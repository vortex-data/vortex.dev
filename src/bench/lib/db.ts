// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import { attachDatabasePool } from '@vercel/functions';

/**
 * Resolved Postgres connection settings for the benchmarks read service.
 *
 * The app signs in with a password (`BENCH_DB_PASSWORD`). In production the
 * read service runs on Vercel and connects to the public RDS instance endpoint
 * as the read-only `bench_read` role; the endpoint and role are configured per
 * environment, see the README's "Database environment" and "Deploys" sections.
 */
interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: PoolConfig['ssl'];
  poolMax: number;
  /** Idle-connection timeout (ms) for the pg pool; see `resolveIdleTimeoutMillis`. */
  idleTimeoutMillis: number;
  /** Timeout (ms) for establishing a connection or waiting for a pool slot. */
  connectionTimeoutMillis: number;
  /** Per-statement server timeout (ms); see `resolveStatementTimeoutMillis`. */
  statementTimeoutMillis: number;
}

/**
 * Read a required environment variable, treating an empty string as missing.
 * Throws rather than defaulting so a misconfigured deployment fails loudly at
 * first connection instead of silently targeting the wrong database.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable \`${name}\` for the benchmarks DB connection.`,
    );
  }
  return value;
}

/**
 * Resolves the pg SSL option from `BENCH_DB_SSL`. `verify-full` (the default)
 * validates the server certificate chain AND hostname (`rejectUnauthorized:
 * true`). Node validates against its bundled trust store, which does NOT
 * include the Amazon RDS roots, so `BENCH_DB_CA` must be set to the RDS CA
 * bundle in production or the connection fails loudly at connect time.
 * `disable` turns TLS verification off and is used only by the local
 * integration tests against a non-TLS container. Any other value is rejected
 * rather than silently downgrading certificate verification.
 *
 * Exported for unit testing the mode handling.
 */
export function resolveSsl(): PoolConfig['ssl'] {
  const mode = process.env.BENCH_DB_SSL ?? 'verify-full';
  if (mode === 'disable') {
    return false;
  }
  if (mode !== 'verify-full') {
    throw new Error(
      `Unsupported \`BENCH_DB_SSL\` mode \`${mode}\`; expected 'verify-full' (default) or 'disable'.`,
    );
  }
  const ca = process.env.BENCH_DB_CA;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

const DEFAULT_POOL_TIMEOUT_MS = 5_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/** Read a positive timeout that fits Node's signed 32-bit timer range. */
function resolvePoolTimeoutMillis(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_POOL_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(
      `Invalid \`${name}\` \`${raw}\`; expected an integer from 1 to 2147483647 milliseconds.`,
    );
  }
  return value;
}

/**
 * Resolve the idle timeout from `BENCH_DB_IDLE_TIMEOUT_MS` (default 5 seconds).
 * Vercel keeps the invocation alive until pg's idle timer can close clients.
 * A short, nonzero timeout allows cleanup before the function suspends.
 */
export function resolveIdleTimeoutMillis(): number {
  return resolvePoolTimeoutMillis('BENCH_DB_IDLE_TIMEOUT_MS');
}

/** Resolve the connection and pool acquisition timeout (default 5 seconds). */
export function resolveConnectionTimeoutMillis(): number {
  return resolvePoolTimeoutMillis('BENCH_DB_CONNECTION_TIMEOUT_MS');
}

/**
 * Resolves the PostgreSQL statement timeout in milliseconds. The timeout runs
 * on the server, so PostgreSQL cancels abandoned work when a request times out
 * while its pooled connection remains alive.
 */
export function resolveStatementTimeoutMillis(): number {
  const raw = process.env.BENCH_DB_STATEMENT_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_STATEMENT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid \`BENCH_DB_STATEMENT_TIMEOUT_MS\` \`${raw}\`; expected a non-negative number of milliseconds.`,
    );
  }
  return value;
}

/**
 * The pool's connection limit, from `BENCH_DB_POOL_MAX` (default 8), and never
 * below 2. The cache fills size their concurrency from it (`lib/cache-fill.ts`).
 * A fill holds one connection for its advisory lock while its queries take
 * another, so on a pool of 1 every fill would wait for a connection it cannot
 * get and fail at the connection timeout.
 */
export function resolvePoolMax(): number {
  return Math.max(2, Number(process.env.BENCH_DB_POOL_MAX ?? '8'));
}

function readConfig(): DbConfig {
  return {
    host: requireEnv('BENCH_DB_HOST'),
    port: Number(process.env.BENCH_DB_PORT ?? '5432'),
    database: requireEnv('BENCH_DB_NAME'),
    user: requireEnv('BENCH_DB_USER'),
    password: requireEnv('BENCH_DB_PASSWORD'),
    ssl: resolveSsl(),
    poolMax: resolvePoolMax(),
    idleTimeoutMillis: resolveIdleTimeoutMillis(),
    connectionTimeoutMillis: resolveConnectionTimeoutMillis(),
    statementTimeoutMillis: resolveStatementTimeoutMillis(),
  };
}

function createPool(config: DbConfig = readConfig()): Pool {
  const pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl,
    max: config.poolMax,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    statement_timeout: config.statementTimeoutMillis,
  });
  attachDatabasePool(pool);
  // pg emits idle-client connection failures on the pool. Without this
  // listener, EventEmitter turns a recoverable disconnect into an uncaught
  // exception. The pool removes the failed client and replaces it on demand.
  pool.on('error', (error) => {
    console.error('bench: idle PostgreSQL client error', error);
  });
  return pool;
}

// A single pool is shared across warm serverless invocations and survives
// Next.js dev HMR module reloads by caching on `globalThis`.
const globalForPool = globalThis as unknown as { __benchDbPool?: Pool | undefined };

/** Returns the process-wide singleton connection pool, creating it on first use. */
export function getPool(): Pool {
  globalForPool.__benchDbPool ??= createPool();
  return globalForPool.__benchDbPool;
}

/**
 * Closes the singleton pool (if any) and clears the cached reference so the
 * next [`getPool`] rebuilds a live pool. Used by tests to release the pool in
 * teardown; in production the pool lives for the process so this is rarely
 * called.
 */
export async function resetPool(): Promise<void> {
  const pool = globalForPool.__benchDbPool;
  if (pool) {
    globalForPool.__benchDbPool = undefined;
    await pool.end();
  }
}

/**
 * Builds the `(text, values)` pair for a parameterized query from a tagged
 * template. Interpolated values become `$1`, `$2`, … bind parameters and are
 * returned positionally; nothing is string-concatenated into the SQL text, so
 * the result is safe against SQL injection by construction. Pure and exported
 * for unit testing the placeholder numbering without a database.
 */
export function buildQuery(
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; values: unknown[] } {
  const text = strings.reduce(
    (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
    '',
  );
  return { text, values };
}

/**
 * Tagged-template helper for parameterized queries against the pool.
 *
 * ```ts
 * const rows = await sql<{ n: number }>`SELECT ${1}::int AS n`;
 * ```
 *
 * Division of labor: use `sql` for queries whose text is fixed at the call
 * site (for example `lib/health.ts`); SQL assembled dynamically from filters
 * (the chart and summary queries) uses `QueryParams` in `lib/queries.ts`,
 * which numbers placeholders as conditions are pushed.
 */
export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  const { text } = buildQuery(strings, values);
  const result = await getPool().query<T>(text, values);
  return result.rows;
}
