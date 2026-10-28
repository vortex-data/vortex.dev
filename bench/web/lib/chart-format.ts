// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Pure chart helpers shared by the PR-4.4.b client islands, the TypeScript port
 * of the side-effect-free layer of `server/static/chart-init.js`: formatting,
 * the display-unit picker, LTTB downsampling, payload normalization onto the
 * full-history x-axis, visible-range math, and the filter predicates.
 *
 * Everything here is pure (no DOM, no module state), so it is importable from
 * server components, client components, and node-environment vitest alike. The
 * stateful counterparts (fetch queues, filter stores) live in
 * `lib/chart-store.ts`; the Chart.js wiring lives in `components/Chart.tsx`.
 */

import type { ChartHistory, ChartResponse, CommitPoint, SeriesTag, UnitKind } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Constants (ported verbatim from `chart-init.js`).
// ---------------------------------------------------------------------------

/** One frame at ~60fps; throttle for slider drag. */
export const ZOOM_THROTTLE_MS = 16;
/** Pan/zoom rebuild throttle, looser than the slider. */
export const PAN_THROTTLE_MS = 50;
/** The explicit full-history upgrade window (`?n=all`). */
export const FETCH_N = 'all';
/** Initial visible window (last 100 of the fetched commits). */
export const DEFAULT_VISIBLE = 100;
/** The initial per-chart fetch window (`?n=100`). */
export const CHART_FETCH_N = String(DEFAULT_VISIBLE);
/** Per-tab cap for initial latest-100 chart requests. */
export const HYDRATION_CONCURRENCY = 4;
/** Per-tab cap for the per-group bundle fetches (`/api/group/{slug}?n=100`).
 * One in-flight bundle covers a whole group, so the cap bounds how many groups
 * fetch at once on Expand All without serializing the top groups. */
export const BUNDLE_CONCURRENCY = 3;
/** Per-tab cap for background `?n=all` warmup requests. */
export const FULL_HISTORY_CONCURRENCY = 2;
/** Priority for a full-history fetch promoted by direct user interaction. */
export const INTERACTION_FULL_PRIORITY = 1_000_000;
/** A silent hover-dwell prefetch outranks idle background work but yields to a
 * direct user interaction (chip click, pan/zoom into the unloaded region). */
export const HOVER_PREFETCH_PRIORITY = 500_000;
/** How long the pointer must rest on one chart card before the silent
 * full-history prefetch starts, so a mouse sweep across the page fetches
 * nothing while a deliberate hover has data ready by the time the user acts. */
export const HOVER_DWELL_MS = 1000;
/** Per-fetch timeout (ms) for the chart `?n=100` / `?n=all` requests. A stalled
 * request aborts at this bound instead of spinning the loading indicator
 * forever. 30s is generous headroom over a cold Vercel function first-hit
 * (~7.8s measured) so a slow-but-live request is not falsely aborted. */
export const FETCH_TIMEOUT_MS = 30000;
/** `IntersectionObserver` root margin for landing-page lazy hydration: a chart
 * begins hydrating slightly before it scrolls into view so it is rarely blank
 * by the time the user reaches it. */
export const LAZY_HYDRATION_ROOT_MARGIN = '300px 0px';

/**
 * Hard cap on how many distinct commit indices (x-positions) a chart renders at
 * once, shared across every series. Below the cap every commit with data
 * renders raw; above it the per-commit max-across-series is LTTB-downsampled to
 * exactly this many representatives. Chart cards are ~600-900px on desktop and
 * Chart.js draws ~2px markers, so 500 points is about as dense as the eye can
 * resolve.
 */
export const MAX_VISIBLE_POINTS = 500;

// ---------------------------------------------------------------------------
// Palette + small formatting helpers.
// ---------------------------------------------------------------------------

/** The fixed series palette; series are colored by sorted-name index. */
export const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#ea580c',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#65a30d',
  '#475569',
] as const;

/** Color for the `i`-th series (wraps around the palette). */
export function colorFor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

/**
 * Stable per-series colors, keyed by series label. Series are colored by
 * FIRST-SEEN order across the lifetime of a chart rather than by their index
 * within whichever payload is currently loaded.
 *
 * Index-within-payload coloring is unstable across a payload reshape: the
 * `?n=all` upgrade adds series that only ran on older commits (and so are absent
 * from the latest-100 window), and any such series that sorts ahead of an
 * existing one shifts every later series onto the next palette slot. That makes
 * recent points appear to vanish -- a color that was drawing a recent-data
 * series gets reassigned to the newly surfaced, recent-data-less older series.
 *
 * `prev` carries the colors already assigned for this chart; existing names keep
 * their color, and new names (folded in sorted order for determinism) take the
 * next palette slots after them. Returns a NEW map so callers can swap it in
 * wholesale.
 */
