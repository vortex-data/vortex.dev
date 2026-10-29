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

/**
 * The landing page's client coordinator for state that lives in the URL. It
 * renders nothing.
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
 *   script, and this opens them. Once the open groups' bodies have mounted
 *   their cards, it scrolls to the first group the fragment lists, as the old
 *   single-anchor permalink did. A later `hashchange` (an in-page link, or a
 *   fragment typed into the address bar) does the same.
 *
 * Waiting for the bodies matters when the fragment lists a group below
 * another one it lists: the upper group's cards push the target down as they
 * mount.
 */
export function LandingState(): null {
  useEffect(() => {
    let active = true;

    const onToggle = (event: Event): void => {
      const target = event.target as Element | null;
      if (target?.matches?.('details.group-disclosure')) {
        syncOpenFragment(window);
      }
    };

    // Open what the fragment lists, then scroll to the first listed group once
    // every open group's body is in the DOM.
    const openFromFragment = (): void => {
      const listed = openGroupsFromHash(document, window.location.hash);
      const first = listed[0];
      if (first === undefined) {
        return;
      }
      void groupBodiesReady(openGroupSlugs(document)).mounted.then(() => {
        if (active) {
          scrollToGroup(document, first);
        }
      });
    };

    document.addEventListener('toggle', onToggle, true);
    window.addEventListener('hashchange', openFromFragment);
    openFromFragment();
    return () => {
      active = false;
      document.removeEventListener('toggle', onToggle, true);
      window.removeEventListener('hashchange', openFromFragment);
    };
  }, []);

  return null;
}
