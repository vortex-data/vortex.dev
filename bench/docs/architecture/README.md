<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Architecture

This directory describes the **whole** benchmarks-website system: how benchmark
results get from a CI run into a chart on a web page, the three generations of
the site that have carried that job over time, and the design decisions behind
the current stack.

Start here, then follow the links below by topic.

| Document | What it covers |
|---|---|
| [`data-pipeline.md`](data-pipeline.md) | Emitters → ingest contract → storage → the `vortex-bench-migrate` tool (v2→v3→v4). The `measurement_id` invariant and `SCHEMA_VERSION`. |
| [`read-path.md`](read-path.md) | How results become charts: the v4 Next.js read service (rendering, the two-layer cache, revalidation, slug/window encoding) and the v3 Rust read model it descends from. |
| [`performance.md`](performance.md) | How a low-traffic serverless site stays fast: the cache layers + warmer cron, the recency-filter and RAM fixes, and the client's lazy hydration, opt-in full history, and fetch resilience. |
| [`deploy-and-infra.md`](deploy-and-infra.md) | AWS (RDS Postgres, IAM roles, GitHub OIDC), the schema-deploy and web-deploy workflows, the SQL migrations, and the legacy v3 host ops. |
| [`design-decisions.md`](design-decisions.md) | A consolidated, ADR-style log of the load-bearing decisions and *why* they were made. |

For the operational view (how to deploy, what secrets exist) see the runbooks
under [`../runbooks/`](../runbooks/) and
[`../../infra/README.md`](../../infra/README.md). The wire contract between the
monorepo emitters and this repo's ingest is
[`../../CONTRACT.md`](../../CONTRACT.md). The legacy component docs
(`server/ARCHITECTURE.md`, `migrate/README.md`, `ops/README.md`) were deleted
with the v3 tree and live in git history — see [`../legacy.md`](../legacy.md).

## The one-paragraph version

Benchmark jobs in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo emit per-commit measurements. Those measurements land in a database, and
a web app renders them as time-series charts — one chart per `(benchmark, dataset,
…)` dimension tuple, with the x-axis being the Vortex commit history. The site has
been rebuilt twice; **v4 is live production** at `bench.vortex.dev`, and the two
previous generations survive only until their teardown finishes (see
[`../legacy.md`](../legacy.md)).

## The three generations

```
            EMITTERS (monorepo CI: vortex-bench --gh-json-v3 + scripts/post-ingest.py)
                 │
                 │  the same record shapes feed every generation
        ┌────────┼───────────────────────────┐
        ▼        ▼                            ▼
   ┌─────────┐  ┌────────────────┐      ┌──────────────────────┐
   │  v2     │  │  v3            │      │  v4                  │
   │  S3 dump│  │  DuckDB        │      │  RDS Postgres        │
   │ (static)│  │  + Rust server │      │  + Next.js on Vercel │
   └────┬────┘  └────────┬───────┘      └──────────┬───────────┘
        │                │                         │
   Vite/React SPA   axum + maud SSR          Next.js App Router
   on Cloudflare    on an EC2 host           (server components)
        │                │                         │
        ▼                ▼                         ▼
   (retired from     (decommissioned)        bench.vortex.dev
    serving)                                  ★ LIVE production
```

| Gen | Stack | Storage | Status (2026-07-08) |
|---|---|---|---|
| **v2** | Node `server.js` + Vite/React SPA, on Cloudflare | A static `data.json.gz` dump in public S3, aggregated in memory at read time | Retired from serving; its S3 dump still receives CI uploads. To be torn down. |
| **v3** | `vortex-bench-server` (Rust, `axum` + `maud`), on an EC2 host | DuckDB file on local disk | **Fully decommissioned 2026-07-08** — infrastructure and code deleted. |
| **v4** | `web/` (Next.js App Router) on Vercel | AWS RDS Postgres | **Live production** at `bench.vortex.dev`; `develop` = production. |

Why three? Each generation traded the previous one's main weakness:

- **v2 → v3** moved from *read-time* classification of loose name strings (all the
  grouping logic ran in the browser/Node server on every load) to *ingest-time*
  structured records in a real analytical store (DuckDB), with a precomputed read
  model so the landing page costs zero SQL.
- **v3 → v4** moved from a single self-managed EC2 host (DuckDB on local disk, a
  systemd polling deploy) to a managed, horizontally-scalable serverless stack
  (Next.js on Vercel reading hosted RDS Postgres), so there is no box to operate.

The migration tool `vortex-bench-migrate` (deleted with the v3 tree; see git
history) is the bridge that carried the full benchmark history v2 → v3 → v4
without losing a row — see [`data-pipeline.md`](data-pipeline.md).

## What's done and what remains

The decoupling from the monorepo is **complete**, and so is the cutover: monorepo
CI writes each run directly to RDS as a required step (direct Postgres write plus
`POST /api/revalidate`), and `bench.vortex.dev` is served by the v4 Vercel
deployment. The v3 generation is fully decommissioned — infrastructure and code.

The only remaining teardown is **v2** (its S3 dump still receives CI uploads and
feeds the monorepo's PR-benchmark comparison). The inventory is in
[`../legacy.md`](../legacy.md).
