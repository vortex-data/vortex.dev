// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Shared harness for the DB-backed vitest suites. This module is imported only
 * by `*.test.ts` files; it never reaches a production bundle.
 *
 * It centralizes the pieces the suites previously copy-pasted (and that had
 * already begun to drift in name): the database probe, the migration runner,
 * the database boot + `BENCH_DB_*` env wiring, and the canonical three-commit
 * chart fixture mirroring `server/tests/common/mod.rs`.
 *
 * A suite gets its database from one of two places. With
 * `BENCH_TEST_DATABASE_URL` set it gets a throwaway database on that server;
 * otherwise it gets a throwaway Postgres container from Docker.
 */

import { execFileSync, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type Pool } from 'pg';

/** A disposable Postgres database. Callers own teardown: resetPool(), then stop(). */
export interface BenchDatabase {
  stop(): Promise<void>;
}

/** How to reach the server named by `BENCH_TEST_DATABASE_URL`. */
export interface TestDatabaseSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  adminDatabase: string;
}

const URL_VARIABLE = 'BENCH_TEST_DATABASE_URL';

/** Trust auth ignores the password, but `BENCH_DB_PASSWORD` must not be empty. */
const TRUST_PASSWORD = 'trust';

/** Serializes first applies of the migrations: they create cluster-wide roles, and two at once
 * race on `CREATE ROLE`. The two keys spell "benc" and "test". */
const MIGRATION_LOCK_KEYS: readonly [number, number] = [0x62656e63, 0x74657374];

/** Read the server address from a `postgres://user[:password]@host[:port][/database]` URL. */
export function testDatabaseSettings(url: string): TestDatabaseSettings {
  const invalid = new Error(
    `${URL_VARIABLE} must be a postgres:// URL that names a user, such as ` +
      'postgres://postgres@127.0.0.1:55433/postgres',
  );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalid;
  }
  if ((parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') || !parsed.username) {
    throw invalid;
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port === '' ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: parsed.password === '' ? TRUST_PASSWORD : decodeURIComponent(parsed.password),
    adminDatabase: decodeURIComponent(parsed.pathname.slice(1)) || 'postgres',
  };
}

// Mirror the repo's Python `_docker_available()` precedent: without a database
// URL, the integration tests need a Docker daemon.
function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Whether the integration suites can get a database: `BENCH_TEST_DATABASE_URL` is set, or Docker
 * runs. The suites skip (not fail) when neither is true, except in CI, where a skip would let a
 * broken runner pass with the database suites silently off, so it throws.
 */
export function integrationDatabaseAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  docker: () => boolean = dockerAvailable,
): boolean {
  const url = env[URL_VARIABLE];
  if (url !== undefined && url !== '') {
    return true;
  }
  if (docker()) {
    return true;
  }
  if (env.CI === 'true') {
    throw new Error(
      `The integration tests need Docker or ${URL_VARIABLE}, and CI has neither. Refusing to skip them.`,
    );
  }
  return false;
}

/** Apply the actual migration runner to one database. Requires uv on PATH. */
function applyMigrations(settings: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): void {
  execFileSync(
    'uv',
    [
      'run',
      '--no-project',
      fileURLToPath(new URL('../../scripts/migrate-schema.py', import.meta.url)),
      'apply',
    ],
    {
      env: {
        ...process.env,
        PGHOST: settings.host,
        PGPORT: String(settings.port),
        PGDATABASE: settings.database,
        PGUSER: settings.user,
        PGPASSWORD: settings.password,
        PGSSLMODE: 'disable',
      },
      stdio: 'pipe',
    },
  );
}

function exportConnectionEnv(settings: {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}): void {
  process.env.BENCH_DB_HOST = settings.host;
  process.env.BENCH_DB_PORT = String(settings.port);
  process.env.BENCH_DB_NAME = settings.database;
  process.env.BENCH_DB_USER = settings.user;
  process.env.BENCH_DB_PASSWORD = settings.password;
  process.env.BENCH_DB_SSL = 'disable';
}

