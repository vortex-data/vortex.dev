<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench PR 2: clean up bench's code — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bench's code gets smaller and clearer: no IAM sign-in path, two queries per group instead of two per chart, `Chart.tsx` and `chart-store.ts` split into modules, and the site's stricter TypeScript flags. Nothing a visitor or API client sees changes.

**Architecture:** One branch, `claude/bench-cleanup`, stacked on PR 1's `claude/bench-toolchain`, with one or two commits per task so a parity difference can be bisected. The group route builds every chart of a group from two statements run in parallel: the shared last-`n` commits, and the group's fact rows with each chart's commit total. It slices each chart's own window from the shared one. `chartPayload` keeps its per-chart SQL for `/api/chart/{slug}` and is the oracle the group tests compare against. The split moves code into `components/chart/` and `lib/chart-store/` without rewriting it.

**Tech Stack:** Bun 1.4.3 workspace, Next.js 16.4.1, React 19.3.1, TypeScript 7, Biome 2.5, Vitest 4, node-postgres 8, Chart.js 4, Postgres 16 (testcontainers in CI; Homebrew `postgresql@16` 16.15 in `/opt/homebrew/opt/postgresql@16/bin` locally).

**Spec:** `bench/docs/plans/2026-10-28-toolchain-and-cleanup.md` (read it first; this plan covers its "PR 2"). The style reference is `bench/docs/plans/2026-10-28-toolchain-pr1-plan.md`.

**Starts from:** PR 1 has landed underneath (branch `claude/bench-toolchain`). `bench/web` is a member of the root Bun workspace, with one `bun.lock`. Bench scripts run as `bun run --cwd bench/web <script>`. Biome lints and formats bench, and `bench/web/tsconfig.json` extends `tsconfig.base.json`. `bash bench/scripts/parity/run.sh <base-ref> <dump-dir>` compares two builds (see `bench/scripts/parity/README.md`). This Mac has no Docker, so the integration suite skips locally until Task 1.

## Global Constraints

- "No change in behavior that a person could notice, and each PR proves it. Small bug fixes and subtle changes from library upgrades are acceptable if they are negligible; every difference the parity check finds is listed and explained in the PR." For PR 2: "Logic stays the same. The parity check and the tests prove it."
- Fail if "a person can notice a change in a page, API response, response header, cache rule or URL". `bench/web/vercel.json` "must not change".
- Group route: "The JSON must stay byte-identical." So `GROUP_PAYLOAD_CACHE_VERSION` in `lib/data-cache.ts` stays `'v9'`.
- `QUERY_CONCURRENCY`: "Keep the concurrency limit unless the new code no longer needs it." (It stays; see Task 3.)
- Splitting `Chart.tsx` and `chart-store.ts`: "Move code; don't rewrite it."
- Parity runs once, in Task 6, comparing the PR's base with the whole branch. Tasks have no parity step. On a difference, bisect the task commits with `run.sh` as the test.
- Vitest stays the test runner. No database schema, ingest contract (`bench/CONTRACT.md`) or AWS changes. The marketing site's build, behavior and deploy do not change.
- The supply-chain gates must not get weaker: "the 14-day cooldown, explicit overrides, the lifecycle-script allowlist, SHA-pinned actions, `ubuntu-24.04` runners".
- The `main` ruleset requires the job name `Bench: format, lint, build, test`. Keep it.
- "Settings changes need Will's confirmation first. That covers GitHub, Vercel and AWS settings." Deleting `BENCH_DB_REGION` from the Vercel project is such a change: list it in the PR, don't do it.
- Node 24 stays the runtime.
- bench keeps its style: single quotes, trailing commas everywhere, 100 columns, 2-space indent.
- Every commit uses `git commit -s` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Squash merges only.
- New code files under `bench/` start with `// SPDX-License-Identifier: Apache-2.0` and `// SPDX-FileCopyrightText: Copyright the Vortex contributors`. Markdown files use CC-BY-4.0.

## Review Focus

1. **A chart whose window differs from the rest of its group.** It has fewer commits than `n`, or its first row is on a commit whose timestamp ties with an earlier one, or it has no rows inside the window. `/api/group/{slug}` must still send it with the same bytes as `/api/chart/{slug}`. Task 3 pins this with `group payloads match chartPayload byte for byte at ?n=%s` and `gives each chart its own window`.
2. **A group takes rows from a sibling group.** Groups that share a dataset (another storage, or a NULL against a `'1'` scale factor) must stay apart, so the group statement must pin every column the chart statement pins. Task 3 pins this with `keeps sibling groups apart`.
3. **An environment without `BENCH_DB_PASSWORD`.** A Preview that has only `BENCH_DB_REGION` must fail at the first query, with an error that names `BENCH_DB_PASSWORD`. It must not try IAM. Task 2 pins this with `requires BENCH_DB_PASSWORD, even when BENCH_DB_REGION is set`.
4. **`/api/group/{slug}?n=all` on the 99-chart TPC-DS group.** One result set now holds the group's whole history (about 870,000 rows). The request must still finish within the 30 s `statement_timeout` and the function's memory. Task 3 Step 7 measures old and new code on the restored dump, and sets the fallback.
5. **A remounted chart after the split.** If a moved wheel or range-strip listener loses the controller's abort signal, it keeps panning a destroyed chart. If the moved config loses an option, the chart changes. Task 4 pins both with `pans once per wheel event and stops after unmount`.

---

### Task 1: Run the integration suite against a local Postgres

