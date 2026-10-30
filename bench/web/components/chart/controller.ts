// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Chart as ChartJs, ChartDataset } from 'chart.js';

import {
  CHART_FETCH_N,
  chartHasRecentData,
  collectAllValues,
  commitDateLabel,
  decimateSeries,
  DEFAULT_VISIBLE,
  FETCH_N,
  FETCH_TIMEOUT_MS,
  HOVER_DWELL_MS,
  HOVER_PREFETCH_PRIORITY,
  IDENTITY_UNIT,
  INTERACTION_FULL_PRIORITY,
  latestValuesSentence,
  MAX_VISIBLE_POINTS,
  normalizeChartPayload,
  PAN_THROTTLE_MS,
  pickDisplayUnit,
  rangeTouchesUnloadedHistory,
  seriesPassesFilter,
  seriesPassesGroupFilter,
  throttle,
  visibleRange,
} from '@/lib/chart-format';
import { loadChartJs } from '@/lib/chart-js';
import {
  chartIsHiddenAsEmpty,
  emptyGroupSnapshot,
  ensureGroupBundle,
  fullHistoryQueue,
  getCachedPayload,
  getGlobalFilterSnapshot,
  getGroupSnapshot,
  hydrationQueue,
  noteChartRecentData,
  noteGroupSeries,
  retryGroupBundle,
  subscribeGroupBundleRetry,
} from '@/lib/chart-store';
import type { ChartResponse } from '@/lib/queries';
import { effectiveTheme, onThemeChange } from '@/lib/theme';

import {
  renderDownsampleBadge,
  renderWindowChip,
  setSliderBounds,
  setSliderFromRange,
} from './card-dom';
import { lineChartConfig } from './config';
import { benchDatasets, buildDatasets, recolorDatasets } from './datasets';
import { attachWheelPan, bindRangeStrip } from './pan-zoom';
import type { CardCallbacks, CardElements, CardState } from './types';

/**
 * The imperative per-island engine. Created once per MOUNT (not per component
 * instance): React StrictMode runs every dev effect as mount, cleanup, remount,
 * and `destroy()` is one-way, so the mount effect constructs a fresh controller
 * each time it runs and tears the previous one down in its cleanup. Every
 * method is a direct port of the corresponding `chart-init.js` function with
 * the canvas field-stash replaced by [`CardState`]; the DOM listeners the
 * controller attaches (wheel pan, range-strip pointers) are registered with its
 * own abort signal so a teardown removes them from the still-mounted nodes
 * before the next controller re-binds.
 */
export class ChartController {
  private readonly state: CardState;
  /** Aborted on [`destroy`]; every controller-attached DOM listener uses it. */
  private readonly aborter = new AbortController();
  /** Failed Chart.js dynamic-import attempts; bounds the error-dismiss retry. */
  private loadAttempts = 0;
  private bundleFailed = false;
  private readonly unsubscribeBundleRetry?: () => void;

  constructor(
    private readonly slug: string,
    private readonly groupSlug: string | undefined,
    private readonly els: () => CardElements,
    private readonly cb: CardCallbacks,
  ) {
    this.state = {
      chart: null,
      constructing: false,
      payload: null,
      ui: { y: 'linear', scope: DEFAULT_VISIBLE },
      overrides: {},
      displayUnit: IDENTITY_UNIT,
      fullLoaded: false,
      initialFetchEntry: null,
      fullFetchEntry: null,
      fullFetchPending: null,
      initialFetchController: null,
      fullFetchController: null,
      everWindowed: false,
      chipError: false,
      hovering: false,
      hoverDwellTimer: null,
      fullUnavailable: false,
      yUserSet: false,
      stripRender: null,
      rebuild: null,
      wheelAttached: false,
      disposed: false,
    };
    // The palette has one set of colors per card theme: recolor a drawn chart
    // when the reader toggles the theme or the system preference changes.
    onThemeChange(() => this.recolor(), this.aborter.signal);
    if (groupSlug) {
      this.unsubscribeBundleRetry = subscribeGroupBundleRetry(groupSlug, () => {
        if (this.bundleFailed && this.groupIsOpen() && !this.state.disposed) {
          this.bundleFailed = false;
          this.cb.setError(null);
          this.onGroupOpen(0);
        }
      });
    }
  }

  /** Recolor the drawn chart for the current theme. Idempotent; a card that has
   * not drawn yet picks up the theme when it builds its datasets. */
  private recolor(): void {
    const chart = this.state.chart;
    if (!chart || this.state.disposed) {
      return;
    }
    recolorDatasets(benchDatasets(chart), effectiveTheme());
    chart.update('none');
  }