export function assignStableColors(
  prev: ReadonlyMap<string, string>,
  names: readonly string[],
): Map<string, string> {
  const next = new Map(prev);
  for (const name of [...names].sort()) {
    if (!next.has(name)) {
      next.set(name, colorFor(next.size));
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Series styling by importance, hand-tuned per `engine:format`. Color carries
// the signal and lines stay solid. The palette is mode-independent: every color
// is chosen to read on both the light (white) and dark card backgrounds, so the
// chart never recolors when the page theme toggles.
//
// The named series are the comparison that matters and get the loud, thick
// lines: Vortex (bright red on datafusion, neon green on duckdb) and Parquet
// (light / dark blue). A notch quieter: vortex-compact (purple) and the duckdb
// native format (gold). Everything else is muted and thin so it recedes and
// never out-shouts the comparison -- lance is neutral slate (it is the least
// important and is hidden by default soon), and `datafusion:arrow` keeps an
// orange where it is still worth reading.
// ---------------------------------------------------------------------------

/** The resolved line style for one series: a color and a width (px). */
export interface SeriesStyle {
  color: string;
  width: number;
}

/** Line widths per importance tier, reinforcing the color hierarchy. */
const HERO_WIDTH = 2.6;
const COMPACT_WIDTH = 1.9;
const SECONDARY_WIDTH = 2.0;
const NATIVE_WIDTH = 1.7;
const MUTED_WIDTH = 1.4;

/** The query series, keyed by `engine:format`, each with a hand-picked color and
 * an importance-tier width. The Vortex hero is the on-disk `vortex-file-compressed`
 * format -- red on datafusion, green on duckdb. The two lance engines carry
 * distinct slate shades so they stay apart. A pair not listed here falls through
 * to the per-format defaults in `FORMAT`. */
const KEYED: Record<string, SeriesStyle> = {
  'datafusion:vortex-file-compressed': { color: '#ef4444', width: HERO_WIDTH }, // bright red
  'duckdb:vortex-file-compressed': { color: '#22c55e', width: HERO_WIDTH }, // neon green
  'datafusion:vortex-compact': { color: '#a855f7', width: COMPACT_WIDTH }, // bright purple
  'duckdb:vortex-compact': { color: '#7e22ce', width: COMPACT_WIDTH }, // deep purple
  'datafusion:parquet': { color: '#38bdf8', width: SECONDARY_WIDTH }, // light blue
  'duckdb:parquet': { color: '#2563eb', width: SECONDARY_WIDTH }, // dark(er) blue
  'duckdb:duckdb': { color: '#eab308', width: NATIVE_WIDTH }, // gold
  'datafusion:lance': { color: '#94a3b8', width: MUTED_WIDTH }, // neutral slate
  'duckdb:lance': { color: '#475569', width: MUTED_WIDTH }, // darker slate
  'datafusion:arrow': { color: '#f97316', width: MUTED_WIDTH }, // orange
};

/** Per-format defaults, used for the engine-less compression-time series and as
 * the fallback for any `engine:format` pair not pinned in `KEYED`. Each format's
 * signature color matches its query-series color (Vortex's datafusion red). */
const FORMAT: Record<string, SeriesStyle> = {
  'vortex-file-compressed': { color: '#ef4444', width: HERO_WIDTH }, // red
  'vortex-compact': { color: '#a855f7', width: COMPACT_WIDTH }, // purple
  parquet: { color: '#38bdf8', width: SECONDARY_WIDTH }, // light blue
  duckdb: { color: '#eab308', width: NATIVE_WIDTH }, // gold
  lance: { color: '#94a3b8', width: MUTED_WIDTH }, // slate
  arrow: { color: '#f97316', width: MUTED_WIDTH }, // orange
  'arrow-ipc': { color: '#f97316', width: MUTED_WIDTH }, // orange
};

/** The catch-all style for an otherwise-unknown series. */
const FALLBACK: SeriesStyle = { color: '#94a3b8', width: MUTED_WIDTH };

/** Resolve a series' `(engine, format)` from its meta, falling back to splitting
 * the `engine:format` label. */
function seriesDims(
  name: string,
  meta: { engine?: string; format?: string } | null | undefined,
): { engine: string | undefined; format: string | undefined } {
  const colon = name.indexOf(':');
  const engine = meta?.engine ?? (colon >= 0 ? name.slice(0, colon) : undefined);
  const format = meta?.format ?? (colon >= 0 ? name.slice(colon + 1) : name);
  return { engine, format };
}

/**
 * The line color and width for a series. The named Vortex / Parquet query series
 * get vivid, thicker lines; everything else is muted and thin. An `engine:format`
 * pin wins first; otherwise the format's signature default applies (which also
 * colors the engine-less compression-time series). Color carries the signal, so
 * lines stay solid and the hierarchy reads at a glance. The palette is
 * mode-independent -- each color reads on both the light and dark card.
 */
export function seriesStyle(
  name: string,
  meta: { engine?: string; format?: string } | null | undefined,
): SeriesStyle {
  const { engine, format } = seriesDims(name, meta);
  const keyed = engine && format ? KEYED[`${engine}:${format}`] : undefined;
  if (keyed) {
    return keyed;
  }
  return (format && FORMAT[format]) || FALLBACK;
}

/** Format draw priority, front (low) to back (high) -- Chart.js renders a lower
 * `order` on top. Vortex sits in front, arrow at the back. */
const FORMAT_ORDER: Record<string, number> = {
  'vortex-file-compressed': 0,
  parquet: 1,
  'vortex-compact': 2,
  duckdb: 3,
  lance: 4,
  arrow: 5,
  'arrow-ipc': 5,
};
const FORMAT_ORDER_FALLBACK = 6;

/** Engine draw priority within a format: datafusion is layered ahead of duckdb. */
const ENGINE_ORDER: Record<string, number> = { datafusion: 0, duckdb: 1 };

/**
 * The Chart.js `order` for a series (lower renders on top). Series are layered by
 * format importance first -- Vortex in front, then Parquet, vortex-compact, the
 * duckdb native format, lance, and arrow at the back -- and within a format
 * datafusion is drawn ahead of duckdb. The format term dominates the engine term
 * so the whole Vortex pair stays in front of the whole Parquet pair.
 */
export function seriesOrder(
  name: string,
  meta: { engine?: string; format?: string } | null | undefined,
): number {
  const { engine, format } = seriesDims(name, meta);
  const formatRank =
    format && format in FORMAT_ORDER ? FORMAT_ORDER[format] : FORMAT_ORDER_FALLBACK;
  const engineRank = engine && engine in ENGINE_ORDER ? ENGINE_ORDER[engine] : 0;
  return formatRank * 10 + engineRank;
}

/**
 * The user-facing display name for a format string. Vortex's on-disk format is
 * stored as `vortex-file-compressed` everywhere in the data (series keys, filter
 * allowlists, `series_meta`), but it is shown to users as plain `vortex`. This is
 * a presentation-only rename: callers pass the real format to the data layer and
 * route it through here ONLY when rendering. All other formats pass through.
 */
export function displayFormat(format: string): string {
  return format === 'vortex-file-compressed' ? 'vortex' : format;
}

/**
 * The display version of a colon-delimited series label (`engine:format` or the
 * compression-time `format:op`), rewriting each segment via [`displayFormat`] so
 * the `vortex-file-compressed` token reads `vortex` wherever it appears while the
 * underlying label (the dataset/override/lookup key) stays unchanged.
 */
export function displaySeriesLabel(label: string): string {
  return label.split(':').map(displayFormat).join(':');
}

/** First 7 characters of a commit SHA. */
export function shortSha(sha: unknown): string {
  return typeof sha === 'string' ? sha.slice(0, 7) : String(sha);
}

/** The `YYYY-MM-DD` prefix of an ISO timestamp, or `''` for non-strings. */
export function shortDate(ts: unknown): string {
  if (typeof ts !== 'string') {
    return '';
  }
  return ts.slice(0, 10);
}

/** Truncate `s` to at most `max` characters, ellipsizing the overflow. */
export function truncate(s: unknown, max: number): string {
  if (typeof s !== 'string') {
    return '';
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Everything before the first newline of `s`, or `''` for non-strings. */
export function firstLine(s: unknown): string {
  if (typeof s !== 'string') {
    return '';
  }
  const nl = s.indexOf('\n');
  return nl >= 0 ? s.slice(0, nl) : s;
}

/**
 * Extract the PR number from a squash-merge subject. Vortex commits to
 * `develop` are squash-merged from PRs and the squash subject ends with
 * `(#NNNN)`; returning just the number lets callers build either a PR or a
 * commit URL.
 */
export function parsePrNumber(message: unknown): string | null {
  if (typeof message !== 'string') {
    return null;
  }
  const m = message.match(/\(#(\d+)\)/);
  return m ? m[1] : null;
}

/**
 * HTML-escape a string for interpolation into tooltip markup. The external
 * tooltip builds `innerHTML` strings (a direct port of `chart-init.js`), so
 * every dynamic value passes through here first.
 */
export function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The x-axis label for one commit slot: the short SHA, or `''` for a virtual
 * (not yet loaded) slot. */
export function labelForCommit(commit: CommitPoint | null | undefined): string {
  return commit && commit.sha ? shortSha(commit.sha) : '';
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The x-axis label for one commit slot as a date, `MMM D, YYYY` (e.g.
 * `Jun 19, 2026`), or `''` for a virtual (not yet loaded) slot. Derived from the
 * ISO timestamp's `YYYY-MM-DD` prefix rather than `new Date(...)` so the label
 * is timezone-stable (no off-by-one-day drift across runtimes), matching the v2
 * frontend's dated x-axis that a reviewer found more readable than raw SHAs.
 */
export function commitDateLabel(commit: CommitPoint | null | undefined): string {
  const ts = commit?.timestamp;
  if (typeof ts !== 'string' || ts.length < 10) {
    return '';
  }
  const [year, month, day] = ts.slice(0, 10).split('-');
  const monthIdx = Number.parseInt(month, 10) - 1;
  const dayNum = Number.parseInt(day, 10);
  if (!(monthIdx >= 0 && monthIdx < 12) || !Number.isFinite(dayNum)) {
    return '';
  }
  return `${MONTH_ABBR[monthIdx]} ${dayNum}, ${year}`;
}

/**
 * The chronologically preceding raw value for a tooltip row's delta, or `null`
 * when no earlier measurement exists. `commits[]` is sorted oldest-first by
 * SQL, so the predecessor of index `idx` lives at `idx - 1` (BAN-pinned: a
 * "fix" flipping this walk to `idx + 1` has been reverted before); the walk
 * continues back across null-valued slots so series that did not run on every
 * commit still get a meaningful baseline.
 */
export function predecessorValue(
  rawData: readonly (number | null | undefined)[],
  idx: number,
): number | null {
  let prevIdx = idx - 1;
  while (prevIdx >= 0) {
    const pv = rawData[prevIdx];
    if (pv !== null && pv !== undefined && !Number.isNaN(pv)) {
      return pv;
    }
    prevIdx -= 1;
  }
  return null;
}

/**
 * The single search param value, or `null` when the param is absent or
 * repeated. Shared by the landing and chart permalink pages for `?engine=`,
 * `?format=`, and `?n=`.
 */
export function singleSearchParam(v: string | string[] | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

/** The short human label for a wire `unit_kind`, ported from the Rust
 * `UnitKind::label` (used by the chart permalink page's meta line). */
export function unitKindLabel(unitKind: UnitKind): string {
  switch (unitKind) {
    case 'time_ns':
      return 'ns';
    case 'bytes':
      return 'bytes';
    case 'ratio':
      return 'ratio';
    case 'count':
      return 'count';
    case 'throughput_mb_s':
      return 'MB/s';
  }
}

// ---------------------------------------------------------------------------
// Display unit picker. The wire payload's `unit_kind` says what the values are
// (`time_ns`, `bytes`, ...); this helper turns that plus the magnitude of the
// loaded values into a `(multiplier, suffix, axisLabel, decimals)` tuple. The
// chart locks that tuple on construction (and again after the lazy `?n=all`
// refetch swaps the payload) so the y-axis stays stable while the user
// pans/zooms; recomputing per-frame would shift the unit out from under them.
// ---------------------------------------------------------------------------

/** A locked display-unit tuple applied to axis ticks and tooltip values. */
export interface DisplayUnit {
  multiplier: number;
  suffix: string;
  axisLabel: string;
  decimals: number;
}

/** The no-scaling fallback for unknown unit kinds. */
export const IDENTITY_UNIT: DisplayUnit = {
  multiplier: 1,
  suffix: '',
  axisLabel: '',
  decimals: 2,
};

/**
 * Median of the finite, nonzero `|v|` in `values`. Zeros and NaNs are not
 * informative for the magnitude pick (a chart with all zeros is not readable
 * anyway), so they are skipped; if every value is filtered out, returns `null`
 * and callers fall back to the kind's smallest display unit.
 */
export function magnitudeReference(values: readonly (number | null | undefined)[]): number | null {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const sample: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
      continue;
    }
    const a = Math.abs(v);
    if (a === 0) {
      continue;
    }
    sample.push(a);
  }
  if (sample.length === 0) {
    return null;
  }
  sample.sort((a, b) => a - b);
  const mid = Math.floor(sample.length / 2);
  return sample.length % 2 ? sample[mid] : (sample[mid - 1] + sample[mid]) / 2;
}

/**
 * Concatenate every series' non-null finite values. The picker works off the
 * merged distribution so a chart with one very fast and one very slow series
 * still picks the unit that keeps the larger magnitudes readable.
 */
export function collectAllValues(payload: Pick<ChartResponse, 'series'> | null): number[] {
  const out: number[] = [];
  const series = payload?.series ?? {};
  for (const arr of Object.values(series)) {
    if (!Array.isArray(arr)) {
      continue;
    }
    for (const v of arr) {
      if (v !== null && v !== undefined && Number.isFinite(v)) {
        out.push(v);
      }
    }
  }
  return out;
}

/** Steps: ns to µs (1e3) to ms (1e6), picked by the median's magnitude so the
 * y-axis tick numbers fit in 1-4 digits. `ms` is the ceiling: a time axis never
 * promotes to seconds, so charts stay comparable in one unit (the v2 frontend's
 * fixed-ms axis, which a reviewer found more readable than auto-seconds). */
function pickTimeUnit(ref: number | null): {
  multiplier: number;
  suffix: string;
  decimals: number;
} {
  if (ref === null || ref < 1e3) {
    return { multiplier: 1, suffix: 'ns', decimals: 0 };
  }
  if (ref < 1e6) {
    return { multiplier: 1e-3, suffix: 'µs', decimals: 2 };
  }
  return { multiplier: 1e-6, suffix: 'ms', decimals: 2 };
}

/** Decimal byte multiples for chart sizes. Steps: B, KB, MB, GB, TB. */
function pickBytesUnit(ref: number | null): {
  multiplier: number;
  suffix: string;
  decimals: number;
} {
  const k = 1_000;
  if (ref === null || ref < k) {
    return { multiplier: 1, suffix: 'B', decimals: 0 };
  }
  if (ref < k * k) {
    return { multiplier: 1 / k, suffix: 'KB', decimals: 2 };
  }
  if (ref < k * k * k) {
    return { multiplier: 1 / (k * k), suffix: 'MB', decimals: 2 };
  }
  if (ref < k * k * k * k) {
    return { multiplier: 1 / (k * k * k), suffix: 'GB', decimals: 2 };
  }
  return { multiplier: 1 / (k * k * k * k), suffix: 'TB', decimals: 2 };
}

/**
 * Pick the display unit for a payload: `unit_kind` selects the family, the
 * magnitude of `values` selects the step within it. Dimensionless kinds
 * (`ratio`, `count`) get no scaling, no suffix, and no axis title, so a
 * "1.2x speedup" axis is not misread via an axis-title-driven label. Unknown
 * kinds (forward-compat with a future server enum) fall back to identity.
 */
export function pickDisplayUnit(
  unitKind: UnitKind | string | undefined,
  values: readonly (number | null | undefined)[],
): DisplayUnit {
  const ref = magnitudeReference(values);
  if (unitKind === 'time_ns') {
    const t = pickTimeUnit(ref);
    return { ...t, axisLabel: `Time (${t.suffix})` };
  }
  if (unitKind === 'bytes') {
    const b = pickBytesUnit(ref);
    return { ...b, axisLabel: `Size (${b.suffix})` };
  }
  if (unitKind === 'throughput_mb_s') {
    return { multiplier: 1, suffix: 'MB/s', axisLabel: 'Throughput (MB/s)', decimals: 2 };
  }
  if (unitKind === 'ratio' || unitKind === 'count') {
    return { multiplier: 1, suffix: '', axisLabel: '', decimals: unitKind === 'count' ? 0 : 2 };
  }
  return IDENTITY_UNIT;
}

/**
 * Tooltip formatter: applies the chart's locked display unit so the tooltip
 * value matches the y-axis tick numbers exactly. Raw `null`/`NaN` collapse to
 * an em dash so a missing data point reads as a clear gap rather than a
 * literal `0`.
 */
export function formatDisplayValue(
  rawValue: number | null | undefined,
  displayUnit: DisplayUnit | null | undefined,
): string {
  if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) {
    return '—';
  }
  const u = displayUnit ?? IDENTITY_UNIT;
  const scaled = rawValue * u.multiplier;
  const text = Number.isFinite(scaled) ? scaled.toFixed(u.decimals) : '—';
  return u.suffix ? `${text} ${u.suffix}` : text;
}

// ---------------------------------------------------------------------------
// Throttle.
// ---------------------------------------------------------------------------

/**
 * Throttle `fn` to at most one call per `ms`; the trailing call is preserved so
 * the final slider position is honored. (`requestAnimationFrame` is
 * conceptually similar but this wants a hard ceiling regardless of when the
 * browser schedules a frame.)
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let lastRan = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A;
  return (...args: A) => {
    const now = Date.now();
    pendingArgs = args;
    if (now - lastRan >= ms) {
      lastRan = now;
      fn(...pendingArgs);
    } else if (!pending) {
      const wait = ms - (now - lastRan);
      pending = setTimeout(() => {
        lastRan = Date.now();
        pending = null;
        fn(...pendingArgs);
      }, wait);
    }
  };
}

// ---------------------------------------------------------------------------
// Range-strip window clamp.
// ---------------------------------------------------------------------------

/**
 * Clamp a requested `[rawMin, rawMax]` visible-commit window to the valid index
 * range `[0, maxIdx]`. A minimum span of one commit is enforced ONLY when the
 * chart has more than one commit; on a single-commit chart (`maxIdx === 0`) the
 * minimum span collapses to zero so the window stays pinned at `[0, 0]` rather
 * than extending one slot past the only label. This mirrors the `n <= 1` guards
 * on the strip's drag and pixel-to-index paths, which the bare-track-click path
 * does not apply before requesting a window.
 */
export function clampRangeWindow(
  maxIdx: number,
  rawMin: number,
  rawMax: number,
): { min: number; max: number } {
  const minRange = Math.min(1, maxIdx);
  const min = Math.max(0, Math.min(maxIdx - minRange, rawMin));
  const max = Math.max(min + minRange, Math.min(maxIdx, rawMax));
  return { min, max };
}

// ---------------------------------------------------------------------------
// LTTB (Largest-Triangle-Three-Buckets) downsampler.
// ---------------------------------------------------------------------------

/**
 * Return the indices into `xs` / `ys` to keep, including index 0 and `n - 1`.
 * `xs` must be strictly increasing. When `threshold >= n` or `threshold < 3`,
 * returns `[0, 1, ..., n - 1]` unchanged.
 *
 * Algorithm: <https://skemman.is/handle/1946/15343>. Per bucket, pick the point
 * that forms the largest triangle with the previously kept point and the
 * average of the next bucket.
 */
export function lttbIndices(
  xs: readonly number[],
  ys: readonly number[],
  threshold: number,
): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) {
    const all = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      all[i] = i;
    }
    return all;
  }
  const out = new Array<number>(threshold);
  out[0] = 0;
  const bucket = (n - 2) / (threshold - 2);
  let a = 0;
  for (let bi = 0; bi < threshold - 2; bi++) {
    // Average of the *next* bucket, the "C" point in the triangle.
    const nextStart = Math.floor((bi + 1) * bucket) + 1;
    const nextEnd = Math.min(n, Math.floor((bi + 2) * bucket) + 1);
    const count = Math.max(1, nextEnd - nextStart);
    let ax = 0;
    let ay = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      ax += xs[j];
      ay += ys[j];
    }
    ax /= count;
    ay /= count;

    // Search this bucket for the point with the largest triangle area against
    // `(a, avg_next)`.
    const rangeStart = Math.floor(bi * bucket) + 1;
    const rangeEnd = Math.floor((bi + 1) * bucket) + 1;
    const pax = xs[a];
    const pay = ys[a];
    let maxArea = -1;
    let maxIdx = rangeStart;
    for (let k = rangeStart; k < rangeEnd; k++) {
      const area = Math.abs((pax - ax) * (ys[k] - pay) - (pax - xs[k]) * (ay - pay)) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = k;
      }
    }
    out[bi + 1] = maxIdx;
    a = maxIdx;
  }
  out[threshold - 1] = n - 1;
  return out;
}

/**
 * Choose which commit indices to render for a set of series over the inclusive
 * visible window `[min, max]`, keeping the total rendered x-positions within
 * `maxPoints`.
 *
 * Each series is downsampled INDEPENDENTLY. The previous approach built one
 * "virtual series" -- the per-commit max across every series -- LTTB'd that, and
 * shared the chosen indices across all series. Those indices tracked whichever
 * series drove the maximum, so a series that never dominated rendered only where
 * the shared indices happened to land on its data; once the window exceeded the
 * cap it could lose every point but the LTTB-pinned last one. Here every series
 * with data in view runs its own LTTB over its own points, and the cap is split
 * across those series so the union of kept indices still stays within
 * `maxPoints`.
 *
 * Returns the kept commit indices and whether any downsampling happened (the
 * latter drives the "downsampled" badge).
 */
export function decimateSeries(
  seriesRawData: readonly ((number | null)[] | undefined)[],
  min: number,
  max: number,
  maxPoints: number,
): { kept: Set<number>; downsampled: boolean } {
  // Gather each series' (index, value) points within the window, plus the set
  // of distinct commit indices carrying data in ANY series.
  const perSeries: { idxs: number[]; vals: number[] }[] = [];
  const distinct = new Set<number>();
  for (const raw of seriesRawData) {
    if (!Array.isArray(raw)) {
      continue;
    }
    const idxs: number[] = [];
    const vals: number[] = [];
    for (let i = min; i <= max; i++) {
      const v = raw[i];
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        idxs.push(i);
        vals.push(v);
        distinct.add(i);
      }
    }
    if (idxs.length > 0) {
      perSeries.push({ idxs, vals });
    }
  }

  const kept = new Set<number>();
  // Below the cap every commit with data renders raw, so no series loses a point.
  if (distinct.size <= maxPoints) {
    for (const idx of distinct) {
      kept.add(idx);
    }
    return { kept, downsampled: false };
  }

  // Split the cap across the series with data so the unioned kept set stays
  // within `maxPoints`; `lttbIndices` always keeps each series' own endpoints.
  const budget = Math.max(2, Math.floor(maxPoints / perSeries.length));
  for (const series of perSeries) {
    for (const local of lttbIndices(series.idxs, series.vals, budget)) {
      kept.add(series.idxs[local]);
    }
  }
  return { kept, downsampled: true };
}