**Files:**
- Modify: `bench/web/lib/test-harness.ts`
- Create: `bench/web/lib/test-harness.test.ts`
- Modify: `bench/web/lib/db.test.ts`, `lib/queries.test.ts`, `lib/groups.test.ts`, `lib/health.test.ts`, `lib/server-smoke.test.ts` (imports, skip gate, type)
- Modify: `bench/web/README.md` ("Local development"), `CLAUDE.md` (the bench line that says the suite needs Docker)

**Interfaces:**
- Produces in `lib/test-harness.ts`:
  - `export interface BenchDatabase { stop(): Promise<void> }`
  - `export interface TestDatabaseSettings { host: string; port: number; user: string; password: string; adminDatabase: string }`
  - `export function testDatabaseSettings(url: string): TestDatabaseSettings`
  - `export function integrationDatabaseAvailable(env: NodeJS.ProcessEnv = process.env, docker: () => boolean = dockerAvailable): boolean`. `dockerAvailable` stops being exported.
  - `export async function startBenchDatabase(options: { applySchema?: boolean } = {}): Promise<BenchDatabase>` replaces `startBenchContainer`.
  - Unchanged: `seedChartFixture`, `COMMITS`, `TREE_SHA`, `commitUrl`.
- Env var `BENCH_TEST_DATABASE_URL`: a `postgres://` URL of an existing server, as a superuser, naming its admin database.

- [ ] **Step 1: Write the failing tests** in `lib/test-harness.test.ts`:

```ts
describe('testDatabaseSettings', () => {
  it('reads host, port, user and admin database, with a placeholder password', () => {
    expect(testDatabaseSettings('postgres://postgres@127.0.0.1:55433/postgres')).toEqual({
      host: '127.0.0.1', port: 55433, user: 'postgres', password: 'trust', adminDatabase: 'postgres',
    });
  });
  it('decodes the password and defaults the port and admin database', () => {
    expect(testDatabaseSettings('postgresql://will:p%40ss@localhost')).toEqual({ // trufflehog:ignore
      host: 'localhost', port: 5432, user: 'will', password: 'p@ss', adminDatabase: 'postgres',
    });
  });
  it.each(['mysql://u@h/db', 'postgres://h/db'])('rejects %s', (url) => {
    expect(() => testDatabaseSettings(url)).toThrow('BENCH_TEST_DATABASE_URL');
  });
});
describe('integrationDatabaseAvailable', () => {
  it('prefers BENCH_TEST_DATABASE_URL, then Docker', () => {
    expect(integrationDatabaseAvailable({ BENCH_TEST_DATABASE_URL: 'postgres://u@h/db' }, () => false)).toBe(true);
    expect(integrationDatabaseAvailable({}, () => true)).toBe(true);
    expect(integrationDatabaseAvailable({}, () => false)).toBe(false);
  });
  it('fails loudly in CI when no database is available', () => {
    expect(() => integrationDatabaseAvailable({ CI: 'true' }, () => false)).toThrow('BENCH_TEST_DATABASE_URL');
  });
});
```

- [ ] **Step 2: Run** `bun run --cwd bench/web test lib/test-harness.test.ts`. Expect FAIL: the exports are missing.
- [ ] **Step 3: Implement.**
  - `testDatabaseSettings` uses `new URL()`. It accepts only the `postgres:` and `postgresql:` schemes and requires a user. The port defaults to 5432 and the admin database to `postgres`.
  - With no password in the URL, the password is the literal `'trust'`. `BENCH_DB_PASSWORD` must not be empty (and is required after Task 2), and trust auth ignores the value.
  - `integrationDatabaseAvailable` returns true when `BENCH_TEST_DATABASE_URL` is set and not empty, otherwise `docker()`. When `env.CI === 'true'` and both are missing, it throws an error that names Docker and `BENCH_TEST_DATABASE_URL`. That stops GitHub Actions from passing with the database suites skipped.
  - When the URL is set, `startBenchDatabase` opens an admin `pg.Client` and takes `pg_advisory_lock(0x62656e63, 0x74657374)`. Under the lock it runs `CREATE DATABASE "bench_test_<pid>_<8 random hex>"` and, unless `applySchema === false`, the same `uv run --no-project migrate-schema.py apply` as today, with `PG*` pointing at the new database. Then it unlocks. The lock is needed because the migrations create cluster-wide roles, and two first applies at once race on `CREATE ROLE`.
  - It then sets `BENCH_DB_HOST`, `_PORT`, `_NAME`, `_USER`, `_PASSWORD` and `BENCH_DB_SSL=disable`. `stop()` runs `DROP DATABASE IF EXISTS "<name>" WITH (FORCE)` from a fresh admin client. If a migration fails, drop the database and rethrow.
  - Without the URL, it keeps today's testcontainers path and wraps it as `{ stop: async () => { await container.stop(); } }`.
- [ ] **Step 4: Update the five DB suites.** `dockerAvailable()` becomes `integrationDatabaseAvailable()`, `startBenchContainer` becomes `startBenchDatabase`, and the `StartedPostgreSqlContainer` type becomes `BenchDatabase`. `server-smoke.test.ts` keeps its `|| !BUILD_PRESENT`.
- [ ] **Step 5: Document the local database.** In the README's "Local development", add these commands, and change the `test` comment to "needs Docker, or `BENCH_TEST_DATABASE_URL`, and uv":

```bash
PG=/opt/homebrew/opt/postgresql@16/bin
$PG/initdb -D "$TMPDIR/bench-test-pg" -U postgres -A trust -E UTF8 --locale=C
$PG/pg_ctl -D "$TMPDIR/bench-test-pg" -l "$TMPDIR/bench-test-pg.log" -w start \
  -o "-p 55433 -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c fsync=off"
export BENCH_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres
```

  Port 55433 stays clear of the parity cluster on 55432. `--locale=C` matches the CI container's collation. Update CLAUDE.md's bench line to match.
