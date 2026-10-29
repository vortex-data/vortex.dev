// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BenchDatabase,
  integrationDatabaseAvailable,
  startBenchDatabase,
} from './test-harness';
import {
  buildQuery,
  getPool,
  requireEnv,
  resetPool,
  resolveIdleTimeoutMillis,
  resolveConnectionTimeoutMillis,
  resolveStatementTimeoutMillis,
  resolveSsl,
  sql,
} from './db';

const databaseAvailable = integrationDatabaseAvailable();

describe.skipIf(!databaseAvailable)('db pool roundtrip (testcontainers Postgres)', () => {
  let container: BenchDatabase;

  beforeAll(async () => {
    // The pool roundtrip needs no schema; the harness sets the BENCH_DB_*
    // variables that getPool() reads.
    vi.stubEnv('BENCH_DB_POOL_MAX', '1');
    vi.stubEnv('BENCH_DB_CONNECTION_TIMEOUT_MS', '1000');
    container = await startBenchDatabase({ applySchema: false });
  });

  afterAll(async () => {
    await resetPool();
    await container.stop();
    vi.unstubAllEnvs();
  });

  it('connects via the password fixture and roundtrips a SELECT', async () => {
    const rows = await sql<{
      one: number;
      greeting: string;
    }>`SELECT ${1}::int AS one, ${'hi'}::text AS greeting`;
    expect(rows).toEqual([{ one: 1, greeting: 'hi' }]);
  });

  it('times out waiting for a pool slot and recovers after release', async () => {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await expect(pool.query('SELECT 1')).rejects.toThrow(
        'timeout exceeded when trying to connect',
      );
    } finally {
      client.release();
    }
    expect(await sql`SELECT 1 AS one`).toEqual([{ one: 1 }]);
  }, 5000);

  it('binds interpolated values as parameters rather than concatenating them', async () => {
    const hostile = '1); DROP TABLE x; --';
    const rows = await sql<{ v: string }>`SELECT ${hostile}::text AS v`;
    // The hostile string round-trips verbatim as a value, proving it was bound
    // as $1 and never interpolated into the SQL text.
    expect(rows).toEqual([{ v: hostile }]);
  });
});

describe('buildQuery (parameterization)', () => {
  const q = (strings: TemplateStringsArray, ...values: unknown[]) => buildQuery(strings, values);

  it('numbers interpolated values $1..$n positionally', () => {
    expect(q`SELECT ${1}, ${'x'}, ${true}`).toEqual({
      text: 'SELECT $1, $2, $3',
      values: [1, 'x', true],
    });
  });

  it('emits no placeholders for a template with no interpolations', () => {
    expect(q`SELECT 1`).toEqual({ text: 'SELECT 1', values: [] });
  });

  it('handles leading and trailing interpolation', () => {
    expect(q`${'a'} mid ${42}`).toEqual({ text: '$1 mid $2', values: ['a', 42] });
  });
});

describe('resolveSsl', () => {
  afterEach(() => {
    delete process.env.BENCH_DB_SSL;
    delete process.env.BENCH_DB_CA;
  });

  it('defaults to verify-full (rejectUnauthorized true)', () => {
    delete process.env.BENCH_DB_SSL;
    expect(resolveSsl()).toEqual({ rejectUnauthorized: true });
  });

  it('returns false for mode=disable', () => {
    process.env.BENCH_DB_SSL = 'disable';
    expect(resolveSsl()).toBe(false);
  });

  it('merges BENCH_DB_CA into the verify-full ssl object', () => {
    process.env.BENCH_DB_SSL = 'verify-full';
    process.env.BENCH_DB_CA = 'rds-ca-pem';
    expect(resolveSsl()).toEqual({ rejectUnauthorized: true, ca: 'rds-ca-pem' });
  });

  it('throws (fails loud) on an unrecognized mode rather than silently disabling verification', () => {
    process.env.BENCH_DB_SSL = 'verify-ca';
    expect(() => resolveSsl()).toThrow(/BENCH_DB_SSL/);
  });
});

describe.each([
  ['BENCH_DB_IDLE_TIMEOUT_MS', resolveIdleTimeoutMillis],
  ['BENCH_DB_CONNECTION_TIMEOUT_MS', resolveConnectionTimeoutMillis],
] as const)('%s', (name, resolve) => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 5000 ms when unset or blank', () => {
    for (const value of [undefined, '', '  ']) {
      vi.stubEnv(name, value);
      expect(resolve()).toBe(5000);
    }
  });

  it('honors a positive integer override', () => {
    vi.stubEnv(name, '12000');
    expect(resolve()).toBe(12000);
  });

  it.each(['soon', '-1', '0', '1.5', 'Infinity', '2147483648'])(
    'rejects %s instead of disabling the timeout or overflowing its timer',
    (value) => {
      vi.stubEnv(name, value);
      expect(resolve).toThrow(name);
    },
  );
});