  /** Seed the permalink page's server-fetched payload before any fetch runs. */
  seedPayload(payload: ChartResponse): void {
    const normalized = normalizeChartPayload(payload);
    this.state.payload = normalized;
    this.state.fullLoaded = normalized.history.complete;
    if (!normalized.history.complete) {
      this.state.everWindowed = true;
    }
    this.syncWindowChip();
    if (this.groupSlug) {
      noteGroupSeries(this.groupSlug, normalized.series_meta);
    }
  }

  /** Whether the enclosing group disclosure (if any) is open. */
  private groupIsOpen(): boolean {
    const card = this.els().card;
    const group = card?.closest('.group-details');
    const details = group?.querySelector('details.group-disclosure');
    return !details || (details as HTMLDetailsElement).open;
  }

  /** Whether the group store currently hides this card as an empty chart (no
   * data in the latest-100 window, reveal toggle off). Read from the store,
   * not the DOM: the store mutation precedes React's `display: none` commit,
   * so gating on it suppresses construction without racing the render. */
  private hiddenAsEmpty(): boolean {
    return (
      this.groupSlug !== undefined &&
      chartIsHiddenAsEmpty(getGroupSnapshot(this.groupSlug), this.slug)
    );
  }

  /**
   * Ensure this chart's default `?n=100` payload is loaded. Consults the session
   * payload cache first (a sibling group-bundle fetch may have already cached
   * it), then on the landing page drives one bundle fetch per group, falling
   * back to the per-chart [`fetchInitialPayloadDirect`] only when the bundle does
   * not cover this slug. The permalink page (no group slug) goes straight to the
   * per-chart fetch. `showLoading` mirrors v3: the group-open path shows the
   * per-card loading indicator, the pointer-intent prefetch stays silent.
   */
  ensureInitialPayload(priority: number, showLoading: boolean): Promise<void> {
    const state = this.state;
    if (state.payload || state.disposed) {
      return Promise.resolve();
    }
    // Fast path: a sibling group-bundle fetch may have already cached this
    // chart's default payload. Seed from it synchronously (the same steps as the
    // fetch success path) so no per-chart request is issued.
    const cached = getCachedPayload(this.slug);
    if (cached) {
      this.seedFromCachedPayload(cached);
      return Promise.resolve();
    }
    // On the landing page (a group slug is present), drive one bundle fetch per
    // group and hydrate from it. Only fall through to the per-chart fetch when
    // the bundle is unavailable (404) or this slug is missing.
    if (this.groupSlug) {
      if (showLoading) {
        this.cb.setError(null);
        this.cb.setLoading(true);
        this.cb.setRetryable(false);
      }
      const groupSlug = this.groupSlug;
      this.bundleFailed = false;
      return ensureGroupBundle(groupSlug, priority).then((result) => {
        // The group can close while this card awaits the in-flight bundle. The
        // close unmounts the island (its `destroy()` aborts this controller's
        // fetches) and GroupBody aborts the bundle, so a per-chart fallback
        // issued now would never be aborted and would defeat the "closing a
        // group frees server capacity" contract. Bail when the controller is
        // disposed or the group is no longer open.
        if (state.disposed || state.payload || !this.groupIsOpen() || result.status === 'aborted') {
          return;
        }
        const fromBundle = getCachedPayload(this.slug);
        if (fromBundle) {
          this.seedFromCachedPayload(fromBundle);
          return;
        }
        if (result.status === 'failed') {
          this.bundleFailed = true;
          this.cb.setLoading(false);
          this.cb.setError('failed to load group charts');
          this.cb.setRetryable(true);
          return;
        }
        // Bundle did not cover this chart: fall back to the per-chart fetch.
        return this.fetchInitialPayloadDirect(priority, showLoading);
      });
    }
    return this.fetchInitialPayloadDirect(priority, showLoading);
  }

  /** Seed state from a cached default payload (the bundle/cache hit path),
   * mirroring the per-chart fetch's success handler. Does NOT call
   * `maybeConstruct`; the caller does after the returned promise resolves. */
  private seedFromCachedPayload(raw: ChartResponse): void {
    const state = this.state;
    // A concurrent full-history upgrade may already have constructed from the
    // `?n=all` payload; the late cache seed must not clobber that back to the
    // bounded window (same invariant as the per-chart success handler).
    if (state.fullLoaded) {
      return;
    }
    const normalized = normalizeChartPayload(raw);
    state.payload = normalized;
    state.fullLoaded = normalized.history.complete;
    if (!normalized.history.complete) {
      state.everWindowed = true;
    }
    this.syncWindowChip();
    this.cb.setLoading(false);
    this.cb.setError(null);
    this.cb.setRetryable(false);
    if (this.groupSlug) {
      noteGroupSeries(this.groupSlug, normalized.series_meta);
    }
  }

