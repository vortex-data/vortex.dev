// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { GroupBodiesReady } from '@/lib/group-bodies';

/**
 * The landing page's own scroll restoration, by element rather than by pixel.
 *
 * The server never sees the fragment, so an open group's body (its toolbar and
 * chart cards) exists only after hydration, and the browser's own restoration
 * would land against a shorter page. [`LandingState`] therefore sets
 * `history.scrollRestoration = 'manual'` on `/` and does the work here:
 *
 * - **Save.** On `pagehide`, and before a chart link is followed, it records
 *   the element nearest the top of the viewport (a chart card, or else a
 *   group section) and that element's offset from the viewport top, in
 *   `sessionStorage` under the page's path and fragment.
 * - **Plan.** On a reload or a Back/Forward with something saved, restore.
 *   Otherwise scroll to the fragment's first group, if it names one: a fresh
 *   visit always does this, whatever was saved.
 * - **Restore.** Once the open groups' bodies have mounted, scroll the saved
 *   element back to its offset; once their bundles have settled (hiding empty
 *   cards can move it), do it again. Any user input in between stops it.
 *
 * "The same spot" is the same element at the same offset, not the same
 * `scrollY`. Every helper takes the window or document it acts on, uses no
 * `instanceof`, and never throws for blocked or full storage.
 */

/** How the document was loaded, from its navigation timing entry. */
export type NavigationKind = 'navigate' | 'reload' | 'back_forward';

/** An element near the top of the viewport and its offset from the viewport
 * top, in CSS pixels. `slug` is its `data-chart-slug` or `data-group-slug`. */
export interface SavedScroll {
  kind: 'chart' | 'group';
  slug: string;
  offset: number;
}

/** What the landing page does with its scroll on mount. */
export type ScrollPlan =
  | { kind: 'restore'; saved: SavedScroll }
  | { kind: 'fragment' }
  | { kind: 'none' };

// A chart card inside a landing-page group, and a group section.
const CHART_CARDS = '.group-details [data-chart-slug]';
const GROUP_SECTIONS = 'section[data-group-slug]';
const STICKY_HEADER = '.sticky-header';

// Input that means the user has taken over the scroll. Not `scroll`: the
// restorer's own `scrollTo` fires that.
const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/** The `sessionStorage` key for a page's saved position: its path and its
 * fragment (which lists the open groups), not its query. */
export function scrollStorageKey(loc: Pick<Location, 'pathname' | 'hash'>): string {
  return `bench-scroll:${loc.pathname}${loc.hash}`;
}

/**
 * How this page was reached: `performance.getEntriesByType('navigation')`'s
 * `type`. A missing entry, or a type other than `reload` and `back_forward`
 * (`navigate`, `prerender`), counts as `navigate`.
 *
 * The entry describes the document, which a client-side navigation keeps: the
 * chart page's logo link renders `/` inside the chart page's document, whose
 * entry may say `reload`. So an entry counts only when its address (`name`)
 * has the current path; any other entry, or one without a usable address,
 * counts as `navigate`.
 */
export function navigationKind(win: Window): NavigationKind {
  let type: unknown;
  try {
    const entry = win.performance?.getEntriesByType?.('navigation')[0] as
      | { type?: unknown; name?: unknown }
      | undefined;
    if (
      entry === undefined ||
      typeof entry.name !== 'string' ||
      new URL(entry.name).pathname !== win.location.pathname
    ) {
      return 'navigate';
    }
    type = entry.type;
  } catch {
    return 'navigate';
  }
  return type === 'reload' || type === 'back_forward' ? type : 'navigate';
}

function isShown(el: Element): boolean {
  return !el.hasAttribute('hidden');
}

/** The first element matching `selector`, in document order, that names a
 * slug in `attribute`, is shown, has a height, ends below `top` and starts
 * above the viewport's bottom. */
function firstInView(
  doc: Document,
  selector: string,
  attribute: string,
  top: number,
  viewHeight: number,
): { slug: string; rect: DOMRect } | null {
  for (const el of doc.querySelectorAll(selector)) {
    const slug = el.getAttribute(attribute) ?? '';
    if (slug === '' || !isShown(el)) {
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > top && rect.top < viewHeight) {
      return { slug, rect };
    }
  }
  return null;
}

/**
 * The element nearest the top of the viewport, below the sticky header: the
 * first chart card in view, or else the first group section in view, with its
 * offset from the viewport top (rounded; negative when its top is above it).
 * `null` when neither is in view.
 */
export function captureScroll(doc: Document): SavedScroll | null {
  const header = doc.querySelector(STICKY_HEADER);
  const top = header === null ? 0 : header.getBoundingClientRect().bottom;
  const viewHeight = doc.defaultView?.innerHeight ?? 0;
  const chart = firstInView(doc, CHART_CARDS, 'data-chart-slug', top, viewHeight);
  if (chart !== null) {
    return { kind: 'chart', slug: chart.slug, offset: Math.round(chart.rect.top) };
  }
  const group = firstInView(doc, GROUP_SECTIONS, 'data-group-slug', top, viewHeight);
  if (group !== null) {
    return { kind: 'group', slug: group.slug, offset: Math.round(group.rect.top) };
  }
  return null;
}