async function withAdminClient<T>(
  settings: TestDatabaseSettings,
  run: (admin: Client) => Promise<T>,
): Promise<T> {
  const admin = new Client({
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.adminDatabase,
    ssl: false,
  });
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.end();
  }
}

/** Create a throwaway database on the server `BENCH_TEST_DATABASE_URL` names. */
async function startDatabaseOnServer(
  settings: TestDatabaseSettings,
  applySchema: boolean,
): Promise<BenchDatabase> {
  const name = `bench_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const drop = (): Promise<void> =>
    withAdminClient(settings, async (admin) => {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    });

  await withAdminClient(settings, async (admin) => {
    await admin.query('SELECT pg_advisory_lock($1, $2)', [...MIGRATION_LOCK_KEYS]);
    try {
      await admin.query(`CREATE DATABASE "${name}"`);
      if (applySchema) {
        try {
          applyMigrations({ ...settings, database: name });
        } catch (error) {
          await drop();
          throw error;
        }
      }
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1, $2)', [...MIGRATION_LOCK_KEYS]);
    }
  });
  exportConnectionEnv({ ...settings, database: name });
  return { stop: drop };
}

/** Start a disposable Postgres database and apply the actual migration runner. With
 * `BENCH_TEST_DATABASE_URL` set it creates a database on that server; otherwise it starts a
 * container. Callers own teardown: resetPool(), then stop(). Requires uv on PATH.
 */
export async function startBenchDatabase(
  options: { applySchema?: boolean } = {},
): Promise<BenchDatabase> {
  const applySchema = options.applySchema !== false;
  const url = process.env[URL_VARIABLE];
  if (url !== undefined && url !== '') {
    return startDatabaseOnServer(testDatabaseSettings(url), applySchema);
  }

  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const settings = {
    host: container.getHost(),
    port: container.getPort(),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
  };
  exportConnectionEnv(settings);
  if (applySchema) {
    try {
      applyMigrations(settings);
    } catch (error) {
      await container.stop();
      throw error;
    }
  }
  return {
    stop: async () => {
      await container.stop();
    },
  };
}

// The canonical web UI fixture contains three oldest-first commits. Vortex and
// Parquet occur on each commit. Lance occurs only on the oldest commit to test
// its sparse cadence. Each commit adds a bias to keep other series non-flat.
export const COMMITS: ReadonlyArray<readonly [string, string, string]> = [
  ['1'.repeat(40), '2026-04-23T12:00:00Z', 'first commit'],
  ['2'.repeat(40), '2026-04-24T12:00:00Z', 'second commit'],
  ['3'.repeat(40), '2026-04-25T12:00:00Z', 'third commit'],
];

/** The fixture's shared (arbitrary) tree SHA. */
export const TREE_SHA = 'fedcba9876543210fedcba9876543210fedcba98';

/** Render the fixture commit URL for `sha`, matching the ingest writer. */
export function commitUrl(sha: string): string {
  return `https://github.com/vortex-data/vortex/commit/${sha}`;
}

