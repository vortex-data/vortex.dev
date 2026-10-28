// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Client-side singletons shared by the chart islands, the stateful counterpart
 * to the pure helpers in `lib/chart-format.ts`: the bounded-concurrency fetch
 * queues, the global engine/format filter store, and the per-group filter/Y
 * stores. One instance of each lives per browser tab (module scope), mirroring
 * the page-level closures of `server/static/chart-init.js`.
 *
 * The stores expose a `subscribe`/`getSnapshot` pair compatible with React's
 * `useSyncExternalStore`, so the islands (every `Chart`, the global
 * `FilterBar`, each `GroupToolbar`) re-render and re-apply filters when any of
 * them mutates shared state. Snapshots are replaced wholesale on mutation;
 * a stable reference means "nothing changed".
 *
 * This module holds browser-tab state and is only imported from `'use client'`
 * components; it has no DOM dependency itself, so node-environment vitest can
 * exercise the queues and stores directly.
 */

import {
  BUNDLE_CONCURRENCY,
  chartHasRecentData,
  FETCH_TIMEOUT_MS,
  FULL_HISTORY_CONCURRENCY,
  HYDRATION_CONCURRENCY,
  seedActiveFormats,
  seedActiveFromAllowlist,
  seriesPassesFilter,
  seriesPassesGroupFilter,
  type FilterUniverse,
  type GlobalFilterState,
} from '@/lib/chart-format';
import type { ChartResponse, GroupChartsResponse, SeriesTag } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Bounded priority queues (ported from chart-init.js sections 11 and 15).
// ---------------------------------------------------------------------------

/** A queued fetch task; `priority` may be bumped while still queued. */
export interface QueueEntry {
  priority: number;
  /** Resolves/rejects with the task's outcome once the queue runs it. */
  promise: Promise<unknown>;
}

