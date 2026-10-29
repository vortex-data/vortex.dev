// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Read-query assembly: per-chart payloads (the TypeScript port of
 * `server/src/api/charts.rs`) plus group / chart-link discovery and
 * group-charts assembly (the port of `server/src/api/groups.rs`).
 *
 * [`chartPayload`] dispatches on a [`ChartKey`] to one of five collectors, each
 * of which runs the same two-pass shape against its fact table: a seeded-commit
 * pre-pass that resolves the chart's x-axis (every commit in the requested
 * window at or after the earliest commit with a row in the fact table), then a
 * fact-row pass that threads values onto that x-axis through a
 * [`SeriesAccumulator`]. The result is a [`ChartResponse`] with the same wire
 * shape the Axum server emits. [`groupChartPayloads`] builds the same payloads
 * for every chart of one group with two statements, or more in slices of 25
 * charts for large groups.
 *
 * Behaviour-preservation notes (this is a substrate migration, DuckDB ->
 * Postgres):
 *  - Nullable-dim equality (`dataset_variant` / `scale_factor`) is rendered via
 *    [`sargableDimEq`] as `col IS NULL` / `col = $n` per the concrete key's
 *    build-time value, giving the same `NULL == NULL` semantics the DuckDB query
 *    had while staying index-sargable (the earlier `IS NOT DISTINCT FROM` form
 *    was correct but forced a per-dataset full scan at prod scale; PR-5.1.5).
 *  - `BIGINT` value columns (`value_ns`, `value_bytes`) are read `::float8` so
 *    node-postgres returns a JS `number` matching the Rust `value as f64` cast,
 *    rather than the bigint-as-string default.
 *  - `commits.timestamp` is rendered with the same `YYYY-MM-DD HH24:MI:SS+00`
 *    text the DuckDB `CAST(timestamp AS VARCHAR)` produced, so the wire-compat
 *    `commits[].timestamp` field stays byte-identical for the (always
 *    whole-second, UTC) git commit timestamps.
 */

import type { PoolClient } from 'pg';
import { getPool } from './db';
import { randomAccessStorage } from './random-access';
import { groupDescription } from './descriptions';
import type { FilterUniverse } from './chart-format';
import { type ChartKind, compareCodeUnits, FAMILIES, type GroupKind } from './families';
import { chartKeyFromSlug, chartKeyToSlug, groupKeyFromSlug, groupKeyToSlug } from './slug';
import type { ChartKey, GroupKey } from './slug';
import { collectGroupSummary, type Summary } from './summary';
import { commitWindowLimit, type CommitWindow } from './window';

/**
 * Structured y-axis unit taxonomy, the snake_case wire values of the Rust
 * `UnitKind` enum. Only `time_ns` and `bytes` are produced by the five
 * collectors here; the rest exist for wire-shape completeness with `dto.rs`.
 */
export type UnitKind = 'time_ns' | 'bytes' | 'ratio' | 'count' | 'throughput_mb_s';

/** One row of the `commits[]` array on a [`ChartResponse`]. */
export interface CommitPoint {
  sha: string;
  timestamp: string;
  message: string;
  url: string;
}

/** Placement metadata for a possibly bounded chart payload. */
export interface ChartHistory {
  total_commits: number;
  start_index: number;
  loaded_commits: number;
  complete: boolean;
}

/**
 * Engine/format tag for one series. Both fields are optional because not every
 * fact table records both dimensions; serde omits a `None` field, so the TS
 * port leaves the property `undefined` (which `JSON.stringify` drops).
 */
export interface SeriesTag {
  engine?: string;
  format?: string;
}

/**
 * Body of `GET /api/chart/{slug}`: every loaded commit, every series' values
 * aligned to those commits, and per-series engine/format tags.
 *
 * `series_meta` is omitted entirely when no series carries a tag (matching the
 * Rust `skip_serializing_if = "BTreeMap::is_empty"`), e.g. vector-search
 * charts.
 */
export interface ChartResponse {
  display_name: string;
  unit_kind: UnitKind;
  history: ChartHistory;
  commits: CommitPoint[];
  series: Record<string, (number | null)[]>;
  series_meta?: Record<string, SeriesTag>;
}

/**
 * Accumulates positional `$1`, `$2`, … placeholders for a single parameterized
 * query. Mirrors the Rust `Vec<Box<dyn ToSql>>` bind list: callers append a
 * value with [`bind`] and splice the returned placeholder into the SQL text,
 * so nothing is string-concatenated into the query and the bind order is
 * exactly the call order.
 */
class QueryParams {
  readonly values: unknown[] = [];

  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Render a sargable equality predicate for a nullable chart dimension. For a
 * concrete chart key the dimension value is known at build time, so emit
 * `col IS NULL` (null value) or `col = $n` (non-null) rather than the
 * non-sargable `col IS NOT DISTINCT FROM $n`. The two forms are logically
 * identical for a concrete key (`IS NOT DISTINCT FROM NULL` ≡ `IS NULL`; for a
 * non-null value both match exactly that value and exclude NULL rows), but the
 * specialized form lets Postgres seek the composite chart index
 * (`idx_query_measurements_chart` and siblings) past the leading `dataset`
 * column instead of heap-filtering every row in that dataset. This is the
 * read-path-perf fix (PR-5.1.5): at the full prod seed the non-sargable form
 * degraded each chart query to a per-dataset full scan.
 *
 * Binds the value into `params` ONLY in the non-null branch; callers must splice
 * the returned fragment in textual order so the positional placeholders stay
 * consistent with the bind sequence.
 */
function sargableDimEq(params: QueryParams, column: string, value: string | null): string {
  return value === null ? `${column} IS NULL` : `${column} = ${params.bind(value)}`;
}

/**
 * Time-series rows are gathered keyed by series name and threaded onto the
 * seeded commit x-axis, then reshaped into the `commits[] / series{}` response
 * shape. Seeded with the canonical commit window first so commits with zero
 * fact rows still appear on the x-axis (their per-series slot stays `null` and
 * renders as a visible gap), exactly as the Rust accumulator does.
 */
class SeriesAccumulator {
  private commits: CommitPoint[] = [];
  private readonly commitIndex = new Map<string, number>();
  private readonly series = new Map<string, (number | null)[]>();
  private readonly tags = new Map<string, SeriesTag>();

  /** Seed the chart's commit list (oldest-first). Must run before
   * [`record`]/[`tag`] so series allocations are sized correctly. */
  seedCommits(commits: CommitPoint[]): void {
    this.commitIndex.clear();
    commits.forEach((c, i) => {
      this.commitIndex.set(c.sha, i);
    });
    this.commits = commits;
  }

  /** Index of `sha` in the seeded window, or `undefined` if the sha was not
   * part of it (an unseeded row is dropped, not a panic). */
  commitIdx(sha: string): number | undefined {
    return this.commitIndex.get(sha);
  }

  record(seriesKey: string, commitIdx: number, value: number): void {
    const total = this.commits.length;
    let entry = this.series.get(seriesKey);
    if (entry === undefined) {
      entry = new Array<number | null>(total).fill(null);
      this.series.set(seriesKey, entry);
    }
    while (entry.length < total) {
      entry.push(null);
    }
    entry[commitIdx] = value;
  }

  /** Record an engine/format classification for a series. Idempotent: every
   * row of a given series shares the same engine/format by construction. */
  tag(seriesKey: string, engine: string | undefined, format: string | undefined): void {
    if (engine === undefined && format === undefined) {
      return;
    }
    let entry = this.tags.get(seriesKey);
    if (entry === undefined) {
      entry = {};
      this.tags.set(seriesKey, entry);
    }
    if (engine !== undefined) {
      entry.engine = engine;
    }
    if (format !== undefined) {
      entry.format = format;
    }
  }