- [ ] **Step 6: Verify.**
  - `bun run --cwd bench/web test lib/test-harness.test.ts` passes.
  - Run `bun run --cwd bench/web build`, then the whole suite with the URL exported. Every file passes, and the summary line shows no `skipped`.
  - `psql -h 127.0.0.1 -p 55433 -U postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE 'bench_test_%'"` prints `0`.
  - Unset the URL and run again: the database suites skip, as before.
  - Record the pass count; later tasks compare against it.
- [ ] **Step 7: Commit:** `Let bench's integration tests use a local Postgres`.

### Task 2: Remove the IAM sign-in path

**Files:**
- Modify: `bench/web/lib/db.ts`, `bench/web/lib/db.test.ts`
- Modify: `bench/web/package.json` (remove `@aws-sdk/rds-signer`), `bun.lock`
- Modify: `bench/web/README.md` (env table; "Deploys" step 3 "Auth" bullet), `bench/docs/runbooks/deploy-secrets-setup.md` (env table)

**Interfaces:**
- Produces: `getPool()` reads `BENCH_DB_PASSWORD` through `requireEnv`. When it is unset or empty, `getPool()` throws ``Missing required environment variable `BENCH_DB_PASSWORD` for the benchmarks DB connection.`` at first use. `next build` still never reads it.
- Removed: `passwordProvider`, `DbConfig.region`, `DbConfig.staticPassword` and the `Signer` import. `DbConfig` gains `password: string` and stops being exported. The pool receives the password as a string.

- [ ] **Step 1: Write the failing tests** in the `singleton pool configuration` block of `db.test.ts`. Keep `BENCH_DB_REGION` in `ENV_KEYS` so it is restored afterwards.

```ts
it('requires BENCH_DB_PASSWORD, even when BENCH_DB_REGION is set', () => {
  configurePoolEnvironment();
  process.env.BENCH_DB_REGION = 'us-east-1';
  for (const value of [undefined, '']) {
    if (value === undefined) delete process.env.BENCH_DB_PASSWORD;
    else process.env.BENCH_DB_PASSWORD = value;
    expect(() => getPool()).toThrow(
      'Missing required environment variable `BENCH_DB_PASSWORD` for the benchmarks DB connection.',
    );
  }
});
it('hands the password to pg as a string', () => {
  configurePoolEnvironment();
  const pool = getPool() as unknown as { options: { password?: unknown } };
  expect(pool.options.password).toBe('fixture-pw');
});
```

- [ ] **Step 2: Run** `bun run --cwd bench/web test lib/db.test.ts -t 'BENCH_DB_PASSWORD|password to pg'`. Expect both to FAIL: the first gets a pool from the mocked signer, and the second sees a function.
- [ ] **Step 3: Implement.** In `readConfig`, set `password: requireEnv('BENCH_DB_PASSWORD')` right after `user`. In `createPool`, pass `password: config.password`. Rewrite the `DbConfig` doc comment: the app signs in with a password, and production uses the read-only `bench_read` role. In the test file, delete the `db IAM auth path (mocked rds-signer)` block, the `vi.hoisted` mock and the `vi.mock('@aws-sdk/rds-signer')`.
- [ ] **Step 4: Drop the package.** Remove the dependency and run `bun install` at the root. Check that `git diff --stat bun.lock` shows only removed lines (the signer and its `@aws-sdk`, `@aws-crypto` and `@smithy` packages), and that `grep -c rds-signer bun.lock` prints `0`.
- [ ] **Step 5: Update the docs.**
  - In the README env table, the `BENCH_DB_PASSWORD` row becomes required: "Password for the role in `BENCH_DB_USER` (`bench_read` in production)." Delete the `BENCH_DB_REGION` row. Fix the stale `SUMMARY_CONCURRENCY` in the `BENCH_DB_POOL_MAX` row to `QUERY_CONCURRENCY`.
  - Rewrite the "Auth" bullet: the app signs in only with `BENCH_DB_PASSWORD`. `bench_read` has no `rds_iam` grant (migration `005`). Moving the read path to IAM would need app code, a migration and AWS credentials in the function runtime.
  - In the runbook, `BENCH_DB_PASSWORD` becomes "Password for the `bench_read` role (required)". Delete the `BENCH_DB_REGION` row.
- [ ] **Step 6: Verify.**
  - The suite passes with your Task 1 baseline minus 3 (the IAM tests) plus 2.
  - `bun run --cwd bench/web build` succeeds.
  - `grep -rn -e rds-signer -e BENCH_DB_REGION -e passwordProvider bench/web bench/docs/runbooks bench/docs/architecture CLAUDE.md` prints nothing.
- [ ] **Step 7: Commit:** `Remove bench's unused IAM sign-in path`. Say in the message that `BENCH_DB_REGION` on the Vercel project is now unused, and that deleting it is Will's settings change.

### Task 3: One query per group

**As built.** The steps below are the plan as written. The code differs from them here:

- `groupChartPayloads` runs its statements one after another on one `getPool().connect()` client, in one `REPEATABLE READ, READ ONLY` transaction, not in parallel with `Promise.all` on the pool. Every statement sees one snapshot, so an ingest that lands mid-build cannot make the shared window and a chart's commit total disagree.
- The rows statement runs in slices of `GROUP_ROWS_CHUNK = 25` charts, so the 99-chart TPC-DS group runs five. As one result, TPC-DS at `?n=all` (about 2.7M rows) peaked at 1.6× the memory of the old per-chart fan-out.
- The SQL differs from Step 4 in four places. On one connection, every chart's cost is paid in turn:
  - A chart's first timestamp comes from an aggregate `LATERAL` subquery (`e`). The planner cannot flatten an aggregate into the outer query and run it once per output row.
  - `total_commits` is a binary search, `width_bucket` over the sorted commit timestamps, not a `count(*)` of `commits` per chart (99 scans for TPC-DS).
  - For query charts, the first timestamp comes from a skip scan of `idx_query_measurements_summary` with one descent per series (`queryChartEarliest`), not from a `MIN` that reads the chart's whole history (about 27K rows per TPC-DS chart).
  - The compression families put NULL-variant and non-NULL-variant charts in separate blocks, each pinned sargably. `IS NOT DISTINCT FROM ch.dataset_variant` planned as a one-row match and rescanned the window for each fact row.
- `groups.test.ts`'s pool-size test is now `keeps a cached group fill within the pool size`. It counts connection requests during a fill under the advisory lock, and the bound is 8: the lock and seven summaries.

**Files:**
- Modify: `bench/web/lib/queries.ts`
- Create: `bench/web/lib/group-charts.test.ts`
- Modify: `bench/docs/architecture/performance.md` (section "Parallel group fan-out")

**Interfaces:**
- Consumes from Task 1: `integrationDatabaseAvailable()`, `startBenchDatabase()`, `seedChartFixture()`, `TREE_SHA`, `commitUrl()`.
- Produces in `lib/queries.ts`:
  - `export function historyFor(totalCommits: number, window: CommitWindow): ChartHistory`
  - `export type FactRow = { commit_sha: string; value: number; engine?: string; format?: string; op?: string; open_mode?: 'cached' | 'reopen'; flavor?: string }`
  - `export function seriesFor(kind: ChartKind, row: FactRow): { key: string; engine: string | undefined; format: string | undefined }`
  - `export async function groupChartPayloads(group: GroupKey, charts: readonly ChartKey[], window: CommitWindow): Promise<(ChartResponse | null)[]>`. The result follows the order of `charts`. A chart with no commits gives `null`. Every key must belong to `group`.
  - New private helpers: `chartDisplayName(key: ChartKey): string`, `chartUnitKind(key: ChartKey): UnitKind`, `windowCommits(window: CommitWindow): Promise<CommitPoint[]>`, `groupRowsQuery(group: GroupKey, charts: readonly ChartKey[], window: CommitWindow): { text: string; values: unknown[] }`.
- Unchanged signatures: `chartPayload`, `collectGroupCharts`, `collectGroups`. `QUERY_CONCURRENCY` and `mapWithConcurrency` stay and now bound only the summary fan-out in `collectGroups`.

- [ ] **Step 1: Write the unit tests** (no database) in `group-charts.test.ts`:

```ts
it('bounds a long history to the window', () => {
  expect(historyFor(125, { kind: 'last', n: 100 })).toEqual({ total_commits: 125, start_index: 25, loaded_commits: 100, complete: false });
});
it('keeps a short history whole', () => {
  expect(historyFor(3, { kind: 'last', n: 100 })).toEqual({ total_commits: 3, start_index: 0, loaded_commits: 3, complete: true });
});
it('loads everything for ?n=all', () => {
  expect(historyFor(125, { kind: 'all' })).toEqual({ total_commits: 125, start_index: 0, loaded_commits: 125, complete: true });
});
it('reports an empty history as complete', () => {
  expect(historyFor(0, { kind: 'last', n: 100 })).toEqual({ total_commits: 0, start_index: 0, loaded_commits: 0, complete: true });
});
it.each([
  ['QueryMeasurement', { engine: 'duckdb', format: 'parquet' }, { key: 'duckdb:parquet', engine: 'duckdb', format: 'parquet' }],
  ['CompressionTime', { format: 'parquet', op: 'encode' }, { key: 'parquet:encode', engine: undefined, format: 'parquet' }],
  ['CompressionSize', { format: 'lance' }, { key: 'lance', engine: undefined, format: 'lance' }],
  ['RandomAccess', { format: 'parquet', open_mode: 'reopen' }, { key: 'parquet:cold', engine: undefined, format: 'parquet' }],
  ['VectorSearch', { flavor: 'vortex-turboquant' }, { key: 'vortex-turboquant', engine: undefined, format: undefined }],
] as const)('names the %s series', (kind, cols, expected) => {
  expect(seriesFor(kind, { commit_sha: 'a', value: 1, ...cols })).toEqual(expected);
});
```