// ---------------------------------------------------------------------------
// Payload normalization onto the full-history x-axis.
// ---------------------------------------------------------------------------

/**
 * A [`ChartResponse`] normalized onto the full-history x-axis: `commits` and
 * every series span `history.total_commits` slots, with `null` placeholders for
 * the virtual (not yet loaded) prefix of a bounded window.
 */
export interface NormalizedChartPayload extends Omit<ChartResponse, 'commits'> {
  history: ChartHistory;
  commits: (CommitPoint | null)[];
}

/**
 * Clamp a payload's `history` into a self-consistent placement: `loaded` and
 * `total` are non-negative integers with `loaded <= total`, `start` fits the
 * loaded window inside the total span, and `complete` is honored from the wire
 * or derived from full coverage.
 */
export function canonicalHistory(
  payload: Pick<ChartResponse, 'commits'> & { history?: Partial<ChartHistory> | null },
): ChartHistory {
  const commits = Array.isArray(payload?.commits) ? payload.commits : [];
  const history = payload?.history ?? {};
  let loaded = Number.isFinite(history.loaded_commits)
    ? (history.loaded_commits as number)
    : commits.length;
  let total = Number.isFinite(history.total_commits)
    ? (history.total_commits as number)
    : commits.length;
  let start = Number.isFinite(history.start_index) ? (history.start_index as number) : 0;
  loaded = Math.max(0, Math.floor(loaded));
  total = Math.max(loaded, Math.floor(total));
  start = Math.max(0, Math.min(Math.floor(start), Math.max(0, total - loaded)));
  return {
    total_commits: total,
    start_index: start,
    loaded_commits: loaded,
    complete: history.complete === true || (start === 0 && loaded === total),
  };
}