  finish(displayName: string, unitKind: UnitKind, history: ChartHistory): ChartResponse {
    const total = this.commits.length;
    const series: Record<string, (number | null)[]> = {};
    for (const key of [...this.series.keys()].sort(compareCodeUnits)) {
      const values = this.series.get(key);
      if (values === undefined) {
        continue;
      }
      while (values.length < total) {
        values.push(null);
      }
      series[key] = values;
    }
    const response: ChartResponse = {
      display_name: displayName,
      unit_kind: unitKind,
      history,
      commits: this.commits,
      series,
    };
    if (this.tags.size > 0) {
      const seriesMeta: Record<string, SeriesTag> = {};
      for (const key of [...this.tags.keys()].sort(compareCodeUnits)) {
        const tag = this.tags.get(key);
        if (tag !== undefined) {
          seriesMeta[key] = tag;
        }
      }
      response.series_meta = seriesMeta;
    }
    return response;
  }
}

interface SeededCommits {
  commits: CommitPoint[];
  history: ChartHistory;
}

/** Row shape of the seeded-commit pre-pass. `total_commits` is read `::int` so
 * node-postgres returns a JS number rather than a bigint string. */
type SeededCommitRow = {
  commit_sha: string;
  ts_text: string;
  message: string;
  url: string;
  total_commits: number;
};

/**
 * Resolve a chart's x-axis: every commit in the requested window whose
 * timestamp is at or after the earliest commit with a row in this chart's fact
 * table, oldest-first. An empty list means the fact table has no rows for this
 * chart and the caller returns `null` (404).
 *
 * `buildEarliest` writes the chart-scoped `MIN(timestamp)` subquery, binding
 * its dim parameters into `params` first; the window `LIMIT` bind is appended
 * after, matching the Rust subquery-binds-then-limit order.
 */
async function seededCommitsInWindow(
  buildEarliest: (params: QueryParams) => string,
  window: CommitWindow,
): Promise<SeededCommits> {
  const params = new QueryParams();
  const earliest = buildEarliest(params);
  const limit = commitWindowLimit(window);
  const windowFilter = limit === null ? '' : `WHERE rn > total_commits - ${params.bind(limit)}`;
  const text = `
    WITH eligible AS (
        SELECT c.commit_sha,
               c.timestamp,
               COALESCE(c.message, '') AS message,
               c.url,
               row_number() OVER (ORDER BY c.timestamp ASC, c.commit_sha ASC) AS rn,
               (count(*) OVER ())::int AS total_commits
          FROM commits c
         WHERE c.timestamp >= (${earliest})
    )
    SELECT commit_sha,
           to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS"+00"') AS ts_text,
           message,
           url,
           total_commits
      FROM eligible
     ${windowFilter}
     ORDER BY timestamp ASC, commit_sha ASC
  `;
  const rows = (await getPool().query<SeededCommitRow>(text, params.values)).rows;
  const totalCommits = rows.length > 0 ? rows[0]!.total_commits : 0;
  const commits: CommitPoint[] = rows.map((row) => ({
    sha: row.commit_sha,
    timestamp: row.ts_text,
    message: row.message,
    url: row.url,
  }));
  const loadedCommits = commits.length;
  const startIndex = Math.max(0, totalCommits - loadedCommits);
  return {
    commits,
    history: {
      total_commits: totalCommits,
      start_index: startIndex,
      loaded_commits: loadedCommits,
      complete: loadedCommits === totalCommits,
    },
  };
}

/**
 * Fact-table window filter spliced after a chart query's dim predicates. For a
 * bounded window it restricts `c.commit_sha` to the most recent `n` commits
 * (binding the `LIMIT` last); empty for the unbounded `all` window. Mirrors
 * `CommitWindow::sql_filter` + `push_window_limit`.
 */
function factWindowFilter(params: QueryParams, window: CommitWindow): string {
  const limit = commitWindowLimit(window);
  if (limit === null) {
    return '';
  }
  return (
    ` AND c.commit_sha IN ` +
    `(SELECT commit_sha FROM commits ORDER BY timestamp DESC, commit_sha DESC LIMIT ${params.bind(limit)})`
  );
}

/**
 * Window filter for `query_measurements` charts. Unlike the shared
 * [`factWindowFilter`], this filters on the denormalized, indexed
 * `q.commit_timestamp` so the planner can seek `idx_query_measurements_summary`
 * (`..., commit_timestamp DESC`) instead of scanning the chart's full history and
 * post-filtering by `commit_sha`. The `>= cutoff` predicate (the timestamp of
 * the n-th newest commit) is the sargable lever; the `commit_sha IN (last-n)`
 * clause is kept as an exact tie-trim in case commits share the boundary
 * timestamp, so the result set is identical to [`factWindowFilter`]'s. Empty for
 * the unbounded `all` window. Only `query_measurements` carries
 * `commit_timestamp`, so this helper is not shared with the other collectors.
 */
function queryMeasurementWindowFilter(params: QueryParams, window: CommitWindow): string {
  const limit = commitWindowLimit(window);
  if (limit === null) {
    return '';
  }
  const n = params.bind(limit);
  return (
    ` AND q.commit_timestamp >= ` +
    `(SELECT min(timestamp) FROM ` +
    `(SELECT timestamp FROM commits ORDER BY timestamp DESC, commit_sha DESC LIMIT ${n}) w)` +
    ` AND q.commit_sha IN ` +
    `(SELECT commit_sha FROM commits ORDER BY timestamp DESC, commit_sha DESC LIMIT ${n})`
  );
}

type QueryMeasurementKey = Extract<ChartKey, { k: 'QueryMeasurement' }>;
type CompressionTimeKey = Extract<ChartKey, { k: 'CompressionTime' }>;
type CompressionSizeKey = Extract<ChartKey, { k: 'CompressionSize' }>;
type RandomAccessKey = Extract<ChartKey, { k: 'RandomAccess' }>;
type VectorSearchKey = Extract<ChartKey, { k: 'VectorSearch' }>;

/** Row shape of a fact-table pass; `value` is read `::float8`. */
type ValueRow = { commit_sha: string; value: number };
type QueryRow = ValueRow & { engine: string; format: string };
type CompressionTimeRow = ValueRow & { format: string; op: string };
type FormatRow = ValueRow & { format: string };
type RandomAccessRow = ValueRow & { format: string; open_mode: 'cached' | 'reopen' };
type FlavorRow = ValueRow & { flavor: string };

/** A fact row of any family. Each family fills the columns that name its series. */
export type FactRow = {
  commit_sha: string;
  value: number;
  engine?: string;
  format?: string;
  op?: string;
  open_mode?: 'cached' | 'reopen';
  flavor?: string;
};

/**
 * The series a fact row belongs to, with its engine/format tag. Vector-search
 * series carry neither, so they are never tagged and the chart omits
 * `series_meta`.
 */
export function seriesFor(
  kind: ChartKind,
  row: FactRow,
): { key: string; engine: string | undefined; format: string | undefined } {
  switch (kind) {
    case 'QueryMeasurement':
      return { key: `${row.engine}:${row.format}`, engine: row.engine, format: row.format };
    case 'CompressionTime':
      return { key: `${row.format}:${row.op}`, engine: undefined, format: row.format };
    case 'CompressionSize':
      return { key: `${row.format}`, engine: undefined, format: row.format };
    case 'RandomAccess': {
      const mode = row.open_mode === 'cached' ? 'hot' : 'cold';
      return { key: `${row.format}:${mode}`, engine: undefined, format: row.format };
    }
    case 'VectorSearch':
      return { key: `${row.flavor}`, engine: undefined, format: undefined };
  }
}

/** Thread one fact row onto the seeded x-axis. A row off the seeded commits is dropped. */
function recordRow(acc: SeriesAccumulator, kind: ChartKind, row: FactRow): void {
  const idx = acc.commitIdx(row.commit_sha);
  if (idx === undefined) {
    return;
  }
  const { key, engine, format } = seriesFor(kind, row);
  acc.record(key, idx, row.value);
  acc.tag(key, engine, format);
}

/** A chart's `display_name`, built from its key alone. */
function chartDisplayName(key: ChartKey): string {
  switch (key.k) {
    case 'QueryMeasurement': {
      let name = key.dataset;
      if (key.dataset_variant !== null) {
        name += `/${key.dataset_variant}`;
      }
      if (key.scale_factor !== null) {
        name += ` sf=${key.scale_factor}`;
      }
      return `${name} Q${key.query_idx} [${key.storage}]`;
    }
    case 'CompressionTime':
    case 'CompressionSize':
      return key.dataset_variant === null ? key.dataset : `${key.dataset}/${key.dataset_variant}`;
    case 'RandomAccess':
      return key.dataset;
    case 'VectorSearch':
      return `${key.dataset} / ${key.layout} (threshold=${key.threshold})`;
  }
}

/** A chart's base `unit_kind`: sizes are bytes, everything else is a time. */
function chartUnitKind(key: ChartKey): UnitKind {
  return key.k === 'CompressionSize' ? 'bytes' : 'time_ns';
}

async function collectQueryChart(
  key: QueryMeasurementKey,
  window: CommitWindow,
): Promise<ChartResponse | null> {
  const { dataset, dataset_variant, scale_factor, storage, query_idx } = key;
  // Both the seed `MIN` below and the data-query window filter on `q.commit_timestamp`, the
  // denormalized copy of `commits.timestamp`. Correctness rests on every write path populating
  // it (the migration-006 backfill of pre-existing rows + the ingest upsert's
  // `commit_timestamp = excluded.commit_timestamp`), since a NULL would drop the row from
  // `MIN`/`>=`. That invariant is pinned at the writers, not here; the old `JOIN commits` that
  // masked it is intentionally gone.
  const seeded = await seededCommitsInWindow(
    (p) =>
      `SELECT MIN(q2.commit_timestamp)
         FROM query_measurements q2
        WHERE q2.dataset = ${p.bind(dataset)}
          AND ${sargableDimEq(p, 'q2.dataset_variant', dataset_variant)}
          AND ${sargableDimEq(p, 'q2.scale_factor', scale_factor)}
          AND q2.storage = ${p.bind(storage)}
          AND q2.query_idx = ${p.bind(query_idx)}`,
    window,
  );
  if (seeded.commits.length === 0) {
    return null;
  }
  const acc = new SeriesAccumulator();
  acc.seedCommits(seeded.commits);

  const params = new QueryParams();
  const text = `
    SELECT q.commit_sha,
           q.engine, q.format, q.value_ns::float8 AS value
      FROM query_measurements q
     WHERE q.dataset = ${params.bind(dataset)}
       AND ${sargableDimEq(params, 'q.dataset_variant', dataset_variant)}
       AND ${sargableDimEq(params, 'q.scale_factor', scale_factor)}
       AND q.storage = ${params.bind(storage)}
       AND q.query_idx = ${params.bind(query_idx)}${queryMeasurementWindowFilter(params, window)}
     ORDER BY q.commit_timestamp, q.engine, q.format
  `;
  const rows = (await getPool().query<QueryRow>(text, params.values)).rows;
  for (const row of rows) {
    recordRow(acc, key.k, row);
  }
  return acc.finish(chartDisplayName(key), chartUnitKind(key), seeded.history);
}

async function collectCompressionTimeChart(
  key: CompressionTimeKey,
  window: CommitWindow,
): Promise<ChartResponse | null> {
  const { dataset, dataset_variant } = key;
  const seeded = await seededCommitsInWindow(
    (p) =>
      `SELECT MIN(c2.timestamp)
         FROM compression_times t2
         JOIN commits c2 ON c2.commit_sha = t2.commit_sha
        WHERE t2.dataset = ${p.bind(dataset)}
          AND ${sargableDimEq(p, 't2.dataset_variant', dataset_variant)}`,
    window,
  );
  if (seeded.commits.length === 0) {
    return null;
  }
  const acc = new SeriesAccumulator();
  acc.seedCommits(seeded.commits);

  const params = new QueryParams();
  const text = `
    SELECT t.commit_sha,
           t.format, t.op, t.value_ns::float8 AS value
      FROM compression_times t
      JOIN commits c USING (commit_sha)
     WHERE t.dataset = ${params.bind(dataset)}
       AND ${sargableDimEq(params, 't.dataset_variant', dataset_variant)}${factWindowFilter(params, window)}
     ORDER BY c.timestamp, t.format, t.op
  `;
  const rows = (await getPool().query<CompressionTimeRow>(text, params.values)).rows;
  for (const row of rows) {
    recordRow(acc, key.k, row);
  }
  return acc.finish(chartDisplayName(key), chartUnitKind(key), seeded.history);
}

async function collectCompressionSizeChart(
  key: CompressionSizeKey,
  window: CommitWindow,
): Promise<ChartResponse | null> {
  const { dataset, dataset_variant } = key;
  const seeded = await seededCommitsInWindow(
    (p) =>
      `SELECT MIN(c2.timestamp)
         FROM compression_sizes s2
         JOIN commits c2 ON c2.commit_sha = s2.commit_sha
        WHERE s2.dataset = ${p.bind(dataset)}
          AND ${sargableDimEq(p, 's2.dataset_variant', dataset_variant)}`,
    window,
  );
  if (seeded.commits.length === 0) {
    return null;
  }
  const acc = new SeriesAccumulator();
  acc.seedCommits(seeded.commits);

  const params = new QueryParams();
  const text = `
    SELECT s.commit_sha,
           s.format, s.value_bytes::float8 AS value
      FROM compression_sizes s
      JOIN commits c USING (commit_sha)
     WHERE s.dataset = ${params.bind(dataset)}
       AND ${sargableDimEq(params, 's.dataset_variant', dataset_variant)}${factWindowFilter(params, window)}
     ORDER BY c.timestamp, s.format
  `;
  const rows = (await getPool().query<FormatRow>(text, params.values)).rows;
  for (const row of rows) {
    recordRow(acc, key.k, row);
  }
  return acc.finish(chartDisplayName(key), chartUnitKind(key), seeded.history);
}

async function collectRandomAccessChart(
  key: RandomAccessKey,
  window: CommitWindow,
): Promise<ChartResponse | null> {
  const { dataset } = key;
  const seeded = await seededCommitsInWindow(
    (p) =>
      `SELECT MIN(c2.timestamp)
         FROM random_access_times r2
         JOIN commits c2 ON c2.commit_sha = r2.commit_sha
        WHERE r2.dataset = ${p.bind(dataset)}`,
    window,
  );
  if (seeded.commits.length === 0) {
    return null;
  }
  const acc = new SeriesAccumulator();
  acc.seedCommits(seeded.commits);

  const params = new QueryParams();
  const text = `
    SELECT r.commit_sha,
           r.format,
           r.open_mode AS open_mode,
           r.value_ns::float8 AS value
      FROM random_access_times r
      JOIN commits c USING (commit_sha)
     WHERE r.dataset = ${params.bind(dataset)}${factWindowFilter(params, window)}
     ORDER BY c.timestamp, r.format, open_mode
  `;
  const rows = (await getPool().query<RandomAccessRow>(text, params.values)).rows;
  for (const row of rows) {
    recordRow(acc, key.k, row);
  }
  return acc.finish(chartDisplayName(key), chartUnitKind(key), seeded.history);
}

async function collectVectorSearchChart(
  key: VectorSearchKey,
  window: CommitWindow,
): Promise<ChartResponse | null> {
  const { dataset, layout, threshold } = key;
  const seeded = await seededCommitsInWindow(
    (p) =>
      `SELECT MIN(c2.timestamp)
         FROM vector_search_runs v2
         JOIN commits c2 ON c2.commit_sha = v2.commit_sha
        WHERE v2.dataset = ${p.bind(dataset)}
          AND v2.layout = ${p.bind(layout)}
          AND v2.threshold = ${p.bind(threshold)}`,
    window,
  );
  if (seeded.commits.length === 0) {
    return null;
  }
  const acc = new SeriesAccumulator();
  acc.seedCommits(seeded.commits);

  const params = new QueryParams();
  const text = `
    SELECT v.commit_sha,
           v.flavor, v.value_ns::float8 AS value
      FROM vector_search_runs v
      JOIN commits c USING (commit_sha)
     WHERE v.dataset = ${params.bind(dataset)}
       AND v.layout = ${params.bind(layout)}
       AND v.threshold = ${params.bind(threshold)}${factWindowFilter(params, window)}
     ORDER BY c.timestamp, v.flavor
  `;
  const rows = (await getPool().query<FlavorRow>(text, params.values)).rows;
  for (const row of rows) {
    recordRow(acc, key.k, row);
  }
  return acc.finish(chartDisplayName(key), chartUnitKind(key), seeded.history);
}

/**
 * Build the JSON payload for one chart by key, or `null` when the chart has no
 * data (callers render a 404). The shared implementation behind
 * `GET /api/chart/{slug}`. `window` caps the number of recent commits; the
 * client-side render hints (`y` / `mode`) are not inputs here, so the SQL is
 * unaffected and the payload is identical across hint values.
 *
 * Dispatches on the key discriminant, the TS analogue of the Rust
 * `family_for_chart_key(key).collect_chart_for_key` registry indirection.
 */
export function chartPayload(key: ChartKey, window: CommitWindow): Promise<ChartResponse | null> {
  switch (key.k) {
    case 'QueryMeasurement':
      return collectQueryChart(key, window);
    case 'CompressionTime':
      return collectCompressionTimeChart(key, window);
    case 'CompressionSize':
      return collectCompressionSizeChart(key, window);
    case 'RandomAccess':
      return collectRandomAccessChart(key, window);
    case 'VectorSearch':
      return collectVectorSearchChart(key, window);
  }
}

/**
 * Where a chart's loaded commits sit in its history of `totalCommits` eligible
 * commits: the last `min(n, total)` of them, or all of them for `?n=all`. The
 * same placement [`seededCommitsInWindow`] derives from the rows it returns.
 */
export function historyFor(totalCommits: number, window: CommitWindow): ChartHistory {
  const limit = commitWindowLimit(window);
  const loaded = limit === null ? totalCommits : Math.min(limit, totalCommits);
  return {
    total_commits: totalCommits,
    start_index: Math.max(0, totalCommits - loaded),
    loaded_commits: loaded,
    complete: loaded === totalCommits,
  };
}

type CommitRow = { commit_sha: string; ts_text: string; message: string; url: string };

/**
 * The last `n` commits of all (every commit for `?n=all`), oldest first. Each
 * chart's x-axis is a suffix of this list. A `null` `LIMIT` is no limit. It
 * runs on [`groupChartPayloads`]'s client, inside that build's `REPEATABLE READ`
 * transaction, so it sees the same snapshot as the group's rows statements.
 */
async function windowCommits(client: PoolClient, window: CommitWindow): Promise<CommitPoint[]> {
  const text = `
    SELECT commit_sha,
           to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS"+00"') AS ts_text,
           COALESCE(message, '') AS message,
           url
      FROM (SELECT * FROM commits ORDER BY timestamp DESC, commit_sha DESC LIMIT $1) w
     ORDER BY timestamp ASC, commit_sha ASC
  `;
  const rows = (await client.query<CommitRow>(text, [commitWindowLimit(window)])).rows;
  return rows.map((row) => ({
    sha: row.commit_sha,
    timestamp: row.ts_text,
    message: row.message,
    url: row.url,
  }));
}

/** Whether `key` is one of the charts discovery puts in `group`. */
function chartInGroup(group: GroupKey, key: ChartKey): boolean {
  switch (group.k) {
    case 'QueryGroup':
      return (
        key.k === 'QueryMeasurement' &&
        key.dataset === group.dataset &&
        key.dataset_variant === group.dataset_variant &&
        key.scale_factor === group.scale_factor &&
        key.storage === group.storage
      );
    case 'CompressionTimeGroup':
      return key.k === 'CompressionTime';
    case 'CompressionSizeGroup':
      return key.k === 'CompressionSize';
    case 'RandomAccessGroup':
      return key.k === 'RandomAccess' && randomAccessStorage(key.dataset) === group.storage;
    case 'VectorSearchGroup':
      return (
        key.k === 'VectorSearch' && key.dataset === group.dataset && key.layout === group.layout
      );
  }
}

/** Narrow a group's chart keys to its family. The SQL pins the group's own dimensions, so a key
 * from another group would get the wrong rows; refuse it instead. */
function chartsOf<K extends ChartKind>(
  group: GroupKey,
  charts: readonly ChartKey[],
  kind: K,
): Extract<ChartKey, { k: K }>[] {
  return charts.map((key) => {
    if (key.k !== kind || !chartInGroup(group, key)) {
      throw new Error(`chart ${chartKeyToSlug(key)} is not in group ${groupKeyToSlug(group)}`);
    }
    return key as Extract<ChartKey, { k: K }>;
  });
}

/**
 * The earliest `commit_timestamp` of the query chart `pins` selects (its
 * `query_idx` is `ch.query_idx`): the value of the collector's
 * `MIN(q2.commit_timestamp)`, without reading the chart's whole history.
 *
 * That `MIN` reads every row of the chart, ~27K heap rows for a TPC-DS query,
 * and a group of 99 charts in one statement pays it 99 times on one
 * connection. Instead, a recursive skip scan of `idx_query_measurements_summary`
 * finds the chart's (engine, format) series, and one backward descent per series
 * finds its oldest non-NULL timestamp, which the index orders last. The minimum
 * over series is the minimum over rows, NULLs ignored as `MIN` ignores them.
 * The successor probe and the full-prefix `ORDER BY` follow
 * `collectQuerySummary` in `summary.ts`, which explains both.
 */
function queryChartEarliest(pins: (alias: string) => string): string {
  const order =
    'q.dataset, q.dataset_variant, q.scale_factor, q.storage, q.query_idx, q.engine, q.format';
  const oldestFirst =
    'q.dataset DESC, q.dataset_variant DESC, q.scale_factor DESC, q.storage DESC, ' +
    'q.query_idx DESC, q.engine DESC, q.format DESC, q.commit_timestamp';
  return `WITH RECURSIVE series AS (
             (SELECT q.engine, q.format
                FROM query_measurements q
               WHERE ${pins('q')}
               ORDER BY ${order}
               LIMIT 1)
             UNION ALL
             SELECT nxt.engine, nxt.format
               FROM series s
              CROSS JOIN LATERAL (
                (SELECT 1 AS br, q.engine, q.format
                   FROM query_measurements q
                  WHERE ${pins('q')}
                    AND q.engine = s.engine
                    AND q.format > s.format
                  ORDER BY ${order}
                  LIMIT 1)
                UNION ALL
                (SELECT 2 AS br, q.engine, q.format
                   FROM query_measurements q
                  WHERE ${pins('q')}
                    AND q.engine > s.engine
                  ORDER BY ${order}
                  LIMIT 1)
                ORDER BY br
                LIMIT 1
              ) nxt
           )
           SELECT MIN(oldest.commit_timestamp)
             FROM series s
            CROSS JOIN LATERAL (
              SELECT q.commit_timestamp
                FROM query_measurements q
               WHERE ${pins('q')}
                 AND q.engine = s.engine
                 AND q.format = s.format
                 AND q.commit_timestamp IS NOT NULL
               ORDER BY ${oldestFirst}
               LIMIT 1
            ) oldest`;
}

/** One per-chart column of a [`groupRowsQuery`] block: its name in `ch`, element type, values. */
type ChartColumn = readonly [name: string, type: string, values: readonly unknown[]];

/**
 * One row per (chart, fact row in the window), plus one row with NULL fact
 * columns for a chart with no rows there. `ord` is the chart's 1-based position
 * in `charts`; `total_commits` counts the commits at or after its first row.
 *
 * Each block unnests the charts' key columns as `ch`, then joins two
 * per-chart subqueries, with the chart's binds replaced by `ch.<column>`:
 *  - `e`, the timestamp of the chart's first row: the collector's own `MIN`,
 *    except for query charts ([`queryChartEarliest`]). It is an aggregate, so
 *    the planner cannot flatten it into the outer query and run it once per
 *    output row.
 *  - `d`, the collector's own row query.
 *
 * `total_commits` is the collectors' `count(*)` of commits at or after `e`,
 * found by binary search: `width_bucket` counts the sorted timestamps up to its
 * argument, and timestamps are whole microseconds, so one microsecond before
 * `e` counts the commits before it. A `count(*)` per chart scans `commits`
 * 99 times for a TPC-DS group.
 *
 * There is no `ORDER BY`: each (series, commit) cell is unique by the fact
 * tables' natural keys and `finish()` sorts the series, so row order cannot
 * show.
 */
function groupRowsQuery(
  group: GroupKey,
  charts: readonly ChartKey[],
  window: CommitWindow,
): { text: string; values: unknown[] } {
  const params = new QueryParams();
  const blocks: string[] = [];
  const block = (
    fields: readonly string[],
    positions: readonly number[],
    columns: readonly ChartColumn[],
    earliest: string,
    rows: string,
  ): void => {
    const arrays = [
      `${params.bind(positions)}::int[]`,
      ...columns.map(([, type, values]) => `${params.bind(values)}::${type}[]`),
    ];
    const names = ['ord', ...columns.map(([name]) => name)];
    blocks.push(`
      SELECT ch.ord,
             COALESCE(cardinality(t.sorted)
                      - width_bucket(e.first_ts - interval '1 microsecond', t.sorted), 0)
               AS total_commits,
             d.commit_sha, ${fields.map((f) => `d.${f}`).join(', ')}, d.value
        FROM commit_times t
       CROSS JOIN unnest(${arrays.join(', ')}) AS ch(${names.join(', ')})
       CROSS JOIN LATERAL (
             ${earliest}
             ) e(first_ts)
        LEFT JOIN LATERAL (
             ${rows}
             ) d ON true`);
  };
  switch (group.k) {
    case 'QueryGroup': {
      const keys = chartsOf(group, charts, 'QueryMeasurement');
      const dataset = params.bind(group.dataset);
      const storage = params.bind(group.storage);
      const pins = (alias: string): string =>
        `${alias}.dataset = ${dataset}
           AND ${sargableDimEq(params, `${alias}.dataset_variant`, group.dataset_variant)}
           AND ${sargableDimEq(params, `${alias}.scale_factor`, group.scale_factor)}
           AND ${alias}.storage = ${storage}
           AND ${alias}.query_idx = ch.query_idx`;
      block(
        ['engine', 'format'],
        keys.map((_, i) => i + 1),
        [['query_idx', 'int', keys.map((k) => k.query_idx)]],
        queryChartEarliest(pins),
        `SELECT q.commit_sha,
                q.engine, q.format, q.value_ns::float8 AS value
           FROM query_measurements q
          WHERE ${pins('q')}${queryMeasurementWindowFilter(params, window)}`,
      );
      break;
    }
    case 'CompressionTimeGroup':
    case 'CompressionSizeGroup': {
      const time = group.k === 'CompressionTimeGroup';
      const table = time ? 'compression_times' : 'compression_sizes';
      const value = time ? 'value_ns' : 'value_bytes';
      const fields = time ? ['format', 'op'] : ['format'];
      const keys = chartsOf(group, charts, time ? 'CompressionTime' : 'CompressionSize');
      // `dataset_variant` varies per chart. `IS NOT DISTINCT FROM ch.dataset_variant` would plan
      // as if it matched one row and rescan the window per fact row, so split the charts by
      // whether the variant is NULL and pin each block sargably, as `sargableDimEq` does.
      for (const nullVariant of [true, false]) {
        const positions: number[] = [];
        const picked: typeof keys = [];
        keys.forEach((key, i) => {
          if ((key.dataset_variant === null) === nullVariant) {
            positions.push(i + 1);
            picked.push(key);
          }
        });
        if (picked.length === 0) {
          continue;
        }
        const columns: ChartColumn[] = [['dataset', 'text', picked.map((k) => k.dataset)]];
        if (!nullVariant) {
          columns.push(['dataset_variant', 'text', picked.map((k) => k.dataset_variant)]);
        }
        const pins = (alias: string): string =>
          `${alias}.dataset = ch.dataset
           AND ${alias}.dataset_variant ${nullVariant ? 'IS NULL' : '= ch.dataset_variant'}`;
        block(
          fields,
          positions,
          columns,
          `SELECT MIN(c2.timestamp)
             FROM ${table} f2
             JOIN commits c2 ON c2.commit_sha = f2.commit_sha
            WHERE ${pins('f2')}`,
          `SELECT f.commit_sha,
                  ${fields.map((field) => `f.${field}`).join(', ')}, f.${value}::float8 AS value
             FROM ${table} f
             JOIN commits c USING (commit_sha)
            WHERE ${pins('f')}${factWindowFilter(params, window)}`,
        );
      }
      break;
    }
    case 'RandomAccessGroup': {
      const keys = chartsOf(group, charts, 'RandomAccess');
      block(
        ['format', 'open_mode'],
        keys.map((_, i) => i + 1),
        [['dataset', 'text', keys.map((k) => k.dataset)]],
        `SELECT MIN(c2.timestamp)
           FROM random_access_times r2
           JOIN commits c2 ON c2.commit_sha = r2.commit_sha
          WHERE r2.dataset = ch.dataset`,
        `SELECT r.commit_sha,
                r.format,
                r.open_mode AS open_mode,
                r.value_ns::float8 AS value
           FROM random_access_times r
           JOIN commits c USING (commit_sha)
          WHERE r.dataset = ch.dataset${factWindowFilter(params, window)}`,
      );
      break;
    }
    case 'VectorSearchGroup': {
      const keys = chartsOf(group, charts, 'VectorSearch');
      const dataset = params.bind(group.dataset);
      const layout = params.bind(group.layout);
      block(
        ['flavor'],
        keys.map((_, i) => i + 1),
        [['threshold', 'float8', keys.map((k) => k.threshold)]],
        `SELECT MIN(c2.timestamp)
           FROM vector_search_runs v2
           JOIN commits c2 ON c2.commit_sha = v2.commit_sha
          WHERE v2.dataset = ${dataset}
            AND v2.layout = ${layout}
            AND v2.threshold = ch.threshold`,
        `SELECT v.commit_sha,
                v.flavor, v.value_ns::float8 AS value
           FROM vector_search_runs v
           JOIN commits c USING (commit_sha)
          WHERE v.dataset = ${dataset}
            AND v.layout = ${layout}
            AND v.threshold = ch.threshold${factWindowFilter(params, window)}`,
      );
      break;
    }
  }
  const text = `
    WITH commit_times AS (
      SELECT array_agg(timestamp ORDER BY timestamp) AS sorted FROM commits
    )${blocks.join('\n      UNION ALL')}`;
  return { text, values: params.values };
}

/** A [`groupRowsQuery`] row: a fact row, or NULL fact columns for a chart with none. */
type GroupRow = { ord: number; total_commits: number } & (FactRow | { commit_sha: null });

/**
 * Charts per rows statement. At `?n=all` a TPC-DS group has ~2.7M fact rows,
 * and holding them in one result peaked the process at 1.6x the memory of the
 * old per-chart fan-out on the 2026-10-28 dump. Slices run one after another,
 * so only one slice's rows are alive at a time.
 */
const GROUP_ROWS_CHUNK = 25;

/**
 * Build the payloads of `charts`, every one of which must belong to `group`:
 * one statement for the shared commit window ([`windowCommits`]) and one for
 * every [`GROUP_ROWS_CHUNK`] charts' fact rows ([`groupRowsQuery`]), so two for
 * most groups and five for TPC-DS's 99 charts. The result follows the order of
 * `charts`, with `null` for a chart with no rows, and each payload is
 * byte-identical to [`chartPayload`]'s.
 *
 * A chart's eligible commits (at or after its first row) are a suffix of all
 * commits in (timestamp, sha) order, so its last-`n` window is the last
 * `min(n, total)` commits of the shared window, ties included: exactly what
 * [`seededCommitsInWindow`] returns.
 *
 * That holds only if every statement sees the same commits, so they run one
 * after another on one connection, in a `REPEATABLE READ` transaction that
 * shares one snapshot. An ingest landing mid-build cannot then count a commit
 * the window lacks, or drop a chart's first commit from it.
 */
export async function groupChartPayloads(
  group: GroupKey,
  charts: readonly ChartKey[],
  window: CommitWindow,
): Promise<(ChartResponse | null)[]> {
  // Build every statement first, so a chart from another group throws before any query runs.
  const slices: { charts: readonly ChartKey[]; query: { text: string; values: unknown[] } }[] = [];
  for (let start = 0; start < charts.length; start += GROUP_ROWS_CHUNK) {
    const slice = charts.slice(start, start + GROUP_ROWS_CHUNK);
    slices.push({ charts: slice, query: groupRowsQuery(group, slice, window) });
  }
  if (slices.length === 0) {
    return [];
  }
  const client = await getPool().connect();
  // A client whose connection dropped or whose ROLLBACK failed is broken; release it with the
  // error so the pool discards it. pg emits a dropped connection as `'error'` on the client, and
  // the pool listens only while the client is idle, so without this listener the event would be
  // an uncaught exception. (`pool.query` attaches the same kind of listener for its query.)
  let broken: Error | undefined;
  const onError = (error: Error): void => {
    broken ??= error;
  };
  client.on('error', onError);
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const commits = await windowCommits(client, window);
    const payloads: (ChartResponse | null)[] = [];
    for (const slice of slices) {
      const result = await client.query<GroupRow>(slice.query);
      payloads.push(...payloadsFromRows(slice.charts, commits, result.rows, window));
    }
    await client.query('COMMIT');
    return payloads;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      broken = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    }
    throw error;
  } finally {
    client.removeListener('error', onError);
    client.release(broken);
  }
}

