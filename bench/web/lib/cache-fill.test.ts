// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connect, poolMax, query, release } = vi.hoisted(() => ({
  connect: vi.fn(),
  poolMax: { value: 8 },
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPool: () => ({ connect }),
  resolvePoolMax: () => poolMax.value,
}));

import {
  cacheFillSlots,
  cacheFillLockId,
  GroupCacheFillInProgressError,
  retryGroupCacheFill,
  withGroupCacheFillLock,
} from '@/lib/cache-fill';

/** A fill that runs until the test settles it. */
function deferredFill(value: string): {
  fill: () => Promise<string>;
  finish: () => void;
} {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fill = vi.fn(async () => {
    await done;
    return value;
  });
  return { fill, finish };
}

/** Let queued promise callbacks and timers run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('group cache fill lock', () => {
  // An `EventEmitter`, like pg's client: emitting `'error'` with no listener throws.
  let client: EventEmitter;

  beforeEach(() => {
    connect.mockReset();
    query.mockReset();
    release.mockReset();
    client = Object.assign(new EventEmitter(), { query, release });
    connect.mockResolvedValue(client);
  });

  it('holds the advisory lock for the fill and releases its client', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [] });
    const fill = vi.fn(async () => 'groups');

    await expect(withGroupCacheFillLock('groups', fill)).resolves.toBe('groups');

    expect(fill).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]![0]).toContain('pg_try_advisory_lock');
    expect(query.mock.calls[1]![0]).toContain('pg_advisory_unlock');
    expect(query.mock.calls[0]![1]).toEqual(query.mock.calls[1]![1]);
    expect(release).toHaveBeenCalledOnce();
    expect(release.mock.calls[0]![0]).toBeUndefined();
    expect(client.listenerCount('error')).toBe(0);
  });

  it('locks only its own cache entry', async () => {
    query.mockResolvedValue({ rows: [{ acquired: true }] });

    await withGroupCacheFillLock('group-charts:a', async () => 'a');
    await withGroupCacheFillLock('group-charts:b', async () => 'b');

    const lockA = query.mock.calls[0]![1];
    const lockB = query.mock.calls[2]![1];
    expect(lockA).toEqual([0x62656e63, cacheFillLockId('group-charts:a')]);
    expect(lockB).toEqual([0x62656e63, cacheFillLockId('group-charts:b')]);
    expect(lockA).not.toEqual(lockB);
  });

  it('fails fast on contention without running the fill', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const fill = vi.fn(async () => 'groups');

    await expect(withGroupCacheFillLock('groups', fill)).rejects.toBeInstanceOf(
      GroupCacheFillInProgressError,
    );

    expect(fill).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('unlocks when the fill fails', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [] });
    const failure = new Error('query failed');

    await expect(
      withGroupCacheFillLock('groups', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(query.mock.calls[1]![0]).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledOnce();
  });

  it('discards a client whose connection drops during the fill', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: true }] });
    const dropped = new Error('Connection terminated unexpectedly');

    await expect(
      withGroupCacheFillLock('groups', async () => {
        client.emit('error', dropped);
        return 'groups';
      }),
    ).resolves.toBe('groups');

    // The lock went with the session, so there is nothing to unlock.
    expect(query).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledExactlyOnceWith(dropped);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('discards a client whose unlock fails, so its session cannot keep the lock', async () => {
    const failure = new Error('canceling statement due to statement timeout');
    query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockRejectedValueOnce(failure);

    await expect(withGroupCacheFillLock('groups', async () => 'groups')).rejects.toBe(failure);

    expect(release).toHaveBeenCalledExactlyOnceWith(failure);
    expect(client.listenerCount('error')).toBe(0);
  });
});

describe('group cache fills in one process', () => {
  beforeEach(() => {
    connect.mockReset();
    query.mockReset();
    release.mockReset();
    query.mockImplementation(async (text: string) =>
      text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: true }] } : { rows: [] },
    );
    connect.mockImplementation(async () => Object.assign(new EventEmitter(), { query, release }));
  });

  it('shares a running fill of the same entry', async () => {
    const running = deferredFill('bundle');

    const first = withGroupCacheFillLock('group-charts:a', running.fill);
    const second = withGroupCacheFillLock('group-charts:a', async () => 'second fill');
    running.finish();

    await expect(first).resolves.toBe('bundle');
    await expect(second).resolves.toBe('bundle');
    expect(running.fill).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });

  it('starts a new fill once the shared one has finished', async () => {
    await withGroupCacheFillLock('group-charts:a', async () => 'first');
    await expect(withGroupCacheFillLock('group-charts:a', async () => 'second')).resolves.toBe(
      'second',
    );
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('runs fills of different entries at once, up to the slot count', async () => {
    expect(cacheFillSlots()).toBe(2);
    const fills = ['a', 'b', 'c'].map((name) => deferredFill(name));

    const results = fills.map((f, i) => withGroupCacheFillLock(`group-charts:${i}`, f.fill));
    await settle();
    // The third waits for a slot without taking a connection.
    expect(connect).toHaveBeenCalledTimes(2);
    expect(fills[2]!.fill).not.toHaveBeenCalled();

    fills[0]!.finish();
    await settle();
    expect(connect).toHaveBeenCalledTimes(3);

    fills[1]!.finish();
    fills[2]!.finish();
    await expect(Promise.all(results)).resolves.toEqual(['a', 'b', 'c']);
  });

  it('gives an exclusive fill every slot, and later fills wait behind it', async () => {
    const bundle = deferredFill('bundle');
    const groups = deferredFill('groups');
    const later = deferredFill('later');

    const bundleResult = withGroupCacheFillLock('group-charts:a', bundle.fill);
    await settle();
    const groupsResult = withGroupCacheFillLock('groups', groups.fill, { exclusive: true });
    const laterResult = withGroupCacheFillLock('group-charts:b', later.fill);
    await settle();
    // A slot is free, but the later fill does not pass the exclusive one queued before it.
    expect(connect).toHaveBeenCalledTimes(1);

    bundle.finish();
    await settle();
    expect(groups.fill).toHaveBeenCalledOnce();
    expect(later.fill).not.toHaveBeenCalled();

    groups.finish();
    await settle();
    expect(later.fill).toHaveBeenCalledOnce();

    later.finish();
    await expect(Promise.all([bundleResult, groupsResult, laterResult])).resolves.toEqual([
      'bundle',
      'groups',
      'later',
    ]);
  });

  it('frees its slot when a fill loses the lock', async () => {
    query.mockImplementation(async (text: string) =>
      text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: false }] } : { rows: [] },
    );
    const lost = await Promise.allSettled(
      Array.from({ length: cacheFillSlots() + 1 }, (_, i) =>
        withGroupCacheFillLock(`group-charts:lost-${i}`, async () => 'never'),
      ),
    );
    for (const outcome of lost) {
      expect(outcome.status === 'rejected' && outcome.reason).toBeInstanceOf(
        GroupCacheFillInProgressError,
      );
    }

    query.mockImplementation(async (text: string) =>
      text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: true }] } : { rows: [] },
    );
    await expect(
      withGroupCacheFillLock('groups', async () => 'groups', { exclusive: true }),
    ).resolves.toBe('groups');
  });
});

describe('cache fill slots', () => {
  beforeEach(() => {
    connect.mockReset();
    query.mockReset();
    release.mockReset();
    query.mockImplementation(async (text: string) =>
      text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: true }] } : { rows: [] },
    );
    connect.mockImplementation(async () => Object.assign(new EventEmitter(), { query, release }));
  });

  afterEach(() => {
    poolMax.value = 8;
  });

  it('fit the pool at two connections per fill, from one up to two', () => {
    for (const [max, slots] of [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [8, 2],
      [100, 2],
      [Number.NaN, 1],
    ] as const) {
      poolMax.value = max;
      expect(cacheFillSlots()).toBe(slots);
    }
  });

  it('runs one fill at a time on a pool of 2, so a fill always has a connection to query on', async () => {
    poolMax.value = 2;
    const first = deferredFill('a');
    const second = deferredFill('b');

    const results = [
      withGroupCacheFillLock('group-charts:small-a', first.fill),
      withGroupCacheFillLock('group-charts:small-b', second.fill),
    ];
    await settle();
    expect(connect).toHaveBeenCalledOnce();
    expect(second.fill).not.toHaveBeenCalled();

    first.finish();
    await settle();
    expect(second.fill).toHaveBeenCalledOnce();

    second.finish();
    await expect(Promise.all(results)).resolves.toEqual(['a', 'b']);
  });
});

describe('a background refresh that loses the lock', () => {
  // The delays between tries of the lock, as in `cache-fill.ts`.
  const delays = [250, 750, 2_000, 4_000, 8_000];

  beforeEach(() => {
    vi.useFakeTimers();
    connect.mockReset();
    query.mockReset();
    release.mockReset();
    connect.mockImplementation(async () => Object.assign(new EventEmitter(), { query, release }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** The lock is taken by another process for the first `taken` tries. */
  function lockTakenFor(taken: number): void {
    let tries = 0;
    query.mockImplementation(async (text: string) => {
      if (text.includes('pg_try_advisory_lock')) {
        tries += 1;
        return { rows: [{ acquired: tries > taken }] };
      }
      return { rows: [] };
    });
  }

  /** Start a fill the way `unstable_cache` refreshes a stale entry: the read starts it and
   * returns the stale value without waiting for it. The refresh comes back in an object: an
   * async function that returned it bare would wait for it. */
  async function staleRead<T>(
    key: string,
    fill: () => Promise<T>,
  ): Promise<{ refresh: Promise<T> }> {
    let refresh!: Promise<T>;
    await expect(
      retryGroupCacheFill(async () => {
        refresh = withGroupCacheFillLock(key, fill);
        return 'stale';
      }, []),
    ).resolves.toBe('stale');
    // Let the refresh settle as a rejection here, not as an unhandled one.
    refresh.catch(() => {});
    return { refresh };
  }

  /** How many pool clients are checked out now. */
  function clientsHeld(): number {
    return connect.mock.calls.length - release.mock.calls.length;
  }

  it('waits for the lock without a connection, then fills', async () => {
    lockTakenFor(2);
    const fill = vi.fn(async () => 'fresh');

    const { refresh } = await staleRead('group-charts:stale', fill);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledOnce();
    expect(clientsHeld()).toBe(0);
    expect(fill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(delays[0]!);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(clientsHeld()).toBe(0);
    expect(fill).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(delays[1]!);
    await expect(refresh).resolves.toBe('fresh');
    expect(fill).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledTimes(3);
    expect(clientsHeld()).toBe(0);
    // The fill ran under the lock, and released it.
    expect(query.mock.calls.at(-1)![0]).toContain('pg_advisory_unlock');
  });

  it('frees its fill slot while it waits', async () => {
    lockTakenFor(1);
    const { refresh } = await staleRead('groups', async () => 'groups');
    await vi.advanceTimersByTimeAsync(0);

    // The group list waits for the lock. Another entry's fill takes the slots meanwhile.
    query.mockImplementation(async (text: string) =>
      text.includes('pg_try_advisory_lock') ? { rows: [{ acquired: true }] } : { rows: [] },
    );
    await expect(withGroupCacheFillLock('group-charts:other', async () => 'other')).resolves.toBe(
      'other',
    );

    await vi.advanceTimersByTimeAsync(delays[0]!);
    await expect(refresh).resolves.toBe('groups');
  });

  it('gives up after the bounded wait', async () => {
    lockTakenFor(Number.POSITIVE_INFINITY);
    const fill = vi.fn(async () => 'never');

    const { refresh } = await staleRead('group-charts:busy', fill);
    const total = delays.reduce((sum, delay) => sum + delay, 0);
    await vi.advanceTimersByTimeAsync(total - 1);
    expect(connect).toHaveBeenCalledTimes(delays.length);
    await vi.advanceTimersByTimeAsync(1);

    await expect(refresh).rejects.toBeInstanceOf(GroupCacheFillInProgressError);
    expect(connect).toHaveBeenCalledTimes(delays.length + 1);
    expect(clientsHeld()).toBe(0);
    expect(fill).not.toHaveBeenCalled();
  });

  it('leaves a read that waits for its fill to fail fast and retry the cache', async () => {
    lockTakenFor(Number.POSITIVE_INFINITY);
    const fill = vi.fn(async () => 'never');

    const read = retryGroupCacheFill(() => withGroupCacheFillLock('group-charts:miss', fill), []);
    read.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    await expect(read).rejects.toBeInstanceOf(GroupCacheFillInProgressError);
    expect(connect).toHaveBeenCalledOnce();
    expect(clientsHeld()).toBe(0);
    expect(fill).not.toHaveBeenCalled();
  });

  it('does not retry a fill that fails for another reason', async () => {
    lockTakenFor(0);
    const failure = new Error('query failed');

    const { refresh } = await staleRead('group-charts:broken', async () => {
      throw failure;
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect(refresh).rejects.toBe(failure);
    expect(connect).toHaveBeenCalledOnce();
  });
});

describe('cache fill lock id', () => {
  it('is the 32-bit FNV-1a hash as a signed int4', () => {
    // The FNV-1a reference vectors: 0x811c9dc5, 0xe40c292c and 0xbf9cf968.
    expect(cacheFillLockId('')).toBe(0x811c9dc5 | 0);
    expect(cacheFillLockId('a')).toBe(0xe40c292c | 0);
    expect(cacheFillLockId('foobar')).toBe(0xbf9cf968 | 0);
    for (const key of ['', 'groups', 'group-charts:qmg.eyJrIjoiUXVlcnlHcm91cCJ9']) {
      const id = cacheFillLockId(key);
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(id).toBeLessThan(2 ** 31);
    }
  });
});

describe('group cache fill retry', () => {
  it('rechecks the Data Cache after lock contention', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new GroupCacheFillInProgressError())
      .mockResolvedValueOnce('cached groups');

    await expect(retryGroupCacheFill(read, [0])).resolves.toBe('cached groups');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated failures', async () => {
    const failure = new Error('database unavailable');
    const read = vi.fn<() => Promise<string>>().mockRejectedValue(failure);

    await expect(retryGroupCacheFill(read, [0])).rejects.toBe(failure);
    expect(read).toHaveBeenCalledOnce();
  });

  it('stops after the bounded contention retries', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new GroupCacheFillInProgressError());

    await expect(retryGroupCacheFill(read, [0, 0])).rejects.toBeInstanceOf(
      GroupCacheFillInProgressError,
    );
    expect(read).toHaveBeenCalledTimes(3);
  });
});
