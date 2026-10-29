// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { seriesPassesFilter, seriesPassesGroupFilter } from '@/lib/chart-format';
import type { SeriesTag } from '@/lib/queries';

import { getGlobalFilterSnapshot, type GlobalFilterSnapshot } from './global-filter';

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
  global: GlobalFilterSnapshot = getGlobalFilterSnapshot(),
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
          getGlobalFilterSnapshot().active,
          getGlobalFilterSnapshot().universe,
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