/** Fold one [`groupRowsQuery`] result into the payloads of its `charts`, in their order. */
function payloadsFromRows(
  charts: readonly ChartKey[],
  commits: readonly CommitPoint[],
  rows: readonly GroupRow[],
  window: CommitWindow,
): (ChartResponse | null)[] {
  const totals = new Array<number>(charts.length).fill(0);
  const rowsByChart = charts.map((): FactRow[] => []);
  for (const row of rows) {
    totals[row.ord - 1] = row.total_commits;
    if (row.commit_sha !== null) {
      rowsByChart[row.ord - 1]!.push(row);
    }
  }
  return charts.map((key, i) => {
    const total = totals[i]!;
    if (total === 0) {
      return null;
    }
    const history = historyFor(total, window);
    const acc = new SeriesAccumulator();
    acc.seedCommits(commits.slice(commits.length - history.loaded_commits));
    for (const row of rowsByChart[i]!) {
      recordRow(acc, key.k, row);
    }
    return acc.finish(chartDisplayName(key), chartUnitKind(key), history);
  });
}

// ---------------------------------------------------------------------------
// Group + chart-link discovery, the TypeScript port of
// `server/src/api/groups.rs`. `collectGroups` scans every fact table for its
// distinct group dimensions, materialises the group / chart-link tree, attaches
// each group's summary and editorial description, and applies the canonical
// `GROUP_ORDER`. `collectGroupCharts` then inlines every chart's full payload
// for one group, the shared implementation behind `GET /api/group/{slug}`.
// ---------------------------------------------------------------------------

