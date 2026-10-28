<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Design decisions

A consolidated, ADR-style log of the load-bearing choices in this system and the
reasoning behind them. Each entry is "decision → why → where." Topic docs
([data-pipeline](data-pipeline.md), [read-path](read-path.md),
[deploy-and-infra](deploy-and-infra.md)) carry the fuller context.

> **Note on paths.** This log spans all three generations. "Where" pointers under
> `server/`, `migrate/`, and `ops/` refer to the v3 tree, which was deleted after
> the v3 decommission (see [`../legacy.md`](../legacy.md)) — find those files in
> git history. The decisions themselves still shape the live system.

## Data model

**One fact table per measurement family (not one wide table).**
The five families have genuinely different dimensions. A single wide table would
bloat every row with NULL columns it doesn't use, or split one chart's data across
multiple rows that then need re-joining. Five focused tables keep each row dense
and each chart query a single-table scan.
→ `migrations/001_initial_schema.sql`, `server/src/schema.rs`.

**`measurement_id` is an ingest-internal deterministic hash, never on the wire.**
Hashing `commit_sha` + the dimension tuple makes the upsert automatic: re-emitting
the same measurement hits `ON CONFLICT (measurement_id) DO UPDATE` instead of
duplicating. Keeping it off the wire kept the hash layout private while it had two
implementations; now that every production row is keyed by it, the layout is
frozen outright. Emitters never send it; the ingest writer computes it just before
INSERT.
→ `server/src/db.rs` (original), the monorepo's `scripts/_measurement_id.py`
(current), `CONTRACT.md`.

**v4 computes `measurement_id` client-side, guarded by a golden-vector contract.**
v3 computed the hash in the server, on the ingest path. v4's ingest goes straight
from CI to managed Postgres with no server in the loop, so the writer computes the
hash itself — which takes the always-on ingest service off the write path
entirely. The cost was a second implementation of the hash, in Python, that had to
match the Rust reference byte-for-byte: any drift silently writes a *different*
upsert key and duplicates rows rather than erroring. That cost is bought back with
a Rust-generated golden-vector file (now the monorepo's
`scripts/measurement_id_golden.json`, frozen forever since the Rust reference was
deleted) that the Python writer asserts byte-for-byte in CI — the vectors, not
trust, are the contract.
→ the monorepo's `scripts/tests/test_measurement_id.py`, `CONTRACT.md`.

**The migrator copies `measurement_id` verbatim — never recomputes it.**
The whole point of the v2→v3→v4 migration is fidelity. If the migrator
re-derived the hash, any divergence from the server's logic would silently create
duplicate or colliding keys. Treating it as opaque bytes to transport preserves
the upsert identity bit-for-bit across generations.
→ `migrate/src/postgres.rs`.

**`SCHEMA_VERSION` is a single integer in cross-repo lockstep.**
A wire-shape mismatch between producer and reader is a hard, loud failure (409/400
on every ingest) rather than silent data corruption. The in-repo anchors are
asserted by a test; the cross-repo anchors are documented and must be bumped in
the same logical change.
→ `CONTRACT.md`, `web/lib/schema-version.test.ts`.

## Ingest

**All-or-nothing ingest.**
A partially-applied envelope is an inconsistent state. One transaction per
envelope (with conflict-retry) trades a little ingest latency for a guarantee that
a batch either lands completely or not at all — acceptable for a ~tens-of-runs-a-
day workload.
→ `server/src/ingest.rs`.

**Two ingest paths, with the v4 path additive and best-effort.**
The v3 `POST /api/ingest` is the hard-required path; the v4 direct-Postgres
dual-write + revalidate ping is gated and `continue-on-error`, so bringing v4
online never risks the established v3 ingest. The cutover flips which is
authoritative without a flag day: the v4 path ships dormant-but-safe and is armed
(or disarmed) by a single switch — the `GH_BENCH_INGEST_ROLE_ARN` CI variable — so
it can be rolled back without a deploy.
→ `CONTRACT.md`.

## Migration

**The v2 classifier lives only in the migrator, and only for v2.**
v2 emitted loose name strings that needed read-time classification; v3+ emit
structured records directly. Confining the bug-for-bug port of v2's grouping logic
to a one-shot migration tool keeps the live read path clean and forward-focused,
and the cost is paid once over history rather than on every page load.
→ `migrate/src/classifier.rs`.

**`--replace` is an atomic TRUNCATE+COPY that requires master ownership.**
Re-migrating must not leave the database empty if it fails midway. Putting the
`TRUNCATE` inside the load transaction means a mid-load failure rolls back to the
original data. `TRUNCATE` needs table ownership, so this path deliberately
connects as the RDS master — not the least-privilege ingest role.
→ `migrate/src/postgres.rs`, `migrate/README.md`.

