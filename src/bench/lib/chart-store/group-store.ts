// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { seriesPassesFilter, seriesPassesGroupFilter } from '@/bench/lib/chart-format';
import type { GroupFilterChoices } from '@/bench/lib/group-filter';
import type { SeriesTag } from '@/bench/lib/queries';

import { getGlobalFilterSnapshot, type GlobalFilterSnapshot } from './global-filter';

// ---------------------------------------------------------------------------
// Per-group stores (ported from chart-init.js section 17's section-node state).
// ---------------------------------------------------------------------------

/**
 * One group's override state plus the series labels its charts have surfaced.
 *
 * The group's filter dropdown has three rows, and each keeps its own choices,
 * so each row's "all" chip clears only its own: the Engine row's in
 * `hiddenEngines` and `shownEngines`, the Format row's in `hiddenFormats` and
 * `shownFormats`, and the Series row's in `hiddenSeries` and `shownSeries`. A
 * series choice wins over an engine or format choice, which wins over the
 * global filter. A hidden engine or format wins over a shown one.
 */
export interface GroupSnapshot {
  /** Dataset labels the user has toggled off in the Series row. */
  hiddenSeries: string[];
  /** Dataset labels explicitly restored over an engine, format or global
   * filter. */
  shownSeries: string[];
  /** Engines the user has turned off in the Engine row. */
  hiddenEngines: string[];
  /** Formats the user has turned off in the Format row. */
  hiddenFormats: string[];
  /** Engines the user has turned on in the Engine row over the global filter. */
  shownEngines: string[];
  /** Formats the user has turned on in the Format row over the global filter. */
  shownFormats: string[];
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
  hiddenEngines: [],
  hiddenFormats: [],
  shownEngines: [],
  shownFormats: [],
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

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Seed one group's filter rows from the current page URL. */
export function initGroupFilter(slug: string, choices: GroupFilterChoices): void {
  const prev = groupStore(slug).snapshot;
  const shownSeries = [...new Set(choices.shownSeries)];
  const hiddenSeries = [...new Set(choices.hiddenSeries)].filter(
    (label) => !shownSeries.includes(label),
  );
  const shownEngines = [...new Set(choices.shownEngines)];
  const shownFormats = [...new Set(choices.shownFormats)];
  const hiddenEngines = [...new Set(choices.hiddenEngines)].filter(
    (value) => !shownEngines.includes(value),
  );
  const hiddenFormats = [...new Set(choices.hiddenFormats)].filter(
    (value) => !shownFormats.includes(value),
  );
  const next = {
    hiddenSeries,
    shownSeries,
    hiddenEngines,
    hiddenFormats,
    shownEngines,
    shownFormats,
  };
  if ((Object.keys(next) as (keyof typeof next)[]).every((key) => sameList(prev[key], next[key]))) {
    return;
  }
  setGroupSnapshot(slug, { ...prev, ...next });
}

/** The shared empty snapshot, for islands that have no enclosing group. */
export function emptyGroupSnapshot(): GroupSnapshot {
  return EMPTY_GROUP;
}

/** A series' engine and format, as a chart dataset or the group store holds them. */
type Tag = { engine?: string | undefined; format?: string | undefined } | undefined;

/** Whether the group's Engine or Format row hides a series with this tag. */
function groupRowsHide(snapshot: GroupSnapshot, tag: Tag): boolean {
  return (
    (tag?.engine !== undefined && snapshot.hiddenEngines.includes(tag.engine)) ||
    (tag?.format !== undefined && snapshot.hiddenFormats.includes(tag.format))
  );
}

/** Whether the group's Engine or Format row shows a series with this tag over
 * the global filter. */
function groupRowsShow(snapshot: GroupSnapshot, tag: Tag): boolean {
  return (
    (tag?.engine !== undefined && snapshot.shownEngines.includes(tag.engine)) ||
    (tag?.format !== undefined && snapshot.shownFormats.includes(tag.format))
  );
}

/**
 * A series' visibility before the Series row's choices: hidden when the
 * group's Engine or Format row hides its tag, shown when one of them shows
 * it, and otherwise as the global filter has it.
 */
export function groupDefaultVisible(
  snapshot: GroupSnapshot,
  tag: Tag,
  global: GlobalFilterSnapshot = getGlobalFilterSnapshot(),
): boolean {
  return (
    !groupRowsHide(snapshot, tag) &&
    (groupRowsShow(snapshot, tag) || seriesPassesFilter(tag, global.active, global.universe))
  );
}

/** Effective visibility: the Series row's choice, else the group's other rows
 * and the global filter. */
export function groupSeriesIsVisible(
  snapshot: GroupSnapshot,
  label: string,
  global: GlobalFilterSnapshot = getGlobalFilterSnapshot(),
): boolean {
  return seriesPassesGroupFilter(
    snapshot,
    label,
    groupDefaultVisible(snapshot, snapshot.knownSeries[label], global),
  );
}

/** The known series whose `dim` tag is `value`. */
function seriesMatching(
  snapshot: GroupSnapshot,
  dim: 'engine' | 'format',
  value: string,
): string[] {
  return Object.keys(snapshot.knownSeries).filter(
    (label) => snapshot.knownSeries[label]?.[dim] === value,
  );
}

/**
 * Whether an Engine or Format chip is on: its row does not hide it, and at
 * least one series it covers shows when the other row hides nothing. It reads
 * its own row only, so turning a format off leaves every engine chip on, even
 * an engine whose every series has that format.
 */
export function groupMacroIsActive(
  snapshot: GroupSnapshot,
  dim: 'engine' | 'format',
  value: string,
  global: GlobalFilterSnapshot = getGlobalFilterSnapshot(),
): boolean {
  const hidden = dim === 'engine' ? snapshot.hiddenEngines : snapshot.hiddenFormats;
  if (hidden.includes(value)) {
    return false;
  }
  const ownRow: GroupSnapshot =
    dim === 'engine'
      ? { ...snapshot, hiddenFormats: [], shownFormats: [] }
      : { ...snapshot, hiddenEngines: [], shownEngines: [] };
  return seriesMatching(snapshot, dim, value).some((label) =>
    groupSeriesIsVisible(ownRow, label, global),
  );
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
      ...labels.filter(
        (label) =>
          !groupDefaultVisible(snapshot, snapshot.knownSeries[label]) &&
          !shownSeries.includes(label),
      ),
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
 * Apply an Engine or Format chip click. A chip that is on (see
 * [`groupMacroIsActive`]) turns off: its row hides the engine or format. A
 * chip that is off turns on: its row stops hiding it, and shows it over the
 * global filter when the global filter hides a series it covers. The row keeps
 * the engine or format itself, so the choice also applies to the series of
 * charts that load later. Either way the click replaces the Series row's
 * choices for the series the chip covers. A chip that covers no known series
 * is inert.
 */
export function applyGroupMacro(slug: string, dim: 'engine' | 'format', value: string): void {
  const prev = groupStore(slug).snapshot;
  const matching = seriesMatching(prev, dim, value);
  if (matching.length === 0) {
    return;
  }
  const hiddenKey = dim === 'engine' ? 'hiddenEngines' : 'hiddenFormats';
  const shownKey = dim === 'engine' ? 'shownEngines' : 'shownFormats';
  const turnOff = groupMacroIsActive(prev, dim, value);
  const covered = new Set(matching);
  const without = (list: string[]) => list.filter((v) => v !== value);
  const global = getGlobalFilterSnapshot();
  const globalHidesOne = matching.some(
    (label) => !seriesPassesFilter(prev.knownSeries[label], global.active, global.universe),
  );
  setGroupSnapshot(slug, {
    ...prev,
    hiddenSeries: prev.hiddenSeries.filter((label) => !covered.has(label)),
    shownSeries: prev.shownSeries.filter((label) => !covered.has(label)),
    [hiddenKey]: turnOff ? [...without(prev[hiddenKey]), value] : without(prev[hiddenKey]),
    [shownKey]:
      !turnOff && globalHidesOne ? [...without(prev[shownKey]), value] : without(prev[shownKey]),
  });
}

/**
 * Clear one row of the group's filter (that row's `'*'` "all" chip): the
 * Engine row's engines, the Format row's formats, or the Series row's series
 * choices. The other rows keep theirs, and the global filter still applies.
 */
export function clearGroupFilterRow(slug: string, row: 'engine' | 'format' | 'series'): void {
  const prev = groupStore(slug).snapshot;
  switch (row) {
    case 'engine':
      setGroupSnapshot(slug, { ...prev, hiddenEngines: [], shownEngines: [] });
      return;
    case 'format':
      setGroupSnapshot(slug, { ...prev, hiddenFormats: [], shownFormats: [] });
      return;
    case 'series':
      setGroupSnapshot(slug, { ...prev, hiddenSeries: [], shownSeries: [] });
      return;
  }
}

/** Set the group-level Y override broadcast to non-sticky charts. */
export function setGroupY(slug: string, y: 'linear' | 'log'): void {
  const prev = groupStore(slug).snapshot;
  setGroupSnapshot(slug, { ...prev, groupY: y });
}

/** Reset the group: an empty filter in every row, no Y override, and empty charts back
 * to hidden (the default). Per-card legend overrides and per-card sticky Y
 * choices are intentionally NOT cleared, matching the v3 reset semantics. */
export function resetGroup(slug: string): void {
  const prev = groupStore(slug).snapshot;
  setGroupSnapshot(slug, {
    ...prev,
    hiddenSeries: [],
    shownSeries: [],
    hiddenEngines: [],
    hiddenFormats: [],
    shownEngines: [],
    shownFormats: [],
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
