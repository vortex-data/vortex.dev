<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Deploy and infrastructure

How the v4 stack is provisioned, how code and schema reach production, and the
(decommissioned) legacy v3 host deploy. Operational detail lives in
[`infra/README.md`](../../../infra/README.md); `../runbooks/` holds one
historical note. This doc is the *why* and the map.

## AWS infrastructure (`infra/`)

Provisioned by [`infra/provision.sh`](../../../infra/provision.sh) in **us-east-1**.

| Resource | What | Notes |
|---|---|---|
| RDS Postgres `vortex-bench-prod` | The v4 database (`vortex_bench`) | Postgres 16, `db.r7g.large` (16 GiB — upsized from the bootstrap default so the working set fits in cache; see [performance.md](performance.md#nall-is-io-bound-the-answer-was-ram-not-downsampling)), IAM auth enabled, managed master password in Secrets Manager (auto-rotated), publicly accessible, 35-day backups (PITR), deletion protection, storage autoscaling to 100 GiB, automatic minor upgrades. |
| Backup replica in `us-west-2` | Off-region copy of the automated backups | Snapshots and WAL, 14 days of point-in-time recovery. Restore procedure: [`infra/RESTORE.md`](../../../infra/RESTORE.md). |
| SNS topic `vortex-bench-alarms` | Alarms and RDS events | Three CloudWatch alarms (free storage, CPU, connections) and the `failure` / `low storage` RDS events, sent to incident.io. See [`infra/README.md`](../../../infra/README.md#alarms). |
| Security group `vortex-bench-sg` | Inbound 5432 from `0.0.0.0/0` | The network is open on purpose — the **IAM token signature (or the `bench_read` password) is the gate**, not a network ACL. |
| GitHub OIDC provider | `token.actions.githubusercontent.com` | Account-scoped; lets GitHub Actions assume roles with no long-lived keys. |
| `GitHubBenchmarkSchemaRole` | Role the schema-deploy workflow assumes | Trust scoped to specific repo + branches; permission is `rds-db:connect` as the `migrator` DB user on the **instance**. |
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

## Postgres roles and migrations (`db/migrations/`)

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
| `008_migrator_ownership.sql` ✱ | Transfer the bootstrap objects to `migrator`. The last master-run bootstrap migration. |
| `009_compression_uncompressed_size.sql` | Record each source dataset's Arrow memory size on new compression rows. |
| `010_random_access_open_mode.sql` | Add `open_mode` (`cached` or `reopen`) to `random_access_times`. |
| `011_ci_read_role.sql` ✱ | Create `bench_ci_read` for the monorepo's CI, with a connection limit, timeouts, and read-only transactions. |
| `012_commit_branch.sql` | Record the branch each commit was measured on, on `commits`. |
| `013_read_role_limits.sql` ✱ | Limit `bench_read` to 400 connections, with read-only, 30 s statement, and 60 s idle-in-transaction defaults. |

✱ = marked `requires-superuser`. These are applied **once, by the RDS master**
(the role-management and ownership DDL the `migrator` role deliberately can't
run): 002 to 008 during bootstrap, 011 when the monorepo's CI got its role, and 013 on 2026-11-03. Steady-state CI then runs as `migrator` against
already-applied files (no-ops per the ledger).

## Schema deploy (`.github/workflows/bench-schema-deploy.yml`)

```
operator clicks "Run workflow"
   │  (workflow_dispatch; dry_run option)
   ▼
GitHub OIDC ──assume──▶ GitHubBenchmarkSchemaRole
   │
   ▼
db/migrate-schema.py       ──IAM token, verify-full TLS──▶  RDS as `migrator`
   │
   ├─ apply: run pending migrations in order, record each in the ledger
   └─ status: report applied / pending / orphaned (drift); exit 1 if any drift
```

- **Manual trigger** (`workflow_dispatch`) from `main` is the deploy gate; the
  role trusts only `main` of `vortex-data/vortex.dev`. Auto-applying on push to
  `main` is left as an operator's-call follow-up.
- `dry_run: true` runs `status` only: it reports drift and exits 0 (drift is
  informational in dry-run), but any other failure, such as a connection or
  permission error, fails the run. A real apply still fails on post-apply drift.
- Serialized concurrency (`cancel-in-progress: false`) prevents two operators
  racing an apply against the same database.
- `migrate-schema.py` is a self-contained PEP 723 script run via `uv run
  --no-project` (the repository has no `pyproject.toml`, so the workflow only installs
  uv).

## Web deploy (the `vortex` Vercel project)

```
same-repo or fork PR ──▶  Vercel preview of the whole app (bench under /bench)
push to main         ──▶  Vercel production deploy (vortex.dev + bench.vortex.dev)
   │
   ▼
Vercel builds on its own builders: `bun install --frozen-lockfile`, `bun run build`
   │
   ▼
push to main ──▶ .github/workflows/bench-verify-deploy.yml waits for the production deployment
   │
   ▼
verify build SHA + read paths under /bench on the deployment URL (bounded retries),
then a CDN HIT on bench.vortex.dev once it serves this commit (skipped until then)
```

- bench is part of the vortex.dev app, so the `vortex` project's git integration
  builds and deploys it with the marketing site: one preview per pull request with
  both sites, and one production deployment per push to `main`. bench.vortex.dev is
  one of that project's domains; `next.config.mjs` serves bench from its root.
- `main` **is** production — there is no staging gate. The per-PR CI (including a
  testcontainer migration test) is the gate. Vercel deploys a merge to `main` as
  soon as it builds; `ci.yml` checks the same commit beside it, not before it.
- On each push to `main`, `bench-verify-deploy.yml` waits for that commit's
  production deployment (up to 20 minutes), then runs
  `scripts/verify-web-deploy.mjs` against bench under `/bench` on the deployment's
  own URL, and checks CDN caching on bench.vortex.dev, the only form of bench's
  pages production caches, once that domain serves the same commit. An
  authentication error or a failed probe fails the workflow. A protected
  deployment URL needs Vercel's Protection Bypass for Automation; the workflow sends
  its secret from the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret.
- A `bench-keep-warm` scheduled workflow pings the production deployment so the RDS
  connection pool and Data Cache stay warm between visits, and the Vercel cron in
  `vercel.json` calls `/bench/api/health` every two minutes. With `CRON_SECRET` set on
  the Vercel project, only those two callers make the route query the database: Vercel
  sends the secret with the cron, and the workflow sends the same value from the
  `BENCH_CRON_SECRET` repository secret.

### Required merge check

The `main` ruleset of `vortex-data/vortex.dev` requires `Lint, build, verify` and `Lighthouse and
axe` from **GitHub Actions** (app ID `15368`). They check both sites: the first runs bench's
format, lint, build and tests (with the Postgres integration suite) beside the site's, and the
second runs Lighthouse and axe on the pull request's preview. The ruleset does not require
branches to be up to date before merging, so a merged commit is never checked before it lands.

To see the checks for a commit:

```bash
checked_sha="$(git rev-parse HEAD)"
gh api "repos/vortex-data/vortex.dev/commits/${checked_sha}/check-runs" \
  --jq '.check_runs[] | select(.name == "Lint, build, verify" or .name == "Lighthouse and axe") | {name, conclusion, app_id: .app.id}'
```

Each must report `success` and app ID `15368`. Keep the job names when their steps change.

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
| Vercel project | `vortex`, with the git integration; bench.vortex.dev is one of its domains |
| Deploy-check bypass | `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret (Vercel's Protection Bypass for Automation), when the deployment URL is protected |
| Schema-deploy role ARN, RDS region/db/endpoint | `GH_BENCH_SCHEMA_ROLE_ARN`, `RDS_BENCH_REGION`, `RDS_BENCH_DB_NAME`, `RDS_BENCH_INSTANCE_ENDPOINT` GitHub variables |
| v4 DB connection (reader) | `BENCH_DB_*` environment variables on the `vortex` project (Production/Preview) |
| Revalidate token | `BENCH_REVALIDATE_TOKEN` environment variable on the `vortex` project |
| RDS master password | AWS Secrets Manager (`rds!db-…`, auto-rotated) |

The full secret/variable inventory and the step-by-step setup are in
[`../runbooks/deploy-secrets-setup.md`](../runbooks/deploy-secrets-setup.md).
