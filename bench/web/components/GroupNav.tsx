// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A group entry for the jump menu: its display name, the `data-group-slug`
 * carried by its landing-page `<section>` (see [`GroupSection`]), and the
 * readable permalink anchor (`lib/anchor.ts`) that section carries as its
 * `id` — mirrored into the address bar when the entry is clicked.
 */
export interface GroupNavItem {
  name: string;
  slug: string;
  anchor: string;
}

/**
 * Expand and scroll the landing-page section for `slug` into view.
 *
 * Finds the group's `<section data-group-slug>`, opens its
 * `<details class="group-disclosure">` so the charts hydrate (setting `open`
 * fires the native `toggle` event the chart islands listen for), and
 * smooth-scrolls it into view; the section's `scroll-margin-top` keeps the
 * title clear of the sticky header. Smooth scrolling is skipped under
 * `prefers-reduced-motion`. Returns `true` when the section was found.
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
  expandAndScroll(section, doc);
  return true;
}

/** Open a group section's disclosure and scroll it into view (the shared tail
 * of [`jumpToGroup`] and [`jumpToLocationHash`]). */
function expandAndScroll(section: HTMLElement, doc: Document): void {
  const disclosure = section.querySelector<HTMLDetailsElement>('details.group-disclosure');
  if (disclosure !== null) {
    disclosure.open = true;
  }
  const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/**
 * Expand and scroll to the group named by the window's URL fragment, if any.
 *
 * This is the landing half of the group-permalink flow: [`GroupPermalink`]
 * copies `/#<anchor>` (percent-encoded, decoded symmetrically here), and this
 * turns that fragment back into an opened, scrolled-to group — the browser's
 * native anchor scroll cannot open the `<details>` disclosure on its own.
 *
 * The fragment resolves against the section `id` (the readable anchor from
 * `lib/anchor.ts`), guarded to group sections so a stray fragment naming some
 * other element's id (e.g. `#group-nav-panel`) is not treated as a group.
 * Fragments carrying the opaque API slug — links copied before anchors became
 * readable — fall back to the [`jumpToGroup`] slug match. An unknown or absent
 * fragment is a no-op.
 *
 * Exported so the fragment handling is unit-testable without rendering.
 */
export function jumpToLocationHash(doc: Document = document): boolean {
  const hash = doc.defaultView?.location.hash ?? '';
  if (!hash.startsWith('#') || hash.length === 1) {
    return false;
  }
  const fragment = decodeURIComponent(hash.slice(1));
  const section = doc.getElementById(fragment);
  if (section !== null && section.dataset.groupSlug !== undefined) {
    expandAndScroll(section, doc);
    return true;
  }
  return jumpToGroup(fragment, doc);
}

/**
 * A left-side "Jump to group" menu: a fixed toggle button that opens a panel
 * listing every group, each a button that expands and scrolls to that group's
 * section (via [`jumpToGroup`]), mirrors the group's permalink anchor into
 * the address bar, and then closes the panel.
 *
 * Also hosts the hash-jump effect: on mount and on every later `hashchange`,
 * [`jumpToLocationHash`] expands and scrolls to the group a `/#<slug>`
 * permalink points at.
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

  // Land group permalinks: expand and scroll to the fragment's group on mount
  // (the copied-link entry path) and on later `hashchange` (back/forward
  // between fragments, or an in-page anchor click).
  useEffect(() => {
    jumpToLocationHash();
    const onHashChange = (): void => {
      jumpToLocationHash();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
                  // Mirror the group's anchor into the address bar so a jump
                  // leaves a shareable URL, exactly like the header copy-link
                  // button. replaceState (not `location.hash =`) avoids firing
                  // `hashchange`, which would re-trigger the hash-jump effect
                  // and double-scroll.
                  if (jumpToGroup(group.slug)) {
                    window.history.replaceState(null, '', `#${encodeURIComponent(group.anchor)}`);
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

/** A list/menu glyph for the toggle, matching the header icons' stroke style. */
function ListIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}
