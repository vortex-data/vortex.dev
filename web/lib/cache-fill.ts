// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { getPool } from '@/lib/db';

// Stable two-int PostgreSQL advisory-lock key: "benc" / "grps". Every group
// cache key shares this lock because each fill starts with the same full group
// discovery and summary pass.
const GROUP_CACHE_FILL_LOCK = [0x62656e63, 0x67727073] as const;

const CACHE_FILL_RETRY_DELAYS_MS = [250, 750, 2_000, 4_000, 8_000] as const;

/** Another process is already rebuilding a group cache entry. */
export class GroupCacheFillInProgressError extends Error {
  constructor() {
    super('another process is already rebuilding the group cache');
    this.name = 'GroupCacheFillInProgressError';
  }
}

/**
 * Run one group cache fill under a cross-instance PostgreSQL advisory lock.
 *
 * Lock contention fails immediately and releases the pool connection. The
 * caller can then retry the Data Cache read without keeping a database
 * connection queued behind the active fill. Session advisory locks disappear
 * automatically if the function or its database connection terminates.
 */
export async function withGroupCacheFillLock<T>(fill: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let acquired = false;
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS acquired',
      [...GROUP_CACHE_FILL_LOCK],
    );
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) {
      throw new GroupCacheFillInProgressError();
    }
    return await fill();
  } finally {
    try {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [...GROUP_CACHE_FILL_LOCK]);
      }
    } finally {
      client.release();
    }
  }
}

/** Retry a Data Cache read while another process owns the group fill lock. */
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
