<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Performance

How a **low-traffic site on a serverless stack stays fast.** This is the part of
v4 that took the most design work, because the two facts in that sentence fight
each other: serverless (Vercel functions + a managed Postgres reached over the
public internet) makes the *first* request after any idle gap expensive — a
function cold start, an RDS connect, an IAM/TLS handshake, a cold cache — and
*low traffic* means almost every visit is that first request. The entire
performance design is about hiding that cold path from the one human who shows
up to look at a chart.

It descends from v3's "precompute the hot path" instinct (see
[read-path.md](read-path.md)), but where v3 owned a long-lived box and could
materialize a read model in memory, v4 has no box — so the same instinct is
expressed as **layers of cache, a warmer, and a client that asks for exactly
what it needs.** The shipped constants live in
[`web/lib/chart-format.ts`](../../web/lib/chart-format.ts) and
[`web/lib/data-cache.ts`](../../web/lib/data-cache.ts).

## The cost being hidden

A measured cold request to a freshly-spun-up function — cold function + RDS
Proxy-less direct connect + IAM token mint + TLS + a cold-cache query — was on
the order of **~7.8 s**. That number drove most of the thresholds below (e.g. the
30 s fetch timeout is deliberate headroom over it). The job is to make sure a
real visitor almost never pays it.

## Server side: caching and warming

### The two-layer cache

