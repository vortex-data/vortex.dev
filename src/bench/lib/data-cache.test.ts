// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

// Capture the options unstable_cache is called with, and pass the wrapped
// function through unchanged so the cached wrappers still invoke the real query.
// `vi.hoisted` lifts the capture array alongside the hoisted `vi.mock` factory,
// so it exists when `data-cache.ts` calls `unstable_cache` at import time.
const { cacheCalls, retryGroupCacheFill, withGroupCacheFillLock } = vi.hoisted(() => ({
  cacheCalls: [] as { keyParts: string[]; options: { tags?: string[]; revalidate?: number } }[],
  retryGroupCacheFill: vi.fn((read: () => Promise<unknown>) => read()),
  withGroupCacheFillLock: vi.fn((_key: string, fill: () => Promise<unknown>, _options?: object) =>
    fill(),
  ),
}));
vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    keyParts: string[],
    options: { tags?: string[]; revalidate?: number },
  ) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

vi.mock('@/lib/cache-fill', () => ({
  withGroupCacheFillLock,
  retryGroupCacheFill,
}));

vi.mock('@/lib/queries', () => ({
  collectGroups: vi.fn(async () => [{ name: 'g', slug: 'gs', charts: [] }]),
  collectFilterUniverse: vi.fn(async () => ({ engines: [], formats: [] })),
  collectGroupCharts: vi.fn(async () => ({ name: 'g', charts: [] })),
  chartPayload: vi.fn(async () => ({ display_name: 'c' })),
}));

// Decoding drops an `-alias` suffix, standing in for the lenient decode that lets
// many slugs name one key; encoding gives the canonical slug back.
vi.mock('@/lib/slug', () => ({
  groupKeyFromSlug: (s: string) => ({ slug: s.replace(/-alias$/, '') }),
  chartKeyFromSlug: (s: string) => ({ slug: s.replace(/-alias$/, '') }),
  groupKeyToSlug: (k: { slug: string }) => k.slug,
  chartKeyToSlug: (k: { slug: string }) => k.slug,
}));

import {
  BENCH_DATA_TAG,
  DATA_CACHE_BACKSTOP_SECONDS,
  cachedDefaultChartPayload,
  cachedDefaultGroupCharts,
  cachedFilterUniverse,
  cachedGroups,
} from '@/lib/data-cache';

afterEach(() => {
  cacheCalls.length = 0;
  retryGroupCacheFill.mockClear();
  withGroupCacheFillLock.mockClear();
});

describe('data-cache wrappers', () => {
  it('tags every wrapper with the shared bench-data tag and the backstop TTL', () => {
    expect(BENCH_DATA_TAG).toBe('bench-data');
    expect(DATA_CACHE_BACKSTOP_SECONDS).toBe(86400);
    expect(cacheCalls.map((call) => call.keyParts)).toContainEqual([
      'data-cache:group-charts:v9:n100',
    ]);
    expect(cacheCalls.map((call) => call.keyParts)).toContainEqual(['data-cache:groups:v9']);
    for (const call of cacheCalls) {
      expect(call.options.tags).toEqual([BENCH_DATA_TAG]);
      expect(call.options.revalidate).toBe(DATA_CACHE_BACKSTOP_SECONDS);
    }
    expect(cacheCalls.length).toBeGreaterThanOrEqual(4);
  });

  it('invokes the wrapped query through the cached wrapper', async () => {
    await expect(cachedGroups()).resolves.toEqual([{ name: 'g', slug: 'gs', charts: [] }]);
    await expect(cachedFilterUniverse()).resolves.toEqual({ engines: [], formats: [] });
    await expect(cachedDefaultGroupCharts('gs')).resolves.toEqual({ name: 'g', charts: [] });
    await expect(cachedDefaultChartPayload('cs')).resolves.toEqual({ display_name: 'c' });
    expect(withGroupCacheFillLock).toHaveBeenCalledTimes(2);
    expect(retryGroupCacheFill).toHaveBeenCalledTimes(2);
  });

  it('locks each group bundle on its own key, and the group list on every fill slot', async () => {
    await cachedGroups();
    await cachedDefaultGroupCharts('gs');
    expect(withGroupCacheFillLock.mock.calls[0]![0]).toBe('groups');
    expect(withGroupCacheFillLock.mock.calls[0]![2]).toEqual({ exclusive: true });
    expect(withGroupCacheFillLock.mock.calls[1]![0]).toBe('group-charts:gs');
    expect(withGroupCacheFillLock.mock.calls[1]![2]).toBeUndefined();
  });

  // A fill learns from the read it runs in whether anyone still waits for it (a background
  // refresh of a stale entry does not), so every locked fill must start inside its read.
  it('starts every locked fill inside a cache read that retries on contention', async () => {
    let reading = false;
    const startedInRead: boolean[] = [];
    retryGroupCacheFill.mockImplementation(async (read: () => Promise<unknown>) => {
      reading = true;
      try {
        return await read();
      } finally {
        reading = false;
      }
    });
    withGroupCacheFillLock.mockImplementation((_key, fill) => {
      startedInRead.push(reading);
      return fill();
    });

    await cachedGroups();
    await cachedDefaultGroupCharts('gs');
    expect(startedInRead).toEqual([true, true]);
  });

  it('reads and fills an aliased slug under its canonical slug', async () => {
    const { collectGroupCharts, chartPayload } = await import('@/lib/queries');
    await cachedDefaultGroupCharts('gs-alias');
    await cachedDefaultChartPayload('cs-alias');
    expect(withGroupCacheFillLock.mock.calls[0]![0]).toBe('group-charts:gs');
    expect(vi.mocked(collectGroupCharts)).toHaveBeenLastCalledWith(
      { slug: 'gs' },
      expect.anything(),
    );
    expect(vi.mocked(chartPayload)).toHaveBeenLastCalledWith({ slug: 'cs' }, expect.anything());
  });
});
