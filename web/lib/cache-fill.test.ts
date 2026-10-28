// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { connect, query, release } = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getPool: () => ({ connect }),
}));

import {
  GroupCacheFillInProgressError,
  retryGroupCacheFill,
  withGroupCacheFillLock,
} from '@/lib/cache-fill';

describe('group cache fill lock', () => {
  beforeEach(() => {
    connect.mockReset();
    query.mockReset();
    release.mockReset();
    connect.mockResolvedValue({ query, release });
  });

  it('holds the advisory lock for the fill and releases its client', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [] });
    const fill = vi.fn(async () => 'groups');

    await expect(withGroupCacheFillLock(fill)).resolves.toBe('groups');

    expect(fill).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain('pg_try_advisory_lock');
    expect(query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(query.mock.calls[0][1]).toEqual(query.mock.calls[1][1]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('fails fast on contention without running the fill', async () => {
    query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const fill = vi.fn(async () => 'groups');

    await expect(withGroupCacheFillLock(fill)).rejects.toBeInstanceOf(
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
      withGroupCacheFillLock(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(query.mock.calls[1][0]).toContain('pg_advisory_unlock');
    expect(release).toHaveBeenCalledOnce();
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
