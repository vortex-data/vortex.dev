// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  cacheFillLockId,
  GroupCacheFillInProgressError,
  retryGroupCacheFill,
  withGroupCacheFillLock,
} from './cache-fill';
import { getPool, resetPool } from './db';
import {
  type BenchDatabase,
  integrationDatabaseAvailable,
  startBenchDatabase,
} from './test-harness';

const databaseAvailable = integrationDatabaseAvailable();

// The two ints of the advisory lock that guards the cache entry `key` (see `cache-fill.ts`).
function lockOf(key: string): [number, number] {
  return [0x62656e63, cacheFillLockId(key)];
}

/** Pool clients checked out now. */
function clientsHeld(): number {
  const pool = getPool();
  return pool.totalCount - pool.idleCount;
}

// Another instance holds the fill lock, as on Vercel when two functions refresh one entry.
describe.skipIf(!databaseAvailable)('group cache fill lock (Postgres)', () => {
  let database: BenchDatabase;
  let other: Client;

  beforeAll(async () => {
    database = await startBenchDatabase({ applySchema: false });
    other = new Client({
      host: process.env.BENCH_DB_HOST,
      port: Number(process.env.BENCH_DB_PORT),
      user: process.env.BENCH_DB_USER,
      password: process.env.BENCH_DB_PASSWORD,
      database: process.env.BENCH_DB_NAME,
      ssl: false,
    });
    await other.connect();
  });

  afterEach(async () => {
    await other.query('SELECT pg_advisory_unlock_all()');
  });

  afterAll(async () => {
    await other.end();
    await resetPool();
    await database.stop();
  });

  it('makes a background refresh wait for the lock, then fill under it', async () => {
    const key = 'group-charts:background';
    await other.query('SELECT pg_advisory_lock($1, $2)', lockOf(key));
    // While the refresh fills, the other instance cannot take the lock.
    const fill = vi.fn(async () => {
      const probe = await other.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS acquired',
        lockOf(key),
      );
      return probe.rows[0]?.acquired === true ? 'filled without the lock' : 'fresh';
    });

    // A stale entry: the read starts the refresh and returns the stale value without waiting.
    let refresh!: Promise<string>;
    await expect(
      retryGroupCacheFill(async () => {
        refresh = withGroupCacheFillLock(key, fill);
        return 'stale';
      }, []),
    ).resolves.toBe('stale');
    const settled = refresh.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

    // The first try lost the lock. The refresh waits for the next one without a connection.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fill).not.toHaveBeenCalled();
    expect(clientsHeld()).toBe(0);

    await other.query('SELECT pg_advisory_unlock($1, $2)', lockOf(key));
    await expect(settled).resolves.toEqual({ value: 'fresh' });
    expect(fill).toHaveBeenCalledOnce();
    expect(clientsHeld()).toBe(0);
    // The refresh let go of the lock.
    const after = await other.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      lockOf(key),
    );
    expect(after.rows[0]?.acquired).toBe(true);
  });

  it('fails a fill that a read waits for at once, and releases its connection', async () => {
    const key = 'group-charts:foreground';
    await other.query('SELECT pg_advisory_lock($1, $2)', lockOf(key));
    const fill = vi.fn(async () => 'never');

    const started = performance.now();
    await expect(
      retryGroupCacheFill(() => withGroupCacheFillLock(key, fill), []),
    ).rejects.toBeInstanceOf(GroupCacheFillInProgressError);
    // One round trip, not a wait for the lock.
    expect(performance.now() - started).toBeLessThan(200);
    expect(fill).not.toHaveBeenCalled();
    expect(clientsHeld()).toBe(0);
  });
});
