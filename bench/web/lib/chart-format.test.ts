// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assignStableColors,
  canonicalHistory,
  chartHasRecentData,
  clampRangeWindow,
  collectAllValues,
  colorFor,
  commitDateLabel,
  decimateSeries,
  displayFormat,
  displaySeriesLabel,
  escapeHtml,
  FETCH_TIMEOUT_MS,
  firstLine,
  formatDisplayValue,
  HOVER_DWELL_MS,
  HOVER_PREFETCH_PRIORITY,
  IDENTITY_UNIT,
  INTERACTION_FULL_PRIORITY,
  LAZY_HYDRATION_ROOT_MARGIN,
  labelForCommit,
  lttbIndices,
  magnitudeReference,
  MAX_VISIBLE_POINTS,
  normalizeChartPayload,
  PALETTE,
  parseFilterCsv,
  parsePrNumber,
  pickDisplayUnit,
  predecessorValue,
  rangeTouchesUnloadedHistory,
  seedActiveFormats,
  seedActiveFromAllowlist,
  seriesOrder,
  seriesPassesFilter,
  seriesPassesGroupFilter,
  seriesStyle,
  shortDate,
  shortSha,
  singleSearchParam,
  throttle,
  truncate,
  visibleRange,
} from './chart-format';
import type { ChartResponse, CommitPoint } from './queries';

function commit(sha: string): CommitPoint {
  return {
    sha,
    timestamp: '2026-06-01T00:00:00Z',
    message: `subject for ${sha}`,
    url: `https://example.invalid/${sha}`,
  };
}

function payloadOf(
  commits: CommitPoint[],
  series: Record<string, (number | null)[]>,
  history?: ChartResponse['history'],
): ChartResponse {
  return {
    display_name: 'test chart',
    unit_kind: 'time_ns',
    history: history ?? {
      total_commits: commits.length,
      start_index: 0,
      loaded_commits: commits.length,
      complete: true,
    },
    commits,
    series,
  };
}

describe('small formatting helpers', () => {
  it('shortens SHAs and dates and stringifies non-strings defensively', () => {
    expect(shortSha('abcdef0123456789')).toBe('abcdef0');
    expect(shortSha(42)).toBe('42');
    expect(shortDate('2026-06-09T18:00:00Z')).toBe('2026-06-09');
    expect(shortDate(null)).toBe('');
  });

  it('truncates with an ellipsis only past the cap', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hello!', 5)).toBe('hell…');
    expect(truncate(undefined, 5)).toBe('');
  });

  it('takes the first line of a multi-line message', () => {
    expect(firstLine('one\ntwo')).toBe('one');
    expect(firstLine('single')).toBe('single');
    expect(firstLine(7)).toBe('');
  });

  it('parses squash-merge PR numbers and rejects everything else', () => {
    expect(parsePrNumber('fix: a thing (#1234)')).toBe('1234');
    expect(parsePrNumber('no pr here')).toBeNull();
    expect(parsePrNumber(undefined)).toBeNull();
  });

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('labels commits by short SHA and virtual slots as empty', () => {
    expect(labelForCommit(commit('abcdef0123'))).toBe('abcdef0');
    expect(labelForCommit(null)).toBe('');
  });

  it('cycles the palette', () => {
    expect(colorFor(0)).toBe(PALETTE[0]);
    expect(colorFor(PALETTE.length)).toBe(PALETTE[0]);
    expect(colorFor(3)).toBe(PALETTE[3]);
  });
});

