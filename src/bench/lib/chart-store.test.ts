// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abortGroupBundle,
  applyGroupMacro,
  chartIsHiddenAsEmpty,
  clearGroupFilterRow,
  ensureGroupBundle,
  getCachedPayload,
  getGlobalFilterSnapshot,
  getGroupSnapshot,
  groupHiddenSeries,
  groupSeriesIsVisible,
  hydrationQueue,
  initGlobalFilter,
  initGroupFilter,
  noteChartRecentData,
  noteGroupSeries,
  resetGroup,
  resetPayloadCache,
  setGroupY,
  setShowEmptyCharts,
  subscribeGlobalFilter,
  subscribeGroup,
  toggleGlobalFilterValue,
  toggleGroupSeries,
} from './chart-store';

// The stores are module-scope singletons (one per tab, one per test file run);
// each describe block uses its own group slug so state does not leak between
// tests, and the global-filter tests re-init the store as a fresh page mount
// would.

const UNIVERSE = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] };

/** Every pairing of `UNIVERSE`'s engines and formats. */
const FOUR_SERIES = {
  'datafusion:parquet': { engine: 'datafusion', format: 'parquet' },
  'datafusion:vortex': { engine: 'datafusion', format: 'vortex' },
  'duckdb:parquet': { engine: 'duckdb', format: 'parquet' },
  'duckdb:vortex': { engine: 'duckdb', format: 'vortex' },
};

/** The group's known series that show, sorted. */
function visibleSeries(slug: string): string[] {
  const snapshot = getGroupSnapshot(slug);
  return Object.keys(snapshot.knownSeries)
    .filter((label) => groupSeriesIsVisible(snapshot, label))
    .sort();
}

describe('global filter store', () => {
  it('seeds every chip active with no URL allowlist', () => {
    initGlobalFilter(UNIVERSE, null, null);
    const snap = getGlobalFilterSnapshot();
    expect(snap.active.engines).toEqual(['datafusion', 'duckdb']);
    expect(snap.active.formats).toEqual(['parquet', 'vortex']);
  });

  it('hides lance by default but keeps it when a URL allowlist pins it', () => {
    const universe = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex', 'lance'] };
    // No `?format=` allowlist: lance is excluded by default (it is far slower, so
    // it buries the comparison); the rest of the format universe stays active.
    initGlobalFilter(universe, null, null);
    expect(getGlobalFilterSnapshot().active.formats).toEqual(['parquet', 'vortex']);
    // An explicit allowlist is taken verbatim, so a URL can pin lance back on.
    initGlobalFilter(universe, null, ['lance']);
    expect(getGlobalFilterSnapshot().active.formats).toEqual(['lance']);
  });

  it('seeds verbatim from a URL allowlist and toggles chips independently', () => {
    initGlobalFilter(UNIVERSE, ['duckdb'], null);
    expect(getGlobalFilterSnapshot().active.engines).toEqual(['duckdb']);

    toggleGlobalFilterValue('engine', 'datafusion');
    expect(getGlobalFilterSnapshot().active.engines).toEqual(['duckdb', 'datafusion']);

    toggleGlobalFilterValue('engine', 'duckdb');
    expect(getGlobalFilterSnapshot().active.engines).toEqual(['datafusion']);
  });

  it('resets a dimension to all-active via the "*" chip', () => {
    initGlobalFilter(UNIVERSE, ['duckdb'], ['vortex']);
    toggleGlobalFilterValue('format', '*');
    expect(getGlobalFilterSnapshot().active.formats).toEqual(['parquet', 'vortex']);
    // The engine dimension is untouched by a format reset.
    expect(getGlobalFilterSnapshot().active.engines).toEqual(['duckdb']);
  });

  it('notifies subscribers with a fresh snapshot reference per mutation', () => {
    initGlobalFilter(UNIVERSE, null, null);
    const before = getGlobalFilterSnapshot();
    let notified = 0;
    const unsubscribe = subscribeGlobalFilter(() => {
      notified += 1;
    });
    toggleGlobalFilterValue('engine', 'duckdb');
    expect(notified).toBe(1);
    expect(getGlobalFilterSnapshot()).not.toBe(before);
    unsubscribe();
    toggleGlobalFilterValue('engine', 'duckdb');
    expect(notified).toBe(1);
  });
});

