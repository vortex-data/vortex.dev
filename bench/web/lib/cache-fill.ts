// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { getPool, resolvePoolMax } from '@/lib/db';

// First int of every group cache fill's two-int PostgreSQL advisory-lock key: "benc". The second
// is a hash of the cache entry's key (`cacheFillLockId`), so fills of different entries run at
// once and only fills of the same entry wait for each other. A hash collision only makes two
// entries take turns.
const GROUP_CACHE_FILL_LOCK_SPACE = 0x62656e63;

const CACHE_FILL_RETRY_DELAYS_MS = [250, 750, 2_000, 4_000, 8_000] as const;

// At most this many fills run at once in one process, however large the pool.
const MAX_CACHE_FILL_SLOTS = 2;

// A group bundle's fill holds one pool connection for its lock and runs one query or one
// transaction at a time, so it never asks for more than two connections.
const BUNDLE_FILL_CONNECTIONS = 2;

/**
 * Fill slots in one process: as many group-bundle fills as the pool holds at their two connections
 * each, from one up to [`MAX_CACHE_FILL_SLOTS`]. The group list takes every slot; it holds its lock
 * and runs seven summaries at once (`QUERY_CONCURRENCY` in `lib/queries.ts`). So with the default
 * pool of 8 the fills in one process never ask for more than 8 connections at once: 1 + 7, or
 * 2 × 2. A pool of 2 or 3 runs one fill at a time, so the fill always has a connection for its
 * queries. A fill waiting for a slot holds no connection.
 */
export function cacheFillSlots(): number {
  const fit = Math.floor(resolvePoolMax() / BUNDLE_FILL_CONNECTIONS);
  return Number.isFinite(fit) ? Math.min(MAX_CACHE_FILL_SLOTS, Math.max(1, fit)) : 1;
}

/** Another process is already filling this group cache entry. */
export class GroupCacheFillInProgressError extends Error {
  constructor() {
    super('another process is already filling this group cache entry');
    this.name = 'GroupCacheFillInProgressError';
  }
}

/**
 * The 32-bit FNV-1a hash of `key`, as the signed int4 that `pg_try_advisory_lock(int, int)`
 * takes.
 */
export function cacheFillLockId(key: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash = Math.imul(hash ^ byte, 0x01000193);
  }
  return hash | 0;
}

let usedSlots = 0;
const slotWaiters: { exclusive: boolean; grant: (slots: number) => void }[] = [];

// First come, first served: a fill that needs every slot waits at the head of the queue for the
// running fills to finish, and no later fill passes it.
function grantSlots(): void {
  const capacity = cacheFillSlots();
  while (slotWaiters.length > 0) {
    const slots = slotWaiters[0]!.exclusive ? capacity : 1;
    if (usedSlots + slots > capacity) {
      return;
    }
    usedSlots += slots;
    slotWaiters.shift()!.grant(slots);
  }
}

async function withFillSlots<T>(exclusive: boolean, run: () => Promise<T>): Promise<T> {
  const slots = await new Promise<number>((grant) => {
    slotWaiters.push({ exclusive, grant });
    grantSlots();
  });
  try {
    return await run();
  } finally {
    usedSlots -= slots;
    grantSlots();
  }
}

// Fills running in this process, by cache entry. A second request for an entry shares the
// running fill instead of queueing for a slot and then losing the entry's lock.
const runningFills = new Map<string, Promise<unknown>>();

/**
 * Run one group cache fill for the entry `key`, under a cross-instance PostgreSQL advisory lock
 * for that entry.
 *
 * In one process, a fill for an entry that is already filling shares that fill, and fills take
 * turns for [`cacheFillSlots`]; `exclusive` takes every slot. Lock contention with another
 * process (another instance, or a preview deployment on the same database) fails immediately and
 * releases the pool connection. The caller can then retry the Data Cache read without keeping a
 * database connection queued behind the active fill. Session advisory locks disappear
 * automatically if the function or its database connection terminates.
 */
export function withGroupCacheFillLock<T>(
  key: string,
  fill: () => Promise<T>,
  { exclusive = false }: { exclusive?: boolean } = {},
): Promise<T> {
  const running = runningFills.get(key);
  if (running !== undefined) {
    return running as Promise<T>;
  }
  const started = withFillSlots(exclusive, () => fillUnderLock(cacheFillLockId(key), fill)).finally(
    () => {
      runningFills.delete(key);
    },
  );
  runningFills.set(key, started);
  return started;
}

async function fillUnderLock<T>(lockId: number, fill: () => Promise<T>): Promise<T> {
  const lock = [GROUP_CACHE_FILL_LOCK_SPACE, lockId];
  const client = await getPool().connect();
  // A client whose connection dropped or whose unlock failed is broken; release it with the error
  // so the pool discards it, which ends its session and any lock the session still holds. pg emits
  // a dropped connection as `'error'` on the client, and the pool listens only while the client is
  // idle, so without this listener the event would be an uncaught exception.
  let broken: Error | undefined;
  const onError = (error: Error): void => {
    broken ??= error;
  };
  client.on('error', onError);
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      lock,
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) {
      throw new GroupCacheFillInProgressError();
    }
    return await fill();
  } finally {
    try {
      // A dropped connection ended the session, and the lock with it.
      if (acquired && broken === undefined) {
        await client
          .query('SELECT pg_advisory_unlock($1, $2)', lock)
          .catch((unlockError: unknown) => {
            broken ??= unlockError instanceof Error ? unlockError : new Error(String(unlockError));
            throw unlockError;
          });
      }
    } finally {
      client.removeListener('error', onError);
      client.release(broken);
    }
  }
}

/** Retry a Data Cache read while another process owns the entry's fill lock. */
export async function retryGroupCacheFill<T>(
  read: () => Promise<T>,
  retryDelaysMs: readonly number[] = CACHE_FILL_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!(error instanceof GroupCacheFillInProgressError) || attempt >= retryDelaysMs.length) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }
  }
}