/**
 * Normalize a chart payload onto the full-history x-axis: a bounded latest-100
 * window is padded with `null` commit slots and `null` series values so the
 * x-axis spans every commit ever ingested, and panning into the virtual prefix
 * can promote the `?n=all` upgrade. Idempotent without v3's `__bench_normalized`
 * marker: an array that already spans `total_commits` slots (a complete payload
 * or a previously normalized bounded one) takes the fast path unchanged, while
 * a raw bounded payload has `commits.length === loaded_commits < total_commits`
 * and gets padded.
 */
export function normalizeChartPayload(payload: ChartResponse): NormalizedChartPayload {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const history = canonicalHistory(payload);
  if (history.total_commits === commits.length) {
    return { ...payload, history, commits };
  }

  const total = history.total_commits;
  const start = history.start_index;
  const normalizedCommits = new Array<CommitPoint | null>(total).fill(null);
  for (let ci = 0; ci < commits.length && start + ci < total; ci++) {
    normalizedCommits[start + ci] = commits[ci];
  }

  const rawSeries = payload.series ?? {};
  const normalizedSeries: Record<string, (number | null)[]> = {};
  for (const [name, values] of Object.entries(rawSeries)) {
    const out = new Array<number | null>(total).fill(null);
    if (Array.isArray(values)) {
      for (let vi = 0; vi < values.length && start + vi < total; vi++) {
        out[start + vi] = values[vi];
      }
    }
    normalizedSeries[name] = out;
  }

  return { ...payload, history, commits: normalizedCommits, series: normalizedSeries };
}

