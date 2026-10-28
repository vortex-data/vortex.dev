<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Read path

How database rows become charts. The forward stack is **v4** (Next.js on Vercel,
reading RDS Postgres); it descends from the **v3** Rust read model, summarized at
the end for context. (The component-level v3 doc, `server/ARCHITECTURE.md`, was
deleted with the v3 tree and lives in git history.)

## The chart abstraction

A *chart* is one `(family, dataset, dataset_variant, …)` dimension tuple plotted
over the Vortex commit history (the x-axis). A *group* bundles related charts
(e.g. all the TPC-H SF=1 NVMe queries). Both are addressed by an **opaque slug**
(below). The default view is the **last 100 commits**; the user can widen it.

## v4 — Next.js read service (`web/`)

A Next.js App Router app of **server components** that query RDS directly and
stream HTML. `develop` is the production branch (see
[deploy-and-infra.md](deploy-and-infra.md)).

### Rendering: `force-dynamic`

Both pages — `/` (landing) and `/chart/[slug]` — set `export const dynamic =
'force-dynamic'`. Each request reads live from Postgres. This keeps `next build`
independent of a database (CI can build with no DB secrets, and there is no
prerender-staleness budget). The landing page fetches all groups + the filter
universe in parallel; the chart page validates the slug *before* querying and
dedupes its payload fetch across `generateMetadata()` and the body via React
`cache()`.

### The two-layer cache

`force-dynamic` does not mean "query the DB on every byte." Freshness is managed
by two independent layers, so the common case is cheap and ingest can flush both:

```
 request
   │
   ▼
 ┌──────────────────────────┐   miss   ┌─────────────────────────┐  miss  ┌──────────┐
 │ Vercel CDN                │────────▶│ Next.js Data Cache       │──────▶│   RDS    │
 │ (per-URL, s-maxage=300,   │         │ (unstable_cache,         │       │ Postgres │
 │  stale-while-revalidate=  │         │  tag 'bench-data',       │       └──────────┘
 │  86400; JSON routes +     │         │  24h backstop)           │
 │  HTML via Vercel-CDN-     │◀────────│                          │
 │  Cache-Control)           │  fill   └─────────────────────────┘
 └──────────────────────────┘
```

- **Layer 1 — Next.js Data Cache** (`web/lib/data-cache.ts`). The four default
  reads (`groups`, `filter universe`, per-group default charts, per-chart default
  payload) are wrapped in `unstable_cache` with the tag `bench-data` and a 24-hour
  backstop (`DATA_CACHE_BACKSTOP_SECONDS = 86400`). Keyed by slug only — *not* by
  query string. The backstop is long because the site is low-traffic: it keeps the
  default window warm across overnight idle gaps so a CDN miss reads this cache
  instead of paying a cold RDS round-trip.
- **Layer 2 — Vercel CDN** (`web/lib/cache.ts`, `web/vercel.json`). JSON read-API
  responses carry `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`
  (5-minute freshness, matching v2's S3 refresh cadence, then up to a day stale
  while revalidating). HTML routes get an equivalent `Vercel-CDN-Cache-Control`
  header — necessary because `force-dynamic` otherwise emits `no-store`, which
  would forbid any CDN caching. Error responses (4xx/5xx) omit the header so they
  are never cached.

**Freshness propagation.** The primary mechanism is
`POST /api/revalidate` (token-gated; `web/app/api/revalidate/route.ts`): on a
successful ingest, `scripts/post-ingest.py` calls it and it runs
`revalidateTag('bench-data')`, flushing Layer 1 so the next read recomputes
against fresh data. The 24h backstop is only the safety cap if that hook never
fires. The endpoint **fails closed** — a missing `BENCH_REVALIDATE_TOKEN` returns
`503`, never silently accepting an unauthenticated flush; the token compare is
constant-time.

> One caveat: a *migrator* backfill or full refresh (as opposed to a CI ingest)
> does not call `/api/revalidate`, so after one the cold/expired Data Cache
> entries simply refill from the fresh RDS on the next read.

### Read API and windows

| Route | Returns |
|---|---|
| `GET /api/groups` | all groups + their chart links (structure only) |
| `GET /api/group/{slug}` | one group with every chart's payload inlined |
| `GET /api/chart/{slug}` | one chart's payload |
| `GET /api/health` | database liveness via `SELECT 1`, build SHA, and schema version (200/503, never cached) |