  /**
   * Queue the initial `?n=100` fetch through the bounded hydration queue (or
   * bump its priority if already queued). The per-chart fallback for the bundle
   * path and the only path on the permalink page. `showLoading` mirrors v3: the
   * group-open path shows the per-card loading indicator, the pointer-intent
   * prefetch stays silent.
   */
  private fetchInitialPayloadDirect(priority: number, showLoading: boolean): Promise<void> {
    const state = this.state;
    if (state.initialFetchEntry) {
      if (priority > state.initialFetchEntry.priority) {
        state.initialFetchEntry.priority = priority;
        hydrationQueue.drain();
      }
      if (showLoading) {
        this.cb.setLoading(true);
        this.cb.setRetryable(false);
      }
      return state.initialFetchEntry.promise.then(
        () => undefined,
        () => undefined,
      );
    }
    if (showLoading) {
      this.cb.setLoading(true);
      this.cb.setRetryable(false);
    }
    const url = `/api/chart/${encodeURIComponent(this.slug)}?n=${encodeURIComponent(CHART_FETCH_N)}`;
    const fc = new AbortController();
    state.initialFetchController = fc;
    // Bridge the controller-lifetime aborter to this per-fetch controller so
    // `destroy()` cancels the in-flight request. `{ once: true }` self-removes
    // the listener after a single abort; the `finally` removes it on the no-abort
    // path. Propagate the parent's reason so a destroy reads as `AbortError`.
    const onParentAbort = (): void => fc.abort(this.aborter.signal.reason);
    this.aborter.signal.addEventListener('abort', onParentAbort, { once: true });
    if (this.aborter.signal.aborted) {
      fc.abort(this.aborter.signal.reason);
    }
    const entry = hydrationQueue.schedule(async () => {
      // The timeout starts when the task actually runs (not while queued), so it
      // measures fetch duration, not queue wait. A `TimeoutError` reason lets the
      // catch tell a timeout apart from a close/destroy `AbortError`.
      const timer = setTimeout(
        () => fc.abort(new DOMException('Fetch timed out', 'TimeoutError')),
        FETCH_TIMEOUT_MS,
      );
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' }, signal: fc.signal });
        if (!r.ok) {
          throw new Error(r.status === 404 ? 'not found' : `HTTP ${r.status}`);
        }
        return (await r.json()) as ChartResponse;
      } finally {
        clearTimeout(timer);
        this.aborter.signal.removeEventListener('abort', onParentAbort);
      }
    }, priority);
    state.initialFetchEntry = entry;
    return entry.promise.then(
      (raw) => {
        if (state.initialFetchEntry === entry) {
          state.initialFetchEntry = null;
        }
        if (state.initialFetchController === fc) {
          state.initialFetchController = null;
        }
        if (state.disposed) {
          return;
        }
        // A concurrent full-history upgrade (hover dwell or chip click) may have
        // already resolved and constructed from the `?n=all` payload while this
        // `?n=100` window was still in flight. The late window resolution must
        // not clobber that full payload back to the bounded window (which would
        // diverge `payload` from the rendered datasets, regress the chip, and
        // re-arm a redundant pan-triggered refetch).
        if (state.fullLoaded) {
          return;
        }
        const normalized = normalizeChartPayload(raw as ChartResponse);
        state.payload = normalized;
        state.fullLoaded = normalized.history.complete;
        if (!normalized.history.complete) {
          state.everWindowed = true;
        }
        this.syncWindowChip();
        this.cb.setLoading(false);
        if (this.groupSlug) {
          noteGroupSeries(this.groupSlug, normalized.series_meta);
          // Classify the empty-window state from this `?n=100` payload (the
          // per-chart analogue of the bundle-prime classification).
          noteChartRecentData(this.groupSlug, this.slug, chartHasRecentData(normalized));
        }
        void this.maybeConstruct();
      },
      (err: unknown) => {
        if (state.initialFetchEntry === entry) {
          state.initialFetchEntry = null;
        }
        if (state.initialFetchController === fc) {
          state.initialFetchController = null;
        }
        if (state.disposed) {
          return;
        }
        // A close/destroy cancellation aborts with `AbortError`: stay silent and
        // do NOT touch the loading state, which may now belong to a fresh fetch
        // scheduled after a reopen (clearing it here would extinguish that
        // newer fetch's spinner). A timeout (`TimeoutError`) or a genuine
        // network/HTTP failure clears loading and surfaces the error indicator.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        this.cb.setLoading(false);
        const message =
          err instanceof DOMException && err.name === 'TimeoutError'
            ? 'timed out'
            : err instanceof Error
              ? err.message
              : 'unknown error';
        this.cb.setError(`failed to load: ${message}`);
        this.cb.setRetryable(true);
      },
    );
  }

  /** Re-issue the initial `?n=100` fetch after a failure/timeout. User-initiated
   * (the error region's retry control), so it is naturally bounded; clears the
   * error first and schedules at the top of the hydration queue.
   */
  retryInitialPayload(): void {
    if (this.state.disposed || this.state.payload) {
      return;
    }
    if (this.groupSlug && this.bundleFailed && retryGroupBundle(this.groupSlug)) {
      return;
    }
    this.cb.setError(null);
    this.cb.setRetryable(false);
    void this.ensureInitialPayload(0, true).then(() => {
      if (this.state.disposed) {
        return;
      }
      void this.maybeConstruct();
    });
  }

  /**
   * Hydrate this chart's latest-100 window at `priority` and construct. Full
   * history is NOT warmed here; it loads only on explicit per-chart intent
   * (window-chip click, hover dwell, or pan/zoom into the unloaded region). The
   * priority is the negated visual `index`, so top cards drain ahead of lower
   * ones (the queue drains highest-priority-first).
   */
  onGroupOpen(priority: number): void {
    void this.ensureInitialPayload(priority, true).then(() => {
      if (this.state.disposed) {
        return;
      }
      void this.maybeConstruct();
    });
  }

  /**
   * Queue the one-shot `?n=all` full-history upgrade (or promote the queued
   * entry's priority). Triggered only by explicit intent — window-chip click
   * (`INTERACTION_FULL_PRIORITY`), hover dwell (`HOVER_PREFETCH_PRIORITY`), or
   * pan/zoom touching the unloaded region — never as an automatic warmup.
   */
  ensureFullHistory(priority: number): Promise<void> {
    const state = this.state;
    // `fullUnavailable` is checked here (not only at the chip/hover call sites)
    // so every intent path shares one terminal-404 guard, including the pan/zoom
    // `rangeTouchesUnloadedHistory` promotion, which must not re-issue a fetch
    // that already 404'd.
    if (state.fullLoaded || state.fullUnavailable || state.disposed) {
      return Promise.resolve();
    }
    if (state.fullFetchEntry) {
      if (priority > state.fullFetchEntry.priority) {
        state.fullFetchEntry.priority = priority;
        fullHistoryQueue.drain();
      }
      return state.fullFetchPending ?? Promise.resolve();
    }
    const url = `/api/chart/${encodeURIComponent(this.slug)}?n=${encodeURIComponent(FETCH_N)}`;
    const fc = new AbortController();
    state.fullFetchController = fc;
    const onParentAbort = (): void => fc.abort(this.aborter.signal.reason);
    this.aborter.signal.addEventListener('abort', onParentAbort, { once: true });
    if (this.aborter.signal.aborted) {
      fc.abort(this.aborter.signal.reason);
    }
    const entry = fullHistoryQueue.schedule(async () => {
      const timer = setTimeout(
        () => fc.abort(new DOMException('Fetch timed out', 'TimeoutError')),
        FETCH_TIMEOUT_MS,
      );
      try {
        const r = await fetch(url, { headers: { accept: 'application/json' }, signal: fc.signal });
        if (r.status === 404) {
          return null;
        }
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}`);
        }
        return (await r.json()) as ChartResponse;
      } finally {
        clearTimeout(timer);
        this.aborter.signal.removeEventListener('abort', onParentAbort);
      }
    }, priority);
    state.fullFetchEntry = entry;
    state.fullFetchPending = entry.promise
      .then((full) => {
        if (state.disposed) {
          return;
        }
        if (full === null) {
          state.fullUnavailable = true;
          return;
        }
        this.replaceChartPayload(full as ChartResponse);
        state.fullLoaded = true;
        if (state.fullFetchController === fc) {
          state.fullFetchController = null;
        }
        state.chipError = false;
        this.cb.setLoading(false);
        if (!state.chart && this.groupIsOpen()) {
          void this.maybeConstruct();
        }
      })
      .catch((err: unknown) => {
        if (state.fullFetchController === fc) {
          state.fullFetchController = null;
        }
        // A close/destroy cancellation is silent; a timeout or genuine failure
        // leaves the chip's retry affordance (chipError) so the user can re-try.
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // Quiet: the latest-100 payload is still usable. Surface to the console
        // for debugging; the chip exposes the retry affordance.
        console.warn('bench: full history fetch failed', err);
        state.chipError = true;
      })
      .then(() => {
        if (state.fullFetchEntry === entry) {
          state.fullFetchEntry = null;
          state.fullFetchController = null;
          state.fullFetchPending = null;
        }
        // Always re-sync the chip so the UI reflects the latest state even when
        // the guard above skips the stale entry clears.
        this.syncWindowChip();
      });
    this.syncWindowChip();
    return state.fullFetchPending;
  }

  /**
   * Construct the Chart.js instance when the payload is present and the
   * enclosing group (if any) is open. Loads Chart.js lazily on first need.
   * Idempotent across overlapping calls via the `constructing` latch.
   */
  async maybeConstruct(): Promise<void> {
    const state = this.state;
    if (state.chart || state.constructing || !state.payload || state.disposed) {
      return;
    }
    // A card hidden as empty is `display: none`; constructing into it would
    // yield a zero-size chart. The reveal effect re-enters when the toggle
    // shows it (mirroring how the toggle-open path re-enters via onGroupOpen).
    if (!this.groupIsOpen() || this.hiddenAsEmpty()) {
      return;
    }
    const { canvas, tooltipHost, card } = this.els();
    if (!canvas || !card) {
      return;
    }
    state.constructing = true;
    try {
      let Chart: typeof ChartJs;
      try {
        Chart = await loadChartJs();
      } catch (err) {
        // A failed chunk load (deploy rotated the hashed assets, flaky
        // network) surfaces like a fetch failure; the loader has already reset
        // its cache, and the error indicator's auto-dismiss retries
        // construction (bounded by `shouldRetryConstruct`) so charts whose
        // only construction trigger already fired (the permalink page's
        // one-shot IntersectionObserver) are not left permanently blank.
        this.loadAttempts += 1;
        if (!state.disposed) {
          const message = err instanceof Error ? err.message : 'unknown error';
          this.cb.setError(`failed to load chart library: ${message}`);
        }
        return;
      }
      if (state.disposed || state.chart || !state.payload) {
        return;
      }
      // Re-check the disclosure AND the empty-hide AFTER the await: the group
      // can close (or the bundle can classify this card empty) while the
      // Chart.js chunk loads (a window v3 never had, its library being
      // preloaded), and constructing into the display:none grid would render a
      // zero-size chart. The next toggle-open re-enters via onGroupOpen; the
      // empty-reveal effect re-enters via maybeConstruct.
      if (!this.groupIsOpen() || this.hiddenAsEmpty()) {
        return;
      }
      const payload = state.payload;

      // Lock the display unit for the lifetime of this loaded payload; it is
      // recomputed only when `replaceChartPayload` swaps in the wider window.
      state.displayUnit = pickDisplayUnit(payload.unit_kind, collectAllValues(payload));

      const labels = payload.commits.map(commitDateLabel);
      const datasets = buildDatasets(payload, effectiveTheme());
      const range = visibleRange(labels.length, state.ui.scope);
      const legendPosition = window.matchMedia?.('(max-width: 768px)').matches ? 'top' : 'bottom';

      // Throttled rebuild for pan/zoom: both axes mutate `scales.x.min/max`
      // continuously during interaction, so the rendered points re-derive at
      // most every PAN_THROTTLE_MS and the range strip refreshes in the same
      // call so LTTB and the strip never diverge.
      const throttledRebuild = throttle((chart: ChartJs) => {
        const sx = chart.scales?.x;
        if (!sx) {
          return;
        }
        this.rebuildVisibleAndUpdate(chart, sx.min, sx.max, true);
        state.stripRender?.();
      }, PAN_THROTTLE_MS);

      // Chart.js's types do not let a line chart widen to `Chart` under
      // `exactOptionalPropertyTypes`. The cast changes no value.
      const chart = new Chart(
        canvas,
        lineChartConfig({
          Chart,
          state,
          tooltipHost,
          labels,
          datasets,
          range,
          legendPosition,
          onZoom: throttledRebuild,
          onLegendToggle: () => this.syncLatestValues(),
        }),
      ) as ChartJs;

      state.chart = chart;
      this.cb.setConstructed(true);
      state.rebuild = throttledRebuild;
      this.attachWheelPan(canvas, chart, throttledRebuild);
      this.syncSliderBounds(labels.length);
      // Initial render: populate the null data for the initial window, then
      // bind the strip so its first paint reflects the same range.
      this.rebuildVisibleAndUpdate(chart, range.min ?? 0, range.max ?? 0, false);
      this.bindRangeStrip(chart);
      state.stripRender?.();
      // `buildDatasets` seeded `hidden` from the global filter; reapply through
      // the layered helper so a per-group filter set before this card hydrated
      // also takes effect.
      this.applyFilters();
      if (this.groupSlug) {
        noteGroupSeries(this.groupSlug, payload.series_meta);
      }
    } finally {
      state.constructing = false;
    }
  }

  /**
   * The single source of truth for the rendered point count, ported verbatim:
   * build the per-commit max-across-series union over `[rangeMin, rangeMax]`,
   * keep at most [`MAX_VISIBLE_POINTS`] shared commit indices (LTTB above the
   * cap), and write the kept values into every `dataset.data` in place.
   */
  rebuildVisibleAndUpdate(
    chart: ChartJs,
    rangeMin: number,
    rangeMax: number,
    allowFullFetch: boolean,
  ): void {
    const state = this.state;
    // The throttled pan/zoom wrapper preserves its trailing call, which can
    // land after teardown; updating a destroyed Chart.js instance throws.
    if (state.disposed) {
      return;
    }
    const payload = state.payload;
    if (!payload) {
      return;
    }
    const datasets = benchDatasets(chart);
    const n = payload.commits.length;
    if (n === 0) {
      return;
    }

    const min = Math.max(0, Math.floor(rangeMin));
    let max = Math.min(n - 1, Math.ceil(rangeMax));
    if (max < min) {
      max = min;
    }

    // Pick the kept commit indices by downsampling each series INDEPENDENTLY
    // (see [`decimateSeries`]). The earlier approach LTTB'd a single
    // max-across-series "virtual series" and shared its indices across every
    // dataset; a series that never drove that maximum then lost its own points
    // once the window exceeded the cap (the "data disappears after loading all"
    // bug). The kept set is still capped at [`MAX_VISIBLE_POINTS`] distinct
    // x-positions, split across the series with data in view.
    const { kept: keptSet, downsampled: anyDownsampled } = decimateSeries(
      datasets.map((ds) => ds.rawData),
      min,
      max,
      MAX_VISIBLE_POINTS,
    );

    // Write the kept set into every dataset, scaled by the locked display-unit
    // multiplier (applied here, not on ingest or in SQL, so the wire payload
    // stays in base units). Values outside `[min, max]` stay null: planting
    // off-screen neighbours would blow up the y-axis auto-scale (it reads
    // every non-null value regardless of `scales.x.min/max`).
    const multiplier = state.displayUnit.multiplier;
    for (const ds of datasets) {
      const dsRaw = ds.rawData;
      if (!Array.isArray(dsRaw)) {
        continue;
      }
      let data = ds.data;
      if (!Array.isArray(data) || data.length !== n) {
        data = new Array<number | null>(n);
        ds.data = data;
      }
      for (let z = 0; z < n; z++) {
        data[z] = null;
      }
      for (const idx of keptSet) {
        const val = dsRaw[idx];
        if (val !== null && val !== undefined && !Number.isNaN(val)) {
          data[idx] = val * multiplier;
        }
      }
    }

    const visibleCommits = max - min + 1;
    const keptCommits = keptSet.size;
    chart.update('none');
    this.syncSliderFromRange(visibleCommits);
    this.syncDownsampleBadge(keptCommits, visibleCommits, anyDownsampled);
    // If the user moves into the virtual, not-yet-loaded part of the x-axis,
    // promote this chart's queued full-history fetch ahead of background work.
    if (allowFullFetch && rangeTouchesUnloadedHistory(payload, min, max)) {
      void this.ensureFullHistory(INTERACTION_FULL_PRIORITY);
    }
  }

  /**
   * Swap the chart's labels + datasets to the freshly fetched unbounded payload
   * while preserving the current x-range. The virtual latest-100 payload and
   * the full payload share a full-history x-axis, so the chart does not jump
   * when the real older values arrive.
   */
  replaceChartPayload(rawPayload: ChartResponse): void {
    const state = this.state;
    const payload = normalizeChartPayload(rawPayload);
    state.payload = payload;
    if (this.groupSlug) {
      // [`chartHasRecentData`] reads only the trailing latest-100 slots, so the
      // full-history payload yields the same verdict as the `?n=100` window;
      // recording here (before the chart-null guard) covers the rare race where
      // the full upgrade resolves before the initial window fetch, whose own
      // handler then early-returns without classifying.
      noteChartRecentData(this.groupSlug, this.slug, chartHasRecentData(payload));
    }
    const chart = state.chart;
    if (!chart) {
      return;
    }
    // Re-pick the display unit against the now-wider window: the refetch may
    // surface older commits with a different magnitude, and moving the y-axis
    // once at the refetch boundary beats leaving the chart on a stale unit.
    state.displayUnit = pickDisplayUnit(payload.unit_kind, collectAllValues(payload));
    const yAxis = chart.options.scales?.y;
    if (yAxis && 'title' in yAxis && yAxis.title) {
      yAxis.title.display = state.displayUnit.axisLabel !== '';
      yAxis.title.text = state.displayUnit.axisLabel;
    }
    const newLabels = payload.commits.map(commitDateLabel);
    const newDatasets = buildDatasets(payload, effectiveTheme());
    // Honour any explicit legend toggles the user had made already.
    for (const ds of newDatasets) {
      if (ds.label && state.overrides[ds.label]) {
        const prev = chart.data.datasets.find((p) => p.label === ds.label);
        if (prev) {
          ds.hidden = Boolean(prev.hidden);
        }
      }
    }
    chart.data.labels = newLabels;
    // Line datasets widen to the generic `ChartDataset` only by a cast, as the
    // chart does in `maybeConstruct`. The cast changes no value.
    chart.data.datasets = newDatasets as ChartDataset[];
    this.applyFilters();
    if (this.groupSlug) {
      noteGroupSeries(this.groupSlug, payload.series_meta);
    }
    const newMaxIdx = Math.max(0, newLabels.length - 1);
    const zoomLimits = chart.options.plugins?.zoom?.limits?.x;
    if (zoomLimits) {
      zoomLimits.max = newMaxIdx;
    }
    this.syncSliderBounds(newLabels.length);
    const sx = chart.options.scales?.x;
    if (!sx) {
      return;
    }
    // v3's `replaceChartPayload` carries an unreachable non-finite else branch
    // here; the values are coerced finite above, so only the clamp survives.
    const prevMin = typeof sx.min === 'number' && Number.isFinite(sx.min) ? sx.min : 0;
    const prevMax = typeof sx.max === 'number' && Number.isFinite(sx.max) ? sx.max : 0;
    sx.min = Math.max(0, Math.min(newMaxIdx, prevMin));
    sx.max = Math.max(sx.min, Math.min(newMaxIdx, prevMax));
    this.rebuildVisibleAndUpdate(chart, sx.min, sx.max, false);
    state.stripRender?.();
  }

  private syncSliderFromRange(visibleCommits: number): void {
    setSliderFromRange(this.els().slider, visibleCommits);
  }

  private syncDownsampleBadge(
    keptCommits: number,
    visibleCommits: number,
    anyDownsampled: boolean,
  ): void {
    renderDownsampleBadge(this.els().badge, keptCommits, visibleCommits, anyDownsampled);
  }

  private syncWindowChip(): void {
    renderWindowChip(this.els().chip, this.state);
  }

  /** Window-chip click: load the full history at top priority, or retry after a
   * failure. A no-op once full history is loaded or a fetch is already pending. */
  onWindowChipClick(): void {
    const state = this.state;
    if (state.disposed || state.fullLoaded || state.fullFetchPending || state.fullUnavailable) {
      return;
    }
    state.chipError = false;
    void this.ensureFullHistory(INTERACTION_FULL_PRIORITY);
  }

  /** Pointer resting on the card: reveal the chip's action immediately and arm
   * the dwell-prefetch timer. Only a deliberate dwell (not a sweep) fetches. */
  onCardHoverStart(): void {
    const state = this.state;
    if (state.disposed) {
      return;
    }
    state.hovering = true;
    this.syncWindowChip();
    if (
      state.fullLoaded ||
      state.fullFetchPending ||
      state.fullUnavailable ||
      state.hoverDwellTimer !== null
    ) {
      return;
    }
    state.hoverDwellTimer = setTimeout(() => {
      state.hoverDwellTimer = null;
      if (state.disposed) {
        return;
      }
      void this.ensureFullHistory(HOVER_PREFETCH_PRIORITY);
    }, HOVER_DWELL_MS);
  }

  /** Pointer left the card: restore the chip label and cancel a pending dwell. */
  onCardHoverEnd(): void {
    const state = this.state;
    if (state.disposed) {
      return;
    }
    state.hovering = false;
    if (state.hoverDwellTimer !== null) {
      clearTimeout(state.hoverDwellTimer);
      state.hoverDwellTimer = null;
    }
    this.syncWindowChip();
  }

  private syncSliderBounds(commitCount: number): void {
    setSliderBounds(this.els().slider, commitCount);
  }

  private attachWheelPan(
    canvas: HTMLCanvasElement,
    chart: ChartJs,
    rebuild: (chart: ChartJs) => void,
  ): void {
    attachWheelPan(canvas, chart, this.state, rebuild, this.aborter.signal);
  }

  private bindRangeStrip(chart: ChartJs): void {
    bindRangeStrip(
      chart,
      this.els(),
      this.state,
      (c, min, max) => this.rebuildVisibleAndUpdate(c, min, max, true),
      this.aborter.signal,
    );
  }

  /**
   * Apply a toolbar/strip scope change. Preserves the visible center when the
   * user has panned away from the right edge (see [`visibleRange`]).
   *
   * Like [`applyY`], the target scope is recorded BEFORE the chart-null guard
   * (a deliberate deviation from v3, where the toolbar only bound after
   * construction so pre-construction input was unreachable): a slider drag on
   * a not-yet-hydrated card still selects the window construction renders.
   */
  applyScope(scopeValue: string): void {
    const state = this.state;
    const scope = scopeValue === 'all' ? ('all' as const) : parseInt(scopeValue, 10);
    state.ui.scope = scope;
    const chart = state.chart;
    if (!chart) {
      return;
    }
    const commits = (chart.data.labels ?? []).length;
    const sx = chart.options.scales?.x;
    const currentRange = sx
      ? {
          min: typeof sx.min === 'number' ? sx.min : undefined,
          max: typeof sx.max === 'number' ? sx.max : undefined,
        }
      : null;
    const range = visibleRange(commits, scope, currentRange);
    if (sx) {
      sx.min = range.min;
      sx.max = range.max;
    }
    this.rebuildVisibleAndUpdate(
      chart,
      range.min ?? 0,
      range.max ?? Math.max(0, commits - 1),
      true,
    );
    state.stripRender?.();
  }

  /**
   * Apply a Y-scale change. `userInitiated` toggles the sticky flag: once the
   * user clicks the per-chart Y toolbar, the per-group Y broadcast skips this
   * chart so the local click stays honored.
   *
   * Deliberate deviation from v3: `chart-init.js::applyY` no-ops entirely when
   * the chart has not constructed yet, dropping the click; here the sticky flag
   * and target scale are recorded BEFORE the chart-null guard so a click on a
   * not-yet-hydrated card still applies once the chart constructs.
   */
  applyY(yValue: 'linear' | 'log', userInitiated: boolean): void {
    const state = this.state;
    if (userInitiated) {
      state.yUserSet = true;
    }
    state.ui.y = yValue;
    this.cb.setY(yValue);
    const chart = state.chart;
    if (!chart) {
      return;
    }
    const yAxis = chart.options.scales?.y;
    if (yAxis) {
      yAxis.type = yValue === 'log' ? 'logarithmic' : 'linear';
      if ('beginAtZero' in yAxis) {
        yAxis.beginAtZero = yValue !== 'log';
      }
    }
    chart.update('none');
  }

  /** Whether the per-group Y broadcast should skip this chart. */
  yIsSticky(): boolean {
    return this.state.yUserSet;
  }

  /** Whether the error-dismiss timer should retry construction: a payload is
   * waiting, no chart exists, and the bounded Chart.js import budget (3
   * attempts) is not exhausted. After the budget, the card stays blank until
   * reload, which is v3's behavior for a failed static script. */
  shouldRetryConstruct(): boolean {
    const state = this.state;
    return (
      !state.disposed && state.chart === null && state.payload !== null && this.loadAttempts < 3
    );
  }

  /**
   * Re-evaluate every dataset under the layered filter resolution: per-card
   * legend overrides win, then explicit per-group show/hide choices, while the
   * global engine/format filter supplies the fallback visibility.
   */
  applyFilters(): void {
    const state = this.state;
    const chart = state.chart;
    if (!chart) {
      return;
    }
    const global = getGlobalFilterSnapshot();
    const group = this.groupSlug ? getGroupSnapshot(this.groupSlug) : emptyGroupSnapshot();
    for (const ds of benchDatasets(chart)) {
      if (ds.label && state.overrides[ds.label]) {
        continue;
      }
      // `dataset.hidden` directly (not `setDatasetVisibility`) so the legend
      // stays in sync; the visibility map is a separate channel.
      const globalVisible = seriesPassesFilter(ds.benchMeta, global.active, global.universe);
      ds.hidden = !seriesPassesGroupFilter(group, ds.label ?? '', globalVisible);
    }
    chart.update('none');
    this.syncLatestValues();
  }

  /**
   * Restate the canvas label's sentence about the latest commit with data
   * (`latestValuesSentence`) from the visible series, in the locked display
   * unit. It
   * runs wherever the series' visibility or the payload changes: after
   * construction and a payload swap (both through [`applyFilters`]), on a
   * filter change, and on a legend click.
   */
  private syncLatestValues(): void {
    const { chart, payload, displayUnit } = this.state;
    if (!chart || !payload) {
      return;
    }
    const series = benchDatasets(chart).flatMap((ds, i) =>
      chart.isDatasetVisible(i) ? [{ label: ds.label ?? '', values: ds.rawData ?? [] }] : [],
    );
    this.cb.setLatestValues(latestValuesSentence(series, payload.commits, displayUnit));
  }

  /** Cancel any in-flight `?n=100` / `?n=all` request WITHOUT tearing down the
   * controller, so closing a group (or its IO disconnect) frees server capacity
   * and stops open/close from piling requests up. A reopen re-issues the fetch.
   * The aborts reject the in-flight promises with `AbortError`, which the fetch
   * catch paths treat as a silent cancellation. */
  abortInFlightFetches(): void {
    this.state.initialFetchController?.abort();
    this.state.fullFetchController?.abort();
    // Drop the entry references so a reopen schedules a FRESH fetch rather than
    // joining the now-aborting promise (which resolves to nothing and would leave
    // the card blank). The aborted tasks still settle; their handlers' identity-
    // guarded clears below no-op once a newer fetch owns these refs.
    this.state.initialFetchController = null;
    this.state.initialFetchEntry = null;
    this.state.fullFetchController = null;
    this.state.fullFetchEntry = null;
    this.state.fullFetchPending = null;
  }

  /** Tear down this controller: destroy the chart, remove every DOM listener
   * it attached (wheel, strip pointers), and drop late async results. One-way;
   * the mount effect constructs a fresh controller for the next mount. */
  destroy(): void {
    this.state.disposed = true;
    this.unsubscribeBundleRetry?.();
    this.aborter.abort(new DOMException('chart controller destroyed', 'AbortError'));
    if (this.state.hoverDwellTimer !== null) {
      clearTimeout(this.state.hoverDwellTimer);
      this.state.hoverDwellTimer = null;
    }
    this.state.chart?.destroy();
    this.state.chart = null;
  }
}
