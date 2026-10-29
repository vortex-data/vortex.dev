// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useRef } from 'react';

import { groupBodiesReady } from '@/lib/group-bodies';
import {
  cancelOpenFragmentSync,
  flushOpenFragmentSync,
  listedOpenAnchors,
  openGroupSlugs,
  openGroupsFromHash,
  scheduleOpenFragmentSync,
  scrollToGroup,
  syncOpenFragment,
  takeOpenGroupsBootstrap,
} from '@/lib/open-groups';
import {
  navigationKind,
  planScroll,
  readSavedScroll,
  restoreScroll,
  type SavedScroll,
  saveScroll,
} from '@/lib/scroll-restore';
// A chart card's title link: a full navigation to the chart page.
const CHART_LINK = 'a[href^="/chart/"]';
/**
 * The landing page's client coordinator for state that lives in the URL and
 * for its scroll. It renders nothing.
 *
 * - **Fragment writer.** A capturing `toggle` listener on the document (the
 *   event does not bubble) rewrites the fragment after every group open or
 *   close, whoever caused it: a summary click, Expand All, the group nav or
 *   the browser. It schedules the write ([`scheduleOpenFragmentSync`]), so
 *   writes stay at least 300 ms apart and a burst of toggles is two writes:
 *   Safari refuses more than 100 `replaceState` calls in 10 seconds, and
 *   Next.js adds one call to each of ours. Writes never add a history entry,
 *   only happen when the URL would change, and survive a browser that
 *   refuses them. The scroll save (below) keys a position by the fragment, so
 *   it makes a pending write first (see `saveOnLeave` for the reload case).
 * - **Fragment reader.** On a full page load, the pre-paint script
 *   ([`OpenGroupsScript`]) has opened the groups the fragment lists and left a
 *   marker on the document. The first mount takes it
 *   ([`takeOpenGroupsBootstrap`], once per document) and leaves the groups as
 *   they are: the reader may have opened or closed some before hydration,
 *   with nobody listening for those `toggle` events. It writes the fragment
 *   once from what is open instead. Without the marker (a client navigation
 *   to `/`, where React never runs that script) it opens the listed groups
 *   itself. A later `hashchange` (an in-page link, or a fragment typed into
 *   the address bar) first drops any pending write, so it cannot overwrite
 *   the new fragment, then opens what it lists, rewrites the fragment to the
 *   whole open set (a group that was already open fires no `toggle`, so
 *   nothing else would) and scrolls to the first listed group.
 * - **Scroll** (`lib/scroll-restore.ts`). While mounted, the page sets
 *   `history.scrollRestoration = 'manual'`, and on unmount sets back the mode
 *   it found (the browser's own on a fresh history entry; after a reload or
 *   Back, it may be the `manual` this page left on the entry). On `pagehide`,
 *   when the tab goes hidden (a mobile browser may discard a hidden tab
 *   without a `pagehide`) and when a chart link is clicked, it saves the
 *   element nearest the top of the viewport. On mount, [`planScroll`]
 *   chooses: if the pre-paint script's marker says the reader already
 *   scrolled, touched, clicked or pressed a key, it leaves the scroll alone
 *   (they have taken over); otherwise a reload or Back/Forward with a saved
 *   position restores that element to its offset (falling back to the
 *   fragment scroll if the element is gone); otherwise, if the fragment lists
 *   groups, it scrolls to the first one (a fresh visit ignores anything
 *   saved); otherwise it leaves the scroll alone.
 *
 * Both scrolls wait for the open groups' bodies to mount their cards
 * ([`groupBodiesReady`]): the upper groups' cards push a target down as they
 * mount.
 */