interface InternalEntry extends QueueEntry {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/** A bounded-concurrency, priority-ordered task queue. */
export interface TaskQueue {
  /** Enqueue `task` and start draining; higher `priority` runs first. */
  schedule(task: () => Promise<unknown>, priority?: number): QueueEntry;
  /** Re-sort and start any idle slots (called after a priority bump). */
  drain(): void;
}

function makeQueue(concurrency: number): TaskQueue {
  let active = 0;
  const queue: InternalEntry[] = [];

  function drain(): void {
    while (active < concurrency && queue.length > 0) {
      queue.sort((a, b) => b.priority - a.priority);
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(
          (value) => {
            active -= 1;
            item.resolve(value);
            drain();
          },
          (err: unknown) => {
            active -= 1;
            item.reject(err);
            drain();
          },
        );
    }
  }

  function schedule(task: () => Promise<unknown>, priority = 0): QueueEntry {
    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const entry: InternalEntry = { task, priority, promise, resolve, reject };
    queue.push(entry);
    drain();
    return entry;
  }

  return { schedule, drain };
}

/** Per-tab queue for the initial latest-100 chart fetches. */
export const hydrationQueue: TaskQueue = makeQueue(HYDRATION_CONCURRENCY);

/** Per-tab queue for the background `?n=all` full-history upgrades. */
export const fullHistoryQueue: TaskQueue = makeQueue(FULL_HISTORY_CONCURRENCY);

// ---------------------------------------------------------------------------
// Group-bundle fetch + session payload cache (PR-5.0.97).
// ---------------------------------------------------------------------------

/** Per-tab queue for the per-group `/api/group/{slug}?n=100` bundle fetches. */
export const bundleQueue: TaskQueue = makeQueue(BUNDLE_CONCURRENCY);

// Session-lifetime cache of the default last-100 chart payloads, keyed by chart
// slug and filled by `ensureGroupBundle`. Closing and reopening a group reads
// from here, so it never refetches. An open tab keeps these until reload; a
// server-side revalidation is picked up on the next full load (a data-version
// invalidation is future work, not built here).
const payloadCache = new Map<string, ChartResponse>();

/** The cached default payload for `slug`, or `undefined` on a miss. */
export function getCachedPayload(slug: string): ChartResponse | undefined {
  return payloadCache.get(slug);
}

/** Seed the cache for one chart slug (idempotent; last write wins). Internal to
 * the store; `ensureGroupBundle` is its only caller. */
function primePayload(slug: string, payload: ChartResponse): void {
  payloadCache.set(slug, payload);
}

// Group slugs whose bundle fetch already completed successfully (the cache is
// primed for every chart it carried). A reopen of such a group skips the fetch
// entirely, so close/reopen after a success issues zero requests. This survives
// a group close: a successful bundle's cached payloads stay valid for the tab.
const completedBundles = new Set<string>();

// Group slugs whose bundle has already been ATTEMPTED in the current open cycle
// (settled as success, 404, or failure). It collapses the eager `armHydration`
// kick and each island's `ensureInitialPayload` re-attempt into a single fetch
// even after the first one settles. Unlike `completedBundles` it is cleared on
// group close (`abortGroupBundle`), so a reopen re-attempts a group whose bundle
// 404'd or failed, while a card still falls back per-chart in the same cycle.
const attemptedBundles = new Set<string>();

/** Clear the cache and in-flight bundle map. TEST-ONLY: production never evicts
 * within a tab session. */
export function resetPayloadCache(): void {
  payloadCache.clear();
  inFlightBundles.clear();
  completedBundles.clear();
  attemptedBundles.clear();
}

/** A group's in-flight bundle fetch: the queue entry (for priority bumps), its
 * aborter (for group-close cancellation), and the settle promise callers join. */
interface BundleInFlight {
  entry: QueueEntry;
  controller: AbortController;
  promise: Promise<void>;
}

const inFlightBundles = new Map<string, BundleInFlight>();

/**
 * Fetch one group's default last-100 bundle (`/api/group/{slug}?n=100`) and
 * prime [`payloadCache`] for every chart in it. Concurrent callers for the same
 * group share one in-flight fetch (priority is bumped to the highest caller's).
 * A 404 or failure resolves without priming, so callers fall back to the
 * per-chart fetch. Never rejects: failures are swallowed here and surfaced as a
 * cache miss to the caller.
 */
export function ensureGroupBundle(groupSlug: string, priority: number): Promise<void> {
  // A group whose bundle already succeeded is fully cached; a reopen need not
  // refetch (the per-chart cache hit in `ensureInitialPayload` does the rest).
  // A group already attempted this open cycle (404 / failure included) is not
  // re-fetched either: callers fall back per-chart. Both short-circuits resolve
  // immediately so a caller's `.then` still runs and re-checks the cache.
  if (completedBundles.has(groupSlug) || attemptedBundles.has(groupSlug)) {
    return Promise.resolve();
  }
  const existing = inFlightBundles.get(groupSlug);
  if (existing) {
    if (priority > existing.entry.priority) {
      existing.entry.priority = priority;
      bundleQueue.drain();
    }
    return existing.promise;
  }
  const url = `/api/group/${encodeURIComponent(groupSlug)}?n=100`;
  const controller = new AbortController();
  const entry = bundleQueue.schedule(async () => {
    // The timeout starts when the task actually runs (not while queued), so it
    // bounds the fetch, not the queue wait. A `TimeoutError` reason lets the
    // catch tell a timeout apart from a close/destroy `AbortError`.
    const timer = setTimeout(
      () => controller.abort(new DOMException('Fetch timed out', 'TimeoutError')),
      FETCH_TIMEOUT_MS,
    );
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (r.status === 404) {
        return null;
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      return (await r.json()) as GroupChartsResponse;
    } finally {
      clearTimeout(timer);
    }
  }, priority);
  const promise = entry.promise
    .then((body) => {
      if (body !== null) {
        const bundle = body as GroupChartsResponse;
        for (const chart of bundle.charts) {
          // `NamedChartResponse` is `ChartResponse & { name, slug }`; the extra
          // keys are harmless in the cached payload.
          primePayload(chart.slug, chart);
          noteGroupSeries(groupSlug, chart.series_meta);
          // The bundle IS the group's latest-100 window, so classify every
          // chart's empty-window state here — including cards that never
          // intersect the viewport (their islands never seed a payload).
          noteChartRecentData(groupSlug, chart.slug, chartHasRecentData(chart));
        }
        // Mark the group complete so a reopen short-circuits without a refetch.
        // A 404 (`null` body) or a failure leaves it unmarked so a reopen retries.
        completedBundles.add(groupSlug);
      }
    })
    .catch((err: unknown) => {
      // A close/destroy abort is silent; a timeout or failure leaves the cache
      // unprimed so callers fall back per-chart. Surface non-abort failures for
      // debugging only.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.warn('bench: group bundle fetch failed', err);
      }
    })
    .finally(() => {
      // Drop the in-flight entry once it settles, but only if a newer fetch has
      // not already replaced it (mirrors the per-chart identity-guarded clears).
      if (inFlightBundles.get(groupSlug)?.entry === entry) {
        inFlightBundles.delete(groupSlug);
        // Record that this group was attempted this open cycle so a re-call does
        // not re-fetch a just-settled bundle. A close (`abortGroupBundle`) clears
        // this so a reopen retries; the in-flight identity guard avoids marking
        // a stale (already-replaced) entry's settle.
        attemptedBundles.add(groupSlug);
      }
    });
  inFlightBundles.set(groupSlug, { entry, controller, promise });
  return promise;
}

