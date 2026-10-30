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