/**
 * One chart's short label inside a group (e.g. `Q1`) plus the slug that
 * resolves to its `/api/chart/{slug}` payload.
 */
export interface ChartLink {
  name: string;
  slug: string;
}

/**
 * One group: a display name, a permalink slug, the chart links inside it, and
 * a rollup [`Summary`] plus an optional editorial description. Every group
 * kind has a summary (see `summary.ts`), so `summary` is absent only for a
 * group whose fact rows are not yet usable. `summary` and `description` are
 * left `undefined` (so `JSON.stringify` drops them) when absent, the TS
 * analogue of serde `skip_serializing_if = "Option::is_none"`.
 */
export interface Group {
  name: string;
  slug: string;
  charts: ChartLink[];
  summary?: Summary;
  description?: string;
}

/** Body of `GET /api/groups`: every group surfaced by discovery, in canonical order. */
export interface GroupsResponse {
  groups: Group[];
}

/**
 * One chart inside a [`GroupChartsResponse`]: the chart's short label and slug
 * with the full [`ChartResponse`] payload flattened in at the same level,
 * matching the Rust `#[serde(flatten)]` on `NamedChartResponse.chart`.
 */
export type NamedChartResponse = ChartResponse & {
  name: string;
  slug: string;
};

/** Body of `GET /api/group/{slug}`: the group's charts with full payloads inlined. */
export interface GroupChartsResponse {
  name: string;
  summary?: Summary;
  description?: string;
  charts: NamedChartResponse[];
}