- [ ] **Step 2: Write the integration tests.** There are two `describe.skipIf(!integrationDatabaseAvailable())` blocks, each with its own `startBenchDatabase()`. `expectedCharts(group, window)` builds the oracle: `JSON.stringify` of `{ name, slug, ...payload }` from `chartPayload(chartKeyFromSlug(link.slug), window)` for each link, nulls dropped.
  - **Canonical fixture** (`seedChartFixture`):
    - `it.each(['1', '2', '100', 'all'])('every group matches chartPayload byte for byte at ?n=%s')` checks `JSON.stringify((await collectGroupCharts(groupKeyFromSlug(g.slug), w))?.charts ?? []) === await expectedCharts(g, w)` for every group from `collectGroups()`.
    - `it('issues two statements for a group of any size')` wraps `vi.spyOn(getPool(), 'query')` around `groupChartPayloads` for the TPC-H group and expects `toHaveBeenCalledTimes(2)`.
    - `it('returns null in place of a chart with no rows')` passes `[Q1, { ...Q1, query_idx: 99 }]`. It expects `[1]` to be `null`, and `[0]` to match `chartPayload(Q1)` byte for byte.
  - **Window-edge fixture.** Commits in order: `C0` 06-01, `C1` 06-02, `C2` 06-03, `D` and `E` both 06-04T00:00Z (SHAs `'d'.repeat(40)` and `'e'.repeat(40)`), `F` 06-05. Query rows have `commit_timestamp` stamped as the writers do.
    - Group G is `('grp', NULL, NULL, 'nvme')`. Q1 has `e1:f1` = 10, 20, …, 60 and `e2:f1` on every commit. Q2 has `e1:f1` on E and F only. Q3 has `e1:f1` on C0 only.
    - Group S is `('grp', NULL, '1', 'nvme')`, with Q1 `e1:f1` = 100, …, 105.
    - Group T is `('grp', NULL, NULL, 's3')`, with Q1 `e1:f1` = 200, …, 205.
  - Tests on the window-edge fixture:
    - `it.each(['1', '2', '3', '4', 'all'])('group payloads match chartPayload byte for byte at ?n=%s')` covers G, S and T.
    - `it('gives each chart its own window')` checks G at `?n=4`:
      - Q1's history is `{6, 2, 4, false}`.
      - Q2's history is `{3, 0, 3, true}`, and its commit SHAs are `[D, E, F]`. D is included because it ties with Q2's first row.
      - Q3's series is `{}` and its history is `{6, 2, 4, false}`.
    - `it('keeps sibling groups apart')`: at `?n=all`, G's Q1 `e1:f1` is `[10, 20, 30, 40, 50, 60]` and S's is `[100, 101, 102, 103, 104, 105]`.
- [ ] **Step 3: Run** `bun run --cwd bench/web test lib/group-charts.test.ts` with `BENCH_TEST_DATABASE_URL` set. Expect FAIL: `groupChartPayloads`, `historyFor` and `seriesFor` are not exported.
- [ ] **Step 4: Implement.**
  - Lift `chartDisplayName`, `chartUnitKind` and `seriesFor` out of the five collectors, and make the collectors call them. Their SQL does not change.
  - `historyFor`: `loaded = limit === null ? total : Math.min(limit, total)`, `start_index = Math.max(0, total - loaded)`, `complete = loaded === total`.
  - `windowCommits` runs the following, with `$1 = commitWindowLimit(window)`. For `?n=all` that is `null`, which Postgres reads as no limit.

```sql
SELECT commit_sha, to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS"+00"') AS ts_text,
       COALESCE(message, '') AS message, url
  FROM (SELECT * FROM commits ORDER BY timestamp DESC, commit_sha DESC LIMIT $1) w
 ORDER BY timestamp ASC, commit_sha ASC
```

  - `groupRowsQuery` builds one row per (chart, fact row in its window). A chart with no rows in the window still gets one row with NULL fact columns. Here is the `QueryGroup` shape; build each pin with `sargableDimEq`.

```sql
SELECT ch.ord::int AS ord, t.total_commits, d.commit_sha, d.engine, d.format, d.value
  FROM unnest($1::int[]) WITH ORDINALITY AS ch(query_idx, ord)
 CROSS JOIN LATERAL (
       SELECT (SELECT count(*) FROM commits c
                WHERE c.timestamp >= (SELECT MIN(q2.commit_timestamp) FROM query_measurements q2
                                       WHERE q2.dataset = $2 AND <q2 variant pin> AND <q2 scale pin>
                                         AND q2.storage = $n AND q2.query_idx = ch.query_idx))::int AS total_commits
       ) t
  LEFT JOIN LATERAL (
       SELECT q.commit_sha, q.engine, q.format, q.value_ns::float8 AS value
         FROM query_measurements q
        WHERE q.dataset = $2 AND <q variant pin> AND <q scale pin> AND q.storage = $n
          AND q.query_idx = ch.query_idx<queryMeasurementWindowFilter(params, window)>
       ) d ON true
```

  The other families use the same shape. Copy each chart collector's own `MIN` subquery and row query, and replace its per-chart binds with `ch.<column>`:

  | Group kind | `ch` columns (bound as arrays) | Pins from the group key | Row columns | Window filter |
  |---|---|---|---|---|
  | `QueryGroup` | `query_idx int[]` | dataset, dataset_variant, scale_factor (sargable), storage | engine, format | `queryMeasurementWindowFilter` |
  | `CompressionTimeGroup` | `dataset text[]`, `dataset_variant text[]` | none | format, op | `factWindowFilter`, with `JOIN commits c USING (commit_sha)` |
  | `CompressionSizeGroup` | same | none | format | same |
  | `RandomAccessGroup` | `dataset text[]` | none (the datasets carry the storage) | format, open_mode | same |
  | `VectorSearchGroup` | `threshold float8[]` | dataset, layout | flavor | same |

  - In the compression families, `dataset_variant` varies per chart, so match it with `IS NOT DISTINCT FROM ch.dataset_variant`. `dataset` still leads the index, and those tables are small (380K and 170K rows).
  - The rows statement has no `ORDER BY`. The output doesn't depend on row order: each (series, commit) cell is unique by the fact tables' natural keys, and `finish()` sorts series keys.
  - `groupChartPayloads` returns `[]` for no charts. Otherwise it runs `Promise.all([windowCommits(window), getPool().query(groupRowsQuery(...))])` and groups the rows by `ord`. For each chart:
    - `total === 0` gives `null`.
    - Otherwise compute `history = historyFor(total, window)`, then seed `commits.slice(commits.length - history.loaded_commits)` into a fresh `SeriesAccumulator`.
    - For each row with a non-null `commit_sha` whose SHA is seeded, call `record` and `tag` with `seriesFor(key.k, row)`.
    - Finish with `chartDisplayName(key)`, `chartUnitKind(key)` and `history`.
  - Why this is correct: a chart's eligible commits (timestamp at or after its first row) are a suffix of all commits in (timestamp, sha) order. So its last-`n` window is the last `min(n, total)` entries of the shared last-`n` window, ties included, which is exactly what `seededCommitsInWindow` returns.
  - `collectGroupCharts` replaces its `mapWithConcurrency` fan-out with one `groupChartPayloads(key, group.charts.map((l) => chartKeyFromSlug(l.slug)), window)`. It zips the result with the links as `{ name, slug, ...payload }` and drops nulls. Update the doc comments of `QUERY_CONCURRENCY` and `collectGroupCharts`.