/** Whether `[min, max]` reaches outside the loaded window of an incomplete
 * payload (the signal to promote the `?n=all` upgrade). */
export function rangeTouchesUnloadedHistory(
  payload: Pick<NormalizedChartPayload, 'history'> | null,
  min: number,
  max: number,
): boolean {
  const history = payload?.history;
  if (!history || history.complete) {
    return false;
  }
  const start = history.start_index || 0;
  const end = start + (history.loaded_commits || 0) - 1;
  return Math.floor(min) < start || Math.ceil(max) > end;
}

// ---------------------------------------------------------------------------
// Visible-range math.
// ---------------------------------------------------------------------------

/** A visible x-range in commit-index space; `undefined` bounds mean "let
 * Chart.js use the full axis". */
export interface VisibleRange {
  min: number | undefined;
  max: number | undefined;
}

/**
 * Resolve the visible `[min, max]` for `scope` visible commits out of
 * `commitCount`. Invariant: when `currentRange` is supplied AND the chart is
 * already panned away from the right edge, a scope change preserves the visible
 * CENTER instead of snapping to the most recent N commits. With no
 * `currentRange` (initial render) or a view that already covers everything or
 * sits flush with the newest commit, anchor to the right, which is the right
 * default at first load and after "show all".
 */
export function visibleRange(
  commitCount: number,
  scope: number | 'all',
  currentRange?: { min: number | undefined; max: number | undefined } | null,
): VisibleRange {
  if (commitCount <= 0) {
    return { min: undefined, max: undefined };
  }
  const maxIdx = commitCount - 1;
  if (scope === 'all' || !Number.isFinite(scope) || scope <= 0 || scope >= commitCount) {
    return { min: 0, max: maxIdx };
  }
  const width = scope;
  const rightAnchored = { min: Math.max(0, maxIdx - (width - 1)), max: maxIdx };
  if (!currentRange) {
    return rightAnchored;
  }
  const curMin = Number.isFinite(currentRange.min) ? (currentRange.min as number) : 0;
  const curMax = Number.isFinite(currentRange.max) ? (currentRange.max as number) : maxIdx;
  const coversAll = curMin <= 0 && curMax >= maxIdx;
  // Half-commit tolerance: pan/zoom can leave fractional drift even when the
  // user is effectively still flush with the newest commit.
  const atRightEdge = curMax >= maxIdx - 0.5;
  if (coversAll || atRightEdge) {
    return rightAnchored;
  }
  const center = (curMin + curMax) / 2;
  const halfWidth = (width - 1) / 2;
  let newMin = Math.round(center - halfWidth);
  let newMax = newMin + (width - 1);
  if (newMin < 0) {
    newMin = 0;
    newMax = width - 1;
  } else if (newMax > maxIdx) {
    newMax = maxIdx;
    newMin = maxIdx - (width - 1);
  }
  return { min: newMin, max: newMax };
}

