// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The chart page's redirect to its one URL, through `generateMetadata`, which
 * calls it before any query. Next.js's `redirect` and `permanentRedirect`
 * throw; this stand-in throws something the tests can read.
 */
class Redirect extends Error {
  constructor(
    readonly kind: 'temporary' | 'permanent',
    readonly to: string,
  ) {
    super(`${kind} redirect to ${to}`);
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect('temporary', to);
  },
  permanentRedirect: (to: string) => {
    throw new Redirect('permanent', to);
  },
  notFound: () => {
    throw new Error('not found');
  },
}));

// `alias` decodes to the same key as `ok`, whose canonical slug is `ok`; `bad`
// is malformed.
vi.mock('@/bench/lib/slug', () => ({
  chartKeyFromSlug: (slug: string) => {
    if (slug === 'bad') {
      throw new Error('invalid');
    }
    return { k: 'QueryMeasurement', slug: slug === 'alias' ? 'ok' : slug };
  },
  chartKeyToSlug: (key: { slug: string }) => key.slug,
}));

// The page is served under /bench here, as on a preview.
vi.mock('@/bench/lib/request-base', () => ({ requestBenchBase: async () => '/bench' }));

const UNIVERSE = { engines: ['duckdb'], formats: ['parquet', 'vortex'] };
const cachedFilterUniverse = vi.fn(async () => UNIVERSE);
// Both payload reads return null, so `generateMetadata` returns `{}` once the
// redirect check passes: the tests only need to know which read ran.
const cachedDefaultChartPayload = vi.fn<(slug: string) => Promise<null>>(async () => null);
vi.mock('@/bench/lib/data-cache', () => ({
  cachedFilterUniverse: () => cachedFilterUniverse(),
  cachedDefaultChartPayload: (slug: string) => cachedDefaultChartPayload(slug),
}));

const chartPayload = vi.fn<(key: unknown, window: unknown) => Promise<null>>(async () => null);
vi.mock('@/bench/lib/queries', () => ({
  chartPayload: (key: unknown, window: unknown) => chartPayload(key, window),
}));

// The chart island needs a browser; the metadata never renders it.
vi.mock('@/bench/components/Chart', () => ({ Chart: () => null }));

const { generateMetadata } = await import('@/app/(bench)/bench/chart/[slug]/page');
const { NOT_FOUND_METADATA } = await import('@/bench/lib/not-found-metadata');

type Query = Record<string, string | string[] | undefined>;

/** The metadata for a request, or the redirect it threw. */
async function metadata(slug: string, query: Query = {}): Promise<Redirect | object> {
  try {
    return await generateMetadata({
      params: Promise.resolve({ slug }),
      searchParams: Promise.resolve(query),
    });
  } catch (error) {
    if (error instanceof Redirect) {
      return error;
    }
    throw error;
  }
}

const permanent = (to: string) => new Redirect('permanent', to);
// The fake has no chart, so a request that is not redirected gets the 404's
// metadata, as the page 404s.
const served = NOT_FOUND_METADATA;
const temporary = (to: string) => new Redirect('temporary', to);

afterEach(() => {
  vi.clearAllMocks();
  cachedFilterUniverse.mockResolvedValue(UNIVERSE);
});

describe('the chart page redirect', () => {
  it('serves the default window as sent, whatever else the query holds', async () => {
    expect(await metadata('ok', { utm_source: 'x' })).toEqual(served);
    expect(cachedDefaultChartPayload).toHaveBeenCalledWith('ok');
    expect(cachedFilterUniverse).not.toHaveBeenCalled();
  });

  it('serves a canonical non-default window without a redirect', async () => {
    expect(await metadata('ok', { n: 'all', engine: 'duckdb' })).toEqual(served);
    expect(chartPayload).toHaveBeenCalledWith(expect.anything(), { kind: 'all' });
  });

  it('sends another spelling of the slug to the canonical one, keeping its window', async () => {
    expect(await metadata('alias')).toEqual(permanent('/bench/chart/ok'));
    expect(await metadata('alias', { n: '50' })).toEqual(permanent('/bench/chart/ok?n=50'));
    expect(chartPayload).not.toHaveBeenCalled();
  });

  it('drops a parameter the page does not read from a non-default window', async () => {
    expect(await metadata('ok', { n: 'all', utm_source: 'x' })).toEqual(
      permanent('/bench/chart/ok?n=all'),
    );
  });

  it('respells n as the rung it snaps to', async () => {
    expect(await metadata('ok', { n: '150' })).toEqual(permanent('/bench/chart/ok?n=200'));
    expect(await metadata('ok', { n: 'ALL' })).toEqual(permanent('/bench/chart/ok?n=all'));
  });

  it('cuts a filter to the values bench knows, with a temporary redirect', async () => {
    expect(await metadata('ok', { n: 'all', engine: 'sqlite,duckdb' })).toEqual(
      temporary('/bench/chart/ok?n=all&engine=duckdb'),
    );
    expect(await metadata('ok', { n: 'all', format: 'vortex,parquet' })).toEqual(
      temporary('/bench/chart/ok?n=all&format=parquet%2Cvortex'),
    );
  });

  it('drops the filters when the universe cannot be read', async () => {
    cachedFilterUniverse.mockRejectedValue(new Error('database down'));
    expect(await metadata('ok', { n: 'all', engine: 'duckdb' })).toEqual(
      temporary('/bench/chart/ok?n=all'),
    );
  });

  it('treats a repeated parameter as absent, as the page does', async () => {
    expect(await metadata('ok', { n: ['all', '100'] })).toEqual(served);
    expect(cachedDefaultChartPayload).toHaveBeenCalledWith('ok');
  });

  it('leaves a malformed slug to the 404, without a redirect', async () => {
    expect(await metadata('bad', { n: 'all' })).toEqual(served);
    expect(chartPayload).not.toHaveBeenCalled();
    expect(cachedDefaultChartPayload).not.toHaveBeenCalled();
  });
});
