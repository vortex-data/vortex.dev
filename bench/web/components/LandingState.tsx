// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect } from 'react';

import { groupBodiesReady } from '@/lib/group-bodies';
import {
  openGroupSlugs,
  openGroupsFromHash,
  scrollToGroup,
  syncOpenFragment,
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
 *   the browser. Writes go through [`syncOpenFragment`], so they never add a
 *   history entry, only happen when the URL would change, and survive a
 *   browser that refuses them.
 * - **Fragment reader.** On mount it opens the groups the fragment lists. The
 *   pre-paint script ([`OpenGroupsScript`]) has usually done so already, and
 *   this is then a no-op; on a client navigation to `/` React never runs that
 *   script, and this opens them. A later `hashchange` (an in-page link, or a
 *   fragment typed into the address bar) opens what it lists, rewrites the
 *   fragment to the whole open set (a group that was already open fires no
 *   `toggle`, so nothing else would) and scrolls to the first listed group.
 * - **Scroll** (`lib/scroll-restore.ts`). While mounted, the page sets
 *   `history.scrollRestoration = 'manual'` and puts the old mode back on
 *   unmount. On `pagehide`, and when a chart link is clicked, it saves the
 *   element nearest the top of the viewport. On mount, [`planScroll`]
 *   chooses: a reload or Back/Forward with a saved position restores that
 *   element to its offset (falling back to the fragment scroll if the element
 *   is gone); otherwise, if the fragment lists groups, it scrolls to the first
 *   one (a fresh visit ignores anything saved); otherwise it leaves the scroll
 *   alone.
 *
 * Both scrolls wait for the open groups' bodies to mount their cards
 * ([`groupBodiesReady`]): the upper groups' cards push a target down as they
 * mount.
 */
export function LandingState(): null {
  useEffect(() => {
    let active = true;
    const { history } = window;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';

    const onToggle = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.matches?.('details.group-disclosure')) {
        syncOpenFragment(window);
      }
    };

    // A reload or Back whose restore has not applied yet still shows the top
    // of the page; leaving now must keep the position it is restoring.
    let pendingRestore: SavedScroll | null = null;

    const onPageHide = (): void => {
      saveScroll(window, pendingRestore ?? undefined);
    };

    // Capturing, so a handler that stops the click cannot skip the save; the
    // link navigates only after the click's dispatch ends.
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Element | null;
      if (target?.closest?.(CHART_LINK)) {
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

    // Read the saved position before anything can rewrite the fragment that
    // keys it.
    const saved = readSavedScroll(window);
    const listed = openGroupsFromHash(document, window.location.hash);
    const ready = groupBodiesReady(openGroupSlugs(document));
    const fragmentScroll = (): void => scrollToGroupAfter(ready.mounted, listed[0]);
    let cancelRestore = (): void => {};
    const plan = planScroll(navigationKind(window), saved, listed.length > 0);
    if (plan.kind === 'restore') {
      pendingRestore = plan.saved;
      cancelRestore = restoreScroll(window, plan.saved, ready, fragmentScroll, () => {
        pendingRestore = null;
      });
    } else if (plan.kind === 'fragment') {
      fragmentScroll();
    }

    // A new fragment is the user's choice: it ends any restore still pending.
    const onHashChange = (): void => {
      cancelRestore();
      const listedNow = openGroupsFromHash(document, window.location.hash);
      syncOpenFragment(window);
      scrollToGroupAfter(groupBodiesReady(openGroupSlugs(document)).mounted, listedNow[0]);
    };

    document.addEventListener('toggle', onToggle, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      active = false;
      cancelRestore();
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('hashchange', onHashChange);
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  return null;
}