export function LandingState(): null {
  // What the first run of the effect read and opened. Kept here, not redone,
  // so a StrictMode replay sees what the first run saw: the first run may
  // rewrite the fragment, which keys the saved position and orders the listed
  // groups. A later client navigation mounts a new instance and finds no
  // marker.
  const firstRun = useRef<FirstRun | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const { history } = window;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const onToggle = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.matches?.('details.group-disclosure')) {
        scheduleOpenFragmentSync(window);
      }
    };
    // A reload or Back whose restore has not applied yet still shows the top
    // of the page; leaving now must keep the position it is restoring.
    let pendingRestore: SavedScroll | null = null;
    // The saved position is keyed by the fragment. A reload loads the URL as it
    // was when the reload began, before this runs, so save under it first.
    // Then make any pending fragment write and save under that too: a page
    // left another way keeps the write, and Back returns to it.
    const saveOnLeave = (): void => {
      saveScroll(window, pendingRestore ?? undefined);
      if (flushOpenFragmentSync(window)) {
        saveScroll(window, pendingRestore ?? undefined);
      }
    };
    // A hidden tab may be discarded without a `pagehide`, and is reloaded
    // when the reader comes back to it.
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        saveOnLeave();
      }
    };
    // Capturing, so a handler that stops the click cannot skip the save; the
    // link navigates only after the click's dispatch ends.
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest?.(CHART_LINK)) {
        flushOpenFragmentSync(window);
        saveScroll(window);
      }
    };
    // Scroll to `anchor`'s group once `mounted` (the open bodies) resolves.
    const scrollToGroupAfter = (mounted: Promise<void>, anchor: string | undefined): void => {
      if (anchor === undefined) {
        return;
      }
      void mounted.then(() => {
        if (active) {
          scrollToGroup(document, anchor);
        }
      });
    };
    firstRun.current ??= openOnFirstRun();
    const { saved, listed, inputBeforeMount } = firstRun.current;
    const ready = groupBodiesReady(openGroupSlugs(document));
    const fragmentScroll = (): void => scrollToGroupAfter(ready.mounted, listed[0]);
    let cancelRestore = (): void => {};
    const plan = planScroll(navigationKind(window), saved, listed.length > 0, inputBeforeMount);
    if (plan.kind === 'restore') {
      pendingRestore = plan.saved;
      cancelRestore = restoreScroll(window, plan.saved, ready, fragmentScroll, () => {
        pendingRestore = null;
      });
    } else if (plan.kind === 'fragment') {
      fragmentScroll();
    }
    // A new fragment is the user's choice: it ends any restore still pending,
    // and a pending write (of the open set before it) must not overwrite it.
    const onHashChange = (): void => {
      cancelOpenFragmentSync(window);
      cancelRestore();
      const listedNow = openGroupsFromHash(document, window.location.hash);
      syncOpenFragment(window);
      scrollToGroupAfter(groupBodiesReady(openGroupSlugs(document)).mounted, listedNow[0]);
    };
    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', saveOnLeave);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      active = false;
      cancelRestore();
      // Dropped, not made: after an unmount the URL may already be the next
      // page's.
      cancelOpenFragmentSync(window);
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', saveOnLeave);
      window.removeEventListener('hashchange', onHashChange);
      history.scrollRestoration = previousRestoration;
    };
  }, []);
  return null;
}
/** What [`LandingState`]'s first run found: the saved position, the listed
 * groups that are open, and whether the reader moved before hydration. */
interface FirstRun {
  saved: SavedScroll | null;
  listed: string[];
  inputBeforeMount: boolean;
}
/** Take the pre-paint script's marker, read the saved position and open the
 * listed groups (or, after the script, keep what the reader left open and
 * write it to the fragment). */
function openOnFirstRun(): FirstRun {
  const bootstrap = takeOpenGroupsBootstrap(document);
  // Read the saved position before anything can rewrite the fragment that
  // keys it.
  const saved = readSavedScroll(window);
  if (bootstrap === null) {
    return {
      saved,
      listed: openGroupsFromHash(document, window.location.hash),
      inputBeforeMount: false,
    };
  }
  // The script opened the listed groups; what is open now is the reader's.
  const listed = listedOpenAnchors(document, window.location.hash);
  syncOpenFragment(window);
  return { saved, listed, inputBeforeMount: bootstrap.input };
}
