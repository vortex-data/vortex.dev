<!--
SPDX-License-Identifier: Apache-2.0
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
`revalidateTag('bench-data')`, so the next read recomputes against fresh data
instead of waiting out the 24-hour cap. The endpoint **fails closed** — a missing
`BENCH_REVALIDATE_TOKEN` is a `503`, never a silent accept — and the post-ingest
hook is **best-effort**: every failure in it is caught, logged, and swallowed so
a cache-refresh problem can never change an ingest's exit code. That is why the
whole path is safe to ship before the emitter cutover wires the token (it is
inert until both `BENCH_SITE_BASE_URL` and the token are set).

### Keeping the function and its connections warm

Caches handle *repeat* reads; they do nothing for the first read after an idle
gap, which is the dominant cost on this site. Two crons keep the hot path warm:

- **The warmer — a Vercel-native cron, `*/2 * * * *` on `/api/health`**
  ([`web/vercel.json`](../../web/vercel.json)). `/api/health` runs one
  `SELECT 1`, so each ping checks connectivity and warms one pooled Postgres connection
  without scanning benchmark tables. Paired with it, the `pg` pool's idle timeout is
  raised to **5 minutes** (`BENCH_DB_IDLE_TIMEOUT_MS`, default `300000`, in
  [`web/lib/db.ts`](../../web/lib/db.ts)) — comfortably longer than the 2-minute
  ping gap, so a connection minted by one ping survives to serve a visitor who
  lands between pings, rather than re-paying the IAM-token + TLS connect.
- **The GitHub `web-keep-warm` workflow** (see
  [deploy-and-infra.md](deploy-and-infra.md)) pings the public read
  surface on its own schedule and doubles as a lightweight uptime check
  (`curl --fail`).

**Why two crons.** GitHub *scheduled* workflows only fire from the default
branch, so the `web-keep-warm` workflow is dormant on any feature branch and
only becomes active once merged to `develop`. The Vercel cron, by contrast, runs
against production deployments — and because this repo deploys with
`vercel deploy --prebuilt --prod` (git integration off), it fires even from a
feature-branch deploy. The Vercel-native warmer is therefore the one that works
*before* a merge, which is exactly when you are testing whether the site feels
fast.

**Honest limit:** one cron ping warms one function instance. Under multi-instance
scaling that is not full coverage — but a low-traffic site effectively runs one
instance, so the ping warms the path the typical first visitor actually takes.

### Parallel group fan-out

A group page builds one chart payload per chart (99 for TPC-DS, 43 for
Clickbench). The fan-out in `collectGroupCharts`
([`web/lib/queries.ts`](../../web/lib/queries.ts)) runs those queries with an
order-preserving `Promise.all` bounded by the existing `pg` pool (max 8
connections) rather than a sequential `await` loop, so a Data Cache *miss* on a
big group does not serialize into dozens of round-trips. The output (chart set,
order, shape) is unchanged and pinned by an integration test. This was a small,
low-risk change; batching a whole group into one SQL statement is the larger
win, deliberately left for later because the chart shapes are heterogeneous.

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
in [`web/lib/chart-store.ts`](../../web/lib/chart-store.ts) and the Chart.js
wiring in [`web/components/Chart.tsx`](../../web/components/Chart.tsx).

### Lazy hydration, top first

Opening a 43-chart group used to hydrate every card at once, in island-
registration order (which tended to start from the *bottom*). Hydration is now
gated by an `IntersectionObserver` with `LAZY_HYDRATION_ROOT_MARGIN = '300px
0px'` (a card begins hydrating just before it scrolls into view) and scheduled by
`priority = -index` so the top cards render first. Only the ~6 visible charts
hydrate on open; the rest hydrate on scroll. The initial latest-100 fetches are
capped per tab (`HYDRATION_CONCURRENCY = 4`).

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
(`ensureGroupBundle`, [`web/lib/chart-store.ts`](../../web/lib/chart-store.ts))
into a session-lifetime `payloadCache`, priming every chart in the group with one
request (~150–300 KB gzipped) instead of dozens. The `IntersectionObserver` still
gates the *Chart.js construction* (the actual CPU cost), and bundles run at
`BUNDLE_CONCURRENCY = 3` ordered by `-index` so Expand All drains top groups
first. The cache is per-session by design: a close/reopen costs zero fetches, and
the small staleness window for an already-open tab after a server-side
revalidation is accepted (a refresh gets fresh data).

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