**Value-verify per `measurement_id`, not just row counts.**
Since `measurement_id` is a hash over keys only (not values), equal row counts and
equal key sets don't prove the value columns copied correctly. The verifier
compares every non-key column per row — the real correctness gate for a prod load.
→ `migrate/src/verify.rs`.

## Read path

**SSR + a thin hydration script — no WASM, no SPA framework (v3).**
LTTB downsampling and pan/zoom are fast enough in plain JavaScript; most of the
cost is layout, not an inner loop. Avoiding WASM/SPA keeps the bundle small, the
first paint fast, and iteration simple.
→ `server/static/chart-init.js`, `AGENTS.md`.

**Precompute the hot path (v3); cache the hot path (v4).**
The landing page is heavy. v3 materialized the latest-100 view into precomputed,
pre-compressed byte artifacts at ingest time (zero SQL per load). v4 keeps the
same "default window is special" instinct but expresses it as a cache layer (the
`bench-data`-tagged Data Cache) over live Postgres, so there's no in-memory read
model to operate.
→ `server/ARCHITECTURE.md`, `web/lib/data-cache.ts`.

**`force-dynamic` pages over prerendering (v4).**
Rendering at request time keeps `next build` independent of a live database (CI
needs no DB secrets) and removes any prerender-staleness budget. Freshness is the
cache layers' job, not the build's.
→ `web/app/page.tsx`, `web/app/chart/[slug]/page.tsx`.

**Two cache layers, flushed by an ingest hook with a 24h backstop.**
The CDN (5-min `s-maxage`) absorbs repeat traffic; the Data Cache (24h backstop)
keeps the default window warm on a low-traffic site. `POST /api/revalidate` flushes
the Data Cache tag on ingest so fresh data shows immediately; the backstop is only
the cap if that hook fails. The endpoint **fails closed** (503 when unconfigured)
so an unconfigured deployment never accepts an unauthenticated flush.
→ `web/lib/cache.ts`, `web/lib/data-cache.ts`, `web/app/api/revalidate/route.ts`.

**Only the default window is cached; `?n=` is clamped to 1000.**
Caching every window would explode the key space, so only the default last-100 is
memoized and other windows ride the per-URL CDN cache. The numeric clamp is a DoS
floor against `?n=99999999`; `?n=all` is the explicit, uncapped escape hatch.
Visual thinning happens client-side via LTTB, so the server never needs a huge
window for a readable chart.
→ `web/lib/window.ts`, `web/lib/data-cache.ts`, `AGENTS.md`.

**Opaque, Rust-compatible slugs.**
Slugs are `<prefix>.<base64url-json>`, encoded identically in Rust and TypeScript
so the same slug works against v3 and v4. The client only echoes server-issued
slugs, and decoding validates the full shape, so they are not an injection
surface.
→ `web/lib/slug.ts`.

## Performance & client hydration

The v4 stack is serverless and the site is low-traffic, so the costly case is
the *first* request after an idle gap (function cold start + RDS connect + cold
cache, measured ~7.8s). Most of the v4 performance work hides that from the one
visitor who shows up. Full detail in [performance.md](performance.md).

**Full history is opt-in, not speculatively warmed.**
v3 auto-queued a background `?n=all` fetch for every chart on group open; on a
22-chart group that queued tens of megabytes nobody asked for, contending with
the windowed fetches a user actually waits on. v4 removed the auto-warmup: full
history loads only on a deliberate per-chart signal — a window-chip click, a
~1000ms hover dwell, or a pan/zoom into the unloaded region.
→ `web/components/Chart.tsx`, `web/lib/chart-format.ts`.

**Bounded windows render on the full-length virtual x-axis.**
Loading a small window and then "more" normally re-bases the Chart.js x-axis
(jank). Instead every chart is built spanning `history.total_commits` slots from
the start, with `null` placeholders for the unloaded prefix; the `?n=all` upgrade
fills those nulls in place, so nothing re-bases and the visible window is
preserved. This is what lets opt-in full history feel seamless.
→ `web/lib/chart-format.ts` (`normalizeChartPayload`).

**Lazy, top-first hydration on the landing page.**
Opening a large group hydrated every card at once, and bottom-first (in island-
registration order). Hydration is now gated by an `IntersectionObserver`
(`rootMargin '300px 0px'`) and ordered `priority = -index`, so only the ~6
visible charts hydrate on open and the top renders first.
→ `web/components/Chart.tsx`.

**Chart fetches are abortable, time-bounded, and retryable.**
Each fetch carries an `AbortController` and a 30s timeout; closing/reopening a
group cancels its in-flight fetches rather than piling load on the server, and a
stall aborts instead of spinning forever. 30s is headroom over the ~7.8s cold
first-hit, so a slow-but-live request is not falsely killed.
→ `web/components/Chart.tsx`, `web/lib/chart-store.ts`.