/** Canonical group order for the v4 site. Unknown groups sort last by name. */
const GROUP_ORDER: readonly string[] = [
  'Compression',
  'Compression Size',
  'Random Access (NVMe)',
  'Random Access (S3)',
  'Clickbench',
  'TPC-H (NVMe) (SF=1)',
  'TPC-H (S3) (SF=1)',
  'TPC-H (NVMe) (SF=10)',
  'TPC-H (S3) (SF=10)',
  'TPC-H (NVMe) (SF=100)',
  'TPC-H (S3) (SF=100)',
  'TPC-DS (NVMe) (SF=1)',
  'TPC-DS (NVMe) (SF=10)',
  'TPC-DS (NVMe) (SF=100)',
  'TPC-DS (S3) (SF=10)',
  'TPC-DS (S3) (SF=100)',
  'Statistical and Population Genetics',
  'PolarSignals Profiling',
  'fineweb [nvme]',
  'fineweb [s3]',
  'appian [nvme]',
];

/**
 * Sort key for a group name against [`GROUP_ORDER`]: names in the list sort by
 * position; names not in the list sort after, with an alphabetical tiebreak.
 * Mirrors the Rust `group_sort_key` `(usize, &str)` tuple.
 */
function groupSortKey(name: string): [number, string] {
  const pos = GROUP_ORDER.indexOf(name);
  return [pos === -1 ? GROUP_ORDER.length : pos, name];
}