/** Abort a group's in-flight bundle fetch (on group close) and reset its
 * per-cycle state so a reopen re-issues. Idempotent. A successfully completed
 * bundle's cache stays valid (`completedBundles` is left intact), so a reopen of
 * a fully cached group still issues nothing. */
export function abortGroupBundle(groupSlug: string): void {
  const inFlight = inFlightBundles.get(groupSlug);
  if (inFlight) {
    inFlight.controller.abort(new DOMException('group closed', 'AbortError'));
    inFlightBundles.delete(groupSlug);
  }
  // Clear the per-cycle attempt marker so a reopen re-attempts a group whose
  // bundle 404'd or failed; a fully cached group is gated by `completedBundles`.
  attemptedBundles.delete(groupSlug);
}

// ---------------------------------------------------------------------------
// Global filter store.
// ---------------------------------------------------------------------------

/** The global filter's full state: the chip universe plus the active sets. */
export interface GlobalFilterSnapshot {
  universe: FilterUniverse;
  active: GlobalFilterState;
}

const EMPTY_GLOBAL: GlobalFilterSnapshot = {
  universe: { engines: [], formats: [] },
  active: { engines: [], formats: [] },
};

let globalSnapshot: GlobalFilterSnapshot = EMPTY_GLOBAL;
const globalListeners = new Set<() => void>();

function notifyGlobal(): void {
  for (const cb of globalListeners) {
    cb();
  }
}

/** Subscribe to global-filter changes; returns the unsubscribe function. */
export function subscribeGlobalFilter(cb: () => void): () => void {
  globalListeners.add(cb);
  return () => {
    globalListeners.delete(cb);
  };
}

/** Current global-filter snapshot (stable reference until a mutation). */
export function getGlobalFilterSnapshot(): GlobalFilterSnapshot {
  return globalSnapshot;
}

/**
 * Seed the store from server-provided props: the chip universe plus the URL
 * `?engine=`/`?format=` allowlists (null uses the defaults; empty hides all).
 * Called by the filter bar on mount and again on soft navigation, so the store
 * tracks the URL state of the page that most recently mounted it.
 */
export function initGlobalFilter(
  universe: FilterUniverse,
  engineAllowlist: readonly string[] | null,
  formatAllowlist: readonly string[] | null,
): void {
  globalSnapshot = {
    universe: { engines: [...universe.engines], formats: [...universe.formats] },
    active: {
      engines: seedActiveFromAllowlist(engineAllowlist, universe.engines),
      formats: seedActiveFormats(formatAllowlist, universe.formats),
    },
  };
  notifyGlobal();
}

/**
 * Toggle one chip independently. The `'*'` value is the one-shot reset chip:
 * it forces every chip in that dimension back to active. Specific chips flip
 * their own membership in the active set.
 */
export function toggleGlobalFilterValue(dim: 'engine' | 'format', value: string): void {
  const key = dim === 'engine' ? 'engines' : 'formats';
  const active = { ...globalSnapshot.active };
  if (value === '*') {
    active[key] = [...globalSnapshot.universe[key]];
  } else {
    const list = [...active[key]];
    const idx = list.indexOf(value);
    if (idx === -1) {
      list.push(value);
    } else {
      list.splice(idx, 1);
    }
    active[key] = list;
  }
  globalSnapshot = { ...globalSnapshot, active };
  notifyGlobal();
}

// ---------------------------------------------------------------------------
// Per-group stores (ported from chart-init.js section 17's section-node state).
// ---------------------------------------------------------------------------