The `?n=` query parameter selects the commit window: `?n=all` is uncapped;
numeric values are floored to 1 and clamped to `MAX_NUMERIC_COMMIT_WINDOW = 1000`
(a DoS floor against `?n=99999999`); absent/malformed falls back to the default
100. **Only the default last-100 window uses the Data Cache** — every other window
runs a direct query and rides the per-URL CDN cache, so cache keys don't explode.
Visual downsampling of wide windows is done client-side, not by capping the
server window.

### Slugs

Charts and groups are addressed by an opaque `<prefix>.<base64url-of-json>` slug
(`web/lib/slug.ts`). The prefix names the family (`qm`/`ct`/`cs`/`rat`/`vsr` for
charts, `…g` for groups); the JSON payload is the typed key with its discriminant
first, mirroring the Rust serde encoding byte-for-byte so the same slug is valid
against the v3 server and the v4 app. Decoding validates the full payload shape
and rejects malformed slugs with `400` (not `404`). The client never constructs
slugs — it only echoes ones the server produced — so they are not an injection
surface.

### Data model mirror

`web/lib/families.ts` is the TypeScript port of the five-family registry;
`web/lib/queries.ts` builds chart/group payloads with a wire shape identical to
the v3 Axum server (so the frontend is generation-agnostic). The landing-page
order is the curated `GROUP_ORDER` in `queries.ts`:

```
Compression, Compression Size, Random Access, Clickbench,
TPC-H (NVMe/S3) SF=1, SF=10, SF=100 (alternating),
TPC-DS (NVMe) SF=1,
Statistical and Population Genetics, PolarSignals Profiling,
fineweb (NVMe/S3), Appian (NVMe)
```

Groups not in the list sort last, alphabetically.

### Database connection

`web/lib/db.ts` resolves a `pg` pool from `BENCH_DB_*` env vars (host, port, name,
user, password, SSL mode, CA bundle). Production connects as the read-only
`bench_read` role over `verify-full` TLS against the RDS CA bundle in
`BENCH_DB_CA` (Node's trust store does not include the Amazon RDS roots, so this
is required). The pool is a single process-wide instance cached on `globalThis`
with a 5-minute idle timeout — long enough to survive the keep-warm cron's ping
gap so idle requests don't pay a fresh TLS+auth connect. Each statement has a
30-second server-side timeout, so a request timeout cannot leave unbounded work
running in PostgreSQL.

Group Data Cache fills share a PostgreSQL advisory lock across production and
preview functions. One invocation runs the group discovery and summary work.
Contenders release their connections and retry the Data Cache read with bounded
backoff instead of issuing duplicate summary queries.

`bench_read` uses a **static password** rather than RDS IAM auth because the
Vercel runtime has no AWS credentials to mint an IAM token, and RDS `rds_iam`
membership disables password auth. The CI roles (`migrator`, `bench_ingest`) do
use IAM tokens — see [deploy-and-infra.md](deploy-and-infra.md).

## v3 — the Rust read model (context)

`vortex-bench-server` is the generation v4 replaced. It is worth understanding
because v4 inherited its data shapes and its "precompute the hot path" philosophy.
(Its code and `server/ARCHITECTURE.md` were deleted with the v3 tree; see git
history.)

- **Storage:** a local DuckDB file. Ingest (`POST /api/ingest`) applies an
  envelope in one transaction, then schedules a background rebuild of an
  in-memory, immutable **read generation**.
- **Materialized hot path:** at ingest time the server precomputes the JSON for
  the landing page, every group, and the **latest-100 shards** (8 charts each),
  each stored as identity/gzip/brotli bytes with an ETag. The landing page is then
  served as precomputed bytes — zero SQL, zero serialization, zero per-request
  compression. A handful of superseded generations are retained so in-flight page
  reloads can still resolve their versioned shard URLs.
- **Fallback:** non-default `?n=` windows run through a generation-versioned,
  single-flight query cache, bounded by a small read-concurrency semaphore.
- **Frontend:** SSR (`maud`) + a single thin hydration script
  (`server/static/chart-init.js`) — **no WASM, no SPA framework**. The client lazy-
  loads shards, warms full history in the background, and does **LTTB**
  downsampling to ~500 visible points for the current viewport width (which the
  server can't know). Pan/zoom rebuild in place from the cached payload rather than
  refetching.
- **Admin:** a separate **loopback-only** listener (enforced at startup) exposes
  read-only SQL and Vortex-format table snapshots, gated by a distinct bearer
  token from ingest.

v4 keeps the same wire shapes and the same default-window-is-hot instinct, but
swaps the bespoke in-memory read model + EC2 host for Vercel's CDN + Next.js Data
Cache + managed Postgres, so there is no server process to operate.
