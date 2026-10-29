// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The landing page's open groups, kept in the URL fragment.
 *
 * `details.open` on each group's `<details class="group-disclosure">` is the
 * only source of truth for "open". The fragment mirrors it as a
 * comma-separated list of the readable anchors from `lib/anchor.ts`, in page
 * order: `/#tpc-h-nvme-sf-10,clickbench`. A fragment never reaches the CDN,
 * so `/` keeps one cache entry whatever is open.
 *
 * Writers: every open or close (a summary click, Expand All, Collapse All,
 * the group nav) rewrites the fragment with [`syncOpenFragment`], which uses
 * `history.replaceState`, so a toggle adds no history entry. Readers: the
 * pre-paint script ([`OpenGroupsScript`]) opens the listed groups before the
 * first paint, and [`LandingState`] does the same after hydration (for client
 * navigations, where that script never runs) and on `hashchange`.
 *
 * An old single-anchor permalink (`/#random-access`) is a one-item list, and
 * a fragment carrying the opaque API slug, as the first permalinks did, still
 * resolves to its group. Unknown or malformed tokens are dropped.
 *
 * Every helper takes the document or window it acts on and none uses
 * `instanceof`, so a test can run them against a second JSDOM realm.
 */

/** One group section on the page: its readable anchor (the section `id`) and
 * its opaque API slug (`data-group-slug`). */
export interface GroupRef {
  anchor: string;
  slug: string;
}

const GROUP_SECTIONS = 'section[data-group-slug][id]';
const GROUP_DISCLOSURE = 'details.group-disclosure';

/**
 * Split a URL fragment (`location.hash`, with or without its `#`) into its
 * tokens. It splits on `,` before decoding, so an encoded comma stays inside
 * its token. A token that does not decode (`%E0%A4%A`) is dropped, as are
 * empty tokens and repeats; the first occurrence keeps its place. The work is
 * linear in the fragment's length, however long a crafted link makes it.
 */
export function parseOpenFragment(hash: string): string[] {
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const tokens = new Set<string>();
  for (const raw of body.split(',')) {
    let token: string;
    try {
      token = decodeURIComponent(raw);
    } catch {
      continue;
    }
    if (token !== '') {
      tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * The fragment for a set of open groups: `''` when none is open, otherwise
 * `#` and the anchors joined by `,`. Anchors are `[a-z0-9-]` by construction
 * (`lib/anchor.ts`), so they are written as they are.
 */
export function formatOpenFragment(anchors: readonly string[]): string {
  return anchors.length === 0 ? '' : `#${anchors.join(',')}`;
}

/**
 * Map fragment tokens to the anchors of the groups they name. A token naming
 * an anchor, or a legacy opaque slug, maps to that group's anchor; an anchor
 * match wins. Unknown tokens drop. The result keeps fragment order, without
 * duplicates.
 */
export function resolveOpenAnchors(
  tokens: readonly string[],
  groups: readonly GroupRef[],
): string[] {
  const anchors: string[] = [];
  for (const token of tokens) {
    const group = groups.find((g) => g.anchor === token) ?? groups.find((g) => g.slug === token);
    if (group !== undefined && !anchors.includes(group.anchor)) {
      anchors.push(group.anchor);
    }
  }
  return anchors;
}

function groupSections(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(GROUP_SECTIONS));
}

function groupRef(section: HTMLElement): GroupRef {
  return { anchor: section.id, slug: section.getAttribute('data-group-slug') ?? '' };
}

function disclosureOf(section: HTMLElement): HTMLDetailsElement | null {
  return section.querySelector<HTMLDetailsElement>(GROUP_DISCLOSURE);
}

function openSections(doc: Document): HTMLElement[] {
  return groupSections(doc).filter((section) => disclosureOf(section)?.open === true);
}

/** The group sections (`section[data-group-slug][id]`) in document order. */
export function pageGroups(doc: Document): GroupRef[] {
  return groupSections(doc).map(groupRef);
}

/** The anchors of the open groups, in page order. */
export function openAnchors(doc: Document): string[] {
  return openSections(doc).map((section) => section.id);
}

/** The API slugs of the open groups, in page order. */
export function openGroupSlugs(doc: Document): string[] {
  return openSections(doc).map((section) => groupRef(section).slug);
}

/**
 * Open every group the fragment lists and return their anchors in fragment
 * order. A group that is already open stays as it is, so this is idempotent
 * with the pre-paint script and fires no `toggle` for it.
 */
export function openGroupsFromHash(doc: Document, hash: string): string[] {
  const sections = groupSections(doc);
  const anchors = resolveOpenAnchors(parseOpenFragment(hash), sections.map(groupRef));
  for (const anchor of anchors) {
    const section = sections.find((el) => el.id === anchor);
    const disclosure = section === undefined ? null : disclosureOf(section);
    if (disclosure !== null && !disclosure.open) {
      disclosure.open = true;
    }
  }
  return anchors;
}

/** Scroll a group section to the top of the viewport. The section's
 * `scroll-margin-top` keeps its title clear of the sticky header. Smooth,
 * unless the visitor prefers reduced motion. */
function scrollSectionIntoView(section: HTMLElement, doc: Document): void {
  const reduceMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/**
 * Open a group section's disclosure and scroll the section into view. Setting
 * `open` fires the native `toggle` event, which mounts the group's body.
 */
export function openAndScrollTo(section: HTMLElement, doc: Document): void {
  const disclosure = disclosureOf(section);
  if (disclosure !== null) {
    disclosure.open = true;
  }
  scrollSectionIntoView(section, doc);
}

/**
 * Scroll to the group section whose anchor is `anchor`. It does not open the
 * group. Returns `false` when no group section has that anchor, including an
 * id that belongs to some other element.
 */
export function scrollToGroup(doc: Document, anchor: string): boolean {
  const section = groupSections(doc).find((el) => el.id === anchor);
  if (section === undefined) {
    return false;
  }
  scrollSectionIntoView(section, doc);
  return true;
}

/**
 * Write the open groups into the fragment, keeping the path and the query.
 * It writes with `history.replaceState`, and only when the URL would change.
 * Browsers rate-limit `replaceState` (Safari throws a `SecurityError` past its
 * limit), so a refused write is caught: the groups stay open and the next
 * toggle tries again. A page without group sections is left alone. Returns
 * whether it wrote.
 */
export function syncOpenFragment(win: Window): boolean {
  const doc = win.document;
  if (groupSections(doc).length === 0) {
    return false;
  }
  const { pathname, search, hash } = win.location;
  const target = `${pathname}${search}${formatOpenFragment(openAnchors(doc))}`;
  if (target === `${pathname}${search}${hash}`) {
    return false;
  }
  try {
    win.history.replaceState(null, '', target);
  } catch {
    return false;
  }
  return true;
}

/**
 * Expand All and Collapse All: set `open` on every group disclosure, then
 * write the fragment once. The `toggle` events that follow find the fragment
 * already current and write nothing.
 */
export function setAllGroupsOpen(win: Window, open: boolean): void {
  for (const disclosure of win.document.querySelectorAll<HTMLDetailsElement>(GROUP_DISCLOSURE)) {
    disclosure.open = open;
  }
  syncOpenFragment(win);
}
