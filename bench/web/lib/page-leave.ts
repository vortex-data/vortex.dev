// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Fetch failures caused by leaving the page.
 *
 * Leaving the page (Back from a chart page, a link, a reload) cancels its in-flight fetches.
 * WebKit rejects each one with a `TypeError` ("Load failed") as the navigation starts, before the
 * page's `pagehide`; Firefox rejects with an `AbortError` that no `AbortController` of ours
 * raised. A real network failure is a `TypeError` too, so the error alone does not tell them
 * apart. [`unlessPageLeft`] therefore holds such a failure for [`PAGE_LEAVE_GRACE_MS`]: if the
 * page fires `pagehide` meanwhile, or already has, the failure is dropped quietly, and only a
 * page restored from the back/forward cache (`pageshow`) reports it, because that page did lose
 * the data. Any other failure (an HTTP status, a timeout, a bad body) reports at once.
 *
 * Only `pagehide` and `pageshow` are watched: a `beforeunload` listener would keep Firefox from
 * putting the page in its back/forward cache.
 */

/** How long a network failure waits for the page to start unloading before it counts. */
export const PAGE_LEAVE_GRACE_MS = 1000;

interface LeaveWatch {
  /** `pagehide` fired, and no `pageshow` since. */
  left: boolean;
  onHide: Set<() => void>;
  onShow: Set<() => void>;
}

const watches = new WeakMap<Window, LeaveWatch>();

function runAll(callbacks: Set<() => void>): void {
  const pending = [...callbacks];
  callbacks.clear();
  for (const callback of pending) {
    callback();
  }
}

function leaveWatch(win: Window): LeaveWatch {
  let watch = watches.get(win);
  if (watch === undefined) {
    const created: LeaveWatch = { left: false, onHide: new Set(), onShow: new Set() };
    win.addEventListener('pagehide', () => {
      created.left = true;
      runAll(created.onHide);
    });
    win.addEventListener('pageshow', () => {
      created.left = false;
      runAll(created.onShow);
    });
    watches.set(win, created);
    watch = created;
  }
  return watch;
}

/** Start watching `win` for `pagehide` and `pageshow`, once per window. The module does this for
 * the page's window when it loads, so a `pagehide` before the first failure is not missed. */
export function watchPageLeave(win: Window): void {
  leaveWatch(win);
}

if (typeof window !== 'undefined') {
  watchPageLeave(window);
}

/** Whether `error` is how a browser fails a fetch that leaving the page cancelled. */
function mayBeFromLeaving(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

/**
 * Report a fetch failure with `report`, unless leaving the page caused it. A failure that cannot
 * come from leaving the page reports at once, and this returns what `report` returns. Otherwise
 * it returns a promise: it reports after [`PAGE_LEAVE_GRACE_MS`] if the page has not started to
 * unload by then; if it has, it reports only when the page is shown again from the back/forward
 * cache, which for a page that unloads is never. The caller checks in `report` that the failure
 * still matters (the island may be gone, or a newer fetch running).
 */
export function unlessPageLeft<T>(
  error: unknown,
  report: () => T,
  win: Window | undefined = typeof window === 'undefined' ? undefined : window,
): T | Promise<T> {
  if (win === undefined || !mayBeFromLeaving(error)) {
    return report();
  }
  const watch = leaveWatch(win);
  return new Promise<T>((resolve, reject) => {
    const settle = (): void => {
      try {
        resolve(report());
      } catch (reportError) {
        reject(reportError);
      }
    };
    if (watch.left) {
      watch.onShow.add(settle);
      return;
    }
    const onHide = (): void => {
      clearTimeout(timer);
      watch.onShow.add(settle);
    };
    const timer = setTimeout(() => {
      watch.onHide.delete(onHide);
      settle();
    }, PAGE_LEAVE_GRACE_MS);
    watch.onHide.add(onHide);
  });
}