/**
 * Save a position for this page's path and fragment: `position` when given,
 * otherwise the current one ([`captureScroll`]). With nothing in view, it
 * forgets any earlier position instead, so a later restore never lands
 * somewhere stale. Blocked or full storage saves nothing.
 */
export function saveScroll(win: Window, position?: SavedScroll): void {
  try {
    const key = scrollStorageKey(win.location);
    const saved = position ?? captureScroll(win.document);
    if (saved === null) {
      win.sessionStorage.removeItem(key);
    } else {
      win.sessionStorage.setItem(key, JSON.stringify(saved));
    }
  } catch {
    // Private mode, a blocked origin or a full quota: nothing is saved.
  }
}

function asSavedScroll(value: unknown): SavedScroll | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { kind, slug, offset } = value as Record<string, unknown>;
  if (
    (kind === 'chart' || kind === 'group') &&
    typeof slug === 'string' &&
    slug !== '' &&
    typeof offset === 'number' &&
    Number.isFinite(offset)
  ) {
    return { kind, slug, offset };
  }
  return null;
}

/** The position saved for this page's path and fragment, or `null` when there
 * is none, it does not hold a position, or storage is blocked. */
export function readSavedScroll(win: Window): SavedScroll | null {
  try {
    const raw = win.sessionStorage.getItem(scrollStorageKey(win.location));
    return raw === null ? null : asSavedScroll(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The shown element `saved` names, matched by string equality on its data
 * attribute (never by a selector built from the slug). */
function findSaved(doc: Document, saved: SavedScroll): Element | null {
  const [selector, attribute] =
    saved.kind === 'chart' ? [CHART_CARDS, 'data-chart-slug'] : [GROUP_SECTIONS, 'data-group-slug'];
  for (const el of doc.querySelectorAll(selector)) {
    if (el.getAttribute(attribute) === saved.slug && isShown(el)) {
      return el;
    }
  }
  return null;
}

/** Scroll so the saved element sits at its saved offset again. Returns `false`,
 * and does not scroll, when no shown element matches. */
export function applySavedScroll(win: Window, saved: SavedScroll): boolean {
  const el = findSaved(win.document, saved);
  if (el === null) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  win.scrollTo({ top: win.scrollY + rect.top - saved.offset, behavior: 'instant' });
  return true;
}

/**
 * Choose what the page does with its scroll on mount. A reload or Back/Forward
 * with a saved position restores it. Otherwise, when the fragment names
 * groups, scroll to the first: a fresh visit (which ignores anything saved),
 * or a reload or Back with nothing saved. Otherwise nothing.
 */
export function planScroll(
  nav: NavigationKind,
  saved: SavedScroll | null,
  fragmentNamesGroups: boolean,
): ScrollPlan {
  if (nav !== 'navigate' && saved !== null) {
    return { kind: 'restore', saved };
  }
  return fragmentNamesGroups ? { kind: 'fragment' } : { kind: 'none' };
}

/**
 * Restore `saved` in two passes: once `ready.mounted` resolves (the open
 * groups' cards are in the DOM), and again one animation frame after
 * `ready.settled` (their bundles have settled and empty cards are hidden). If
 * the element is missing on the first pass, it calls `fallback` and stops.
 * User input (`wheel`, `touchstart`, `keydown`, `pointerdown`) stops every
 * later pass. Returns `cancel`, which also stops it and is safe to call twice.
 *
 * Until the first pass, the page shows a position that is not the reader's,
 * and `saved` is still where they were. `onPendingEnd` runs once, when that
 * stops being so: the first pass applied, or it is about to fall back, or the
 * restore stopped (user input or `cancel`) before it.
 */
export function restoreScroll(
  win: Window,
  saved: SavedScroll,
  ready: GroupBodiesReady,
  fallback: () => void,
  onPendingEnd?: () => void,
): () => void {
  let active = true;
  let pending = true;
  let frame: number | null = null;
  const options: AddEventListenerOptions = { capture: true, passive: true };

  const endPending = (): void => {
    if (pending) {
      pending = false;
      onPendingEnd?.();
    }
  };

  const cancel = (): void => {
    if (!active) {
      return;
    }
    active = false;
    endPending();
    for (const type of USER_INPUT) {
      win.removeEventListener(type, cancel, options);
    }
    if (frame !== null) {
      win.cancelAnimationFrame(frame);
      frame = null;
    }
  };

  for (const type of USER_INPUT) {
    win.addEventListener(type, cancel, options);
  }

  void ready.mounted.then(() => {
    if (!active) {
      return;
    }
    if (!applySavedScroll(win, saved)) {
      cancel();
      fallback();
      return;
    }
    endPending();
    void ready.settled.then(() => {
      if (!active) {
        return;
      }
      frame = win.requestAnimationFrame(() => {
        frame = null;
        if (active) {
          applySavedScroll(win, saved);
        }
        cancel();
      });
    });
  });

  return cancel;
}