describe('per-group store', () => {
  beforeEach(() => {
    initGlobalFilter(UNIVERSE, null, null);
  });

  it('restores a URL filter without discarding hydrated series metadata', () => {
    const slug = 'group-url-filter';
    noteGroupSeries(slug, { a: { engine: 'duckdb' } });
    initGroupFilter(slug, ['b', 'a', 'b'], ['lance', 'lance']);
    const snap = getGroupSnapshot(slug);
    expect(snap.hiddenSeries).toEqual(['b', 'a']);
    expect(snap.shownSeries).toEqual(['lance']);
    expect(snap.knownSeries).toEqual({ a: { engine: 'duckdb' } });
  });

  it('accumulates known series idempotently and notifies', () => {
    const slug = 'group-known-series';
    let notified = 0;
    subscribeGroup(slug, () => {
      notified += 1;
    });
    noteGroupSeries(slug, { 'duckdb:parquet': { engine: 'duckdb', format: 'parquet' } });
    expect(notified).toBe(1);
    // Re-noting the same labels is a no-op (no notification, same snapshot).
    const snap = getGroupSnapshot(slug);
    noteGroupSeries(slug, { 'duckdb:parquet': { engine: 'duckdb', format: 'parquet' } });
    expect(notified).toBe(1);
    expect(getGroupSnapshot(slug)).toBe(snap);
  });

  it('toggles single series in and out of the hidden set', () => {
    const slug = 'group-series-toggle';
    toggleGroupSeries(slug, 'a');
    expect(getGroupSnapshot(slug).hiddenSeries).toEqual(['a']);
    toggleGroupSeries(slug, 'a');
    expect(getGroupSnapshot(slug).hiddenSeries).toEqual([]);
    expect(getGroupSnapshot(slug).shownSeries).toEqual([]);
  });

  it('restores a globally hidden series with a local visible override', () => {
    const slug = 'group-global-fallback';
    const universe = { ...UNIVERSE, formats: [...UNIVERSE.formats, 'lance'] };
    initGlobalFilter(universe, null, null);
    noteGroupSeries(slug, { lance: { format: 'lance' } });

    expect(groupSeriesIsVisible(getGroupSnapshot(slug), 'lance')).toBe(false);
    toggleGroupSeries(slug, 'lance');
    expect(getGroupSnapshot(slug).shownSeries).toEqual(['lance']);
    expect(groupSeriesIsVisible(getGroupSnapshot(slug), 'lance')).toBe(true);

    toggleGroupSeries(slug, 'lance');
    expect(getGroupSnapshot(slug).shownSeries).toEqual([]);
    expect(getGroupSnapshot(slug).hiddenSeries).toEqual(['lance']);
    expect(groupSeriesIsVisible(getGroupSnapshot(slug), 'lance')).toBe(false);
  });

  it('bulk-toggles matching series via engine/format macros', () => {
    const slug = 'group-macros';
    noteGroupSeries(slug, {
      'duckdb:parquet': { engine: 'duckdb', format: 'parquet' },
      'duckdb:vortex': { engine: 'duckdb', format: 'vortex' },
      'datafusion:vortex': { engine: 'datafusion', format: 'vortex' },
    });
    const visible = () => visibleSeries(slug);
    // A shown engine: the macro hides every series it matches.
    applyGroupMacro(slug, 'engine', 'duckdb');
    expect(getGroupSnapshot(slug).hiddenEngines).toEqual(['duckdb']);
    expect(visible()).toEqual(['datafusion:vortex']);
    // A hidden engine: the macro shows them again.
    applyGroupMacro(slug, 'engine', 'duckdb');
    expect(getGroupSnapshot(slug).hiddenEngines).toEqual([]);
    expect(visible()).toEqual(['datafusion:vortex', 'duckdb:parquet', 'duckdb:vortex']);
    // A macro with no matching series is inert.
    const snap = getGroupSnapshot(slug);
    applyGroupMacro(slug, 'engine', 'unknown-engine');
    expect(getGroupSnapshot(slug)).toBe(snap);
  });

  it('lets a macro replace the series picks it covers', () => {
    const slug = 'group-macro-over-series';
    noteGroupSeries(slug, FOUR_SERIES);
    toggleGroupSeries(slug, 'duckdb:vortex');
    applyGroupMacro(slug, 'engine', 'duckdb');
    applyGroupMacro(slug, 'engine', 'duckdb');
    expect(getGroupSnapshot(slug).hiddenSeries).toEqual([]);
    expect(visibleSeries(slug)).toEqual(Object.keys(FOUR_SERIES).sort());
  });

  it('uses a macro to restore every match hidden by the global default', () => {
    const slug = 'group-global-macro';
    const universe = { ...UNIVERSE, formats: [...UNIVERSE.formats, 'lance'] };
    initGlobalFilter(universe, null, null);
    noteGroupSeries(slug, {
      'datafusion:lance': { engine: 'datafusion', format: 'lance' },
      'duckdb:lance': { engine: 'duckdb', format: 'lance' },
    });

    expect(visibleSeries(slug)).toEqual([]);
    applyGroupMacro(slug, 'format', 'lance');
    expect(getGroupSnapshot(slug).shownSeries.sort()).toEqual(['datafusion:lance', 'duckdb:lance']);
    expect(visibleSeries(slug)).toEqual(['datafusion:lance', 'duckdb:lance']);
    applyGroupMacro(slug, 'format', 'lance');
    expect(getGroupSnapshot(slug).shownSeries).toEqual([]);
    expect(visibleSeries(slug)).toEqual([]);
  });

  // The Engine, Format and Series rows of a group's filter are independent:
  // each row's "all" chip turns its own row back on and leaves the others.
  describe("each row's all chip", () => {
    /** A group with datafusion, Parquet, and duckdb:vortex turned off, one per row. */
    function filtered(slug: string): void {
      noteGroupSeries(slug, FOUR_SERIES);
      applyGroupMacro(slug, 'engine', 'datafusion');
      applyGroupMacro(slug, 'format', 'parquet');
      toggleGroupSeries(slug, 'duckdb:vortex');
      expect(visibleSeries(slug)).toEqual([]);
    }

    it('in the Engine row shows the engines and keeps the format and series choices', () => {
      const slug = 'group-all-engine';
      filtered(slug);
      clearGroupFilterRow(slug, 'engine');
      expect(visibleSeries(slug)).toEqual(['datafusion:vortex']);
      expect(getGroupSnapshot(slug).hiddenFormats).toEqual(['parquet']);
      expect(getGroupSnapshot(slug).hiddenSeries).toEqual(['duckdb:vortex']);
    });

    it('in the Format row shows the formats and keeps the engine and series choices', () => {
      const slug = 'group-all-format';
      filtered(slug);
      clearGroupFilterRow(slug, 'format');
      expect(visibleSeries(slug)).toEqual(['duckdb:parquet']);
      expect(getGroupSnapshot(slug).hiddenEngines).toEqual(['datafusion']);
    });

    it('in the Series row clears the series choices and keeps the engine and format ones', () => {
      const slug = 'group-all-series';
      filtered(slug);
      clearGroupFilterRow(slug, 'series');
      expect(visibleSeries(slug)).toEqual(['duckdb:vortex']);
      expect(getGroupSnapshot(slug).hiddenEngines).toEqual(['datafusion']);
      expect(getGroupSnapshot(slug).hiddenFormats).toEqual(['parquet']);
    });

    it('leaves Y alone', () => {
      const slug = 'group-all-y';
      toggleGroupSeries(slug, 'a');
      setGroupY(slug, 'log');
      clearGroupFilterRow(slug, 'series');
      expect(getGroupSnapshot(slug).hiddenSeries).toEqual([]);
      expect(getGroupSnapshot(slug).groupY).toBe('log');
    });
  });

  // A permalink names series, so it lists every series a row hides.
  it('lists the series that any row hides', () => {
    const slug = 'group-hidden-list';
    noteGroupSeries(slug, FOUR_SERIES);
    applyGroupMacro(slug, 'engine', 'datafusion');
    toggleGroupSeries(slug, 'duckdb:vortex');
    expect(groupHiddenSeries(getGroupSnapshot(slug))).toEqual([
      'datafusion:parquet',
      'datafusion:vortex',
      'duckdb:vortex',
    ]);
  });

  it('resets the filter and Y override but keeps known series', () => {
    const slug = 'group-reset';
    noteGroupSeries(slug, { s1: { engine: 'duckdb', format: 'vortex' } });
    toggleGroupSeries(slug, 's1');
    applyGroupMacro(slug, 'engine', 'duckdb');
    applyGroupMacro(slug, 'format', 'vortex');
    setGroupY(slug, 'log');
    resetGroup(slug);
    const snap = getGroupSnapshot(slug);
    expect(snap.hiddenSeries).toEqual([]);
    expect(snap.shownSeries).toEqual([]);
    expect(snap.hiddenEngines).toEqual([]);
    expect(snap.hiddenFormats).toEqual([]);
    expect(snap.groupY).toBeNull();
    expect(Object.keys(snap.knownSeries)).toEqual(['s1']);
  });

  it('records empty-window charts idempotently and notifies once per change', () => {
    const slug = 'group-empty-note';
    let notified = 0;
    subscribeGroup(slug, () => {
      notified += 1;
    });
    noteChartRecentData(slug, 'c-empty', false);
    expect(getGroupSnapshot(slug).emptyCharts).toEqual(['c-empty']);
    expect(notified).toBe(1);
    // Re-noting the same verdict is a no-op (no notification, same snapshot).
    const snap = getGroupSnapshot(slug);
    noteChartRecentData(slug, 'c-empty', false);
    expect(getGroupSnapshot(slug)).toBe(snap);
    expect(notified).toBe(1);
    // A chart with data never joins the set; a re-classified chart leaves it.
    noteChartRecentData(slug, 'c-live', true);
    expect(getGroupSnapshot(slug).emptyCharts).toEqual(['c-empty']);
    noteChartRecentData(slug, 'c-empty', true);
    expect(getGroupSnapshot(slug).emptyCharts).toEqual([]);
  });

  it('hides empty charts by default; the toggle reveals; Reset re-hides', () => {
    const slug = 'group-empty-toggle';
    noteChartRecentData(slug, 'c-empty', false);
    expect(chartIsHiddenAsEmpty(getGroupSnapshot(slug), 'c-empty')).toBe(true);
    expect(chartIsHiddenAsEmpty(getGroupSnapshot(slug), 'c-live')).toBe(false);

    setShowEmptyCharts(slug, true);
    expect(getGroupSnapshot(slug).showEmptyCharts).toBe(true);
    expect(chartIsHiddenAsEmpty(getGroupSnapshot(slug), 'c-empty')).toBe(false);
    // Setting the current value is a no-op (same snapshot reference).
    const snap = getGroupSnapshot(slug);
    setShowEmptyCharts(slug, true);
    expect(getGroupSnapshot(slug)).toBe(snap);

    // Reset restores the default-hidden state but keeps the classification.
    resetGroup(slug);
    expect(getGroupSnapshot(slug).showEmptyCharts).toBe(false);
    expect(getGroupSnapshot(slug).emptyCharts).toEqual(['c-empty']);
    expect(chartIsHiddenAsEmpty(getGroupSnapshot(slug), 'c-empty')).toBe(true);
  });
});

