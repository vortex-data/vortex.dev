<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Previous generations (v2 and v3)

The benchmarks site has been rebuilt twice; the current site is the third generation (**v4**).
This document is the home for everything about the previous two generations while they are
decommissioned: what they were, what state they are in, how to run their code, and what remains
to tear down. The full history and the design rationale behind each rebuild live in
[`architecture/`](architecture/README.md).

## The generations

| Gen | Stack | Storage | Status |
|---|---|---|---|
| **v2** | Node `server.js` + Vite/React SPA on Cloudflare | Static `data.json.gz` dump in public S3 | Retired from serving; its S3 dump still receives CI uploads |
| **v3** | Rust `axum` + `maud` server on an EC2 host | DuckDB file on local disk | **Fully decommissioned 2026-07-08** — host, backups, ingest steps, and code all deleted |
| **v4** | `web/` (Next.js App Router) on Vercel | AWS RDS Postgres | **Live production** at `bench.vortex.dev` |

The v2 source was deployed from elsewhere and never lived in this repo, though its S3 dump was
the migrator's historical source.

All three generations were fed by the same emitter output, so the record shapes are identical
across them — that shared shape is what made the v2→v3→v4 migration a faithful copy rather than a
re-derivation.

Why three? Each generation traded the previous one's main weakness:

- **v2 → v3** moved from *read-time* classification of loose name strings (all the grouping logic
  ran in the browser/Node server on every load) to *ingest-time* structured records in a real
  analytical store (DuckDB), with a precomputed read model so the landing page costs zero SQL.
- **v3 → v4** moved from a single self-managed EC2 host (DuckDB on local disk, a systemd polling
  deploy) to a managed serverless stack (Next.js on Vercel reading hosted RDS Postgres), so there
  is no box to operate.

## Where the code went

The whole v3 Rust tree — `server/` (the `axum` ingest/read server), `migrate/`
(`vortex-bench-migrate`, the v2→v3→v4 migration tool), `ops/` (the host deploy runbook and
scripts), the Cargo workspace files, and the v3 runbooks — was deleted from the working tree
once the v3 infrastructure was gone. Recover any of it from git history (the deletion commit's
parent has the final state).

The one contract that outlived the deletion is the `measurement_id` hash: the Rust
implementation in `server/src/db.rs` generated the golden vectors that now live in the monorepo
(`scripts/measurement_id_golden.json`, asserted by `scripts/tests/test_measurement_id.py`
against the Python writer). Those vectors are frozen forever — see
[`CONTRACT.md`](../CONTRACT.md).

## v3 teardown record (completed 2026-07-08)

v4 serves the full history and is a superset of the v2 dump (after the 2026-07-07 merge backfill
restored the appian and fineweb `[s3]` history). The accepted loss is ~910 v3 chart points that
never reached the v2 dump.

- Monorepo PR #8683 deleted the three `V3_INGEST_URL`-gated v3 ingest steps (`bench.yml`,
  `sql-benchmarks.yml`, `commit-metadata.yml`) and promoted the v4 ingest steps
  (`post-ingest.py --postgres`) from `continue-on-error: true` to required.
- The `V3_INGEST_URL` variable and `INGEST_BEARER_TOKEN` / `ADMIN_BEARER_TOKEN` secrets were
  deleted from the monorepo.
- The EC2 host (`connor-benchmarks-v3`, us-east-2), its `bench-v3-ingest` security group, the
  `VortexBenchServerRole` IAM role/instance profile, the `VortexBenchV3Backups` policy, and the
  `vortex-benchmark-results-database` S3 backup bucket were all deleted.
- This repo deleted the v3 code (see above).

`vortex-bench/src/v3.rs` and `post-ingest.py` stay in the monorepo — the "v3" JSONL record shape
is v4's wire format, not a v3 leftover.

## v2 teardown inventory (remaining)

Blocked first on repointing the monorepo's PR-benchmark compare off the v2 S3 bucket
(`sql-benchmarks.yml` and `bench-pr.yml` download `data.json.gz` as the comparison baseline).
Then, in the monorepo: delete the v2 upload steps (`cat-s3.sh`, `commit-json.sh`, the
commit-metadata S3 job), the `benchmarks-website/` directory (the v2 site source), and
`publish-benchmarks-website.yml`, plus the GHCR site image. Finally: the orphaned v2 Cloudflare
project and the `vortex-ci-benchmark-results` bucket itself.