// ---------------------------------------------------------------------------
// Filter state + predicates.
// ---------------------------------------------------------------------------

/**
 * The distinct engines and formats observed across the fact tables; the chip
 * universe of the global filter bar. Collected server-side by
 * `queries.ts::collectFilterUniverse` and passed to the header as a prop.
 */
export interface FilterUniverse {
  engines: string[];
  formats: string[];
}

/**
 * The active (visible) chip sets of the global filter. Every chip active means
 * no filter is applied; the URL `?engine=`/`?format=` allowlists are translated
 * into active sets against the universe on hydration.
 */
export interface GlobalFilterState {
  engines: string[];
  formats: string[];
}

/**
 * Parse one `?engine=` / `?format=` CSV param into a deduplicated, trimmed
 * allowlist, the TypeScript port of the Axum server's `parse_csv`. Empty
 * entries (e.g. trailing commas) are dropped. An absent parameter returns null
 * for the defaults; a present empty parameter returns an empty active set.
 */
export function parseFilterCsv(raw: string | null | undefined): string[] | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Translate a URL allowlist into the active chip set. A null allowlist uses
 * the defaults, with every engine active. An explicit allowlist
 * is taken verbatim, even if a chip has since been added or removed from the
 * universe, which keeps stale URLs deterministic.
 */