/** One group's override state plus the series labels its charts have surfaced. */
export interface GroupSnapshot {
  /** Dataset labels the user has toggled off via the group's filter dropdown. */
  hiddenSeries: string[];
  /** Dataset labels explicitly restored over a global engine/format filter. */
  shownSeries: string[];
  /** The group-level Y override; `null` means "no override; defer to charts". */
  groupY: 'linear' | 'log' | null;
  /** Series labels (with engine/format tags) surfaced by hydrated charts. */
  knownSeries: Record<string, SeriesTag>;
  /** Chart slugs whose latest-100 window carries no data point at all (see
   * [`chartHasRecentData`]); these cards hide by default. Data-derived, like
   * `knownSeries`, so a group Reset leaves it intact. */
  emptyCharts: string[];
  /** The group toolbar's "show empty charts" toggle; `false` (the default and
   * the post-Reset state) hides every `emptyCharts` card. */
  showEmptyCharts: boolean;
}

const EMPTY_GROUP: GroupSnapshot = {
  hiddenSeries: [],
  shownSeries: [],
  groupY: null,
  knownSeries: {},
  emptyCharts: [],
  showEmptyCharts: false,
};

interface GroupStore {
  snapshot: GroupSnapshot;
  listeners: Set<() => void>;
}

const groupStores = new Map<string, GroupStore>();

function groupStore(slug: string): GroupStore {
  let store = groupStores.get(slug);
  if (store === undefined) {
    store = { snapshot: EMPTY_GROUP, listeners: new Set() };
    groupStores.set(slug, store);
  }
  return store;
}

function setGroupSnapshot(slug: string, next: GroupSnapshot): void {
  const store = groupStore(slug);
  store.snapshot = next;
  for (const cb of store.listeners) {
    cb();
  }
}

/** Subscribe to one group's changes; returns the unsubscribe function. */
export function subscribeGroup(slug: string, cb: () => void): () => void {
  const store = groupStore(slug);
  store.listeners.add(cb);
  return () => {
    store.listeners.delete(cb);
  };
}

/** Current snapshot for one group (stable reference until a mutation). */
export function getGroupSnapshot(slug: string): GroupSnapshot {
  return groupStore(slug).snapshot;
}

/** Seed one group's local series overrides from the current page URL. */
export function initGroupFilter(
  slug: string,
  hiddenSeries: readonly string[],
  shownSeries: readonly string[] = [],
): void {
  const prev = groupStore(slug).snapshot;
  const nextShown = [...new Set(shownSeries)];
  const nextHidden = [...new Set(hiddenSeries)].filter((label) => !nextShown.includes(label));
  if (
    prev.hiddenSeries.length === nextHidden.length &&
    prev.hiddenSeries.every((label, index) => label === nextHidden[index]) &&
    prev.shownSeries.length === nextShown.length &&
    prev.shownSeries.every((label, index) => label === nextShown[index])
  ) {
    return;
  }
  setGroupSnapshot(slug, { ...prev, hiddenSeries: nextHidden, shownSeries: nextShown });
}

/** The shared empty snapshot, for islands that have no enclosing group. */
export function emptyGroupSnapshot(): GroupSnapshot {
  return EMPTY_GROUP;
}

/** Effective visibility after the group override falls back to global state. */
export function groupSeriesIsVisible(
  snapshot: GroupSnapshot,
  label: string,
  global: GlobalFilterSnapshot = globalSnapshot,
): boolean {
  const defaultVisible = seriesPassesFilter(
    snapshot.knownSeries[label],
    global.active,
    global.universe,
  );
  return seriesPassesGroupFilter(snapshot, label, defaultVisible);
}

function setSeriesVisibility(
  snapshot: GroupSnapshot,
  labels: readonly string[],
  visible: boolean,
): Pick<GroupSnapshot, 'hiddenSeries' | 'shownSeries'> {
  const selected = new Set(labels);
  let hiddenSeries = snapshot.hiddenSeries.filter((label) => !selected.has(label));
  let shownSeries = snapshot.shownSeries.filter((label) => !selected.has(label));
  if (visible) {
    shownSeries = [
      ...shownSeries,
      ...labels.filter((label) => {
        const defaultVisible = seriesPassesFilter(
          snapshot.knownSeries[label],
          globalSnapshot.active,
          globalSnapshot.universe,
        );
        return !defaultVisible && !shownSeries.includes(label);
      }),
    ];
  } else {
    hiddenSeries = [...hiddenSeries, ...labels.filter((label) => !hiddenSeries.includes(label))];
  }
  return { hiddenSeries, shownSeries };
}

