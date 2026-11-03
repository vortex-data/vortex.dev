// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Server-side commit-window cap used by every chart query, the TypeScript port
 * of `server/src/api/window.rs`.
 *
 * Visual downsampling is the client's job; this module only decides how many of
 * the most recent commits (by `commits.timestamp`) a chart loads.
 */

/** Default window when no `?n=` is supplied. */
export const DEFAULT_COMMIT_WINDOW = 100;

/**
 * Largest numeric `?n=` accepted before clamping. `?n=all` remains the explicit
 * opt-in for full history, with no server-side cap.
 */
export const MAX_NUMERIC_COMMIT_WINDOW = 1000;

/**
 * The numeric windows the read paths serve, smallest first. A numeric `?n=`
 * snaps up to the first rung that holds it, so a chart gets at least the
 * commits asked for. Only the default window is read through the Data Cache;
 * every other window is a direct database query that the CDN caches per URL,
 * so without the rungs a client walking `?n=1`, `?n=2`, … `?n=1000` would send
 * a thousand direct queries per chart or group. With them, each has seven
 * window URLs: these six and `all`. Add a rung only with that cost in mind.
 */
export const COMMIT_WINDOW_RUNGS: readonly number[] = [
  25,
  50,
  DEFAULT_COMMIT_WINDOW,
  200,
  500,
  MAX_NUMERIC_COMMIT_WINDOW,
];

/**
 * Resolved commit window. `Last(n)` keeps the most recent `n` commits; `All`
 * returns every commit ever ingested.
 */
export type CommitWindow = { kind: 'all' } | { kind: 'last'; n: number };

/**
 * Parse the `?n=...` query parameter. `null`/`undefined` and malformed values
 * fall back to the default window. `"all"` (any case, surrounding whitespace
 * trimmed) means unbounded. A numeric value snaps up to the first rung of
 * [`COMMIT_WINDOW_RUNGS`] that holds it (so `?n=0` and `?n=1` become `?n=25`,
 * and `?n=150` becomes `?n=200`), and down to [`MAX_NUMERIC_COMMIT_WINDOW`].
 * A value that overflows `u32` (the Rust parse type) is treated as malformed
 * and falls back to the default, matching `window.rs`.
 */
export function parseCommitWindow(raw: string | null | undefined): CommitWindow {
  if (raw === null || raw === undefined) {
    return { kind: 'last', n: DEFAULT_COMMIT_WINDOW };
  }
  const trimmed = raw.trim();
  if (/^all$/i.test(trimmed)) {
    return { kind: 'all' };
  }
  // Rust's `str::parse::<u32>()` accepts an optional leading `+` then ASCII
  // digits, and rejects signs, decimals, and overflow. Anything it would reject
  // falls back to the default window.
  if (!/^\+?\d+$/.test(trimmed)) {
    return { kind: 'last', n: DEFAULT_COMMIT_WINDOW };
  }
  const value = Number(trimmed);
  const U32_MAX = 4_294_967_295;
  if (value > U32_MAX) {
    return { kind: 'last', n: DEFAULT_COMMIT_WINDOW };
  }
  const rung = COMMIT_WINDOW_RUNGS.find((r) => r >= value) ?? MAX_NUMERIC_COMMIT_WINDOW;
  return { kind: 'last', n: rung };
}

/**
 * The `LIMIT` value for the most-recent-commits subquery, or `null` for an
 * unbounded `All` window (no `LIMIT` clause). Mirrors `window.rs::limit_param`.
 */
export function commitWindowLimit(window: CommitWindow): number | null {
  return window.kind === 'all' ? null : window.n;
}

/** The canonical `?n=` spelling of a window: `all`, or the rung it snapped to. */
export function windowParam(window: CommitWindow): string {
  return window.kind === 'all' ? 'all' : String(window.n);
}

/**
 * The canonical query string for a request whose `?n=` selects a window other
 * than the default, or `null` when no redirect is needed.
 *
 * Only the default window is read through the Data Cache; every other window
 * is a direct database query, and the CDN caches it per full URL. Without
 * this, a client could add a new parameter (`?n=all&x=1`, `&x=2`, …) or spell
 * `n` another way (`?n=+0500`) on each request, miss the CDN every time, and
 * send each request to the database. Redirecting to one URL per window and
 * page keeps those requests on the CDN.
 *
 * The canonical form keeps the `allowed` parameters in the order of `allowed`,
 * the first value of each, with `n` spelled by [`windowParam`] and every other
 * value passed through `normalize`, which drops the parameter by returning
 * `null`; it drops every other parameter. The order is fixed because the CDN's
 * key depends on it: on 2026-11-03, `?n=654&engine=a` and `?engine=a&n=654`
 * were two entries. The key does not depend on empty separators or on
 * percent-encoding (`?n=184&&`, `?&n=184` and `?n=%3184` hit the entry for
 * `?n=184`), so comparing parsed queries is enough. A request with the default
 * window returns `null`, whatever else its query holds: it costs no direct
 * query.
 */
export function canonicalWindowQuery(
  search: URLSearchParams,
  allowed: readonly string[],
  normalize: (name: string, value: string) => string | null = (_name, value) => value,
): string | null {
  const window = parseCommitWindow(search.get('n'));
  if (window.kind === 'last' && window.n === DEFAULT_COMMIT_WINDOW) {
    return null;
  }
  const canonical = new URLSearchParams();
  for (const name of allowed) {
    const value = search.get(name);
    const kept =
      value === null ? null : name === 'n' ? windowParam(window) : normalize(name, value);
    if (kept !== null) {
      canonical.set(name, kept);
    }
  }
  const query = canonical.toString();
  return query === search.toString() ? null : query;
}