export function seedActiveFromAllowlist(
  allowlist: readonly string[] | null,
  universe: readonly string[],
): string[] {
  return allowlist === null ? [...universe] : [...allowlist];
}

/**
 * Formats hidden by default — visible only when the user explicitly enables
 * them (a format chip or the "all" reset) or pins them via a `?format=` URL.
 * `lance` is excluded by default: its benchmarks run far slower than the other
 * formats, so leaving it on dominates the y-axis and buries the comparison.
 */
export const DEFAULT_HIDDEN_FORMATS: readonly string[] = ['lance'];

/**
 * Seed the active FORMAT chips from a URL allowlist. An explicit allowlist is
 * taken verbatim — so a `?format=` URL can pin a default-hidden format back on
 * — while the no-filter default starts from the universe minus
 * [`DEFAULT_HIDDEN_FORMATS`]. This is the format-aware counterpart of
 * [`seedActiveFromAllowlist`], which the engine dimension still uses directly.
 */
export function seedActiveFormats(
  allowlist: readonly string[] | null,
  universe: readonly string[],
): string[] {
  if (allowlist !== null) {
    return [...allowlist];
  }
  return universe.filter((format) => !DEFAULT_HIDDEN_FORMATS.includes(format));
}

/**
 * Whether a series passes the global filter. A series is hidden when its
 * engine/format dimension has initialized chips and its tag is not in the active
 * set. Series without an engine tag (e.g. compression-time `format:op` series)
 * are unaffected by the engine
 * filter, symmetric for format, so hiding an engine does not nuke charts that
 * have no engine dimension.
 */