- [ ] **Step 5: Run** the new file, then the whole suite. Expect PASS at the Task 2 count plus the new tests. `groups.test.ts`'s `keeps a group fill within the pool size` (peak at most 7) still passes.
- [ ] **Step 6: Check bytes and timing on the restored dump.**
  - Start the parity cluster: `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D "$TMPDIR/bench-parity/pgdata" -l "$TMPDIR/bench-parity/postgres.log" -w start -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories="`.
  - Save the script below as `$TMPDIR/group-check.ts`. From `bench/web`, run it with `env BENCH_DB_HOST=127.0.0.1 BENCH_DB_PORT=55432 BENCH_DB_NAME=vortex_bench BENCH_DB_USER=postgres BENCH_DB_PASSWORD=parity BENCH_DB_SSL=disable N=100 bun -e "$(cat "$TMPDIR/group-check.ts")"`. If Bun can't resolve `./lib` from `-e`, copy the script into `bench/web` for the run and delete it afterwards.

```ts
import { createHash } from 'node:crypto';
import { resetPool } from './lib/db.ts';
import { chartPayload, collectGroups, groupChartPayloads } from './lib/queries.ts';
import { chartKeyFromSlug, groupKeyFromSlug } from './lib/slug.ts';
import { parseCommitWindow } from './lib/window.ts';
const w = parseCommitWindow(process.env.N ?? '100');
const mode = process.env.MODE ?? 'both';
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
for (const g of await collectGroups()) {
  if (process.env.GROUP && g.name !== process.env.GROUP) continue;
  const keys = g.charts.map((l) => chartKeyFromSlug(l.slug));
  const line: unknown[] = [g.name, keys.length];
  if (mode !== 'new') {
    const t = performance.now(); const old: unknown[] = [];
    for (let i = 0; i < keys.length; i += 7) old.push(...(await Promise.all(keys.slice(i, i + 7).map((k) => chartPayload(k, w)))));
    line.push(`old ${Math.round(performance.now() - t)} ms ${digest(old)}`);
  }
  if (mode !== 'old') {
    const t = performance.now(); const now = await groupChartPayloads(groupKeyFromSlug(g.slug), keys, w);
    line.push(`new ${Math.round(performance.now() - t)} ms ${digest(now)}`);
  }
  console.log(line.join('  '));
}
await resetPool();
```

  - What passes: run `N=100` and `N=50` twice each and read the second run, which is warm. On every line the old and new digests match. For the five TPC-DS groups and Clickbench, new ms is no more than old ms.
  - Then, with `GROUP='TPC-DS (NVMe) (SF=1)' N=all`, run `MODE=old` and `MODE=new` separately under `/usr/bin/time -l`. The digests match, and new's wall time and "maximum resident set size" are each at most 1.5× old's.
  - If not, run the rows statement in slices of 25 charts (`GROUP_ROWS_CHUNK = 25`), one after another, and measure again.
  - Stop the cluster with `pg_ctl -D "$TMPDIR/bench-parity/pgdata" -m fast stop`, and keep the numbers for the docs and the PR.
- [ ] **Step 7: Update `performance.md`.** Rename "Parallel group fan-out" to "One query per group". In about eight lines, cover the two statements, the window slicing, `QUERY_CONCURRENCY` now bounding only the summaries, and the Step 6 numbers.
- [ ] **Step 8: Verify** `bun run --cwd bench/web lint`, `format:check`, `bunx tsc --noEmit -p bench/web` and `bun run --cwd bench/web build`. **Commit:** `Fetch a bench group's charts with two queries, not two per chart`.

### Task 4: Split `Chart.tsx` and `chart-store.ts` into modules

**Files:**
- Create: `bench/web/lib/chart-store/queues.ts`, `bundles.ts`, `global-filter.ts`, `group-store.ts`, `index.ts`
- Delete: `bench/web/lib/chart-store.ts`
- Create: `bench/web/components/chart/types.ts`, `datasets.ts`, `tooltip.ts`, `config.ts`, `card-dom.ts`, `pan-zoom.ts`, `controller.ts`
- Modify: `bench/web/components/Chart.tsx`
- Test: `bench/web/components/Chart.loading.test.tsx` (one new test)

