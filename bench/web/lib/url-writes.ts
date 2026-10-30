// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Coalesced `history.replaceState` writes of page state into the URL.
 *
 * Two parts of the page keep state in the URL: the landing page's open groups in the fragment
 * (`lib/open-groups.ts`) and the filter bar's chips in the query (`components/FilterBar.tsx`).
 * Each is a *part*: a name and an edit that writes its current state into a `URL`. A part either
 * writes now ([`writeUrlNow`]) or schedules a write ([`scheduleUrlWrite`]), and every write
 * applies all the parts that are pending, in one `replaceState` call, and only when the URL would
 * change.
 *
 * Why: Safari throws a `SecurityError` from a document's 101st `history.replaceState` within 10
 * seconds, and Next.js makes a second call of its own after each of ours (its router re-syncs its
 * history state). Ours is caught; Next's is not, and the App Router then replaces the page with
 * its error page. A write per toggle or chip click reached that limit after about 50 clicks.
 * Scheduled writes are at least [`URL_WRITE_DELAY_MS`] apart, so the page makes at most about 68
 * calls in 10 seconds however fast the clicks come.
 *
 * Every helper takes the window it acts on, so a test can run them against a second JSDOM realm.
 */

/**
 * The shortest time between two scheduled writes, in milliseconds; also how long the last change
 * of a burst waits before its write. At most about three writes a second.
 */
export const URL_WRITE_DELAY_MS = 300;

/** Write a part's current state into `url`. Leave `url` alone to write nothing for the part. */
export type UrlEdit = (url: URL) => void;

/** A part waiting for the next write: its edit, and the URL when it was scheduled. */
interface PendingPart {
  edit: UrlEdit;
  pathname: string;
  hash: string;
  /** Drop the part when the fragment changed after it was scheduled. */
  ownsHash: boolean;
}

interface PendingWrite {
  timer: ReturnType<typeof setTimeout> | null;
  parts: Map<string, PendingPart>;
}

const pendingWrites = new WeakMap<Window, PendingWrite>();
// When this module last called `replaceState`, per window, on the monotonic `performance.now()`
// clock: a wall clock that jumps forward would let two writes come closer than the delay.
const lastWrites = new WeakMap<Window, number>();

function pendingFor(win: Window): PendingWrite {
  let pending = pendingWrites.get(win);
  if (pending === undefined) {
    pending = { timer: null, parts: new Map() };
    pendingWrites.set(win, pending);
  }
  return pending;
}

function addPart(win: Window, name: string, edit: UrlEdit, ownsHash: boolean): void {
  pendingFor(win).parts.set(name, {
    edit,
    pathname: win.location.pathname,
    hash: win.location.hash,
    ownsHash,
  });
}

/**
 * Apply every pending part and write the URL now, cancelling the scheduled write. Returns whether
 * it called `replaceState`.
 *
 * A part whose path changed since it was scheduled is dropped: the page is another route's now (a
 * client navigation that has not unmounted the old page yet). A part that owns the fragment is
 * dropped too when the fragment changed: that fragment is not ours (a link, or one typed into the
 * address bar, whose `hashchange` may not have run yet), and the `hashchange` handler writes the
 * part itself.
 */
function writePending(win: Window): boolean {
  const pending = pendingWrites.get(win);
  if (pending === undefined) {
    return false;
  }
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pendingWrites.delete(win);
  const { pathname, search, hash, href } = win.location;
  const url = new URL(href);
  for (const part of pending.parts.values()) {
    if (part.pathname === pathname && (!part.ownsHash || part.hash === hash)) {
      part.edit(url);
    }
  }
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (target === `${pathname}${search}${hash}`) {
    return false;
  }
  lastWrites.set(win, win.performance.now());
  try {
    win.history.replaceState(null, '', target);
  } catch {
    // Browsers rate-limit `replaceState` (Safari throws a `SecurityError` past its limit). The
    // state stays on the page, and the next write tries again.
    return false;
  }
  return true;
}

/**
 * Write the part `name` now, with any other part that is pending. For a change the reader asked
 * to see in the URL at once (a new fragment, the group nav). Returns whether it wrote.
 */
export function writeUrlNow(win: Window, name: string, edit: UrlEdit): boolean {
  addPart(win, name, edit, false);
  return writePending(win);
}

/**
 * Write the part `name` after a change, at most once per [`URL_WRITE_DELAY_MS`]. After a quiet
 * spell (no write and nothing pending for the delay) it writes at once, so the URL of a page with
 * one change is current at once, ready for a reload. Inside the delay it waits instead, and each
 * call restarts the wait, so the rest of a burst (fast clicks, or Enter held on a button) is one
 * more write, made once the burst stops. Writes are therefore always at least the delay apart.
 *
 * `ownsHash` marks a part that writes the fragment: it is dropped if the fragment changes before
 * the write (see [`flushUrlWrites`]).
 *
 * The URL can therefore lag the page by the delay. Code that reads the URL as page state (the
 * scroll save on leaving the page) calls [`flushUrlWrites`] first.
 */
export function scheduleUrlWrite(
  win: Window,
  name: string,
  edit: UrlEdit,
  { ownsHash = false }: { ownsHash?: boolean } = {},
): void {
  const lastWrite = lastWrites.get(win);
  const quiet =
    !pendingWrites.has(win) &&
    (lastWrite === undefined || win.performance.now() - lastWrite >= URL_WRITE_DELAY_MS);
  addPart(win, name, edit, ownsHash);
  const pending = pendingFor(win);
  if (quiet) {
    writePending(win);
    return;
  }
  if (pending.timer !== null) {
    clearTimeout(pending.timer);
  }
  pending.timer = setTimeout(() => {
    writePending(win);
  }, URL_WRITE_DELAY_MS);
}

/**
 * Make a pending write now, instead of after the delay. Returns whether it wrote; with nothing
 * pending it writes nothing. A part whose path changed since it was scheduled, or that owns the
 * fragment and the fragment changed, is dropped rather than written.
 */
export function flushUrlWrites(win: Window): boolean {
  return writePending(win);
}

/** Drop the pending write of the part `name`, if any, without writing it. */
export function cancelUrlWrite(win: Window, name: string): void {
  const pending = pendingWrites.get(win);
  if (pending === undefined) {
    return;
  }
  pending.parts.delete(name);
  if (pending.parts.size === 0) {
    if (pending.timer !== null) {
      clearTimeout(pending.timer);
    }
    pendingWrites.delete(win);
  }
}

/** Whether the part `name` has a write pending. */
export function urlWritePending(win: Window, name: string): boolean {
  return pendingWrites.get(win)?.parts.has(name) === true;
}

/** Drop every pending write and forget the last write's time. TEST-ONLY: a page load starts with
 * neither. */
export function resetUrlWrites(win: Window): void {
  const pending = pendingWrites.get(win);
  if (pending?.timer != null) {
    clearTimeout(pending.timer);
  }
  pendingWrites.delete(win);
  lastWrites.delete(win);
}