describe('resolveStatementTimeoutMillis', () => {
  afterEach(() => {
    delete process.env.BENCH_DB_STATEMENT_TIMEOUT_MS;
  });

  it('defaults to 30000 ms when unset or empty', () => {
    delete process.env.BENCH_DB_STATEMENT_TIMEOUT_MS;
    expect(resolveStatementTimeoutMillis()).toBe(30000);
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = '';
    expect(resolveStatementTimeoutMillis()).toBe(30000);
  });

  it('honors a numeric override and accepts 0', () => {
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = '45000';
    expect(resolveStatementTimeoutMillis()).toBe(45000);
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = '0';
    expect(resolveStatementTimeoutMillis()).toBe(0);
  });

  it('rejects invalid and negative values', () => {
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = 'later';
    expect(() => resolveStatementTimeoutMillis()).toThrow(/BENCH_DB_STATEMENT_TIMEOUT_MS/);
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = '-1';
    expect(() => resolveStatementTimeoutMillis()).toThrow(/BENCH_DB_STATEMENT_TIMEOUT_MS/);
  });
});

describe('singleton pool configuration', () => {
  const ENV_KEYS = [
    'BENCH_DB_HOST',
    'BENCH_DB_NAME',
    'BENCH_DB_USER',
    'BENCH_DB_PASSWORD',
    'BENCH_DB_SSL',
    'BENCH_DB_IDLE_TIMEOUT_MS',
    'BENCH_DB_CONNECTION_TIMEOUT_MS',
    'BENCH_DB_STATEMENT_TIMEOUT_MS',
    'BENCH_DB_PORT',
    'BENCH_DB_REGION',
    'BENCH_DB_POOL_MAX',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  function configurePoolEnvironment(): void {
    process.env.BENCH_DB_HOST = 'localhost';
    process.env.BENCH_DB_NAME = 'bench';
    process.env.BENCH_DB_USER = 'bench_reader';
    process.env.BENCH_DB_PASSWORD = 'fixture-pw';
    process.env.BENCH_DB_SSL = 'disable';
  }

  beforeEach(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    await resetPool();
  });

  afterEach(async () => {
    await resetPool();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('uses the resolved timeouts as pool options', () => {
    configurePoolEnvironment();
    process.env.BENCH_DB_IDLE_TIMEOUT_MS = '123456';
    process.env.BENCH_DB_CONNECTION_TIMEOUT_MS = '3456';
    process.env.BENCH_DB_STATEMENT_TIMEOUT_MS = '23456';

    // `pg`'s Pool exposes the resolved construction options at runtime but the
    // types do not surface `options`, so read it through a narrow cast.
    const pool = getPool() as unknown as {
      options: {
        idleTimeoutMillis?: number;
        connectionTimeoutMillis?: number;
        statement_timeout?: number;
      };
    };
    expect(pool.options.idleTimeoutMillis).toBe(123456);
    expect(pool.options.statement_timeout).toBe(23456);
    expect(pool.options.connectionTimeoutMillis).toBe(3456);
  });

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

  it('attaches one lifecycle listener per singleton pool', async () => {
    configurePoolEnvironment();
    const pool = getPool();
    expect(getPool()).toBe(pool);
    expect(pool.listenerCount('release')).toBe(1);

    await resetPool();
    const replacement = getPool();
    expect(replacement).not.toBe(pool);
    expect(replacement.listenerCount('release')).toBe(1);
  });

  it('handles idle-client errors on the shared pool', () => {
    configurePoolEnvironment();
    const pool = getPool();
    const error = new Error('fixture idle-client disconnect');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(pool.listenerCount('error')).toBe(1);
    expect(() => pool.emit('error', error)).not.toThrow();
    expect(log).toHaveBeenCalledWith('bench: idle PostgreSQL client error', error);
  });
});

describe('requireEnv', () => {
  it('returns a set value', () => {
    process.env.BENCH_TEST_REQ = 'present';
    expect(requireEnv('BENCH_TEST_REQ')).toBe('present');
    delete process.env.BENCH_TEST_REQ;
  });

  it('throws on a missing variable', () => {
    delete process.env.BENCH_TEST_REQ_MISSING;
    expect(() => requireEnv('BENCH_TEST_REQ_MISSING')).toThrow(/BENCH_TEST_REQ_MISSING/);
  });

  it('throws on an empty variable', () => {
    process.env.BENCH_TEST_REQ_EMPTY = '';
    expect(() => requireEnv('BENCH_TEST_REQ_EMPTY')).toThrow();
    delete process.env.BENCH_TEST_REQ_EMPTY;
  });
});