/** Comparator over [`groupSortKey`] applying the canonical group ordering. */
export function compareGroupSortKey(a: string, b: string): number {
  const [posA, nameA] = groupSortKey(a);
  const [posB, nameB] = groupSortKey(b);
  if (posA !== posB) {
    return posA - posB;
  }
  return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}

/**
 * Render a query-group display name in v2's shape. Ports
 * `groups.rs::group_name_query` and additionally restores v2's two flat group
 * names that the v3 source dropped (PR-5.0.5, v2-fidelity):
 *  - `tpch` + storage + scale_factor -> `TPC-H (NVMe) (SF=1)`,
 *  - `tpcds` + storage + scale_factor -> `TPC-DS (NVMe) (SF=1)`,
 *  - `clickbench` -> `Clickbench`,
 *  - `statpopgen` -> `Statistical and Population Genetics` (v2 `src/config.js`),
 *  - `polarsignals` -> `PolarSignals Profiling` (v2 `src/config.js`),
 *  - anything else -> the legacy `dataset[/variant] sf=N [storage]` shape.
 *
 * The `statpopgen`/`polarsignals` names are exactly the keys `groupDescription`
 * (`descriptions.ts`) uses to attach their editorial blurbs, which would
 * otherwise stay dead because the legacy fallback name never matches. The other
 * five preserved-v3 parity quirks are intentionally kept (Phase-5 Decision C).
 *
 * A non-null `datasetVariant` appends ` / variant` to the matched base name,
 * disambiguating ingested variants that v2's flat list collapsed. In practice
 * `statpopgen`/`polarsignals` carry no variant, so they render as the flat v2
 * name and their description attaches.
 *
 * Exported only so a Docker-free unit test can pin the v2-name mapping
 * (`groups.test.ts`); production callers reach it via `collectGroups`.
 */
export function groupNameQuery(
  dataset: string,
  datasetVariant: string | null,
  scaleFactor: string | null,
  storage: string,
): string {
  const storageLabel = storage === 'nvme' ? 'NVMe' : storage === 's3' ? 'S3' : null;
  let base: string | null = null;
  if (dataset === 'tpch' && storageLabel !== null && scaleFactor !== null) {
    base = `TPC-H (${storageLabel}) (SF=${scaleFactor})`;
  } else if (dataset === 'tpcds' && storageLabel !== null && scaleFactor !== null) {
    base = `TPC-DS (${storageLabel}) (SF=${scaleFactor})`;
  } else if (dataset === 'clickbench') {
    base = 'Clickbench';
  } else if (dataset === 'statpopgen') {
    base = 'Statistical and Population Genetics';
  } else if (dataset === 'polarsignals') {
    base = 'PolarSignals Profiling';
  }
  if (base !== null) {
    return datasetVariant !== null ? `${base} / ${datasetVariant}` : base;
  }
  // Legacy fallback for unknown datasets, keeping the page rendering rather
  // than silently dropping data.
  let name = dataset;
  if (datasetVariant !== null) {
    name += `/${datasetVariant}`;
  }
  if (scaleFactor !== null) {
    name += ` sf=${scaleFactor}`;
  }
  name += ` [${storage}]`;
  return name;
}

type QueryGroupRow = {
  dataset: string;
  dataset_variant: string | null;
  scale_factor: string | null;
  storage: string;
  query_idx: number;
};

/**
 * The five discovery dimensions of `query_measurements`, in the column order of
 * `idx_query_measurements_chart`. Doubles as the probes' ORDER BY: spelling out
 * the full index prefix is what lets the planner prove each probe is an ordered
 * index descent even under `IS NULL` pins (see `collectQuerySummary` in
 * `summary.ts` for the pathkey rationale).
 */
const DISCOVERY_COLS = 'q.dataset, q.dataset_variant, q.scale_factor, q.storage, q.query_idx';

/**
 * The successor probe of the discovery skip scan: given the current tuple `s`,
 * find the next distinct `(dataset, dataset_variant, scale_factor, storage,
 * query_idx)` tuple in index order (ASC, NULLS LAST on the two nullable
 * columns). A single row comparison cannot express this (it would not be a
 * btree index qual past column 1, and NULL components poison it), so the
 * successor is a `UNION ALL` of single-inequality branches that partition the
 * tuples greater than `s` -- deepest level first (next query_idx within the
 * same group), then next storage, scale_factor, dataset_variant, dataset.
 * Every qualifying row satisfies exactly one branch and all of branch N's rows
 * precede branch N+1's in tuple order, so the successor is the row from the
 * lowest-numbered non-empty branch: each branch carries a constant `br`
 * ordinal and the caller selects via `ORDER BY br LIMIT 1`, a SQL-guaranteed
 * choice rather than a reliance on Append's (undocumented) syntactic arm
 * order. See `collectQuerySummary` for the same construction and its cost
 * note.
 *
 * The nullable levels (scale_factor, dataset_variant) follow NULLS LAST order
 * with two branches each: `col > s.col` walks the non-NULL values (vacuously
 * empty when `s.col` is NULL, since a NULL comparison is never true), then
 * `col IS NULL AND s.col IS NOT NULL` steps from the last non-NULL value into
 * the NULL partition; the `s.col IS NOT NULL` guard keeps the NULL partition
 * from succeeding itself forever. Equality pins on a nullable column likewise
 * need both forms (`= s.col` / `IS NULL AND s.col IS NULL`) because
 * `IS NOT DISTINCT FROM` is not index-sargable; the dead combination returns
 * no rows at the btree layer for free. Every branch is a pure O(log n) descent
 * of `idx_query_measurements_chart`.
 */