**Interfaces:**
- `'@/lib/chart-store'` keeps its exact export surface through `lib/chart-store/index.ts`, which holds `export * from` each module. No importer or test changes; `vi.spyOn(hydrationQueue, 'schedule')` still sees the same object.
- Produces in `components/chart/` (no `'use client'`; `Chart.tsx` stays the client boundary):
  - `types.ts`: `export interface BenchDataset`, `CardState`, `CardElements`, `CardCallbacks` (unchanged bodies)
  - `datasets.ts`: `export function benchDatasets(chart: ChartJs): BenchDataset[]`; `export function buildDatasets(payload: NormalizedChartPayload): BenchDataset[]`
  - `tooltip.ts`: `export function externalTooltipHandler(state: CardState, host: HTMLDivElement | null): (context: { chart: ChartJs; tooltip: TooltipModel<'line'> }) => void`
  - `config.ts`: `GRID_COLOR`, `crosshairPlugin`, and `export function lineChartConfig(input: { Chart: typeof ChartJs; state: CardState; tooltipHost: HTMLDivElement | null; labels: string[]; datasets: BenchDataset[]; range: VisibleRange; legendPosition: 'top' | 'bottom'; onZoom: (chart: ChartJs) => void }): ChartConfiguration<'line', (number | null)[], string>`
  - `card-dom.ts`: `renderWindowChip(chip: HTMLButtonElement | null, state: CardState): void`; `renderDownsampleBadge(badge: HTMLSpanElement | null, keptCommits: number, visibleCommits: number, anyDownsampled: boolean): void`; `setSliderFromRange(slider: HTMLInputElement | null, visibleCommits: number): void`; `setSliderBounds(slider: HTMLInputElement | null, commitCount: number): void`
  - `pan-zoom.ts`: `attachWheelPan(canvas: HTMLCanvasElement, chart: ChartJs, state: CardState, rebuild: (chart: ChartJs) => void, signal: AbortSignal): void`; `bindRangeStrip(chart: ChartJs, els: Pick<CardElements, 'strip' | 'stripWindow'>, state: CardState, rebuildRange: (chart: ChartJs, min: number, max: number) => void, signal: AbortSignal): void`
  - `controller.ts`: `export class ChartController`, with the same constructor and public methods

Where code goes. Line numbers are as of `702aeeb`; PR 1's reformat may shift them, so the symbol names decide.

| Destination | Moves |
|---|---|
| `lib/chart-store/queues.ts` | `QueueEntry`, `InternalEntry`, `TaskQueue`, `makeQueue`, `hydrationQueue`, `fullHistoryQueue`, `bundleQueue` (37–118) |
| `lib/chart-store/bundles.ts` | payload cache, `BundleResult`, settled and in-flight maps, `subscribeGroupBundleRetry`, `retryGroupBundle`, `resetPayloadCache`, `ensureGroupBundle`, `abortGroupBundle` (120–306) |
| `lib/chart-store/global-filter.ts` | `GlobalFilterSnapshot` through `toggleGlobalFilterValue` (308–388) |
| `lib/chart-store/group-store.ts` | `GroupSnapshot` through `noteGroupSeries` (390–632) |
| `components/chart/types.ts` | 108–178 |
| `components/chart/config.ts` | `GRID_COLOR`, `crosshairPlugin` (180–217), and the config literal of `new Chart(canvas, {...})` in `maybeConstruct` (915–1044) |
| `components/chart/datasets.ts` | `benchDatasets`, `buildDatasets` (219–270) |
| `components/chart/tooltip.ts` | `externalTooltipHandler` (272–395) |
| `components/chart/card-dom.ts` | bodies of `syncSliderFromRange`, `syncDownsampleBadge`, `syncWindowChip`, `syncSliderBounds` (1223–1326, 1379–1397) |
| `components/chart/pan-zoom.ts` | bodies of `attachWheelPan`, `bindRangeStrip` (1399–1607) |
| `components/chart/controller.ts` | the rest of `ChartController` (397–1753) |
| `components/Chart.tsx` keeps | `'use client'`, the architecture comment, `ChartIslandProps`, `Chart` (1755–2200) |

Moves are verbatim, with their comments. The only other edits allowed:
- `export` keywords and import lists.
- In moved methods, `this.state`, `this.els()` and `this.aborter.signal` become parameters.
- Each moved private method leaves a one-line delegator with the same name, so no call site inside the controller changes.
- `maybeConstruct` calls `lineChartConfig({...})`, and the `state_` alias goes.
- In `group-store.ts`, the two reads of the module variable `globalSnapshot` become `getGlobalFilterSnapshot()`.

- [ ] **Step 1: Write the pin test** in `Chart.loading.test.tsx`: `it('pans once per wheel event and stops after unmount')`.
  - Render one card in an open group under `<StrictMode>`. The bundle returns 404, and the chart fetch returns `completePayload(20)`.
  - Resolve `loadChartJs` to a `StubChart` that keeps `config.options` and has `pan = vi.fn()`, `update()` and `destroy()`.
  - After construction, assert `stub.options.plugins.tooltip.enabled === false` and that `stub.options.plugins.zoom.limits.x` equals `{ min: 0, max: 19, minRange: 4 }`.
  - Dispatch `new WheelEvent('wheel', { deltaY: 40, cancelable: true })` on the canvas. Expect `pan` to be called once, with `({ x: 20 }, undefined, 'none')`.
  - Unmount, dispatch again on the same canvas node, and expect still one call.
- [ ] **Step 2: Run it on the unsplit code.** Expect PASS: it pins today's behavior.
- [ ] **Step 3: Split `chart-store.ts`** following the table, and run the whole suite. Expect the Task 3 count. Lint and type-check. **Commit:** `Split bench's chart store into modules`.
- [ ] **Step 4: Split `Chart.tsx`** following the table.
- [ ] **Step 5: Verify.**
  - The suite passes at the Task 3 count plus 1, and lint, type-check and build pass.
  - `wc -l` shows `Chart.tsx` under 600 lines, `controller.ts` under 950, and every other new module under 300.
  - `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change HEAD -- bench/web/components` dims everything except imports, exports, delegators and the parameter substitutions.