describe('seriesStyle', () => {
  const tag = (engine: string, format: string) => ({ engine, format });

  it('makes the hero Vortex series the loudest: red/green, distinct per engine, thickest', () => {
    const dfv = seriesStyle(
      'datafusion:vortex-file-compressed',
      tag('datafusion', 'vortex-file-compressed'),
    );
    const dkv = seriesStyle(
      'duckdb:vortex-file-compressed',
      tag('duckdb', 'vortex-file-compressed'),
    );
    expect(dfv.color).toBe('#ef4444');
    expect(dkv.color).toBe('#22c55e');
    expect(dfv.color).not.toBe(dkv.color);
    const muted = seriesStyle('duckdb:lance', tag('duckdb', 'lance'));
    expect(dfv.width).toBeGreaterThan(muted.width);
  });

  it('puts Parquet a notch under Vortex (blue, thinner than the hero)', () => {
    const vortex = seriesStyle(
      'datafusion:vortex-file-compressed',
      tag('datafusion', 'vortex-file-compressed'),
    );
    const parquet = seriesStyle('datafusion:parquet', tag('datafusion', 'parquet'));
    expect(parquet.color).toBe('#38bdf8');
    expect(parquet.width).toBeLessThan(vortex.width);
  });

  it('distinguishes the two lance engines but keeps them thinner than Parquet', () => {
    const parquet = seriesStyle('datafusion:parquet', tag('datafusion', 'parquet'));
    const dfLance = seriesStyle('datafusion:lance', tag('datafusion', 'lance'));
    const dkLance = seriesStyle('duckdb:lance', tag('duckdb', 'lance'));
    expect(dfLance.width).toBeLessThan(parquet.width);
    expect(dfLance.color).not.toBe(dkLance.color);
  });

  it('gives vortex-compact its own purple, never the vortex red/green', () => {
    const compact = seriesStyle('datafusion:vortex-compact', tag('datafusion', 'vortex-compact'));
    expect(compact.color).toBe('#a855f7');
    expect(compact.color).not.toBe('#ef4444');
    expect(compact.color).not.toBe('#22c55e');
  });

  it('derives engine/format from the label when meta is absent', () => {
    expect(seriesStyle('datafusion:vortex-file-compressed', undefined).color).toBe('#ef4444');
  });

  it('colors the engine-less compression-time series by its format', () => {
    // Compression-time series carry a format but no engine; they pick up the
    // format's signature color (here Vortex red) rather than the gray fallback.
    const comp = seriesStyle('vortex-file-compressed:encode', { format: 'vortex-file-compressed' });
    expect(comp.color).toBe('#ef4444');
  });

  it('falls back to a muted color + width for an unknown series', () => {
    const unknown = seriesStyle('datafusion:mystery', tag('datafusion', 'mystery'));
    expect(unknown.color).toBe('#94a3b8');
    const hero = seriesStyle(
      'datafusion:vortex-file-compressed',
      tag('datafusion', 'vortex-file-compressed'),
    );
    expect(unknown.width).toBeLessThan(hero.width);
  });
});