function discoverySuccessorSql(): string {
  const variantPins = [
    'q.dataset_variant = s.dataset_variant',
    'q.dataset_variant IS NULL AND s.dataset_variant IS NULL',
  ];
  const scalePins = [
    'q.scale_factor = s.scale_factor',
    'q.scale_factor IS NULL AND s.scale_factor IS NULL',
  ];
  const branches: string[] = [];
  for (const variantPin of variantPins) {
    for (const scalePin of scalePins) {
      branches.push(
        `q.dataset = s.dataset AND ${variantPin} AND ${scalePin}
              AND q.storage = s.storage AND q.query_idx > s.query_idx`,
      );
    }
  }
  for (const variantPin of variantPins) {
    for (const scalePin of scalePins) {
      branches.push(
        `q.dataset = s.dataset AND ${variantPin} AND ${scalePin} AND q.storage > s.storage`,
      );
    }
  }
  for (const variantPin of variantPins) {
    branches.push(`q.dataset = s.dataset AND ${variantPin} AND q.scale_factor > s.scale_factor`);
  }
  for (const variantPin of variantPins) {
    branches.push(
      `q.dataset = s.dataset AND ${variantPin}
            AND q.scale_factor IS NULL AND s.scale_factor IS NOT NULL`,
    );
  }
  branches.push('q.dataset = s.dataset AND q.dataset_variant > s.dataset_variant');
  branches.push(
    'q.dataset = s.dataset AND q.dataset_variant IS NULL AND s.dataset_variant IS NOT NULL',
  );
  branches.push('q.dataset > s.dataset');
  return branches
    .map(
      (branch, i) => `(SELECT ${i + 1} AS br, ${DISCOVERY_COLS}
             FROM query_measurements q
            WHERE ${branch}
            ORDER BY ${DISCOVERY_COLS}
            LIMIT 1)`,
    )
    .join('\n          UNION ALL\n          ');
}

/**
 * Distinct query groups, one per `(dataset, dataset_variant, scale_factor,
 * storage)` tuple, each with one `Q{idx}` chart link per query index. Rows
 * arrive grouped by the tuple (ORDER BY matches `groups.rs`), so a new group
 * starts whenever the tuple changes.
 *
 * The distinct tuples come from a recursive-CTE skip scan (anchor = first index
 * tuple, step = [`discoverySuccessorSql`]) instead of a `GROUP BY` that scans
 * all of `query_measurements` (~1.3s at the prod seed vs ~ms; PR-5.1.5, the
 * same loose-index-scan treatment as `collectQuerySummary`). The skip scan
 * walks `idx_query_measurements_chart` in its native order (NULLS LAST), so the
 * outer ORDER BY re-sorts the few hundred result tuples into the v3-parity
 * NULLS FIRST order the group builder expects.
 */
async function collectQueryGroups(): Promise<Group[]> {
  const text = `
    WITH RECURSIVE tuples AS (
      (SELECT ${DISCOVERY_COLS}
         FROM query_measurements q
        ORDER BY ${DISCOVERY_COLS}
        LIMIT 1)
      UNION ALL
      SELECT nxt.dataset, nxt.dataset_variant, nxt.scale_factor, nxt.storage, nxt.query_idx
        FROM tuples s
        CROSS JOIN LATERAL (
          ${discoverySuccessorSql()}
          ORDER BY br
          LIMIT 1
        ) nxt
    )
    SELECT dataset, dataset_variant, scale_factor, storage, query_idx
      FROM tuples
     ORDER BY dataset, dataset_variant NULLS FIRST,
              scale_factor NULLS FIRST, storage, query_idx
  `;
  const rows = (await getPool().query<QueryGroupRow>(text)).rows;
  const groups: Group[] = [];
  let current: Group | undefined;
  let currentTupleKey: string | undefined;
  for (const row of rows) {
    const tupleKey = JSON.stringify([
      row.dataset,
      row.dataset_variant,
      row.scale_factor,
      row.storage,
    ]);
    if (current === undefined || currentTupleKey !== tupleKey) {
      current = {
        name: groupNameQuery(row.dataset, row.dataset_variant, row.scale_factor, row.storage),
        slug: groupKeyToSlug({
          k: 'QueryGroup',
          dataset: row.dataset,
          dataset_variant: row.dataset_variant,
          scale_factor: row.scale_factor,
          storage: row.storage,
        }),
        charts: [],
      };
      groups.push(current);
      currentTupleKey = tupleKey;
    }
    current.charts.push({
      name: `Q${row.query_idx}`,
      slug: chartKeyToSlug({
        k: 'QueryMeasurement',
        dataset: row.dataset,
        dataset_variant: row.dataset_variant,
        scale_factor: row.scale_factor,
        storage: row.storage,
        query_idx: row.query_idx,
      }),
    });
  }
  return groups;
}

type DatasetVariantRow = { dataset: string; dataset_variant: string | null };

/** The single `Compression` group, or `[]` if the fact table is empty. */
async function collectCompressionTimeGroup(): Promise<Group[]> {
  const text = `
    SELECT dataset, dataset_variant
      FROM compression_times
     GROUP BY dataset, dataset_variant
     ORDER BY dataset, dataset_variant NULLS FIRST
  `;
  const rows = (await getPool().query<DatasetVariantRow>(text)).rows;
  if (rows.length === 0) {
    return [];
  }
  const charts: ChartLink[] = rows.map((row) => ({
    name: row.dataset_variant !== null ? `${row.dataset}/${row.dataset_variant}` : row.dataset,
    slug: chartKeyToSlug({
      k: 'CompressionTime',
      dataset: row.dataset,
      dataset_variant: row.dataset_variant,
    }),
  }));
  return [{ name: 'Compression', slug: groupKeyToSlug({ k: 'CompressionTimeGroup' }), charts }];
}

/** The single `Compression Size` group, or `[]` if the fact table is empty. */
async function collectCompressionSizeGroup(): Promise<Group[]> {
  const text = `
    SELECT dataset, dataset_variant
      FROM compression_sizes
     GROUP BY dataset, dataset_variant
     ORDER BY dataset, dataset_variant NULLS FIRST
  `;
  const rows = (await getPool().query<DatasetVariantRow>(text)).rows;
  if (rows.length === 0) {
    return [];
  }
  const charts: ChartLink[] = rows.map((row) => ({
    name: row.dataset_variant !== null ? `${row.dataset}/${row.dataset_variant}` : row.dataset,
    slug: chartKeyToSlug({
      k: 'CompressionSize',
      dataset: row.dataset,
      dataset_variant: row.dataset_variant,
    }),
  }));
  return [
    { name: 'Compression Size', slug: groupKeyToSlug({ k: 'CompressionSizeGroup' }), charts },
  ];
}

/** One random-access group per storage backend, omitting empty sections. */
async function collectRandomAccessGroup(): Promise<Group[]> {
  const text = `
    SELECT DISTINCT dataset
      FROM random_access_times
     ORDER BY dataset
  `;
  const rows = (await getPool().query<{ dataset: string }>(text)).rows;
  const groups: Group[] = [];
  for (const storage of ['nvme', 's3'] as const) {
    const charts: ChartLink[] = rows
      .filter((row) => randomAccessStorage(row.dataset) === storage)
      .map((row) => ({
        name: row.dataset,
        slug: chartKeyToSlug({ k: 'RandomAccess', dataset: row.dataset }),
      }));
    if (charts.length > 0) {
      groups.push({
        name: `Random Access (${storage === 'nvme' ? 'NVMe' : 'S3'})`,
        slug: groupKeyToSlug({ k: 'RandomAccessGroup', storage }),
        charts,
      });
    }
  }
  return groups;
}

type VectorSearchGroupRow = { dataset: string; layout: string; threshold: number };

/**
 * Distinct vector-search groups, one per `(dataset, layout)` tuple, each with
 * one `threshold=N` chart link per threshold. Rows arrive grouped by the tuple,
 * so a new group starts whenever it changes.
 */
async function collectVectorSearchGroups(): Promise<Group[]> {
  const text = `
    SELECT dataset, layout, threshold
      FROM vector_search_runs
     GROUP BY dataset, layout, threshold
     ORDER BY dataset, layout, threshold
  `;
  const rows = (await getPool().query<VectorSearchGroupRow>(text)).rows;
  const groups: Group[] = [];
  let current: Group | undefined;
  let currentTupleKey: string | undefined;
  for (const row of rows) {
    const tupleKey = JSON.stringify([row.dataset, row.layout]);
    if (current === undefined || currentTupleKey !== tupleKey) {
      current = {
        name: `${row.dataset} / ${row.layout}`,
        slug: groupKeyToSlug({
          k: 'VectorSearchGroup',
          dataset: row.dataset,
          layout: row.layout,
        }),
        charts: [],
      };
      groups.push(current);
      currentTupleKey = tupleKey;
    }
    current.charts.push({
      name: `threshold=${row.threshold}`,
      slug: chartKeyToSlug({
        k: 'VectorSearch',
        dataset: row.dataset,
        layout: row.layout,
        threshold: row.threshold,
      }),
    });
  }
  return groups;
}

