<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Deploy and infrastructure

How the v4 stack is provisioned, how code and schema reach production, and the
(decommissioned) legacy v3 host deploy. Operational detail lives in the runbooks
([`../runbooks/`](../runbooks/)) and
[`../../infra/README.md`](../../infra/README.md); this doc is the *why* and the
map.

## AWS infrastructure (`infra/`)

Provisioned by [`infra/provision.sh`](../../infra/provision.sh) in **us-east-1**.

| Resource | What | Notes |
|---|---|---|
| RDS Postgres `vortex-bench-prod` | The v4 database (`vortex_bench`) | Postgres 16, `db.r7g.large` (16 GiB — upsized from the bootstrap default so the working set fits in cache; see [performance.md](performance.md#nall-is-io-bound-the-answer-was-ram-not-downsampling)), IAM auth enabled, managed master password in Secrets Manager (auto-rotated), publicly accessible, 35-day backups (PITR). |
| RDS Proxy `vortex-bench-proxy` | Provisioned for pooling, but **not in the live read path** | VPC-internal (`IAMAuth=REQUIRED`, TLS required), so it is unreachable from both off-VPC CI runners and Vercel's off-VPC serverless functions; the reader connects directly to the instance endpoint (see [read-path.md](read-path.md#database-connection)). A managed pooler is revisited only if connection exhaustion surfaces. |
| Security group `vortex-bench-sg` | Inbound 5432 from `0.0.0.0/0` | The network is open on purpose — the **IAM token signature (or the `bench_read` password) is the gate**, not a network ACL. |
| GitHub OIDC provider | `token.actions.githubusercontent.com` | Account-scoped; lets GitHub Actions assume roles with no long-lived keys. |
| `GitHubBenchmarkSchemaRole` | Role the schema-deploy workflow assumes | Trust scoped to specific repo + branches; permission is `rds-db:connect` as the `migrator` DB user on the **instance** (not the proxy). |
| `GitHubBenchmarkIngestRole` | Role the v4 ingest dual-write assumes | `rds-db:connect` as `bench_ingest`. Separated from schema DDL. Not yet wired to the live emitter. |

### Why these shapes

- **OIDC over long-lived keys.** CI authenticates by exchanging a short-lived,
  repo+branch-scoped GitHub OIDC token for AWS credentials. There are no AWS
  secrets stored in GitHub.
- **Least-privilege, separated roles.** `migrator` can run DDL but not write data;
  `bench_ingest` can write the six data tables but not run DDL; `bench_read` can
  only `SELECT`. A leaked ingest credential can't migrate; a leaked read
  credential can't write. The blast radius of any one credential is small.
- **IAM auth for CI, password for the reader.** CI mints a 15-minute SigV4 RDS
  auth token per connection (time-bounded, never logged). The Vercel reader can't
  do that (no AWS creds in the runtime, and `rds_iam` disables password auth), so
  `bench_read` is the one role that uses a static password.

## Postgres roles and migrations (`migrations/`)

The schema is a Postgres translation of the v3 DuckDB schema: the `commits`
dimension table plus the six fact tables, all keyed by `measurement_id`, with
indexes ordered to serve the read-path filters (dimensional columns), not the hash
key. Migrations are plain `*.sql`, applied in lexicographic order and tracked in a
`public._applied_migrations` ledger.

| Migration | Does |
|---|---|
| `001_initial_schema.sql` | `commits` + six fact tables + chart-query indexes (master-owned). |
| `002_iam_db_user.sql` ✱ | Create `migrator` role, grant `rds_iam` + schema privileges. |
| `003_migrator_ledger_grant.sql` | Grant `migrator` read/insert on the `_applied_migrations` ledger. |
| `004_ingest_role.sql` ✱ | Create `bench_ingest`, grant DML on the six tables. |
| `005_read_role.sql` ✱ | Create `bench_read`, **revoke** `rds_iam`, grant `SELECT`-only. |
| `006_read_path_perf.sql` ✱ | Denormalize `commit_timestamp` onto `query_measurements` + backfill; add read-path / low-cardinality indexes. |
| `007_summary_covering_index.sql` ✱ | Rebuild the summary index with `INCLUDE (value_ns)` for index-only scans. |

✱ = marked `requires-superuser`. These are applied **once, by the RDS master**,
during bootstrap (the role-management and ownership DDL the `migrator` role
deliberately can't run). Steady-state CI then runs as `migrator` against
already-applied files (no-ops per the ledger).

## Schema deploy (`.github/workflows/schema-deploy.yml`)

```
operator clicks "Run workflow"
   │  (workflow_dispatch; dry_run option)
   ▼
GitHub OIDC ──assume──▶ GitHubBenchmarkSchemaRole
   │
   ▼
scripts/migrate-schema.py  ──IAM token, verify-full TLS──▶  RDS as `migrator`
   │
   ├─ apply: run pending migrations in order, record each in the ledger
   └─ status: report applied / pending / orphaned (drift); exit 1 if any drift
```

- **Manual trigger** (`workflow_dispatch`) is the deploy gate — there is a marked
  TODO to auto-apply on push to `develop` now that the OIDC trust exists, left as
  an operator's-call follow-up.
- `dry_run: true` runs `status` only: it reports drift and exits 0 (drift is
  informational in dry-run); a real apply still fails on post-apply drift.
- Serialized concurrency (`cancel-in-progress: false`) prevents two operators
  racing an apply against the same database.
- `migrate-schema.py` is a self-contained PEP 723 script run via `uv run
  --no-project` (this repo has no `pyproject.toml`, so `setup-uv` is configured
  with `sync: false`).

## Web deploy (`.github/workflows/web-deploy.yml`)

```
push to develop  ──▶  production deploy
workflow_dispatch ──▶  preview or production (input)
   │
   ▼
runner: pnpm install + `vercel build [--prod]`   (builds web/ ON THE RUNNER)
   │
   ▼
`vercel deploy --prebuilt [--prod]`              (uploads the prebuilt output)
```

- The Vercel project is **independently owned** by this repo: keyed by
  `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` (GitHub *variables*) and `VERCEL_TOKEN` (a
  *secret*), with **git integration turned off**. That keeps this repo's deploys
  from racing the monorepo's deploys to its own Vercel project.
- The build runs **on the GitHub runner** (not Vercel's builders), so the workflow
  installs pnpm + Node to match `web/package.json` before `vercel build`; the
  prebuilt output is then uploaded, eliminating a build race.
- `develop` **is** production — there is no staging gate. The per-PR CI
  (including a testcontainer migration test) is the gate; a merge to `develop`
  ships straight to the v4 production domain.
- A `web-keep-warm` scheduled workflow pings the production deployment so the RDS
  connection pool and Data Cache stay warm between visits.

## Legacy v3 host deploy (`ops/`) — decommissioned 2026-07-08

The v3 Rust server ran on an EC2 host under systemd, deployed by a **polling**
model (no inbound deploy surface):

- A `vortex-bench-deploy` systemd timer fired `ops/deploy.sh` every 60s. It
  fetched the branch, and if the server/migrator paths changed,
  `cargo build --release`d, swapped a versioned binary via an **atomic symlink**
  + `systemctl restart`, then polled `/health`. On health failure it **reverted
  the symlink and re-probed**; it only stamped success after a healthy probe, so
  a bad SHA retried rather than staying live.
- A `vortex-bench-backup` timer hourly `POST`ed to the loopback admin
  `/api/admin/snapshot`, tarred the per-table Vortex snapshots, and uploaded to
  S3 (7-day lifecycle).

The host, its backups, and the `ops/` scripts are all gone (see
[`../legacy.md`](../legacy.md)); the scripts live in git history.

## Where deploy state lives

| Thing | Where |
|---|---|
| Vercel project IDs | `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` GitHub variables; `web/.vercel/project.json` (gitignored) |
| Vercel deploy token | `VERCEL_TOKEN` GitHub secret |
| Schema-deploy role ARN, RDS region/db/endpoint | `GH_BENCH_SCHEMA_ROLE_ARN`, `RDS_BENCH_REGION`, `RDS_BENCH_DB_NAME`, `RDS_BENCH_INSTANCE_ENDPOINT` GitHub variables |
| v4 DB connection (reader) | `BENCH_DB_*` Vercel environment variables (Production/Preview) |
| Revalidate token | `BENCH_REVALIDATE_TOKEN` Vercel env (deferred until emitter cutover) |
| RDS master password | AWS Secrets Manager (`rds!db-…`, auto-rotated) |

The full secret/variable inventory and the step-by-step setup are in
[`../runbooks/deploy-secrets-setup.md`](../runbooks/deploy-secrets-setup.md).
