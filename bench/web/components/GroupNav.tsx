// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useRef, useState } from 'react';
import { ListIcon } from '@/components/icons';

import { openAndScrollTo, syncOpenFragment } from '@/lib/open-groups';

/**
 * A group entry for the jump menu: its display name and the `data-group-slug`
 * carried by its landing-page `<section>` (see [`GroupSection`]).
 */
export interface GroupNavItem {
  name: string;
  slug: string;
}

/**
 * Open and scroll to the landing-page section for `slug`.
 *
 * Finds the group's `<section data-group-slug>` and hands it to
 * [`openAndScrollTo`] (`lib/open-groups.ts`), which opens its
 * `<details class="group-disclosure">` (setting `open` fires the native
 * `toggle` event that mounts the group's body) and scrolls it into view,
 * smoothly unless the visitor prefers reduced motion. Returns `true` when the
 * section was found.
 *
 * Exported so the menu's jump behavior is unit-testable without rendering.
 */
export function jumpToGroup(slug: string, doc: Document = document): boolean {
  const section = Array.from(doc.querySelectorAll<HTMLElement>('[data-group-slug]')).find(
    (el) => el.dataset.groupSlug === slug,
  );
  if (section === undefined) {
    return false;
  }
  openAndScrollTo(section, doc);
  return true;
}

/**
 * A left-side "Jump to group" menu: a fixed toggle button that opens a panel
 * listing every group, each a button that adds that group to the open set: it
 * opens and scrolls to the group's section (via [`jumpToGroup`]), writes the
 * open groups into the URL fragment (`syncOpenFragment`), and then closes the
 * panel. Groups already open stay open.
 *
 * Opening groups from the fragment on load and on `hashchange` is
 * [`LandingState`]'s job, not this menu's.
 *
 * Toggle-driven (not hover) so it works on touch and keyboard, mirroring the
 * header's hamburger nav ([`Header`]): `aria-expanded` / `aria-controls` on the
 * toggle, with outside-click and Escape closing the panel. Renders nothing when
 * there are no groups.
 */
export function GroupNav({ groups }: { groups: GroupNavItem[] }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close on outside click and Escape while open (the header nav's pattern).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (groups.length === 0) {
    return null;
  }

  return (
    <nav className="group-nav" aria-label="Jump to group">
      <button
        className="control-btn group-nav-toggle"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="group-nav-panel"
        ref={toggleRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <ListIcon />
        <span>Groups</span>
      </button>
      <div
        className={`group-nav-panel${open ? ' group-nav-panel--open' : ''}`}
        id="group-nav-panel"
        ref={panelRef}
      >
        <p className="group-nav-heading">Jump to group</p>
        <ul className="group-nav-list">
          {groups.map((group) => (
            <li key={group.slug}>
              <button
                className="group-nav-link"
                type="button"
                onClick={() => {
                  // Write the open set now rather than after the `toggle`
                  // event's delayed write, and also when the group was
                  // already open. One write per jump stays well inside
                  // Safari's replaceState limit. replaceState fires no
                  // `hashchange`, so the jump does not scroll twice.
                  if (jumpToGroup(group.slug)) {
                    syncOpenFragment(window);
                  }
                  setOpen(false);
                }}
              >
                {group.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