/** Dispatch to the discovery pass for one family, the TS analogue of the Rust
 * `(family.collect_groups)(conn)` registry indirection. */
function discoverGroups(groupKind: GroupKind): Promise<Group[]> {
  switch (groupKind) {
    case 'QueryGroup':
      return collectQueryGroups();
    case 'CompressionTimeGroup':
      return collectCompressionTimeGroup();
    case 'CompressionSizeGroup':
      return collectCompressionSizeGroup();
    case 'RandomAccessGroup':
      return collectRandomAccessGroup();
    case 'VectorSearchGroup':
      return collectVectorSearchGroups();
  }
}

/**
 * Bound on how many queries one request runs concurrently: the per-group
 * summaries in [`collectGroups`] (PR-5.1.5 fix e). [`collectGroupCharts`] no
 * longer fans out; it runs two statements per group, or more in slices of 25
 * charts for large groups, one after another on one connection, after the
 * summaries finish. Kept one below the `BENCH_DB_POOL_MAX` default because a
 * cached fill holds one pool connection for its advisory lock. Excess work
 * waits here, not on `pg`'s acquire list, where a wait longer than
 * `BENCH_DB_CONNECTION_TIMEOUT_MS` fails the query. A smaller pool still queues
 * the excess on that list. Overlapping the queries is what turns the
 * sequential sum of round trips into roughly the slowest query's wall-clock.
 */
const QUERY_CONCURRENCY = 7;

/**
 * Map `items` through `fn` with at most `limit` promises in flight, preserving
 * input order in the result. Used to overlap the independent per-group summary
 * queries across the pool without firing all N at once.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      // `next++` is atomic here: single-threaded JS guarantees no await runs
      // between the read and the increment.
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Collect every group + chart link derivable from the data, the shared
 * implementation behind `GET /api/groups`. Iterates the [`FAMILIES`] registry
 * in order, attaches each group's summary + description, then applies the
 * canonical [`GROUP_ORDER`].
 */
export async function collectGroups(): Promise<Group[]> {
  // Discover families in parallel -- each scans a different fact table, so they
  // overlap rather than running one after another (PR-5.1.5 fix e). Concat
  // preserves the FAMILIES registry order the final sort expects.
  const perFamily = await Promise.all(FAMILIES.map((family) => discoverGroups(family.groupKind)));
  const groups = perFamily.flat();
  // Attach each group's summary + description with bounded concurrency instead
  // of the prior sequential await, which serialized the N+1 summary cost across
  // ~64 groups (PR-5.1.5 fix e).
  await mapWithConcurrency(groups, QUERY_CONCURRENCY, async (group) => {
    const key = groupKeyFromSlug(group.slug);
    const summary = await collectGroupSummary(key);
    if (summary !== null) {
      group.summary = summary;
    }
    const description = groupDescription(group.name);
    if (description !== null) {
      group.description = description;
    }
  });
  // Sort by `GROUP_ORDER` position, then by group name as the tiebreaker, so
  // groups outside `GROUP_ORDER` share the trailing bucket and order
  // alphabetically by name, matching the Rust `(usize, &str)` `group_sort_key`.
  groups.sort((a, b) => compareGroupSortKey(a.name, b.name));
  return groups;
}

/**
 * Collect every chart inside one group with its full payload inlined, or `null`
 * when the group has no data (callers render a 404). Re-runs the full
 * [`collectGroups`] discovery to resolve the group by slug, then fetches every
 * chart link's payload with [`groupChartPayloads`] (two statements, or more in
 * slices of 25 charts for large groups), dropping links whose chart has no
 * rows. Mirrors the Rust `collect_group_charts` (including its per-call
 * re-discovery).
 *
 * The full re-discovery makes this materially more query work than resolving the
 * one group directly; it inherits the Rust source's `TODO(#7812)` deferral of that
 * cost, acceptable under the trusted-input plus 5-minute-revalidate calibration.
 */
export async function collectGroupCharts(
  key: GroupKey,
  window: CommitWindow,
): Promise<GroupChartsResponse | null> {
  const targetSlug = groupKeyToSlug(key);
  const group = (await collectGroups()).find((g) => g.slug === targetSlug);
  if (group === undefined) {
    return null;
  }
  const payloads = await groupChartPayloads(
    key,
    group.charts.map((link) => chartKeyFromSlug(link.slug)),
    window,
  );
  const charts: NamedChartResponse[] = [];
  group.charts.forEach((link, i) => {
    const chart = payloads[i] as ChartResponse | null;
    if (chart !== null) {
      charts.push({ name: link.name, slug: link.slug, ...chart });
    }
  });
  if (charts.length === 0) {
    return null;
  }
  return {
    name: group.name,
    ...(group.summary !== undefined ? { summary: group.summary } : {}),
    ...(group.description !== undefined ? { description: group.description } : {}),
    charts,
  };
}

// ---------------------------------------------------------------------------
// Filter chip universe.
// ---------------------------------------------------------------------------

/**
 * Collect the set of distinct engines and formats observed across the fact
 * tables, the port of the Rust `collect_filter_universe`. Used to seed the
 * global filter bar's chip universe, so a new engine or format showing up in
 * ingest automatically surfaces a chip without a code change.
 *
 * Engines come from `query_measurements` only, since the other fact tables do
 * not record an engine. Formats are unioned across `query_measurements`,
 * `compression_times`, `compression_sizes`, and `random_access_times`;
 * `vector_search_runs` is intentionally excluded because its `flavor` column is
 * not a format in the same sense the chip filter is matching on. Both lists are
 * sorted in JS with [`compareCodeUnits`] rather than SQL `ORDER BY`: the SQL
 * sort follows the DATABASE collation (en_US.UTF-8 on RDS, C in the test
 * container), which orders hyphenated names differently per environment, while
 * the Rust source iterates a `BTreeSet` in byte order. Code-unit comparison
 * pins the v3 byte order everywhere.
 */
export async function collectFilterUniverse(): Promise<FilterUniverse> {
  // The two queries are independent; run them on parallel pool connections
  // since this collector sits on every force-dynamic page render.
  //
  // The `query_measurements` DISTINCTs are recursive-CTE skip scans over the 006
  // single-column indexes (`idx_query_measurements_engine` / `_format`) instead
  // of full index scans (~460ms each at the prod seed vs ~ms; PR-5.1.5, the same
  // loose-index-scan treatment as `collectQuerySummary` -- see `summary.ts` for
  // the mechanics). One descent per distinct value: the anchor takes the
  // smallest, each step seeks the first value strictly greater than the last.
  // `engine`/`format` are NOT NULL by schema; the `IS NOT NULL` anchor guards
  // are kept so an all-NULL column would yield `[]` rather than `[null]`,
  // preserving the prior queries' explicit-filter semantics. The three small
  // fact tables (a few thousand rows each) stay plain DISTINCT arms; `UNION`
  // dedupes across all four sources.
  const [engines, formats] = await Promise.all([
    getPool().query<{ value: string }>(
      `WITH RECURSIVE engines AS (
        (SELECT q.engine AS value FROM query_measurements q
          WHERE q.engine IS NOT NULL
          ORDER BY q.engine
          LIMIT 1)
        UNION ALL
        SELECT nxt.value
          FROM engines e
          CROSS JOIN LATERAL (
            SELECT q.engine AS value FROM query_measurements q
             WHERE q.engine > e.value
             ORDER BY q.engine
             LIMIT 1
          ) nxt
      )
      SELECT value FROM engines`,
    ),
    getPool().query<{ value: string }>(
      `WITH RECURSIVE qm_formats AS (
        (SELECT q.format AS value FROM query_measurements q
          WHERE q.format IS NOT NULL
          ORDER BY q.format
          LIMIT 1)
        UNION ALL
        SELECT nxt.value
          FROM qm_formats f
          CROSS JOIN LATERAL (
            SELECT q.format AS value FROM query_measurements q
             WHERE q.format > f.value
             ORDER BY q.format
             LIMIT 1
          ) nxt
      )
      SELECT value FROM qm_formats
      UNION SELECT format AS value FROM compression_times    WHERE format IS NOT NULL
      UNION SELECT format AS value FROM compression_sizes    WHERE format IS NOT NULL
      UNION SELECT format AS value FROM random_access_times  WHERE format IS NOT NULL`,
    ),
  ]);
  return {
    engines: engines.rows.map((r) => r.value).sort(compareCodeUnits),
    formats: formats.rows.map((r) => r.value).sort(compareCodeUnits),
  };
}