Freshness is managed by two independent layers so the common case never touches
Postgres; the mechanics (Vercel CDN over the Next.js Data Cache, the
`bench-data` tag, the `?n=` window rules) are described in
[read-path.md](read-path.md#the-two-layer-cache). Two performance decisions
about those layers are worth calling out here.

**The Data Cache backstop is 24 hours, not the obvious hour.**
`DATA_CACHE_BACKSTOP_SECONDS = 86400`
([`web/lib/data-cache.ts`](../../web/lib/data-cache.ts)) caps how long a cached
default-window read can live before it must recompute. On a busy site you would
keep this short. Here it is deliberately *long*: benchmark data lands only a few
times a day, and a low-traffic site idles overnight, so a short backstop just
guarantees that the first visitor each morning pays the cold RDS fill. A 24-hour
backstop keeps the default last-100 window warm across the idle gap; the
ingest-driven flush (below) is what keeps it *fresh*, so the backstop is only
the safety cap, never the freshness mechanism.

**Only the default last-100 window is cached.** Every other `?n=` rides the
per-URL CDN cache and runs a direct query, so the Data Cache key space cannot
explode. The four cached reads — groups, the filter universe, a group's default
bundle, a chart's default payload — are the only `unstable_cache` wrappers in the
app, all sharing the `bench-data` tag.

### Refresh on ingest

The backstop bounds staleness; `POST /api/revalidate`
([`web/app/api/revalidate/route.ts`](../../web/app/api/revalidate/route.ts))
*removes* it. On a successful ingest the emitter calls it and it runs
`revalidateTag('bench-data', 'max')`, which marks the entries stale rather than
dropping them: the next read of each serves the previous data once and refreshes
it in the background, and the read after that gets the fresh data, instead of
waiting out the 24-hour cap. No read waits on the database because of an ingest;
new results can take about one more CDN cycle (five minutes) to show. Dropping
the entries instead (`{ expire: 0 }`) failed in production: every fill then
shared one advisory lock, the emitter revalidates after every benchmark job
(about once a minute during a develop run), and the reads that waited on the
lock ran out of retries. A failed render of `/` then stayed in the CDN for five
minutes. Each entry now fills under its own lock (see
[read-path.md](read-path.md#database-connection)). The
endpoint **fails closed** — a missing `BENCH_REVALIDATE_TOKEN` is a `503`, never
a silent accept — and the post-ingest hook is **best-effort**: every failure in
it is caught, logged, and swallowed so a cache-refresh problem can never change
an ingest's exit code. That is why the whole path is safe to ship before the
emitter cutover wires the token (it is inert until both `BENCH_SITE_BASE_URL`
and the token are set).

### Keeping the function and its connections warm

Caches handle *repeat* reads; they do nothing for the first read after an idle
gap, which is the dominant cost on this site. Two crons keep the hot path warm:

- **The warmer — a Vercel-native cron, `*/2 * * * *` on `/api/health`**
  ([`web/vercel.json`](../../web/vercel.json)). `/api/health` runs one
  `SELECT 1`, so each ping checks connectivity and warms one pooled Postgres connection
  without scanning benchmark tables. The pool uses a **5-second** idle timeout
  (`BENCH_DB_IDLE_TIMEOUT_MS`, default `5000`, in
  [`web/lib/db.ts`](../../web/lib/db.ts)). Its
  [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool)
  hook keeps the invocation alive while pg closes idle clients before suspension.
  Connections can serve concurrent requests, but expire between cron pings.
  Existing deployments that override the previous 5-minute default must lower the override
  to benefit from prompt cleanup. `0` is rejected because it disables idle cleanup.
- **The GitHub `bench-keep-warm` workflow** (see
  [deploy-and-infra.md](deploy-and-infra.md)) pings the public read
  surface on its own schedule and doubles as a lightweight uptime check
  (`curl --fail`).

**Why two crons.** GitHub *scheduled* workflows only fire from the default
branch, so the `bench-keep-warm` workflow is dormant on any feature branch and
only becomes active once merged to `main`. The Vercel cron, by contrast, runs
against production deployments — and because this repo deploys with
`vercel deploy --prebuilt --prod` (git integration off), it fires even from a
feature-branch deploy. The Vercel-native warmer is therefore the one that works
*before* a merge, which is exactly when you are testing whether the site feels
fast.

**Honest limit:** one cron ping warms one function instance. Under multi-instance
scaling that is not full coverage — but a low-traffic site effectively runs one
instance, so the ping warms the path the typical first visitor actually takes.

### One query per group

A group page inlines every chart's payload (99 for TPC-DS, 43 for Clickbench).
`groupChartPayloads` ([`web/lib/queries.ts`](../../web/lib/queries.ts)) builds
them from two statements instead of two per chart: the last `n` commits, and
every chart's rows in that window, one `LATERAL` join per chart (in slices of
25 charts, so a TPC-DS group runs five). They run one after another on one
connection, in one `REPEATABLE READ` snapshot. A chart's x-axis is the last
`min(n, total)` commits of the shared window, so the JSON is byte-identical to
`chartPayload`'s, which a test and a dump check pin. On one connection the
per-chart `MIN` over a query chart's whole history became the cost, so it is a
skip scan of `idx_query_measurements_summary`, and the commit count is a
binary search. `QUERY_CONCURRENCY` now bounds only the summaries in
`collectGroups`. On the 2026-10-28 dump at `n=100`, warm: TPC-DS (NVMe) SF=1
1.57 s → 0.31 s, Clickbench 0.82 s → 0.14 s, Compression 68 → 117 ms (its
`MIN` still reads every row). At `?n=all` the TPC-DS group takes 5.2 s against
4.7–4.9 s, and its peak memory stays under 1.5× the old fan-out's (1.2–1.8 GB
against 1.3 GB over four runs each).

### `query_measurements` reads filter on a denormalized timestamp

The biggest read-path win came from a query fix, not a cache. Each per-chart
`query_measurements` query used to read a chart's **entire** history (~18 k rows)
just to return the latest ~665-row window, because recency was applied by joining
`commits` on `commit_sha` *after* a full scan. The fix
(`queryMeasurementWindowFilter` in
[`web/lib/queries.ts`](../../web/lib/queries.ts)) filters directly on the
**denormalized `commit_timestamp`** column — populated on every write path and
backed by the read-path index (migration `006`/`007`, see
[deploy-and-infra.md](deploy-and-infra.md)) — so
the query becomes a bounded index scan returning the identical rows (a
`commit_sha IN (last-N)` tie-trim guards same-timestamp ties). EXPLAIN-verified
≈5× per chart, ≈9× on a cold TPC-DS group (~4.7 s → ~0.5 s).

The diagnosis is the interesting part. The slowness was first blamed on
DB throughput and then on instance size; Performance Insights showed the
opposite — RDS CPU ~5 %, near-zero physical I/O, the load almost entirely
in-process — so it was neither disk- nor core-bound. The real causes were a
client-side request burst (see *lazy hydration* below), function cold start, and
this **over-read**. More hardware would not have helped; reading fewer rows did.

### `?n=all` is I/O-bound: the answer was RAM, not downsampling

The full-history (`?n=all`) path has the opposite profile. Loading every row of
a large group cold is **physical-I/O-bound**: the working set (~6 GB) exceeded the
~1 GB of cache on the original small instance, so pages churned through the buffer
cache (Performance Insights showed ~80 % I/O wait, `ReadIOPS` spiking from zero).
The fix was to **upsize the instance to `db.r7g.large` (16 GiB)** so the whole
database fits in cache (see
[deploy-and-infra.md](deploy-and-infra.md#aws-infrastructure-infra)); a cold-ish
read dropped ~0.5 s → ~0.13 s and cross-group "cold again" churn disappeared.

The tempting alternative — *server-side downsampling of `?n=all`* — was rejected
for this goal: downsampling shrinks the response *payload*, but you have to read
all the rows before you can downsample, so it does nothing for the cold **read**.
It is left unbuilt and is only relevant if wire size, not cold-start, ever
becomes the bottleneck.

## Client side: hydration and interaction

The server makes a single payload cheap; the client decides *when and how many*
to ask for. The pure helpers below live in
[`web/lib/chart-format.ts`](../../web/lib/chart-format.ts); the fetch queues are
in [`web/lib/chart-store/queues.ts`](../../web/lib/chart-store/queues.ts), the
chart island in [`web/components/Chart.tsx`](../../web/components/Chart.tsx) and
the Chart.js wiring in [`web/components/chart/`](../../web/components/chart/).

### Lazy hydration, top first

Opening a 43-chart group used to hydrate every card at once, in island-
registration order (which tended to start from the *bottom*). Hydration is now
gated by an `IntersectionObserver` with `LAZY_HYDRATION_ROOT_MARGIN = '300px
0px'` (a card begins hydrating just before it scrolls into view) and scheduled by
`priority = -index` so the top cards render first. Only the ~6 visible charts
hydrate on open; the rest hydrate on scroll. The initial latest-100 fetches are
capped per tab (`HYDRATION_CONCURRENCY = 4`). A collapsed group has no islands
at all: its cards mount only when it opens (see "Collapsed groups on the landing
page" below).

### Full history is opt-in

v4 inherited v3's habit of speculatively warming `?n=all` for every chart on
group open — which, on a 22-chart group, queued tens of megabytes nobody asked
for and contended with the windowed fetches a user is actually waiting on. That
auto-warmup was **removed**. Full history now loads only on a deliberate
per-chart signal:

- **An always-visible window chip** ("latest 100 of 3,572") with a
  windowed → loading → complete → error/retry state machine, so the partial view
  is never silent and a failed load is retryable. Charts with fewer than 100
  commits are born complete and show no chip.
- **A ~1000 ms hover *dwell*** (`HOVER_DWELL_MS`) starts a silent prefetch at a
  mid-tier priority (`HOVER_PREFETCH_PRIORITY = 500_000`, between idle background
  `0` and a direct `INTERACTION_FULL_PRIORITY = 1_000_000`), so a deliberate
  hover has data ready while a mouse sweep across the page fetches nothing.
  `pointerleave` cancels a pending dwell.
- **Panning or zooming into the unloaded region** promotes the upgrade at
  interaction priority (`rangeTouchesUnloadedHistory`).

### The virtual full-length x-axis (jank-free load-more)

Loading a small window first and "more" later is normally jarring in Chart.js
because the x-axis re-bases when points are prepended. v4 sidesteps that
entirely: the windowed response carries `history.total_commits` / `start_index`,
and `normalizeChartPayload` builds **every chart on the full-length virtual
x-axis from the start**, with `null` placeholders for the unloaded prefix and the
range slider sized to the full length immediately. When `?n=all` arrives, the
nulls are filled in place — nothing re-bases, and the visible window the user was
looking at is preserved. This is the load-bearing trick that makes opt-in full
history feel seamless rather than janky.

### Fetch resilience

Both chart fetches use a per-fetch `AbortController` plus a `FETCH_TIMEOUT_MS =
30000` timeout (generous headroom over the ~7.8 s cold first-hit, so a
slow-but-live request is never falsely killed). Closing or re-opening a group
**aborts** its in-flight fetches instead of piling more load on the server, and a
stall aborts at the timeout rather than spinning "loading…" forever. The window
chip's retry re-issues the *fetch* (an earlier version only retried chart
*construction*, which did not help a failed request).

### Fast "Expand All": the group bundle + session cache

"Expand All" should load everything quickly, but the per-chart, viewport-gated
path does the opposite — it loads only what is on screen. So a toggle-open kicks a
single `GET /api/group/{slug}?n=100` **bundle** fetch
(`ensureGroupBundle`, [`web/lib/chart-store/bundles.ts`](../../web/lib/chart-store/bundles.ts))
into a session-lifetime `payloadCache`, priming every chart in the group with one
request (~150–300 KB gzipped) instead of dozens. The `IntersectionObserver` still
gates the *Chart.js construction* (the actual CPU cost), and bundles run at
`BUNDLE_CONCURRENCY = 3` ordered by `-index` so Expand All drains top groups
first. The cache is per-session by design: a close/reopen costs zero fetches, and
the small staleness window for an already-open tab after a server-side
revalidation is accepted (a refresh gets fresh data).

### Collapsed groups on the landing page

Every group starts collapsed: its header row, with the Vortex-vs-Parquet
headline, and its summary table, both server-rendered. Its toolbar and cards
([`GroupBody`](../../web/components/GroupBody.tsx)) mount only while it is open,
so a collapsed group hydrates no island. The open groups live in
the URL fragment (`/#compression,clickbench`), which the CDN never sees. An
inline script before the first group
([`OpenGroupsScript`](../../web/components/OpenGroupsScript.tsx)) opens each
listed group as soon as the parser inserts it: its `MutationObserver` callback
runs before the browser can paint the new nodes. So a reload or Back never
shows them collapsed first, even on a connection slow enough that the first
groups paint before the last arrive. A second script after the last group ends
the work and leaves a marker for the client code: a group the reader opens or
closes before hydration stays that way, and a reader who scrolls, touches,
clicks or presses a key before hydration is not moved, neither by the restore
nor by the scroll to a link's first group. Scroll is
restored by element, not by pixel
([`lib/scroll-restore.ts`](../../web/lib/scroll-restore.ts)): the open bodies
mount only after hydration, so a saved `scrollY` would land against a shorter
page. While no group is open the page leaves restoration to the browser
(`history.scrollRestoration` stays `auto`), because the collapsed list is as
tall before hydration as after; it switches to `manual` while a group is open.

Measured against the previous build, the head of `claude/bench-cleanup`
(b4caf7c): a local restore of the production dump, desktop (1440×900), no
network throttling, CPU 4×, the median of 5 runs (Expand All: the median of 3),
with one-off scripts that are not in this repository.

- Landing HTML 84 → 27 KB gzipped, islands 791 → 0, DOM elements
  21,237 → 1,585, script time 186 → 59 ms.
- The groups first paint at 413 → 182 ms. First contentful paint rises
  124 → 184 ms, because the previous build first paints its "Loading benchmark
  summaries…" card and shows it until its 2.3 MB page has parsed. The new page
  is small enough that its first paint already shows the groups.
- Back and Reload with two groups open put the same card within 1 px of its
  saved offset. The reader sees the top of the page for 1–2 frames, then that
  spot. The Layout Instability API scores these loads at 1.4–1.8. It counts
  content that moves above the restored card: the cards that mount during that
  jump, and the empty cards that hide once the bundles arrive. The restore's
  two scrolls cancel both, so the reader sees no shift after the jump.
- Expand All mounts all 791 islands in the toggle tasks that follow the click:
  574 ms of blocking time against 500 ms.

Each request to `/` decides how to send the groups
([`app/page.tsx`](../../web/app/page.tsx)). It starts reading them and waits up
to 300 ms (`LOADING_VIEW_AFTER_MS`). A Data Cache hit answers well inside that,
so the page renders the groups directly, with no Suspense boundary: plain,
visible HTML that a reader with JavaScript off can read in full. A miss gets a
Suspense boundary instead: the "Loading benchmark summaries…" view streams at
once and the groups follow into a hidden segment that React's inline script
reveals. Without JavaScript that reveal never runs, so the loading view says to
reload in a few minutes (the CDN keeps a copy of `/` for five). A client
navigation to `/` on a miss shows the same loading view instead of holding the
previous page. A database failure inside the wait fails the render, so `/`
returns a real 500; one after it reaches the reader as an error inside a 200
response that has already started.

Measured as above (local dump, desktop, CPU 4×, median of 5; the cold runs on a
server restarted with an empty Data Cache), against the build that always waited
for the data (c4e0934, on #120) and, for the first column, the build that always
streamed the loading view (511c316):

| `/` | Always streamed | Always waited | Decides per request |
| --- | --- | --- | --- |
| Miss: time to first byte | 40 ms | 590 ms | 180 ms |
| Miss: first contentful paint | 184 ms (loading view) | 720 ms | 328 ms (loading view) |
| Miss: groups laid out | 613 ms | 633 ms | 605 ms |
| Hit: time to first byte | 12 ms | 12 ms | 13 ms |
| Hit: first contentful paint | 96 ms (loading view) | 140 ms | 136 ms |
| Hit: groups laid out | 368 ms | 39 ms | 50 ms |
| Client navigation on a miss: loading view | (not measured) | never | 175 ms |
| Client navigation on a miss: groups | (not measured) | 583 ms | 593 ms |

"Groups laid out" is the first animation frame in which a group section has
layout. In production a miss costs the cold database read, seconds after an idle
gap (see "The cost being hidden"); the CDN and the 24-hour Data Cache backstop
keep misses rare, and an ingest causes none: it marks the entries stale rather
than dropping them (see "Refresh on ingest"), so the next render of `/` takes
the plain-HTML path with the previous data.

The threshold was first 150 ms, measured against the local Data Cache, where a
hit answers in a few milliseconds. On Vercel a hit reads the cache over the
network: on 2026-10-30, 1 of 12 cache-busted production renders of `/` missed
150 ms and streamed the loading view, which the CDN would then keep for five
minutes. At 300 ms a hit has room, and a miss still shows the loading view
early.

### Visual downsampling (LTTB)

A chart card is only ~600–900 px wide and Chart.js draws ~2 px markers, so a
window of thousands of commits is downsampled client-side to
`MAX_VISIBLE_POINTS = 500` representatives via **LTTB**
(Largest-Triangle-Three-Buckets, `lttbIndices`). This is why the server never
needs to cap a wide window for readability — the thinning is the client's job,
and it preserves the visual shape (peaks and troughs) far better than uniform
sampling.

## What this buys

The net effect: a returning visitor hits a warm CDN entry; a first visitor after
an idle gap hits a warm function with warm connections and a warm Data Cache; a
genuinely cold path is bounded and recovers (abortable, retryable, time-limited);
and the heavy `?n=all` read is a deliberate, RAM-resident scan rather than a
surprise. The honest gaps are written down where they live: single-instance
warming, session-scoped (not version-invalidated) client cache, and per-chart
(not batched) group queries — all acceptable for a trusted-input, low-stakes
dashboard, and all noted as future levers rather than hidden.
