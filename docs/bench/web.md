# Benchmarks web (v4 read service)

Next.js 16 (App Router) read service serving the benchmark charts at
[bench.vortex.dev](https://bench.vortex.dev) from the benchmarks Postgres database. This is the
v4 frontend that replaced both the v2 Vite/React SPA and the v3 Axum server — see
[`legacy.md`](legacy.md).

It is part of the vortex.dev app: its routes are `src/app/(bench)/bench/`, with their own root
layout, and its code is `src/bench/`. bench.vortex.dev serves them from its root; everywhere else
(previews, local dev, a deployment's own URL) they are under `/bench`. See "Repository layout" in
the root `CLAUDE.md`.

## Local development

Install and run the app from the repository root:

```bash
bun install            # installs the app from the root bun.lock
bun run dev            # bench is at http://localhost:3000/bench; needs BENCH_DB_* (see below)

bun run check:ci       # biome format and lint
bun run build          # next build, both sites; deliberately works WITHOUT a database
bun run test:bench     # vitest; the Postgres integration suite needs Docker, or BENCH_TEST_DATABASE_URL, and uv
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
configured. Keep it that way; the CI job builds with no database on purpose.

## Database environment

Connection config is read by `src/bench/lib/db.ts`:

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
  (`src/bench/lib/cache.ts`); error responses omit the header so they are never CDN-cached. `/api/health`
  is deliberately uncached so the liveness probe always reflects the live database. Once the Vercel
  project sets `CRON_SECRET`, the probe runs its `SELECT 1` only for a request that sends
  `Authorization: Bearer <CRON_SECRET>`: Vercel's cron does, and `bench-keep-warm.yml` sends it from
  the `BENCH_CRON_SECRET` repository secret. Any other caller gets the build SHA and schema version
  alone, so it cannot make the route query the database.
  The crawler files (`/robots.txt`, `/sitemap.xml`, `/llms.txt`, from `src/bench/lib/site-files.ts`)
  set the same header.
- The HTML pages (`/`, `/methodology` and `/chart/:slug`) cannot set response headers from a server component,
  and Next.js emits `Cache-Control: no-store` for `force-dynamic` pages, which takes precedence
  over config-file `Cache-Control` rules. Instead, `vercel.json` sets `Vercel-CDN-Cache-Control`
  on those routes: that header is consumed (and stripped) by Vercel's CDN alone at the highest
  precedence, so the CDN caches the rendered pages while browsers still revalidate every load.
  Header rules match the path as requested, before the app's rewrites, so the rule names
  bench.vortex.dev's form of each page: `/`, `/methodology` and `/chart/:slug` on that host. bench's HTML differs
  between its two URL forms (its links are root-relative on bench.vortex.dev and under `/bench`
  elsewhere), so the `/bench` form (`/bench`, `/bench/methodology`, `/bench/chart/:slug`) gets the same rule only
  outside production, from `benchPrefixCdnRules` in `next.config.mjs`: in production a cached
  `/bench` page must never answer for bench.vortex.dev.

After each production deployment, `.github/workflows/bench-verify-deploy.yml` verifies the
expected build SHA through `/api/health`, a representative group and chart JSON response, and the
landing and chart pages, under `/bench` on the deployment's own URL. It then checks for a CDN `HIT`
on repeated landing/chart-API requests on bench.vortex.dev (`BENCH_SITE_BASE_URL`), the form
production caches, once that domain's `/api/health` reports the deployment's commit; while the
domain serves another deployment or project, it skips that check with a notice. The probe has a
three-minute deadline, and fails on authentication errors or redirects. A protected deployment URL needs Vercel's Protection Bypass for Automation,
whose secret the workflow sends from the `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret. To
check a protected deployment by hand, use `vercel curl`.

One deliberate
divergence from the API routes: the `vercel.json` header rules apply to every response status,
so an unknown `/chart/:slug` 404 follows the HTML page rule: five minutes fresh and then eligible
for Vercel's one-day stale-while-revalidate window. That is acceptable for opaque, never-linked
malformed/unknown chart URLs, while real chart pages refresh on the same five-minute fresh cadence
as the landing page (transient 5xx responses are believed not CDN-cacheable by Vercel; if one ever
were, the same HTML page rule would bound it).

## Deploys

The `Lint, build, verify` job in `.github/workflows/ci.yml` runs bench's checks with the site's on
every PR, including the integration suite, which applies `db/migrations/**` to its testcontainer.
`Lighthouse and axe` in `.github/workflows/lighthouse.yml` audits bench on the PR's preview. Both
are required checks on `main`.

bench deploys with the vortex.dev site: the `vortex` Vercel project builds the app through its
git integration, a preview deployment for every pull request and a production deployment for every
push to `main`. A pull request's preview serves both sites, bench under `/bench`. Vercel sets
`VERCEL_GIT_COMMIT_SHA` during the build, and `next.config.mjs` embeds it, so the uncached health
endpoint and the footer name the deployed commit. The keep-warm workflow pings
`BENCH_SITE_BASE_URL` (a repository variable, the public production URL as `https://<domain>`).

Operator setup on the `vortex` project:

1. bench.vortex.dev is one of the project's domains, with the production deployment.
2. Configure `BENCH_REVALIDATE_TOKEN` (Production, for the ingest hook) and `BENCH_DB_*`
   (Production and Preview environments) on the project. Two
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