**Expand All loads one bundle per group, not N per-chart requests.**
The viewport-gated per-chart path loads only what is on screen — the opposite of
"load everything." A toggle-open instead fetches one `GET /api/group/{slug}?n=100`
bundle into a session-lifetime payload cache, priming every chart with a single
request; the `IntersectionObserver` still gates the CPU-bound Chart.js
construction. The cache is per-session by design (a close/reopen costs zero
fetches).
→ `web/lib/chart-store.ts` (`ensureGroupBundle`).

**A warmer cron keeps the function and its DB connections hot.**
Caches handle repeat reads but not the first read after idle. A Vercel-native
cron pings `/api/health` every 2 minutes (warming the function instance and
several pooled connections), and the `pg` idle timeout is raised to 5 minutes so
a pooled connection survives between pings. A Vercel-native cron is used (not
only the GitHub `web-keep-warm` workflow) because GitHub scheduled workflows fire
only from the default branch, whereas the Vercel cron also runs against the
feature-branch production deploy.
→ `web/vercel.json`, `web/lib/db.ts`.

**`query_measurements` reads filter on the denormalized `commit_timestamp`.**
The per-chart query used to read a chart's full ~18k-row history to return the
latest ~665 rows, because recency was applied via a `commits` join after a full
scan. Filtering directly on the denormalized, indexed `commit_timestamp` makes it
a bounded index scan returning identical rows (≈5× per chart, ≈9× cold per
group). Performance Insights showed the load was in-process — not I/O- or
core-bound — so reading fewer rows, not more hardware, was the fix.
→ `web/lib/queries.ts` (`queryMeasurementWindowFilter`), migrations `006`/`007`.

**`?n=all` cold reads were fixed with RAM, not downsampling.**
Loading a large group's full history cold is physical-I/O-bound: the ~6GB working
set exceeded the cache on the original small instance. Upsizing to `db.r7g.large`
(16GiB) lets the whole database sit in cache. Server-side downsampling was
rejected for this goal — you must read every row before downsampling, so it does
nothing for the cold read; it only shrinks the wire payload.
→ `infra/provision.sh`.

## Infrastructure & deploy

**OIDC, not long-lived AWS keys.**
CI exchanges a short-lived, repo+branch-scoped GitHub OIDC token for AWS
credentials. No AWS secret is ever stored in GitHub.
→ `infra/provision.sh`, `.github/workflows/schema-deploy.yml`.

**Least-privilege, separated DB roles.**
`migrator` (DDL, no data writes), `bench_ingest` (data writes, no DDL),
`bench_read` (SELECT only). The blast radius of any leaked credential is bounded
to what that role can do.
→ `migrations/00{2,4,5}_*.sql`.

**Master-applied bootstrap, scripted steady state.**
The role-management and ownership DDL (the `requires-superuser` migrations) is
applied once by the RDS master; afterwards CI runs as the unprivileged `migrator`
against an already-applied ledger. CI never holds master-capable privileges.
→ `scripts/migrate-schema.py`, `infra/README.md`.

**An independently-owned Vercel project, built on the runner.**
This repo's Vercel project is keyed by its own org/project IDs with git
integration off, and the build runs on the GitHub runner via `vercel build` +
`vercel deploy --prebuilt`. Both choices stop this repo's deploys from racing the
monorepo's deploys to its project, and give this repo full control of the build
environment.
→ `.github/workflows/web-deploy.yml`.

**`develop` is production; per-PR CI is the gate.**
No staging environment. A merge to `develop` ships straight to the v4 production
domain; the testcontainer migration test and the rest of CI are what gate the
merge.
→ `.github/workflows/web-deploy.yml`.

**Open security group, IAM/password as the gate.**
RDS is publicly reachable on 5432; the access control is the IAM token signature
(CI) or the `bench_read` password (Vercel), not a network ACL — which keeps
serverless callers with dynamic egress IPs working without an allow-list.
→ `infra/provision.sh`.

**The Vercel reader connects directly to the instance, not via the RDS Proxy.**
A proxy was provisioned for connection pooling, but it is VPC-internal and
unreachable from Vercel's off-VPC serverless functions (and from off-VPC CI
runners). Reads therefore go to the public instance endpoint as `bench_read`,
and the CDN + Data Cache absorb nearly all read load; a managed pooler is
revisited only if connection exhaustion actually surfaces.
→ `web/lib/db.ts`, `infra/provision.sh`.

**Polling deploy for the v3 host.**
The EC2 host pulls (timer → fetch → build → atomic symlink swap → health-check →
rollback-on-failure) rather than receiving pushes, so it has no inbound deploy
surface and a bad build never stays live.
→ `ops/deploy.sh`.
