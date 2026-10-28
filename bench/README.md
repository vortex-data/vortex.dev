<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# benchmarks-website

The public home for **Vortex benchmark results** — and the data pipeline behind it. Benchmark jobs
in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex) monorepo emit one measurement
per commit; this repo stores those measurements in Postgres and renders them as time-series
charts — one per `(benchmark, dataset, …)` dimension tuple, plotted across the Vortex commit
history.

**Live at [bench.vortex.dev](https://bench.vortex.dev).**

> This repo owns the **storage, the read service, and the ingest contract** — not the benchmark
> runs. The emitters live in the monorepo and stay there.

## Architecture

The system is a small pipeline with three stages: benchmark CI runs **emit** measurements, a
hosted Postgres database **stores** them, and a serverless web app **reads** them back out as
charts. There is no ingest server and no box to operate — CI writes straight to the database, and
the site reads straight from it.

```
 vortex-data/vortex monorepo (CI)
┌──────────────────────────────────┐
│ benchmark jobs                   │
│   vortex-bench ─▶ JSONL records  │
│   scripts/post-ingest.py         │
└───────┬──────────────────┬───────┘
        │ upsert rows      │ POST /api/revalidate
        │ (direct SQL)     │ (flush the read cache)
        ▼                  ▼
┌────────────────┐  SQL  ┌─────────────────────────────┐      ┌────────────────────┐
│ AWS RDS        │◀──────│ web/ — Next.js read service │─────▶│ charts, one per    │
│ Postgres       │       │ on Vercel (server-rendered, │      │ dimension tuple    │
│ (vortex_bench) │       │ Data Cache + CDN in front)  │      │ @ bench.vortex.dev │
└────────────────┘       └─────────────────────────────┘      └────────────────────┘
```

**Emit.** Each benchmark CI run in the monorepo writes JSONL measurement records
(`vortex-bench --gh-json-v3`), and `scripts/post-ingest.py` delivers them. Every measurement is
one of five kinds — query time, compression time, compression size, random-access time, and
vector search — each carrying a commit SHA plus the dimension tuple that identifies its chart.
The versioned wire format is this repo's [`CONTRACT.md`](CONTRACT.md).

**Store.** One AWS RDS Postgres database holds one fact table per measurement kind plus a
`commits` dimension table. Each fact row is keyed by `measurement_id`, a deterministic hash of
the commit and dimension tuple, so re-running a benchmark for the same commit updates the row
instead of duplicating it. The schema lives in [`migrations/`](migrations/) and deploys through a
GitHub-OIDC workflow, and a single `SCHEMA_VERSION` integer keeps emitters and readers in
lockstep across the two repos.

**Read.** [`web/`](web/README.md) is a Next.js App Router app on Vercel. Every page is rendered
on the server from live Postgres queries — there is no build-time data step — and two cache
layers make that cheap: the Next.js Data Cache keeps the default views warm (flushed by the
ingest hook `POST /api/revalidate` after each run lands), and the Vercel CDN serves repeat
traffic with a five-minute freshness window. Charts and groups are addressed by opaque slugs that
encode their dimension tuple.

The full story — the data pipeline in detail, the read path and its caches, how a low-traffic
serverless site stays fast, deploy and infra, and the design decisions behind the stack — is in
[**`docs/architecture/`**](docs/architecture/README.md). **Start there.**

This site is the third generation of the benchmarks site; the previous two (v2 and v3) are
retired or being decommissioned, and everything about them lives in
[`docs/legacy.md`](docs/legacy.md).

## Find your way around

| If you want to… | Go to |
|---|---|
| understand the whole system | [`docs/architecture/`](docs/architecture/README.md) |
| know the emitter ↔ ingest wire format | [`CONTRACT.md`](CONTRACT.md) |
| work in this tree (env vars, conventions, footguns) | [`AGENTS.md`](AGENTS.md) |
| deploy, set up secrets, or run a data refresh | [`docs/runbooks/`](docs/runbooks/) |
| read about the previous generations (v2, v3) | [`docs/legacy.md`](docs/legacy.md) |
| dig into one component | the per-directory READMEs in the layout below |

## Layout

| Path | What it is |
|------|------------|
| `web/` | The Next.js read service on Vercel ([README](web/README.md)). |
| `migrations/` | The Postgres schema — SQL migrations + the `_applied_migrations` ledger. |
| `infra/` | AWS provisioning for the hosted Postgres + IAM ([README](infra/README.md)). |
| `scripts/` | The schema-deploy runner and golden fixtures. |
| `docs/` | Architecture docs, operational runbooks, and the legacy-generations doc. |

## Quick start

```bash
# The web app needs BENCH_DB_* env vars for a real database — see web/README.md.
cd web && pnpm install && pnpm dev
```

`pnpm build` deliberately works without a database, so CI can build with no secrets. See
[`AGENTS.md`](AGENTS.md) for the full local-dev and env-var contract.

## Status

The site is **live production**: `bench.vortex.dev` is served by the Vercel deployment, and the
monorepo emitters write each run directly to Postgres as a required CI step. The v3 generation is
fully decommissioned (infrastructure and code); what remains is the v2 teardown, whose inventory
is in [`docs/legacy.md`](docs/legacy.md).

## License

Apache-2.0. See the SPDX headers in each file.