export function seriesPassesFilter(
  meta: SeriesTag | undefined,
  active: GlobalFilterState,
  universe: FilterUniverse,
): boolean {
  const m = meta ?? {};
  if (m.engine && universe.engines.length > 0 && !active.engines.includes(m.engine)) {
    return false;
  }
  if (m.format && universe.formats.length > 0 && !active.formats.includes(m.format)) {
    return false;
  }
  return true;
}

/**
 * Resolve a series label against its group-local override. An explicit local
 * show or hide wins; otherwise the caller-provided global default applies.
 */
export function seriesPassesGroupFilter(
  filter: { hiddenSeries: readonly string[]; shownSeries: readonly string[] } | null | undefined,
  label: string,
  defaultVisible = true,
): boolean {
  if (!filter) {
    return defaultVisible;
  }
  if (filter.shownSeries.includes(label)) {
    return true;
  }
  if (filter.hiddenSeries.includes(label)) {
    return false;
  }
  return defaultVisible;
}

/**
 * Whether a chart payload carries at least one real data point inside its most
 * recent `windowSize` commits (default: the [`DEFAULT_VISIBLE`] latest-100
 * window the landing page hydrates from). Only the TRAILING `windowSize` slots
 * of each series are inspected, so the classification is identical whichever
 * payload shape arrives first: a bounded `?n=100` payload (every slot is
 * recent), its normalized null-padded form, and a full `?n=all` history (only
 * the tail counts) all judge the same chart the same way.
 *
 * A chart with NO recent data renders as bare axes on the landing page; the
 * per-group store collects these so the group can hide them by default (the
 * group toolbar's "show empty charts" toggle brings them back).
 */
export function chartHasRecentData(
  payload: Pick<ChartResponse, 'series'>,
  windowSize: number = DEFAULT_VISIBLE,
): boolean {
  const series = payload.series ?? {};
  for (const values of Object.values(series)) {
    if (!Array.isArray(values)) {
      continue;
    }
    const from = Math.max(0, values.length - windowSize);
    for (let i = from; i < values.length; i++) {
      const v = values[i];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        return true;
      }
    }
  }
  return false;
}
