// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { initGroupFilter } from '@/lib/chart-store';

/**
 * Page-load bookkeeping for the landing page's group bodies ([`GroupBody`]).
 * A group's body mounts its toolbar and chart cards only while the group is
 * open, so code that needs the open groups' cards in the DOM (the scroll
 * restorer) waits here for them, and the URL's per-group series overrides are
 * seeded only once per page load, however often a body remounts.
 *
 * Module scope, like `lib/chart-store`: one instance per browser tab. No DOM
 * dependency, so node-environment vitest can exercise it directly.
 */

/** Two waits for a set of groups, from [`groupBodiesReady`]. */
export interface GroupBodiesReady {
  /** Resolves once every listed group's body has mounted its cards. */
  mounted: Promise<void>;
  /** Resolves after `mounted`, once each listed group's bundle has settled
   * (empty-card hiding happens then, which can shift the content below). */
  settled: Promise<void>;
}

// The bundle of each group whose body is mounted now. A body that closes or
// unmounts is forgotten ([`noteGroupBodyClosed`]), so a wait that starts after
// it holds for the next mount and that mount's bundle, never a stale one.
const notedBundles = new Map<string, Promise<unknown>>();
// Waits for a group that has not noted yet. Each receives the bundle in a box,
// because resolving with a bare promise would adopt it and wait for the bundle.
const noteWaiters = new Map<string, ((noted: { bundle: Promise<unknown> }) => void)[]>();
// Groups whose URL series overrides have been seeded on this page.
const seededGroups = new Set<string>();

/** Record that `groupSlug`'s body has mounted its cards, with the group's
 * bundle fetch (or the settled result of an earlier one). */
export function noteGroupBodyOpen(groupSlug: string, bundle: Promise<unknown>): void {
  notedBundles.set(groupSlug, bundle);
  const waiters = noteWaiters.get(groupSlug);
  noteWaiters.delete(groupSlug);
  for (const resolve of waiters ?? []) {
    resolve({ bundle });
  }
}

/** Record that `groupSlug`'s body has closed or unmounted its cards. A wait
 * that already saw the body keeps its bundle; a later one waits for the next
 * [`noteGroupBodyOpen`]. */
export function noteGroupBodyClosed(groupSlug: string): void {
  notedBundles.delete(groupSlug);
}

function whenNoted(groupSlug: string): Promise<{ bundle: Promise<unknown> }> {
  const bundle = notedBundles.get(groupSlug);
  if (bundle !== undefined) {
    return Promise.resolve({ bundle });
  }
  return new Promise((resolve) => {
    const waiters = noteWaiters.get(groupSlug) ?? [];
    waiters.push(resolve);
    noteWaiters.set(groupSlug, waiters);
  });
}

/**
 * Wait for the bodies of `groupSlugs` to mount, and then for their bundles to
 * settle. A body mounted before this call counts; one that has since closed
 * does not. A failed bundle counts as settled. With no groups, both promises
 * resolve at once.
 */
export function groupBodiesReady(groupSlugs: readonly string[]): GroupBodiesReady {
  const noted = Promise.all(groupSlugs.map(whenNoted));
  const mounted = noted.then(() => undefined);
  const settled = noted
    .then((boxes) => Promise.allSettled(boxes.map((box) => box.bundle)))
    .then(() => undefined);
  return { mounted, settled };
}

/**
 * Seed one group's series overrides from the page URL ([`initGroupFilter`]),
 * the first time per group per page load. A body that closes and reopens, or
 * remounts, must not overwrite what the user has changed since.
 */
export function seedGroupFilterOnce(
  groupSlug: string,
  hiddenSeries: readonly string[],
  shownSeries: readonly string[],
): void {
  if (seededGroups.has(groupSlug)) {
    return;
  }
  seededGroups.add(groupSlug);
  initGroupFilter(groupSlug, hiddenSeries, shownSeries);
}

/** Forget every note, wait and seed. TEST-ONLY: production never resets within
 * a page load. */
export function resetGroupBodies(): void {
  notedBundles.clear();
  noteWaiters.clear();
  seededGroups.clear();
}
