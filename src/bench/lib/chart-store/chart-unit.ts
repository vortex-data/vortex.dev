// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// ---------------------------------------------------------------------------
// The unit each chart's y-axis is drawn in, per chart slug.
// ---------------------------------------------------------------------------

const units = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

/**
 * Record the unit a chart's y-axis is now drawn in (see
 * [`displayUnitLabel`]). The chart sets it when it first draws and again when
 * a wider window changes the unit, so the chart page's meta line names the
 * axis it sits above.
 */
export function setChartUnitLabel(slug: string, label: string): void {
  if (units.get(slug) === label) {
    return;
  }
  units.set(slug, label);
  for (const cb of listeners.get(slug) ?? []) {
    cb();
  }
}

/** The unit a chart last recorded, or `undefined` before it draws. */
export function getChartUnitLabel(slug: string): string | undefined {
  return units.get(slug);
}

/** Subscribe to one chart's unit changes; returns the unsubscribe function. */
export function subscribeChartUnitLabel(slug: string, cb: () => void): () => void {
  let set = listeners.get(slug);
  if (set === undefined) {
    set = new Set();
    listeners.set(slug, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
}