describe('seriesOrder', () => {
  const tag = (engine: string, format: string) => ({ engine, format });
  const ord = (engine: string, format: string) =>
    seriesOrder(`${engine}:${format}`, tag(engine, format));

  it('layers formats front-to-back: vortex, parquet, vortex-compact, duckdb, lance, arrow', () => {
    const ranks = [
      ord('datafusion', 'vortex-file-compressed'),
      ord('datafusion', 'parquet'),
      ord('datafusion', 'vortex-compact'),
      ord('duckdb', 'duckdb'),
      ord('datafusion', 'lance'),
      ord('datafusion', 'arrow'),
    ];
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('draws datafusion ahead of duckdb within a format', () => {
    expect(ord('datafusion', 'vortex-file-compressed')).toBeLessThan(
      ord('duckdb', 'vortex-file-compressed'),
    );
  });

  it('keeps the whole Vortex pair in front of the whole Parquet pair', () => {
    expect(ord('duckdb', 'vortex-file-compressed')).toBeLessThan(ord('datafusion', 'parquet'));
  });
});

describe('displayFormat / displaySeriesLabel', () => {
  it('renames only vortex-file-compressed to vortex', () => {
    expect(displayFormat('vortex-file-compressed')).toBe('vortex');
    expect(displayFormat('vortex-compact')).toBe('vortex-compact');
    expect(displayFormat('parquet')).toBe('parquet');
  });

  it('rewrites the vortex token in any colon-delimited label', () => {
    expect(displaySeriesLabel('datafusion:vortex-file-compressed')).toBe('datafusion:vortex');
    expect(displaySeriesLabel('duckdb:vortex-file-compressed')).toBe('duckdb:vortex');
    // Compression-time labels are format:op, so the token leads.
    expect(displaySeriesLabel('vortex-file-compressed:encode')).toBe('vortex:encode');
    expect(displaySeriesLabel('vortex-file-compressed')).toBe('vortex');
    // Untouched labels pass through.
    expect(displaySeriesLabel('datafusion:parquet')).toBe('datafusion:parquet');
  });
});

describe('commitDateLabel', () => {
  it('formats a commit timestamp as MMM D, YYYY', () => {
    expect(commitDateLabel(commit('abc'))).toBe('Jun 1, 2026');
  });

  it('derives the date from the ISO prefix so it is timezone-stable', () => {
    expect(
      commitDateLabel({ sha: 'x', timestamp: '2026-01-09T23:30:00Z', message: '', url: '' }),
    ).toBe('Jan 9, 2026');
  });

  it('returns empty for virtual slots and malformed timestamps', () => {
    expect(commitDateLabel(null)).toBe('');
    expect(commitDateLabel({ sha: 'x', timestamp: '', message: '', url: '' })).toBe('');
  });
});

describe('magnitudeReference', () => {
  it('takes the median of finite nonzero magnitudes', () => {
    expect(magnitudeReference([1, 3, 2])).toBe(2);
    // Even count averages the middle pair.
    expect(magnitudeReference([1, 2, 3, 4])).toBe(2.5);
    // Magnitude, not signed value.
    expect(magnitudeReference([-10])).toBe(10);
  });

  it('skips zeros, nulls, and non-finite values', () => {
    expect(magnitudeReference([0, null, undefined, NaN, Infinity, 5])).toBe(5);
    expect(magnitudeReference([0, 0])).toBeNull();
    expect(magnitudeReference([])).toBeNull();
  });
});

describe('pickDisplayUnit', () => {
  it('steps time_ns by the median magnitude', () => {
    expect(pickDisplayUnit('time_ns', [500])).toMatchObject({
      multiplier: 1,
      suffix: 'ns',
      decimals: 0,
    });
    expect(pickDisplayUnit('time_ns', [5e3])).toMatchObject({ multiplier: 1e-3, suffix: 'µs' });
    expect(pickDisplayUnit('time_ns', [5e6])).toMatchObject({ multiplier: 1e-6, suffix: 'ms' });
    // ms is the ceiling: a slow (≥1s) benchmark stays in ms, never seconds.
    expect(pickDisplayUnit('time_ns', [5e9])).toMatchObject({
      multiplier: 1e-6,
      suffix: 'ms',
      axisLabel: 'Time (ms)',
    });
  });

  it('steps bytes by decimal multiples', () => {
    expect(pickDisplayUnit('bytes', [512])).toMatchObject({ suffix: 'B', decimals: 0 });
    expect(pickDisplayUnit('bytes', [2_000])).toMatchObject({ suffix: 'KB' });
    expect(pickDisplayUnit('bytes', [3_000_000])).toMatchObject({ suffix: 'MB' });
    expect(pickDisplayUnit('bytes', [3_000_000_000])).toMatchObject({
      suffix: 'GB',
      axisLabel: 'Size (GB)',
    });
    expect(pickDisplayUnit('bytes', [3_000_000_000_000])).toMatchObject({ suffix: 'TB' });
  });

  it('leaves dimensionless and throughput kinds unscaled', () => {
    expect(pickDisplayUnit('ratio', [1.5])).toMatchObject({
      multiplier: 1,
      suffix: '',
      axisLabel: '',
      decimals: 2,
    });
    expect(pickDisplayUnit('count', [12])).toMatchObject({ decimals: 0 });
    expect(pickDisplayUnit('throughput_mb_s', [100])).toMatchObject({ suffix: 'MB/s' });
  });

  it('falls back to identity for unknown kinds and empty values', () => {
    expect(pickDisplayUnit('future_unit', [1])).toEqual(IDENTITY_UNIT);
    // No usable values: time picks the smallest unit (ns).
    expect(pickDisplayUnit('time_ns', [])).toMatchObject({ suffix: 'ns' });
  });
});

describe('formatDisplayValue', () => {
  it('applies the locked multiplier, decimals, and suffix', () => {
    const unit = pickDisplayUnit('time_ns', [12e9]);
    expect(formatDisplayValue(12e9, unit)).toBe('12000.00 ms');
  });

  it('collapses missing values to an em dash', () => {
    expect(formatDisplayValue(null, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(undefined, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(NaN, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(Infinity, IDENTITY_UNIT)).toBe('—');
  });
});

describe('collectAllValues', () => {
  it('concatenates non-null finite values across series', () => {
    const payload = payloadOf([commit('a'), commit('b')], {
      s1: [1, null],
      s2: [3, NaN as unknown as number],
    });
    expect(collectAllValues(payload).sort()).toEqual([1, 3]);
    expect(collectAllValues(null)).toEqual([]);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately, then preserves the trailing call', () => {
    const calls: number[] = [];
    const fn = throttle((v: number) => calls.push(v), 100);
    fn(1);
    fn(2);
    fn(3);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(100);
    // The trailing timer fires once with the LAST pending arguments.
    expect(calls).toEqual([1, 3]);
  });
});

describe('lttbIndices', () => {
  it('returns every index when at or under the threshold', () => {
    expect(lttbIndices([0, 1, 2], [5, 6, 7], 3)).toEqual([0, 1, 2]);
    expect(lttbIndices([0, 1], [5, 6], 5)).toEqual([0, 1]);
  });

  it('returns every index for degenerate thresholds', () => {
    expect(lttbIndices([0, 1, 2, 3], [1, 2, 3, 4], 2)).toEqual([0, 1, 2, 3]);
  });

  it('keeps both endpoints and exactly threshold points, preferring peaks', () => {
    const n = 100;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = xs.map((x) => (x === 50 ? 1000 : Math.sin(x / 5)));
    const kept = lttbIndices(xs, ys, 10);
    expect(kept).toHaveLength(10);
    expect(kept[0]).toBe(0);
    expect(kept[9]).toBe(n - 1);
    // The big spike at index 50 forms the largest triangle in its bucket.
    expect(kept).toContain(50);
    // Indices are strictly increasing.
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i]).toBeGreaterThan(kept[i - 1]);
    }
  });
});

describe('assignStableColors', () => {
  it('colors a fresh series set by sorted first-seen order', () => {
    const colors = assignStableColors(new Map(), ['b', 'a', 'c']);
    expect(colors.get('a')).toBe(colorFor(0));
    expect(colors.get('b')).toBe(colorFor(1));
    expect(colors.get('c')).toBe(colorFor(2));
  });

  it('keeps an existing series on its color when ?n=all surfaces an older series', () => {
    // The latest-100 payload only has the always-running series.
    const windowed = assignStableColors(new Map(), ['duckdb:parquet']);
    expect(windowed.get('duckdb:parquet')).toBe(colorFor(0));
    // Loading all data surfaces an older series that SORTS FIRST. Under the old
    // index-within-payload coloring `duckdb:parquet` would shift to colorFor(1)
    // and `aengine:aformat` (which has no recent data) would steal colorFor(0),
    // making the recent points look like they vanished. The existing series must
    // instead keep its color and the new one take the next slot.
    const all = assignStableColors(windowed, ['aengine:aformat', 'duckdb:parquet']);
    expect(all.get('duckdb:parquet')).toBe(colorFor(0));
    expect(all.get('aengine:aformat')).toBe(colorFor(1));
    expect(all.get('aengine:aformat')).not.toBe(all.get('duckdb:parquet'));
  });

  it('is idempotent for an unchanged series set', () => {
    const first = assignStableColors(new Map(), ['x', 'y']);
    const second = assignStableColors(first, ['x', 'y']);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });
});

describe('decimateSeries', () => {
  it('keeps every commit with data and reports no downsampling under the cap', () => {
    const a = [1, 2, null, 4, 5];
    const b = [null, null, 3, null, null];
    const { kept, downsampled } = decimateSeries([a, b], 0, 4, 500);
    expect(downsampled).toBe(false);
    expect([...kept].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves a non-dominant series’ points when downsampling (regression)', () => {
    const N = 3000;
    // Series A: large values on EVERY commit, so it drives the max-across-series
    // union everywhere. Series B: small values on only a few recent commits.
    const a = Array.from({ length: N }, (_, i) => 1_000_000 + i);
    const b: (number | null)[] = new Array<number | null>(N).fill(null);
    const bPoints = [2990, 2993, 2996, 2999];
    for (const i of bPoints) {
      b[i] = 1_000;
    }
    const { kept, downsampled } = decimateSeries([a, b], 0, N - 1, 500);
    expect(downsampled).toBe(true);
    // The old shared-union LTTB kept only B's pinned last point (2999); every
    // one of B's points must now survive.
    for (const i of bPoints) {
      expect(kept.has(i)).toBe(true);
    }
  });

  it('keeps the total distinct x-positions within the cap', () => {
    const N = 5000;
    const a = Array.from({ length: N }, (_, i) => Math.sin(i / 7));
    const b = Array.from({ length: N }, (_, i) => Math.cos(i / 11) * 1_000);
    const { kept } = decimateSeries([a, b], 0, N - 1, 500);
    expect(kept.size).toBeLessThanOrEqual(500);
  });

  it('ignores series with no data in the visible window', () => {
    const a = [1, 2, 3];
    const empty = [null, null, null];
    const { kept, downsampled } = decimateSeries([a, empty], 0, 2, 500);
    expect(downsampled).toBe(false);
    expect([...kept].sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });
});

describe('canonicalHistory', () => {
  it('defaults to a complete history over the loaded commits', () => {
    const h = canonicalHistory({ commits: [commit('a'), commit('b')], history: undefined });
    expect(h).toEqual({ total_commits: 2, start_index: 0, loaded_commits: 2, complete: true });
  });

  it('clamps start_index into the valid placement window', () => {
    const h = canonicalHistory({
      commits: [commit('a')],
      history: { total_commits: 10, start_index: 99, loaded_commits: 1, complete: false },
    });
    expect(h.start_index).toBe(9);
    expect(h.total_commits).toBe(10);
  });

  it('derives complete from full coverage', () => {
    const h = canonicalHistory({
      commits: [commit('a'), commit('b')],
      history: { total_commits: 2, start_index: 0, loaded_commits: 2, complete: false },
    });
    expect(h.complete).toBe(true);
  });
});

describe('normalizeChartPayload', () => {
  it('passes complete payloads through the fast path unchanged', () => {
    const payload = payloadOf([commit('a'), commit('b')], { s: [1, 2] });
    const normalized = normalizeChartPayload(payload);
    expect(normalized.commits).toHaveLength(2);
    expect(normalized.series.s).toEqual([1, 2]);
    expect(normalized.history.complete).toBe(true);
  });

  it('pads a bounded window onto the full-history axis', () => {
    const payload = payloadOf(
      [commit('y'), commit('z')],
      { s: [7, 8] },
      {
        total_commits: 5,
        start_index: 3,
        loaded_commits: 2,
        complete: false,
      },
    );
    const normalized = normalizeChartPayload(payload);
    expect(normalized.commits).toHaveLength(5);
    expect(normalized.commits.slice(0, 3)).toEqual([null, null, null]);
    expect(normalized.commits[3]?.sha).toBe('y');
    expect(normalized.series.s).toEqual([null, null, null, 7, 8]);
  });

  it('is idempotent: normalizing twice equals normalizing once', () => {
    const payload = payloadOf(
      [commit('y')],
      { s: [7] },
      {
        total_commits: 3,
        start_index: 2,
        loaded_commits: 1,
        complete: false,
      },
    );
    const once = normalizeChartPayload(payload);
    const twice = normalizeChartPayload(once as unknown as ChartResponse);
    expect(twice.commits).toEqual(once.commits);
    expect(twice.series).toEqual(once.series);
    expect(twice.history).toEqual(once.history);
  });
});

describe('rangeTouchesUnloadedHistory', () => {
  const history = { total_commits: 10, start_index: 5, loaded_commits: 5, complete: false };

  it('fires when the range reaches before the loaded window', () => {
    expect(rangeTouchesUnloadedHistory({ history }, 2, 7)).toBe(true);
  });

  it('stays quiet inside the loaded window or when complete', () => {
    expect(rangeTouchesUnloadedHistory({ history }, 5, 9)).toBe(false);
    expect(rangeTouchesUnloadedHistory({ history: { ...history, complete: true } }, 0, 9)).toBe(
      false,
    );
    expect(rangeTouchesUnloadedHistory(null, 0, 9)).toBe(false);
  });
});

describe('visibleRange', () => {
  it('covers everything for "all" or an over-wide scope', () => {
    expect(visibleRange(10, 'all')).toEqual({ min: 0, max: 9 });
    expect(visibleRange(10, 50)).toEqual({ min: 0, max: 9 });
    expect(visibleRange(0, 5)).toEqual({ min: undefined, max: undefined });
  });

  it('anchors right with no current range', () => {
    expect(visibleRange(100, 10)).toEqual({ min: 90, max: 99 });
  });

  it('anchors right when flush with the newest commit (half-commit tolerance)', () => {
    expect(visibleRange(100, 10, { min: 50, max: 99.4 })).toEqual({ min: 90, max: 99 });
  });

  it('preserves the center when panned away from the right edge', () => {
    const r = visibleRange(100, 11, { min: 40, max: 60 });
    // Center 50 with width 11 keeps indices 45..55.
    expect(r).toEqual({ min: 45, max: 55 });
  });

  it('clamps a preserved center at the history edges', () => {
    expect(visibleRange(100, 21, { min: 0, max: 4 })).toEqual({ min: 0, max: 20 });
  });
});

describe('filter helpers', () => {
  const universe = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet'] };

  it('parses CSV allowlists with trimming and dedupe', () => {
    expect(parseFilterCsv('duckdb, datafusion,duckdb,,')).toEqual(['duckdb', 'datafusion']);
    expect(parseFilterCsv(null)).toBeNull();
    expect(parseFilterCsv(undefined)).toBeNull();
    expect(parseFilterCsv('')).toEqual([]);
  });

  it('seeds the active set from the allowlist or the whole universe', () => {
    expect(seedActiveFromAllowlist(null, universe.engines)).toEqual(['duckdb', 'datafusion']);
    // A non-empty allowlist is verbatim, even when stale against the universe.
    expect(seedActiveFromAllowlist(['gone'], universe.engines)).toEqual(['gone']);
  });

  it('seeds formats with lance hidden by default, but honors an explicit allowlist', () => {
    const formats = ['vortex', 'parquet', 'lance'];
    // No allowlist: lance is dropped from the default active set.
    expect(seedActiveFormats(null, formats)).toEqual(['vortex', 'parquet']);
    // An explicit allowlist is verbatim, so a `?format=` URL can pin lance on.
    expect(seedActiveFormats(['lance'], formats)).toEqual(['lance']);
    // A universe without lance is unaffected.
    expect(seedActiveFormats(null, ['vortex', 'parquet'])).toEqual(['vortex', 'parquet']);
  });

  it('hides a series only when its own dimension is filtered', () => {
    const active = { engines: ['duckdb'], formats: ['vortex', 'parquet'] };
    expect(seriesPassesFilter({ engine: 'duckdb', format: 'vortex' }, active, universe)).toBe(true);
    expect(seriesPassesFilter({ engine: 'datafusion', format: 'vortex' }, active, universe)).toBe(
      false,
    );
    // No engine tag: the engine filter does not apply.
    expect(seriesPassesFilter({ format: 'vortex' }, active, universe)).toBe(true);
    expect(seriesPassesFilter(undefined, active, universe)).toBe(true);
  });

  it('checks explicit membership after the filter universe initializes', () => {
    const active = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet'] };
    expect(seriesPassesFilter({ engine: 'duckdb' }, active, universe)).toBe(true);
    expect(seriesPassesFilter({ engine: 'new-engine' }, active, universe)).toBe(false);
    expect(seriesPassesFilter({ format: 'new-format' }, active, universe)).toBe(false);
    expect(
      seriesPassesFilter(
        { engine: 'duckdb' },
        { engines: [], formats: [] },
        { engines: [], formats: [] },
      ),
    ).toBe(true);
  });

  it('applies per-group overrides before the fallback visibility', () => {
    const filter = { hiddenSeries: ['a'], shownSeries: ['lance'] };
    expect(seriesPassesGroupFilter(filter, 'a')).toBe(false);
    expect(seriesPassesGroupFilter(filter, 'lance', false)).toBe(true);
    expect(seriesPassesGroupFilter(filter, 'b', false)).toBe(false);
    expect(seriesPassesGroupFilter(null, 'a')).toBe(true);
  });
});

describe('predecessorValue (BAN-pinned tooltip delta walk)', () => {
  it('walks to idx - 1, never idx + 1: commits[] is oldest-first', () => {
    // Distinct neighbour values make a flipped walk unmistakable.
    expect(predecessorValue([10, 20, 30], 1)).toBe(10);
    expect(predecessorValue([10, 20, 30], 2)).toBe(20);
  });

  it('continues back across null-valued slots for sparse series', () => {
    expect(predecessorValue([10, null, NaN, undefined, 50], 4)).toBe(10);
  });

  it('returns null when no earlier measurement exists', () => {
    expect(predecessorValue([10, 20], 0)).toBeNull();
    expect(predecessorValue([null, 20], 1)).toBeNull();
    expect(predecessorValue([], 0)).toBeNull();
  });
});

describe('singleSearchParam', () => {
  it('passes strings through and rejects absent or repeated params', () => {
    expect(singleSearchParam('all')).toBe('all');
    expect(singleSearchParam(undefined)).toBeNull();
    expect(singleSearchParam(['a', 'b'])).toBeNull();
  });
});

describe('MAX_VISIBLE_POINTS contract', () => {
  it('keeps exactly the cap when downsampling above it', () => {
    const n = MAX_VISIBLE_POINTS * 2;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 10));
    expect(lttbIndices(xs, ys, MAX_VISIBLE_POINTS)).toHaveLength(MAX_VISIBLE_POINTS);
  });
});

describe('clampRangeWindow', () => {
  it('pins the window to [0, 0] on a single-commit chart (no phantom slot)', () => {
    // Regression: the range-strip bare-track-click path requested a window with
    // the pre-fix `minRange = 1`, which forced `max` to 1 on a single-commit
    // chart (`maxIdx === 0`), one slot past the only label. The fix collapses
    // the minimum span to zero when there is only one commit. (Discriminating:
    // the pre-fix math returned `{ min: 0, max: 1 }` here.)
    expect(clampRangeWindow(0, 0, 0)).toEqual({ min: 0, max: 0 });
    expect(clampRangeWindow(0, -5, 5)).toEqual({ min: 0, max: 0 });
  });

  it('enforces a one-commit minimum span on multi-commit charts', () => {
    expect(clampRangeWindow(10, 3, 3)).toEqual({ min: 3, max: 4 });
    expect(clampRangeWindow(10, 10, 10)).toEqual({ min: 9, max: 10 });
  });

  it('clamps requested bounds into [0, maxIdx]', () => {
    expect(clampRangeWindow(10, 3, 7)).toEqual({ min: 3, max: 7 });
    expect(clampRangeWindow(10, -5, 100)).toEqual({ min: 0, max: 10 });
  });
});

describe('hover-dwell prefetch constants', () => {
  it('dwell is a deliberate one-second pause, not an accidental sweep', () => {
    expect(HOVER_DWELL_MS).toBe(1000);
  });

  it('hover-prefetch priority sits above background (0) and below direct interaction', () => {
    expect(HOVER_PREFETCH_PRIORITY).toBeGreaterThan(0);
    expect(HOVER_PREFETCH_PRIORITY).toBeLessThan(INTERACTION_FULL_PRIORITY);
  });
});

describe('lazy-hydration + fetch-resilience constants', () => {
  it('the per-fetch timeout is a generous bound over a cold function first-hit', () => {
    // Cold Vercel first-hit measured ~7.8s; 30s leaves headroom so a slow-but-live
    // request is not falsely aborted, while still bounding a true hang.
    expect(FETCH_TIMEOUT_MS).toBe(30000);
  });

  it('the IO root margin pre-hydrates charts slightly before they scroll in', () => {
    expect(LAZY_HYDRATION_ROOT_MARGIN).toMatch(/px/);
  });
});

describe('chartHasRecentData', () => {
  it('is false for the empty-window wire shape (no series at all)', () => {
    // A chart whose fact rows all predate the latest-100 window arrives as 100
    // seeded commits with `series: {}` (the accumulator never records a row).
    expect(chartHasRecentData({ series: {} })).toBe(false);
  });

  it('is false when every series value is null', () => {
    expect(chartHasRecentData({ series: { a: [null, null], b: [null] } })).toBe(false);
  });

  it('is true when any series carries one real value', () => {
    expect(chartHasRecentData({ series: { a: [null, null], b: [null, 7] } })).toBe(true);
  });

  it('ignores NaN values', () => {
    expect(chartHasRecentData({ series: { a: [Number.NaN, null] } })).toBe(false);
  });

  it('inspects only the trailing window of a full-history payload', () => {
    // 150 slots with data only in the first 40: the trailing-100 window is all
    // null, so the chart classifies empty — the same verdict its `?n=100`
    // payload would produce.
    const stale = new Array<number | null>(150).fill(null);
    for (let i = 0; i < 40; i++) {
      stale[i] = i + 1;
    }
    expect(chartHasRecentData({ series: { a: stale } })).toBe(false);
    // One value inside the trailing window flips the verdict.
    const alive = [...stale];
    alive[149] = 42;
    expect(chartHasRecentData({ series: { a: alive } })).toBe(true);
  });

  it('honors an explicit window size', () => {
    const values = [1, null, null];
    expect(chartHasRecentData({ series: { a: values } }, 2)).toBe(false);
    expect(chartHasRecentData({ series: { a: values } }, 3)).toBe(true);
  });
});