describe('bounded priority queue', () => {
  it('runs at most the concurrency cap at once and drains by priority', async () => {
    // The hydration queue caps at 4 concurrent tasks. Fill the running slots
    // with 4 gate-blocked tasks, then enqueue three more with distinct
    // priorities and assert they run in priority order once the gates open.
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    let running = 0;
    let maxRunning = 0;
    const blocker = async (): Promise<void> => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await gate;
      running -= 1;
    };
    const blockers = Array.from({ length: 4 }, () => hydrationQueue.schedule(blocker, 0));

    const order: string[] = [];
    const queued = [
      hydrationQueue.schedule(async () => {
        order.push('low');
      }, 1),
      hydrationQueue.schedule(async () => {
        order.push('high');
      }, 100),
      hydrationQueue.schedule(async () => {
        order.push('mid');
      }, 50),
    ];
    // Nothing beyond the cap starts while the gates are closed.
    await Promise.resolve();
    expect(maxRunning).toBe(4);
    expect(order).toEqual([]);

    release();
    await Promise.all([...blockers.map((e) => e.promise), ...queued.map((e) => e.promise)]);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('rejects the entry promise when the task throws and keeps draining', async () => {
    const failing = hydrationQueue.schedule(async () => {
      throw new Error('boom');
    }, 0);
    await expect(failing.promise).rejects.toThrow('boom');
    const ok = hydrationQueue.schedule(async () => 'fine', 0);
    await expect(ok.promise).resolves.toBe('fine');
  });
});

describe('ensureGroupBundle empty-window classification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetPayloadCache();
  });

  it('classifies every bundle chart, so hidden-by-default works without hydration', async () => {
    const commits = Array.from({ length: 3 }, (_, i) => ({
      sha: `sha${i}`,
      timestamp: `2026-01-01 00:00:0${i}+00`,
      message: `c${i}`,
      url: `https://example.invalid/sha${i}`,
    }));
    const history = { total_commits: 3, start_index: 0, loaded_commits: 3, complete: true };
    const bundle = {
      name: 'g',
      charts: [
        // The empty-window wire shape: seeded commits, no recorded series.
        {
          name: 'stale',
          slug: 'chart-stale',
          display_name: 'stale',
          unit_kind: 'bytes',
          history,
          commits,
          series: {},
        },
        {
          name: 'live',
          slug: 'chart-live',
          display_name: 'live',
          unit_kind: 'bytes',
          history,
          commits,
          series: { parquet: [1, 2, 3] },
        },
      ],
    };
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(bundle),
      } as unknown as Response),
    );
    const groupSlug = 'bundle-empty-classify';
    await ensureGroupBundle(groupSlug, 0, '');
    const snap = getGroupSnapshot(groupSlug);
    expect(snap.emptyCharts).toEqual(['chart-stale']);
    expect(chartIsHiddenAsEmpty(snap, 'chart-stale')).toBe(true);
    expect(chartIsHiddenAsEmpty(snap, 'chart-live')).toBe(false);
  });

  it('ignores a late closed bundle without replacing the reopened request or its cached data', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveNew!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveNew = resolve;
          }),
      );
    vi.stubGlobal('fetch', fetcher);
    const old = ensureGroupBundle('reopened', 0, '');
    await Promise.resolve();
    abortGroupBundle('reopened');
    const current = ensureGroupBundle('reopened', 0, '');
    await Promise.resolve();

    const response = (value: number) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ charts: [{ slug: 'cached', series: { vortex: [value] } }] }),
      }) as Response;
    resolveOld(response(1));
    expect(await old).toEqual({ status: 'aborted' });
    expect(getCachedPayload('cached')).toBeUndefined();
    expect(ensureGroupBundle('reopened', 0, '')).toBe(current);
    resolveNew(response(2));
    expect(await current).toEqual({ status: 'success' });
    expect(getCachedPayload('cached')?.series).toEqual({ vortex: [2] });
    abortGroupBundle('reopened');
    expect(await ensureGroupBundle('reopened', 0, '')).toEqual({ status: 'success' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