/** Toggle one series against its effective global-plus-local visibility. */
export function toggleGroupSeries(slug: string, label: string): void {
  const prev = groupStore(slug).snapshot;
  const overrides = setSeriesVisibility(prev, [label], !groupSeriesIsVisible(prev, label));
  setGroupSnapshot(slug, { ...prev, ...overrides });
}

/**
 * Apply an engine/format macro click: find every known series whose tag
 * matches. If every match is currently visible, hide them all; otherwise (any
 * match already hidden) show them all, so the macro chip toggles between "all
 * matching visible" and "all matching hidden".
 */
export function applyGroupMacro(slug: string, dim: 'engine' | 'format', value: string): void {
  const prev = groupStore(slug).snapshot;
  const matching = Object.keys(prev.knownSeries).filter(
    (label) => prev.knownSeries[label]?.[dim] === value,
  );
  if (matching.length === 0) {
    return;
  }
  const allVisible = matching.every((label) => groupSeriesIsVisible(prev, label));
  const overrides = setSeriesVisibility(prev, matching, !allVisible);
  setGroupSnapshot(slug, { ...prev, ...overrides });
}

/** Clear the group's series filter (the `'*'` reset chip). */
export function clearGroupSeriesFilter(slug: string): void {
  const prev = groupStore(slug).snapshot;
  setGroupSnapshot(slug, { ...prev, hiddenSeries: [], shownSeries: [] });
}

/** Set the group-level Y override broadcast to non-sticky charts. */
export function setGroupY(slug: string, y: 'linear' | 'log'): void {
  const prev = groupStore(slug).snapshot;
  setGroupSnapshot(slug, { ...prev, groupY: y });
}

/** Reset the group: empty series filter, no Y override, and empty charts back
 * to hidden (the default). Per-card legend overrides and per-card sticky Y
 * choices are intentionally NOT cleared, matching the v3 reset semantics. */
export function resetGroup(slug: string): void {
  const prev = groupStore(slug).snapshot;
  setGroupSnapshot(slug, {
    ...prev,
    hiddenSeries: [],
    shownSeries: [],
    groupY: null,
    showEmptyCharts: false,
  });
}

/**
 * Record whether one chart's latest-100 window carries any data (idempotent).
 * Called with a [`chartHasRecentData`] verdict wherever a default-window payload
 * lands — the group-bundle prime here in the store, plus the per-chart fetch
 * paths in the chart island — so `emptyCharts` fills in as the group hydrates
 * and the affected cards hide without a layout pass per notification.
 */
export function noteChartRecentData(slug: string, chartSlug: string, hasData: boolean): void {
  const prev = groupStore(slug).snapshot;
  const isEmpty = prev.emptyCharts.includes(chartSlug);
  if (isEmpty === !hasData) {
    return;
  }
  const emptyCharts = hasData
    ? prev.emptyCharts.filter((s) => s !== chartSlug)
    : [...prev.emptyCharts, chartSlug];
  setGroupSnapshot(slug, { ...prev, emptyCharts });
}

/** Set the group toolbar's "show empty charts" toggle. */
export function setShowEmptyCharts(slug: string, show: boolean): void {
  const prev = groupStore(slug).snapshot;
  if (prev.showEmptyCharts === show) {
    return;
  }
  setGroupSnapshot(slug, { ...prev, showEmptyCharts: show });
}

/** Whether a group snapshot currently hides `chartSlug` as an empty card:
 * classified empty in the latest-100 window and not revealed by the toggle. */
export function chartIsHiddenAsEmpty(snapshot: GroupSnapshot, chartSlug: string): boolean {
  return !snapshot.showEmptyCharts && snapshot.emptyCharts.includes(chartSlug);
}

/**
 * Fold a hydrated chart's `series_meta` labels into the group's running set
 * (idempotent), so the group toolbar's series chip row grows as charts in the
 * group hydrate. No-op when every label is already known.
 */
export function noteGroupSeries(slug: string, meta: Record<string, SeriesTag> | undefined): void {
  if (!meta) {
    return;
  }
  const prev = groupStore(slug).snapshot;
  let added = false;
  const knownSeries = { ...prev.knownSeries };
  for (const [label, tag] of Object.entries(meta)) {
    if (!(label in knownSeries)) {
      knownSeries[label] = tag ?? {};
      added = true;
    }
  }
  if (added) {
    setGroupSnapshot(slug, { ...prev, knownSeries });
  }
}