/** Seed the canonical three-commit fixture (see [`COMMITS`]) into `pool`. */
export async function seedChartFixture(pool: Pool): Promise<void> {
  let id = 0;
  const mid = (): number => {
    id += 1;
    return id;
  };
  for (const [sha, ts, msg] of COMMITS) {
    await pool.query(
      `INSERT INTO commits (commit_sha, timestamp, message, tree_sha, url)
       VALUES ($1, $2::timestamptz, $3, $4, $5)`,
      [sha, ts, msg, TREE_SHA, commitUrl(sha)],
    );
  }
  for (let i = 0; i < COMMITS.length; i += 1) {
    const sha = COMMITS[i][0];
    const bias = i * 50_000;
    // query_measurements: Q1 has two engine/format series, Q2 has one.
    const qm: ReadonlyArray<readonly [number, string, string, number]> = [
      [1, 'datafusion', 'vortex-file-compressed', 1_000_000 + bias],
      [1, 'duckdb', 'parquet', 800_000 + bias],
      [2, 'datafusion', 'vortex-file-compressed', 600_000 + bias],
    ];
    for (const [queryIdx, engine, format, valueNs] of qm) {
      await pool.query(
        `INSERT INTO query_measurements
           (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
            query_idx, storage, engine, format, value_ns, all_runtimes_ns,
            commit_timestamp)
         VALUES ($1, $2, 'tpch', NULL, '1', $3, 'nvme', $4, $5, $6, '{1}'::bigint[],
                 (SELECT timestamp FROM commits WHERE commit_sha = $2))`,
        [mid(), sha, queryIdx, engine, format, valueNs],
      );
    }
    const compTimes: Array<readonly [string, string, number]> = [
      ['vortex-file-compressed', 'encode', 9_000 + bias],
      ['vortex-file-compressed', 'decode', 5_000 + bias],
      ['parquet', 'encode', 18_000 + 2 * bias],
      ['parquet', 'decode', 10_000 + 2 * bias],
    ];
    if (i === 0) {
      compTimes.push(['lance', 'encode', 36_000], ['lance', 'decode', 20_000]);
    }
    for (const [format, op, valueNs] of compTimes) {
      await pool.query(
        `INSERT INTO compression_times
           (measurement_id, commit_sha, dataset, dataset_variant, format, op,
            value_ns, all_runtimes_ns)
         VALUES ($1, $2, 'tpch-lineitem', NULL, $3, $4, $5, '{1}'::bigint[])`,
        [mid(), sha, format, op, valueNs],
      );
    }
    const compSizes: Array<readonly [string, number]> = [
      ['vortex-file-compressed', 4_000 + bias],
      ['parquet', 8_000 + 2 * bias],
    ];
    if (i === 0) {
      // Arrow IPC is not present in every run. The summary must use its latest
      // per-dataset value without tying it to the current Vortex snapshot.
      compSizes.push(['arrow-ipc', 32_000]);
      compSizes.push(['lance', 16_000]);
    }
    const uncompressedBytes = 32_000 + 8 * bias;
    for (const [format, valueBytes] of compSizes) {
      await pool.query(
        `INSERT INTO compression_sizes
           (measurement_id, commit_sha, dataset, dataset_variant, format,
            value_bytes, uncompressed_bytes)
         VALUES ($1, $2, 'tpch-lineitem', NULL, $3, $4, $5)`,
        [mid(), sha, format, valueBytes, uncompressedBytes],
      );
    }
    const randomAccess: ReadonlyArray<readonly [string, number]> = [
      ['vortex-file-compressed', 500 + bias],
      ['parquet', 1_000 + 2 * bias],
      ['arrow-ipc', 1_500 + 3 * bias],
    ];
    for (const [format, valueNs] of randomAccess) {
      for (const [openMode, modeValueNs] of [
        ['cached', valueNs],
        ['reopen', valueNs * 10],
      ] as const) {
        await pool.query(
          `INSERT INTO random_access_times
             (measurement_id, commit_sha, dataset, format, open_mode, value_ns, all_runtimes_ns)
           VALUES ($1, $2, 'taxi', $3, $4, $5, '{1}'::bigint[])`,
          [mid(), sha, format, openMode, modeValueNs],
        );
      }
    }
    await pool.query(
      `INSERT INTO vector_search_runs
         (measurement_id, commit_sha, dataset, layout, flavor, threshold, value_ns,
          all_runtimes_ns, matches, rows_scanned, bytes_scanned, iterations)
       VALUES ($1, $2, 'cohere-large-10m', 'partitioned', 'vortex-turboquant', 0.75, $3,
               '{1}'::bigint[], 42, 1000000, 5000000, 1)`,
      [mid(), sha, 7_000 + bias],
    );
  }
}
