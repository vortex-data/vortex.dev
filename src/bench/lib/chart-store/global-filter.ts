// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import {
  seedActiveFormats,
  seedActiveFromAllowlist,
  type FilterUniverse,
  type GlobalFilterState,
} from '@/lib/chart-format';

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