- [ ] **Step 6: Commit:** `Split bench's chart island into modules`.

### Task 5: Remove test-only helpers and adopt the site's stricter flags

**Files:**
- Modify: `bench/web/lib/chart-format.ts` and `lib/chart-format.test.ts` (delete `PALETTE`, `colorFor`, `assignStableColors`, `labelForCommit` and their tests); `lib/window.ts` and `lib/window.test.ts` (delete `commitWindowUrlValue` and its test)
- Modify: `tsconfig.base.json` (add `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`), `tsconfig.json` (remove both; it inherits them)
- Modify: the files tsc reports. Measured on 2026-10-28 with TS 5.9 on the unsplit tree: 138 + 7 = 145 errors.
  - About 33 are in app code: `lib/chart-format.ts` 20, `lib/queries.ts` 2, the four from `Chart.tsx` (now in `components/chart/*`), `app/page.tsx` 2, `app/chart/[slug]/page.tsx` 1, `components/GroupSection.tsx` 1, `lib/random-access.ts` 1, `lib/db.ts` 1, `lib/test-harness.ts` 1.
  - About 112 are in tests: `groups.test.ts` 36, `Chart.lazy-hydration.test.tsx` 29, `summary.test.ts` 23, `Chart.loading.test.tsx` 9, `cache-fill.test.ts` 5, and a few in others.

**Interfaces:**
- Consumes: Task 3's `queries.ts` and Task 4's modules. This task goes last so its edits land on their final locations.

- [ ] **Step 1: Delete the helpers only tests use.** Check with `grep -rlw -e assignStableColors -e colorFor -e PALETTE -e labelForCommit -e commitWindowUrlValue bench/web/app bench/web/components bench/web/lib`: only the defining files and their tests may appear. Delete the helpers and their tests. Run the suite. **Commit:** `Remove bench helpers that only tests used`.
- [ ] **Step 2: Move the flags into the base.** `bunx tsc --showConfig -p .` must list both flags as `true` before and after. Then run `bunx tsc --noEmit -p bench/web` and record the error count, about 145.
- [ ] **Step 3: Fix without changing behavior.**
  - For `exactOptionalPropertyTypes`, add `| undefined` to the optional property's declared type (`summary?: Summary | undefined`, `benchMeta`, `__benchDbPool?: Pool | undefined`). Never change which keys an object carries.
  - For `noUncheckedIndexedAccess` in app code, use `!` only where the index is in range by construction: a loop bound, a prior length check, `% length`, or `split()[0]`. Otherwise add an explicit `=== undefined` check whose branch does what today's code does with `undefined`. Never add a new `?? 0`, `?? ''` or `?? []`.
  - In tests, use `!` or the existing `expectDefined`.
- [ ] **Step 4: Verify.**
  - `bunx tsc --noEmit -p bench/web` and the root `bun run typecheck` both report 0 errors.
  - The suite passes at the count after Step 1.
  - `bun run check:ci`, `bun run --cwd bench/web build` and `bun run build` pass.
- [ ] **Step 5: Commit:** `Type-check bench with the site's stricter flags`.

### Task 6: Verify, push and open the draft PR

- [ ] **Step 1: Run the local gates.**
  - Build, then run the whole suite with `BENCH_TEST_DATABASE_URL` set. Everything passes, with nothing skipped.
  - `bun run check:ci`, `bunx tsc --noEmit -p bench/web`, `bun run typecheck`, `bun run --cwd bench/web build` and `bun run build` pass.
  - `uvx reuse lint` passes.
  - `git diff --exit-code origin/claude/bench-toolchain -- bench/web/vercel.json` exits 0.
- [ ] **Step 2: Run parity once.** `bash bench/scripts/parity/run.sh origin/claude/bench-toolchain ~/Backups/vortex-bench/vortex_bench-20261028T171815Z` must print `parity: 0 mismatches`.
  - If PR 1 has merged, merge `origin/main` into this branch (never rebase: Auto-fix watches it) and use `origin/main` as the base.
  - On a difference, run `git bisect start HEAD <base>` and then `git bisect run bash bench/scripts/parity/run.sh <base> <dump>`. `run.sh` exits 2 on setup errors, which bisect counts as bad, so read the log of the commit it names.
  - Fix the cause, or explain in the PR why it is negligible.
- [ ] **Step 3: Push** with `git push -u origin claude/bench-cleanup`.
- [ ] **Step 4: Open a draft PR.** Run `gh pr create --draft --base claude/bench-toolchain` (or `main`).
  - Write the body, about 100 words in Simplified Technical English, with the spiral:pr-and-issue-voice skill.
  - It names the parity result and the Task 3 timings, and links the design doc.
  - It says that `BENCH_DB_REGION` on the Vercel project is now unused, and that deleting it is Will's call.
  - It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
  - Show the body in the session before creating the PR (Will pre-authorized opening it as a draft).
- [ ] **Step 5: Check the CI evidence.**
  - `Bench: format, lint, build, test` passes, and its log shows the database suites ran.
  - `Bench Deploy` builds the preview, and `verify-web-deploy.mjs` passes.
- [ ] **Step 6: Hand to Will** for the smoke test in the preview:
  - Open TPC-DS (NVMe) (SF=1) and use Expand All.
  - Click a chart's "load all" chip.
  - Open one permalink page.
