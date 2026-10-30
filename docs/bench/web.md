# Benchmarks web (v4 read service)

Next.js 16 (App Router) read service serving the benchmark charts at
[bench.vortex.dev](https://bench.vortex.dev) from the benchmarks Postgres database. This is the
v4 frontend that replaced both the v2 Vite/React SPA and the v3 Axum server — see
[`../docs/legacy.md`](../docs/legacy.md).

## Local development

This app is a member of the repository's Bun workspace. Install and run it from the repository
root:

```bash
bun install                           # installs the whole workspace from the root bun.lock
bun run --cwd bench/web dev           # needs BENCH_DB_* pointing at a database (see below)

bun run --cwd bench/web format:check  # biome format
bun run --cwd bench/web lint          # biome lint
bun run --cwd bench/web build         # next build; deliberately works WITHOUT a database
bun run --cwd bench/web test          # vitest; the Postgres integration suite needs Docker, or BENCH_TEST_DATABASE_URL, and uv
```

Without Docker, run the integration suite against a local Postgres. This starts a throwaway
cluster in `$TMPDIR` on port 55433, which stays clear of the parity cluster on 55432. `--locale=C`
matches the collation of the CI container:

```bash
PG=/opt/homebrew/opt/postgresql@16/bin
$PG/initdb -D "$TMPDIR/bench-test-pg" -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl -D "$TMPDIR/bench-test-pg" -l "$TMPDIR/bench-test-pg.log" -w start \
  -o "-p 55433 -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off"
export BENCH_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres
```

`BENCH_TEST_DATABASE_URL` names an existing server, as a superuser, and its admin database. Each
suite creates a `bench_test_*` database there and drops it when it ends. Stop the cluster with
`$PG/pg_ctl -D "$TMPDIR/bench-test-pg" stop`. In CI (`CI=true`), a runner with neither Docker nor
the variable fails the suite instead of skipping it.

`next build` never touches the database: every page and route is request-rendered
(`force-dynamic` or request-URL-dependent), so builds are reproducible with no `BENCH_DB_*`
configured. Keep it that way; the CI `test` job builds with no database on purpose.

## Database environment

Connection config is read by `lib/db.ts`:

| Variable                        | Required           | Meaning                                                                                                                                       |
| ------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `BENCH_DB_HOST`                 | yes                | Postgres host.                                                                                                                                |
| `BENCH_DB_NAME`                 | yes                | Database name.                                                                                                                                |
| `BENCH_DB_USER`                 | yes                | Role to connect as.                                                                                                                           |
| `BENCH_DB_PORT`                 | no (5432)          | Port.                                                                                                                                         |
| `BENCH_DB_PASSWORD`             | yes                | Password for the role in `BENCH_DB_USER` (`bench_read` in production).                                                                        |
| `BENCH_DB_SSL`                  | no (`verify-full`) | `verify-full` validates the certificate chain and hostname; `disable` is for local non-TLS containers only. Any other value fails loudly.     |
| `BENCH_DB_CA`                   | prod               | PEM contents of the Amazon RDS CA bundle; Node's trust store does not include the RDS roots, so `verify-full` against RDS fails without it.   |
| `BENCH_DB_POOL_MAX`             | no (8)             | Max pool connections per serverless instance, at least 2 (a cache fill holds one for its lock and queries on another); the per-render summary fan-out (`QUERY_CONCURRENCY`) is sized to the default. |
| `BENCH_DB_IDLE_TIMEOUT_MS`      | no (5000)          | Idle connection timeout in ms. Must be a positive integer within Node's timer range. |
| `BENCH_DB_CONNECTION_TIMEOUT_MS` | no (5000)          | Timeout in ms for a new connection or a free pool slot. Must be a positive integer within Node's timer range. |
| `BENCH_DB_STATEMENT_TIMEOUT_MS` | no (30000)         | PostgreSQL server-side timeout for each web statement. `0` disables the timeout.                                                              |

## CDN caching

The read paths serve traffic through Vercel's CDN with a five-minute fresh window, matching
the v2 site's S3 refresh cadence, plus bounded stale-while-revalidate windows for low-traffic
warmth:

- The data routes (`/api/groups`, `/api/group/*`, `/api/chart/*`) set
  `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600` on success responses
  (`lib/cache.ts`); error responses omit the header so they are never CDN-cached. `/api/health`
  is deliberately uncached so the liveness probe always reflects the live database.
- The HTML pages (`/` and `/chart/:slug`) cannot set response headers from a server component,
  and Next.js emits `Cache-Control: no-store` for `force-dynamic` pages, which takes precedence
  over config-file `Cache-Control` rules. Instead, `vercel.json` sets `Vercel-CDN-Cache-Control`
  on those routes: that header is consumed (and stripped) by Vercel's CDN alone at the highest
  precedence, so the CDN caches the rendered pages while browsers still revalidate every load.

The deploy workflow verifies the expected build SHA through `/api/health`, a representative group
and chart JSON response, the landing and chart pages, and a CDN `HIT` on repeated landing/chart-API
requests. The probe has a three-minute deadline. Production uses the public `BENCH_SITE_BASE_URL`
and fails verification on authentication errors or redirects. A protected preview reports
verification as blocked, with no claim that its health, build identity, or caching passed. To check
a protected preview by hand, use `vercel curl`.

One deliberate
divergence from the API routes: the `vercel.json` header rules apply to every response status,
so an unknown `/chart/:slug` 404 follows the HTML page rule: five minutes fresh and then eligible
for Vercel's one-day stale-while-revalidate window. That is acceptable for opaque, never-linked
malformed/unknown chart URLs, while real chart pages refresh on the same five-minute fresh cadence
as the landing page (transient 5xx responses are believed not CDN-cacheable by Vercel; if one ever
were, the same HTML page rule would bound it).

## Deploys

`.github/workflows/bench-ci.yml` runs the check suite on every PR touching `bench/`, including
`migrations/**` (the integration suite applies that DDL to its testcontainer). It is a required
check on `main`. `.github/workflows/bench-deploy.yml` deploys via the Vercel CLI (`vercel pull` /
`vercel build` / `vercel deploy --prebuilt`): a preview deployment per same-repo PR that touches
`bench/`, and a production deployment on each push to `main` that does. Before it builds, the
deploy workflow runs the same checks (the `bench-checks` composite action) on the exact commit it
deploys. Fork PRs run CI but do not receive deployment credentials.

The `bench-production` environment limits manual production runs to `main`. Push and manual
production runs share one production queue and let an active deploy finish verification. New
preview runs can cancel older previews of the same event and ref. The Vercel CLI builds on the
runner and uploads the prebuilt output. `BENCH_BUILD_SHA` is embedded in that output so the
uncached health endpoint identifies the checked-out build.

One-time operator setup:

1. Create the Vercel project: Framework Next.js, **Root Directory `bench/web`**,
   and the GitHub integration **disabled** (deploys are CLI-driven from CI; the integration
   would double-deploy).
2. Set the repo variables `VERCEL_ORG_ID` + `BENCH_VERCEL_PROJECT_ID` (from the Vercel project
   settings), and the secret `VERCEL_TOKEN` (a deploy token scoped to this Vercel project) in
   both the `bench-preview` and `bench-production` GitHub environments. Limit
   `bench-production` to `main`. Set the repo variable `BENCH_SITE_BASE_URL` to the public
   production URL as `https://<domain>`. The keep-warm workflow uses the same variable.
   Production deployment requires it before uploading and verifies the public domain after
   deployment.
3. Configure `BENCH_DB_*` on the Vercel project (Production and Preview environments). Two
   wiring points are set in this step, per environment:
   - **Endpoint**: the public RDS instance endpoint (the same endpoint CI writers use). There is
     no RDS Proxy: the one provisioned earlier was VPC-internal, so Vercel functions could not
     reach it, and it was deleted on 2026-10-28.
   - **Auth**: the app signs in only with `BENCH_DB_PASSWORD`, for the read-only `bench_read`
     role. Migration `005_read_role.sql` creates `bench_read` with **no `rds_iam` grant** (and
     revokes it if a pre-existing role carries it), because on RDS `rds_iam` membership forces
     IAM-only auth. Moving the read path to IAM would need app code, a migration and AWS
     credentials in the function runtime (for example Vercel's OIDC federation to an AWS role
     with `rds-db:connect`).
