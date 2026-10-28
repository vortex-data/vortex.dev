// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Per-group summary rollups.
 *
 * Each `collect*Summary` runs focused SQL queries and returns one [`Summary`]
 * variant. Compression summaries compare the configured formats with Parquet.
 *
 * **Every group kind has a summary.** There is no allowlist gate: a benchmark
 * suite that lands in one of the five fact tables gets a rollup card the moment
 * its first rows are ingested. The timing-shaped families (query, random
 * access, vector search) all rank through the one [`rankSeries`] model below,
 * so a new suite in any of them needs no summary code at all. Adding a sixth
 * fact table is the only case that needs a new arm here, and
 * [`collectGroupSummary`]'s exhaustive switch makes omitting it a compile
 * error rather than a silently missing card.
 *
 * Behaviour-preservation notes (substrate migration, DuckDB -> Postgres):
 *  - Nullable-dim equality (`dataset_variant` / `scale_factor`) in the
 *    query-group summary is rendered as `col IS NULL` / `col = $n` per the
 *    concrete key's build-time value, the index-sargable form of the DuckDB
 *    `NULL == NULL` semantics (the same rule as `sargableDimEq` in
 *    `queries.ts`; PR-5.1.5). The compression summaries' self-joins below are
 *    the only remaining `IS NOT DISTINCT FROM` users -- there the dim is a
 *    join column, not a build-time constant, and the tables are small.
 *  - value columns are read `::float8` so node-postgres returns a JS `number`
 *    matching the Rust `CAST(... AS DOUBLE)`, rather than the bigint-as-string
 *    default.
 *  - the "latest timestamp" two-step (find the newest commit with a complete
 *    vortex/parquet pair, then aggregate at that timestamp) is preserved, but
 *    resolved entirely inside SQL via a CTE so `MAX(timestamp)` never round-trips
 *    through text. The Rust source rendered it via `CAST(MAX(ts) AS VARCHAR)` /
 *    `CAST(? AS TIMESTAMPTZ)`; DuckDB's VARCHAR cast preserves microseconds, but
 *    a text round-trip is fragile (a second-granularity render silently drops
 *    any sub-second commit timestamp), so the port keeps the timestamp in SQL.
 */

import { getPool } from './db';
import { randomAccessStorage, type RandomAccessStorage } from './random-access';
import { compareCodeUnits } from './families';
import type { GroupKey } from './slug';

/**
 * Freshness buckets for compression-time and compression-size summaries.
 *
 * Formats benchmarked with Vortex use its newest shared snapshot. Compression size also includes
 * Arrow IPC as an on-disk format. Independently benchmarked formats use their newest complete
 * snapshot and Parquet data from the same commit.
 */
const COMPRESSION_SHARED_SNAPSHOT_FORMATS = ['vortex-file-compressed', 'parquet'];
const COMPRESSION_INDEPENDENT_SNAPSHOT_FORMATS = ['lance'];
const ARROW_IPC_FORMAT = 'arrow-ipc';

const COMPRESSION_SNAPSHOT_ANCHOR = 'vortex-file-compressed';
const COMPRESSION_BASELINE = 'parquet';

function compressionSummaryQueryParams(): [string[], string[], string, string] {
  return [
    [...COMPRESSION_SHARED_SNAPSHOT_FORMATS, ...COMPRESSION_INDEPENDENT_SNAPSHOT_FORMATS],
    COMPRESSION_SHARED_SNAPSHOT_FORMATS,
    COMPRESSION_SNAPSHOT_ANCHOR,
    COMPRESSION_BASELINE,
  ];
}

function compressionSizeSummaryQueryParams(): [string[], string[], string, string, string] {
  return [
    [
      ...COMPRESSION_SHARED_SNAPSHOT_FORMATS,
      ...COMPRESSION_INDEPENDENT_SNAPSHOT_FORMATS,
      ARROW_IPC_FORMAT,
    ],
    COMPRESSION_SHARED_SNAPSHOT_FORMATS,
    COMPRESSION_SNAPSHOT_ANCHOR,
    COMPRESSION_BASELINE,
    ARROW_IPC_FORMAT,
  ];
}

/**
 * One row of a timing-benchmark ranking (query, random access, vector search).
 *
 * `score` is the headline number: the geomean of this series' time ratio to
 * the fastest series, taken over every bucket in the group (queries for a
 * query suite, dataset totals for random access, thresholds for vector
 * search). A single bucket's absolute time is deliberately NOT the
 * headline -- a summary that quoted one arbitrary chart's numbers reads as a
 * claim about the whole group and is wrong whenever the group's charts
 * disagree.
 */
export interface SeriesRanking {
  /** Series name: `engine:format` for queries, the format or flavor otherwise. */
  name: string;
  /** Geomean ratio to the fastest series per bucket. Lower is better. */
  score: number;
  /** Secondary runtime: a sum, except for random access where this is a dataset mean. */
  totalRuntime: number;
  /** Buckets this series has a measurement for. */
  measured: number;
  /** Buckets in the group, i.e. the denominator `measured` is out of. */
  total: number;
}

/** @deprecated Prefer [`SeriesRanking`]; kept as the historical spelling. */
export type QueryRanking = SeriesRanking;

/** One format and operation in the compression throughput summary. */
export interface CompressionRanking {
  /** On-disk format. */
  name: string;
  /** Compression operation. */
  operation: 'encode' | 'decode';
  /** Geomean throughput ratio to Parquet for shared datasets. */
  ratio: number;
  /** Aggregate logical throughput in decimal gigabytes per second. */
  throughputGbS?: number;
}

/** One format in the compression size summary. */
export interface CompressionSizeRanking {
  /** On-disk format. */
  name: string;
  /** Minimum size ratio to Parquet across datasets. */
  minRatio: number;
  /** Geomean size ratio to Parquet for shared datasets. */
  ratio: number;
  /** Maximum size ratio to Parquet across datasets. */
  maxRatio: number;
  /** Geomean ratio of Arrow memory size to the format size. */
  compressionRatio: number | null;
}

/**
 * Server-computed group summary. The `type` field identifies the variant.
 * Field names use camelCase on the wire.
 */
export type Summary =
  | {
      type: 'randomAccess';
      hotRankings: SeriesRanking[];
      coldRankings: SeriesRanking[];
      explanation: string;
    }
  | {
      type: 'compression';
      title: string;
      rankings: CompressionRanking[];
      explanation: string;
    }
  | {
      type: 'compressionSize';
      title: string;
      rankings: CompressionSizeRanking[];
      explanation: string;
    }
  | {
      type: 'queryBenchmark';
      title: string;
      rankings: SeriesRanking[];
      explanation: string;
    }
  | {
      type: 'vectorSearch';
      title: string;
      rankings: SeriesRanking[];
      explanation: string;
    };

/**
 * Compute the summary for one group. Every group kind has one, so this returns
 * `null` only when the group has no usable rows yet (a brand-new suite between
 * its first ingest and its first complete measurement).
 */
export function collectGroupSummary(key: GroupKey): Promise<Summary | null> {
  switch (key.k) {
    case 'QueryGroup':
      return collectQuerySummary(key.dataset, key.dataset_variant, key.scale_factor, key.storage);
    case 'CompressionTimeGroup':
      return collectCompressionSummary();
    case 'CompressionSizeGroup':
      return collectCompressionSizeSummary();
    case 'RandomAccessGroup':
      return collectRandomAccessSummary(key.storage);
    case 'VectorSearchGroup':
      return collectVectorSearchSummary(key.dataset, key.layout);
  }
}

/**
 * Geometric mean over the positive, finite values, or `null` when none
 * qualify. Computed in log space (`exp(mean(ln(v)))`) exactly as the Rust
 * `geo_mean`.
 */
function geoMean(values: readonly number[]): number | null {
  let sumLn = 0;
  let n = 0;
  for (const value of values) {
    if (value > 0 && Number.isFinite(value)) {
      sumLn += Math.log(value);
      n += 1;
    }
  }
  return n > 0 ? Math.exp(sumLn / n) : null;
}

/**
 * The v2 penalty floor for query suites, in nanoseconds. A series missing a
 * query is imputed `max(itsWorstQuery, 300us) * 2`; the floor stops a suite of
 * uniformly fast queries from making a missing result nearly free.
 */
const QUERY_PENALTY_FLOOR_NS = 300_000;

/** One measured point feeding [`rankSeries`]. */
interface SeriesSample<K> {
  /** Series being ranked (`engine:format`, a format, or a flavor). */
  series: string;
  /** The thing being measured across series: a query, a chart, a threshold. */
  bucket: K;
  /** Latest value for `(series, bucket)`, in nanoseconds. */
  value: number;
}

/**
 * Rank timing series by the geomean of their ratio to the fastest series in
 * each bucket, with v2's missing-series penalty.
 *
 * This is the one ranking model behind the query, random-access, and
 * vector-search summaries. Two properties matter for a summary card:
 *
 *  - **Every bucket counts.** Ranking on one bucket's absolute times (which is
 *    what the random-access summary used to do -- it took whichever chart
 *    sorted first and quoted its raw numbers) states a group-wide conclusion
 *    from a single chart. `lance` leading `feature-vectors/correlated` says
 *    nothing about `nested-structs/uniform`.
 *  - **A missing bucket is not a free win.** A series measured on only the
 *    buckets it happens to win would otherwise outrank one measured
 *    everywhere. Where a series has no value the bucket contributes
 *    `max(itsWorstBucket, penaltyFloorNs) * 2` instead. `measured`/`total` on
 *    each row reports how much of the score was imputed.
 *
 * The `(10 + value) / (10 + best)` ratio (rather than `value / best`) is v2's,
 * damping sub-10ns noise; it is preserved because the shipped query scores are
 * pinned to it. Random-access and vector-search summaries also set a 2x floor
 * for a missing bucket. The floor prevents a penalty derived from a fast bucket
 * from beating a real measurement on a slower bucket. Query summaries keep a
 * zero floor to preserve the shipped v2 scores.
 */
function rankSeries<K>(
  samples: readonly SeriesSample<K>[],
  compareBuckets: (a: K, b: K) => number,
  penaltyFloorNs: number,
  missingRatioFloor: number,
  knownSeries: readonly string[] = [],
): SeriesRanking[] {
  const buckets = new Map<string, K>();
  const valuesBySeries = new Map<string, Map<string, number>>();
  for (const series of knownSeries) {
    valuesBySeries.set(series, new Map<string, number>());
  }
  for (const sample of samples) {
    if (!(sample.value > 0) || !Number.isFinite(sample.value)) {
      continue;
    }
    const bucketKey = String(sample.bucket);
    buckets.set(bucketKey, sample.bucket);
    let series = valuesBySeries.get(sample.series);
    if (series === undefined) {
      series = new Map<string, number>();
      valuesBySeries.set(sample.series, series);
    }
    series.set(bucketKey, sample.value);
  }
  if (valuesBySeries.size === 0) {
    return [];
  }

  // Sorted buckets match the Rust `BTreeSet` iteration order for query suites.
  const sortedBuckets = [...buckets.entries()].sort((a, b) => compareBuckets(a[1], b[1]));
  const bestByBucket = new Map<string, number>();
  for (const [bucketKey] of sortedBuckets) {
    let best = Infinity;
    for (const series of valuesBySeries.values()) {
      const value = series.get(bucketKey);
      if (value !== undefined && value < best) {
        best = value;
      }
    }
    if (Number.isFinite(best)) {
      bestByBucket.set(bucketKey, best);
    }
  }

  const rankings: SeriesRanking[] = [];
  // Sorted series keys match the Rust `BTreeMap<String, _>` iteration order.
  for (const name of [...valuesBySeries.keys()].sort(compareCodeUnits)) {
    const bucketValues = valuesBySeries.get(name);
    if (bucketValues === undefined) {
      continue;
    }
    let totalRuntime = 0;
    let maxRuntime = -Infinity;
    for (const [bucketKey] of sortedBuckets) {
      const value = bucketValues.get(bucketKey);
      if (value === undefined) {
        continue;
      }
      totalRuntime += value;
      if (value > maxRuntime) {
        maxRuntime = value;
      }
    }
    const penaltyBase = Number.isFinite(maxRuntime) ? maxRuntime : penaltyFloorNs;
    const penalty = Math.max(penaltyBase, penaltyFloorNs) * 2;
    const ratios: number[] = [];
    for (const [bucketKey] of sortedBuckets) {
      const base = bestByBucket.get(bucketKey);
      if (base === undefined) {
        continue;
      }
      const measuredValue = bucketValues.get(bucketKey);
      const ratio = (10 + (measuredValue ?? penalty)) / (10 + base);
      ratios.push(measuredValue === undefined ? Math.max(ratio, missingRatioFloor) : ratio);
    }
    const score = geoMean(ratios);
    if (score === null) {
      continue;
    }
    rankings.push({
      name,
      score,
      totalRuntime,
      measured: bucketValues.size,
      total: sortedBuckets.length,
    });
  }
  rankings.sort((a, b) =>
    a.score < b.score ? -1 : a.score > b.score ? 1 : compareCodeUnits(a.name, b.name),
  );
  return rankings;
}

/**
 * Sum random-access chart medians into one bucket per dataset.
 *
 * Correlated and uniform charts contribute to one dataset total. The legacy
 * `taxi` chart contributes to the same total as `taxi/correlated` and
 * `taxi/uniform`. A format must cover every chart in a dataset before that
 * dataset contributes to its score. Coverage describes complete datasets.
 */
function groupRandomAccessSamples(
  samples: readonly SeriesSample<string>[],
): SeriesSample<string>[] {
  const chartsByDataset = new Map<string, Set<string>>();
  const groupsBySeries = new Map<string, Map<string, { value: number; charts: Set<string> }>>();

  for (const sample of samples) {
    if (!(sample.value > 0) || !Number.isFinite(sample.value)) {
      continue;
    }
    const separator = sample.bucket.indexOf('/');
    const dataset = separator === -1 ? sample.bucket : sample.bucket.slice(0, separator);
    let charts = chartsByDataset.get(dataset);
    if (charts === undefined) {
      charts = new Set<string>();
      chartsByDataset.set(dataset, charts);
    }
    charts.add(sample.bucket);

    let seriesGroups = groupsBySeries.get(sample.series);
    if (seriesGroups === undefined) {
      seriesGroups = new Map<string, { value: number; charts: Set<string> }>();
      groupsBySeries.set(sample.series, seriesGroups);
    }
    let group = seriesGroups.get(dataset);
    if (group === undefined) {
      group = { value: 0, charts: new Set<string>() };
      seriesGroups.set(dataset, group);
    }
    group.value += sample.value;
    group.charts.add(sample.bucket);
  }

  const grouped: SeriesSample<string>[] = [];
  for (const [series, seriesGroups] of groupsBySeries) {
    for (const [dataset, group] of seriesGroups) {
      if (group.charts.size === chartsByDataset.get(dataset)?.size) {
        grouped.push({ series, bucket: dataset, value: group.value });
      }
    }
  }
  return grouped;
}

/**
 * The random-access rollup for one storage backend, over dataset and open-mode buckets.
 *
 * Two things this deliberately does NOT do, both of which the previous
 * implementation did:
 *
 *  - It does not summarize one chart. The old query walked the group's chart
 *    links and returned the first that had rows -- in practice always the
 *    alphabetically first `dataset/pattern` -- then published its raw times
 *    as the group summary. The producer
 *    (`benchmarks/random-access-bench`) emits `dataset` as `{dataset}/{pattern}`
 *    plus the legacy bare `taxi`. Correlated and uniform medians are summed
 *    within each dataset. The bare `taxi` median joins the other taxi medians.
 *  - It does not pin every format to one global latest commit. `format` is
 *    ranked from its own newest run per chart, the same freshness policy the
 *    compression summaries apply to intermittently benchmarked formats such as
 *    `lance`: a format that skipped the newest commit is compared as of when it
 *    last ran instead of vanishing from the card.
 *
 * Since migration 010, `random_access_times` holds one row per
 * `(commit_sha, dataset, format, open_mode)`, with historical rows backfilled
 * as `cached`. `open_mode` must be read as a plain column: an earlier
 * `to_jsonb(r) ->> 'open_mode'` lookup serialized every row, including its
 * `all_runtimes_ns` array of tens of thousands of samples, which made this
 * statement exceed the server-side statement timeout in production. The
 * table is small, so the per-series `DISTINCT ON` descent is cheap.
 */
async function collectRandomAccessSummary(storage: RandomAccessStorage): Promise<Summary | null> {
  const text = `
    SELECT DISTINCT ON (r.dataset, r.format, r.open_mode)
           r.dataset AS bucket,
           r.format AS series,
           r.open_mode AS open_mode,
           r.value_ns::float8 AS value
      FROM random_access_times r
      JOIN commits c USING (commit_sha)
     WHERE r.value_ns > 0
     ORDER BY r.dataset, r.format, r.open_mode,
              c.timestamp DESC,
              r.commit_sha DESC
  `;
  const rows = (
    await getPool().query<{
      bucket: string;
      series: string;
      open_mode?: 'cached' | 'reopen';
      value: number;
    }>(text)
  ).rows;
  const rankingsFor = (openMode: 'cached' | 'reopen') => {
    const modeRows = rows.filter(
      (row) =>
        randomAccessStorage(row.bucket) === storage && (row.open_mode ?? 'cached') === openMode,
    );
    const grouped = groupRandomAccessSamples(modeRows);
    const knownSeries = [...new Set(modeRows.map((row) => row.series))];
    return rankSeries(grouped, compareCodeUnits, 0, 2, knownSeries).map((ranking) => ({
      ...ranking,
      totalRuntime:
        ranking.measured > 0 ? ranking.totalRuntime / ranking.measured : ranking.totalRuntime,
    }));
  };
  const hotRankings = rankingsFor('cached');
  const coldRankings = rankingsFor('reopen');
  if (hotRankings.length === 0 && coldRankings.length === 0) {
    return null;
  }
  return {
    type: 'randomAccess',
    hotRankings,
    coldRankings,
    explanation: 'Geomean of take time ratio to fastest across every dataset (lower is better)',
  };
}

/**
 * The vector-search rollup for one `(dataset, layout)` group, ranking flavors
 * across the group's thresholds. Vector-search groups previously carried no
 * summary at all; they rank through the same model as every other timing
 * family, with the threshold as the bucket.
 */
async function collectVectorSearchSummary(
  dataset: string,
  layout: string,
): Promise<Summary | null> {
  const text = `
    SELECT DISTINCT ON (v.threshold, v.flavor)
           v.threshold::float8 AS bucket,
           v.flavor AS series,
           v.value_ns::float8 AS value
      FROM vector_search_runs v
      JOIN commits c USING (commit_sha)
     WHERE v.dataset = $1
       AND v.layout = $2
       AND v.value_ns > 0
     ORDER BY v.threshold, v.flavor, c.timestamp DESC, v.commit_sha DESC
  `;
  const rows = (
    await getPool().query<{ bucket: number; series: string; value: number }>(text, [
      dataset,
      layout,
    ])
  ).rows;
  const rankings = rankSeries(rows, (a, b) => a - b, 0, 2);
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'vectorSearch',
    title: 'Vector Search Performance',
    rankings,
    explanation: 'Geomean of scan time ratio to fastest across thresholds (lower is better)',
  };
}

async function collectCompressionSummary(): Promise<Summary | null> {
  // Both geomeans use the latest encode timestamp. If no encode pair exists,
  // they use the latest decode timestamp. SQL preserves sub-second precision.
  const rows = await compressionSamples();
  const grouped = new Map<
    string,
    {
      name: string;
      operation: 'encode' | 'decode';
      ratios: number[];
      totalBytes: number;
      totalNs: number;
    }
  >();
  for (const row of rows) {
    if (row.op !== 'encode' && row.op !== 'decode') {
      continue;
    }
    const key = `${row.op}:${row.format}`;
    const aggregate = grouped.get(key) ?? {
      name: row.format,
      operation: row.op,
      ratios: [],
      totalBytes: 0,
      totalNs: 0,
    };
    aggregate.ratios.push(row.parquetNs / row.valueNs);
    if (
      row.uncompressedBytes !== null &&
      row.uncompressedBytes > 0 &&
      Number.isFinite(row.uncompressedBytes)
    ) {
      aggregate.totalBytes += row.uncompressedBytes;
      aggregate.totalNs += row.valueNs;
    }
    grouped.set(key, aggregate);
  }
  const rankings: CompressionRanking[] = [];
  for (const aggregate of grouped.values()) {
    const ratio = geoMean(aggregate.ratios);
    if (ratio === null) {
      continue;
    }
    const ranking: CompressionRanking = {
      name: aggregate.name,
      operation: aggregate.operation,
      ratio,
    };
    if (aggregate.totalBytes > 0 && aggregate.totalNs > 0) {
      // One byte per nanosecond equals one decimal gigabyte per second.
      ranking.throughputGbS = aggregate.totalBytes / aggregate.totalNs;
    }
    rankings.push(ranking);
  }
  const operationRank = (op: 'encode' | 'decode'): number => (op === 'encode' ? 0 : 1);
  rankings.sort((a, b) => {
    const byOperation = operationRank(a.operation) - operationRank(b.operation);
    if (byOperation !== 0) {
      return byOperation;
    }
    return b.ratio - a.ratio || compareCodeUnits(a.name, b.name);
  });
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'compression',
    title: 'Write Throughput',
    rankings,
    explanation: 'Geomean throughput ratio to Parquet | Aggregate throughput (higher is better)',
  };
}

/**
 * Regularly benchmarked formats use the newest complete Vortex snapshot.
 * Each independently benchmarked format uses its own newest complete snapshot.
 * Every sample uses Parquet timing from the same commit. Aggregate throughput uses the newest
 * available decoded Arrow memory size for each dataset. The size commit does not need to match.
 * The JSON field lookup returns `NULL` before migration 009 adds the column, so web deployment
 * does not depend on migration deployment order.
 */
async function compressionSamples(): Promise<
  Array<{
    format: string;
    op: string;
    valueNs: number;
    parquetNs: number;
    uncompressedBytes: number | null;
  }>
> {
  const text = `
    WITH pairs AS (
      SELECT t.format AS format,
             t.op AS op,
             c.timestamp AS ts,
             t.commit_sha AS commit_sha,
             t.value_ns::float8 AS value_ns,
             p.value_ns::float8 AS parquet_ns,
             t.dataset AS dataset,
             t.dataset_variant AS dataset_variant
        FROM compression_times t
        JOIN compression_times p
          ON p.commit_sha = t.commit_sha
         AND p.dataset = t.dataset
         AND p.dataset_variant IS NOT DISTINCT FROM t.dataset_variant
         AND p.op = t.op
        JOIN commits c ON c.commit_sha = t.commit_sha
       WHERE t.op IN ('encode', 'decode')
         AND t.format = ANY($1::text[])
         AND p.format = $4
         AND t.value_ns > 0
         AND p.value_ns > 0
         AND lower(t.dataset) NOT LIKE '%wide table%'
    ), snapshot_policy AS (
      SELECT format,
             CASE WHEN format = ANY($2::text[]) THEN $3 ELSE format END AS anchor_format
        FROM unnest($1::text[]) AS configured(format)
    ), snapshot_commits AS (
      SELECT policy.anchor_format, pairs.op, pairs.ts, pairs.commit_sha
        FROM (SELECT DISTINCT anchor_format FROM snapshot_policy) policy
        JOIN pairs ON pairs.format = policy.anchor_format
       GROUP BY policy.anchor_format, pairs.op, pairs.ts, pairs.commit_sha
    ), latest_snapshots AS (
      SELECT DISTINCT ON (anchor_format) anchor_format, commit_sha
        FROM snapshot_commits
       ORDER BY anchor_format,
                CASE WHEN op = 'encode' THEN 0 ELSE 1 END,
                ts DESC, commit_sha DESC
    ), selected AS (
      SELECT pairs.format, pairs.op, pairs.value_ns,
             pairs.parquet_ns, pairs.dataset, pairs.dataset_variant
        FROM pairs
        JOIN snapshot_policy policy ON policy.format = pairs.format
        JOIN latest_snapshots latest
         ON latest.anchor_format = policy.anchor_format
         AND latest.commit_sha = pairs.commit_sha
    ), latest_uncompressed_sizes AS (
      SELECT DISTINCT ON (s.dataset, s.dataset_variant)
             s.dataset, s.dataset_variant,
             s.uncompressed_bytes::float8 AS uncompressed_bytes
        FROM compression_sizes s
        JOIN commits c ON c.commit_sha = s.commit_sha
       WHERE s.format = $4
         AND s.uncompressed_bytes::float8 > 0
         AND lower(s.dataset) NOT LIKE '%wide table%'
       ORDER BY s.dataset, s.dataset_variant NULLS FIRST,
                c.timestamp DESC, s.commit_sha DESC
    )
    SELECT selected.format AS format,
           selected.op AS op,
           selected.value_ns AS "valueNs",
           selected.parquet_ns AS "parquetNs",
           uncompressed.uncompressed_bytes AS "uncompressedBytes"
      FROM selected
      LEFT JOIN latest_uncompressed_sizes uncompressed
        ON uncompressed.dataset = selected.dataset
       AND uncompressed.dataset_variant IS NOT DISTINCT FROM selected.dataset_variant
     ORDER BY selected.op, selected.format, selected.dataset,
              selected.dataset_variant NULLS FIRST
  `;
  return (
    await getPool().query<{
      format: string;
      op: string;
      valueNs: number;
      parquetNs: number;
      uncompressedBytes: number | null;
    }>(text, compressionSummaryQueryParams())
  ).rows;
}

async function collectCompressionSizeSummary(): Promise<Summary | null> {
  const rows = await compressionSizeSamples();
  const grouped = new Map<string, { sizeRatios: number[]; compressionRatios: number[] }>();
  for (const row of rows) {
    const ratios = grouped.get(row.format) ?? { sizeRatios: [], compressionRatios: [] };
    if (
      row.valueBytes > 0 &&
      Number.isFinite(row.valueBytes) &&
      row.parquetBytes > 0 &&
      Number.isFinite(row.parquetBytes)
    ) {
      ratios.sizeRatios.push(row.valueBytes / row.parquetBytes);
    }
    if (
      row.uncompressedBytes !== null &&
      row.uncompressedBytes > 0 &&
      Number.isFinite(row.uncompressedBytes) &&
      row.valueBytes > 0 &&
      Number.isFinite(row.valueBytes)
    ) {
      ratios.compressionRatios.push(row.uncompressedBytes / row.valueBytes);
    }
    grouped.set(row.format, ratios);
  }
  const rankings: CompressionSizeRanking[] = [];
  for (const [name, ratios] of grouped) {
    const ratio = geoMean(ratios.sizeRatios);
    if (ratio !== null) {
      let minRatio = Infinity;
      let maxRatio = -Infinity;
      for (const sizeRatio of ratios.sizeRatios) {
        minRatio = Math.min(minRatio, sizeRatio);
        maxRatio = Math.max(maxRatio, sizeRatio);
      }
      rankings.push({
        name,
        minRatio,
        ratio,
        maxRatio,
        compressionRatio: geoMean(ratios.compressionRatios),
      });
    }
  }
  const hasCompleteArrowRatios = rankings.every((ranking) => ranking.compressionRatio !== null);
  rankings.sort((a, b) => {
    if (!hasCompleteArrowRatios) {
      return a.ratio - b.ratio || compareCodeUnits(a.name, b.name);
    }
    return (
      (b.compressionRatio as number) - (a.compressionRatio as number) ||
      compareCodeUnits(a.name, b.name)
    );
  });
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'compressionSize',
    title: 'Compression Size Summary',
    rankings,
    explanation:
      'Geometric means of compressed sizes versus Arrow (higher is better) and versus Parquet-zstd (lower is better)',
  };
}

/**
 * Regularly benchmarked formats use the newest complete Vortex snapshot.
 * Each independently benchmarked format uses its own newest complete snapshot
 * and compares it with Parquet from the same commit. Arrow IPC uses its newest value for each
 * dataset and Parquet from the same commit. Compression ratios use the newest available decoded
 * Arrow memory size for each dataset. The size commit does not need to match.
 * The JSON field lookup returns `NULL` before migration 009 adds the column, so web deployment
 * does not depend on migration deployment order.
 */
async function compressionSizeSamples(): Promise<
  Array<{
    format: string;
    valueBytes: number;
    parquetBytes: number;
    uncompressedBytes: number | null;
  }>
> {
  const text = `
    WITH pairs AS (
      SELECT s.format AS format,
             c.timestamp AS ts,
             s.commit_sha AS commit_sha,
             s.value_bytes::float8 AS value_bytes,
             s.uncompressed_bytes::float8 AS uncompressed_bytes,
             p.value_bytes::float8 AS parquet_bytes,
             s.dataset AS dataset,
             s.dataset_variant AS dataset_variant
        FROM compression_sizes s
        JOIN compression_sizes p
          ON p.commit_sha = s.commit_sha
         AND p.dataset = s.dataset
         AND p.dataset_variant IS NOT DISTINCT FROM s.dataset_variant
        JOIN commits c ON c.commit_sha = s.commit_sha
       WHERE s.format = ANY($1::text[])
         AND p.format = $4
         AND s.value_bytes > 0
         AND p.value_bytes > 0
         AND lower(s.dataset) NOT LIKE '%wide table%'
    ), snapshot_policy AS (
      SELECT format,
             CASE WHEN format = ANY($2::text[]) THEN $3 ELSE format END AS anchor_format
        FROM unnest($1::text[]) AS configured(format)
       WHERE format <> $5
    ), snapshot_commits AS (
      SELECT policy.anchor_format, pairs.ts, pairs.commit_sha
        FROM (SELECT DISTINCT anchor_format FROM snapshot_policy) policy
        JOIN pairs ON pairs.format = policy.anchor_format
       GROUP BY policy.anchor_format, pairs.ts, pairs.commit_sha
    ), latest_snapshots AS (
      SELECT DISTINCT ON (anchor_format) anchor_format, commit_sha
        FROM snapshot_commits
       ORDER BY anchor_format, ts DESC, commit_sha DESC
    ), selected AS (
      SELECT pairs.format, pairs.value_bytes, pairs.parquet_bytes,
             pairs.uncompressed_bytes,
             pairs.dataset, pairs.dataset_variant
        FROM pairs
        JOIN snapshot_policy policy ON policy.format = pairs.format
        JOIN latest_snapshots latest
         ON latest.anchor_format = policy.anchor_format
         AND latest.commit_sha = pairs.commit_sha
    ), latest_arrow_ipc AS (
      SELECT DISTINCT ON (pairs.dataset, pairs.dataset_variant)
             pairs.format, pairs.value_bytes, pairs.parquet_bytes,
             pairs.uncompressed_bytes, pairs.dataset, pairs.dataset_variant
        FROM pairs
       WHERE pairs.format = $5
       ORDER BY pairs.dataset, pairs.dataset_variant NULLS FIRST,
                pairs.ts DESC, pairs.commit_sha DESC
    ), selected_with_arrow_ipc AS (
      SELECT * FROM selected
      UNION ALL
      SELECT * FROM latest_arrow_ipc
    ), latest_uncompressed_sizes AS (
      SELECT DISTINCT ON (s.dataset, s.dataset_variant)
             s.dataset, s.dataset_variant,
             s.uncompressed_bytes::float8 AS uncompressed_bytes
        FROM compression_sizes s
        JOIN commits c ON c.commit_sha = s.commit_sha
       WHERE s.format = $4
         AND s.uncompressed_bytes::float8 > 0
         AND lower(s.dataset) NOT LIKE '%wide table%'
       ORDER BY s.dataset, s.dataset_variant NULLS FIRST,
                c.timestamp DESC, s.commit_sha DESC
    )
    SELECT selected.format AS format,
           selected.value_bytes AS "valueBytes",
           selected.parquet_bytes AS "parquetBytes",
           COALESCE(uncompressed.uncompressed_bytes, selected.uncompressed_bytes)
             AS "uncompressedBytes"
      FROM selected_with_arrow_ipc selected
      LEFT JOIN latest_uncompressed_sizes uncompressed
        ON uncompressed.dataset = selected.dataset
       AND uncompressed.dataset_variant IS NOT DISTINCT FROM selected.dataset_variant
     ORDER BY selected.format, selected.dataset, selected.dataset_variant NULLS FIRST
  `;
  return (
    await getPool().query<{
      format: string;
      valueBytes: number;
      parquetBytes: number;
      uncompressedBytes: number | null;
    }>(text, compressionSizeSummaryQueryParams())
  ).rows;
}

async function collectQuerySummary(
  dataset: string,
  datasetVariant: string | null,
  scaleFactor: string | null,
  storage: string,
): Promise<Summary | null> {
  // Latest value per (query_idx, engine, format), then the shared
  // [`rankSeries`] model with the query bucket = `query_idx` and v2's
  // `QUERY_PENALTY_FLOOR_NS` floor.
  //
  // "Latest per series" is a recursive-CTE skip scan (loose index scan) over the
  // covering index `idx_query_measurements_summary` (dataset, dataset_variant,
  // scale_factor, storage, query_idx, engine, format, commit_timestamp DESC)
  // INCLUDE (value_ns) from migrations 006/007 (PR-5.1.5 fix c). Those
  // migrations' in-file rationale describes the interim `DISTINCT ON` consumer
  // and predates the cold-render decision that shipped this skip scan; the
  // files are frozen post-apply, so this comment (and migrations/README.md) is
  // the current record. The previous
  // `DISTINCT ON (query_idx, engine, format) ... ORDER BY commit_timestamp DESC
  // NULLS LAST` form scanned the group's entire history (~1.8M index entries,
  // ~2.4s warm for tpcds at the prod seed); the skip scan instead does one
  // O(log n) index descent per distinct series tuple plus one per series for its
  // latest value (~1.3K descents, ~20ms), which is what makes the cache-cold
  // `/api/groups` render fast.
  //
  // Three non-obvious constructions keep every probe a pure index descent:
  //
  //  - The successor probe cannot be a single row comparison
  //    `(query_idx, engine, format) > (...)`: a row comparison is only a btree
  //    index qual when its first column is the index's FIRST column, and these
  //    are index columns 5-7 (the planner degrades the row form to a filter over
  //    a full scan). It is instead three single-column-inequality branches (next
  //    format within the series' query_idx+engine, then next engine within its
  //    query_idx, then next query_idx), each fully index-sargable. The branches
  //    partition the tuples greater than the current series (every qualifying
  //    row satisfies exactly one branch, and all of branch N's rows precede all
  //    of branch N+1's rows in tuple order), so the successor is the row from
  //    the lowest-numbered non-empty branch. Each branch carries a constant
  //    `br` ordinal and the union is selected via `ORDER BY br LIMIT 1`, which
  //    makes that choice a SQL-guaranteed ordering rather than a reliance on
  //    Append evaluating `UNION ALL` arms in syntactic order (which Postgres
  //    does today but does not document). The ordinal sort costs at most one
  //    extra single-row descent per branch per step (~1.5x measured), not the
  //    full-scan cliff the skip scan exists to avoid.
  //
  //  - Every probe's ORDER BY spells out the full index prefix (dataset,
  //    dataset_variant, scale_factor, storage, ...) even though those columns
  //    are pinned by the WHERE. An `IS NULL` pin (NULL-variant/scale groups)
  //    does not join the planner's equivalence classes, so with the short
  //    `ORDER BY query_idx, engine, format` form the planner cannot prove the
  //    index already provides the order and inserts a Sort over the whole
  //    group. The pinned columns are constant per group, so the long form is
  //    semantically identical.
  //
  //  - "Latest" must order `commit_timestamp DESC NULLS LAST` (a transient NULL
  //    -- a row from a writer not yet populating `commit_timestamp`, before the
  //    post-deploy re-backfill -- must not win over real timestamps), but the
  //    index is `commit_timestamp DESC`, i.e. NULLS FIRST, so that order is not
  //    index-provided. The per-series latest probe therefore takes the newest
  //    `commit_timestamp IS NOT NULL` row first (index-ordered descent past the
  //    NULL block, ordinal 1) and falls back to the NULL-timestamp rows
  //    (ordinal 2) only when the series has no timestamped rows; the two
  //    branches are selected via the same `ORDER BY br LIMIT 1` guarantee as
  //    the successor probe. The fallback branch joins `commits` and orders by
  //    `c.timestamp DESC NULLS LAST` so an all-unstamped series (one ingested
  //    entirely inside the transient window) still returns its NEWEST value,
  //    matching the replaced join-ordered query, rather than an arbitrary row.
  //    The join is LEFT so an orphan row whose commit_sha has no commits row
  //    -- impossible unless a writer violates the commits-upsert-first
  //    invariant -- still surfaces (last) instead of vanishing as it did under
  //    the old INNER JOIN; fail-visible is preferred. The fallback's join cost
  //    is irrelevant: it executes only for series with zero stamped rows.
  //
  // The `value_ns > 0` filter rides inside every probe: it is read from the
  // index leaf (INCLUDE), so the enumeration lands directly on series that have
  // at least one valid row, the same set `DISTINCT ON` produced. The timestamp
  // value is the same `commits.timestamp` the original join used, so the
  // same-second-tie behavior (an accepted tradeoff) is unchanged. `$1` =
  // dataset, `$2` = storage; variant/scale params append only when non-null.
  const params: unknown[] = [dataset, storage];
  const variantPred =
    datasetVariant === null
      ? 'q.dataset_variant IS NULL'
      : `q.dataset_variant = $${params.push(datasetVariant)}`;
  const scalePred =
    scaleFactor === null
      ? 'q.scale_factor IS NULL'
      : `q.scale_factor = $${params.push(scaleFactor)}`;
  const groupPred = `q.dataset = $1
           AND ${variantPred}
           AND ${scalePred}
           AND q.storage = $2`;
  const indexOrder =
    'q.dataset, q.dataset_variant, q.scale_factor, q.storage, q.query_idx, q.engine, q.format';
  const text = `
    WITH RECURSIVE series AS (
      (SELECT q.query_idx, q.engine, q.format
         FROM query_measurements q
        WHERE ${groupPred}
          AND q.value_ns > 0
        ORDER BY ${indexOrder}
        LIMIT 1)
      UNION ALL
      SELECT nxt.query_idx, nxt.engine, nxt.format
        FROM series s
        CROSS JOIN LATERAL (
          (SELECT 1 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx = s.query_idx
              AND q.engine = s.engine
              AND q.format > s.format
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          UNION ALL
          (SELECT 2 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx = s.query_idx
              AND q.engine > s.engine
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          UNION ALL
          (SELECT 3 AS br, q.query_idx, q.engine, q.format
             FROM query_measurements q
            WHERE ${groupPred}
              AND q.query_idx > s.query_idx
              AND q.value_ns > 0
            ORDER BY ${indexOrder}
            LIMIT 1)
          ORDER BY br
          LIMIT 1
        ) nxt
    )
    SELECT s.query_idx AS query_idx,
           s.engine || ':' || s.format AS series,
           latest.value_ns AS value_ns
      FROM series s
      CROSS JOIN LATERAL (
        (SELECT 1 AS br, q.value_ns::float8 AS value_ns
           FROM query_measurements q
          WHERE ${groupPred}
            AND q.query_idx = s.query_idx
            AND q.engine = s.engine
            AND q.format = s.format
            AND q.value_ns > 0
            AND q.commit_timestamp IS NOT NULL
          ORDER BY ${indexOrder}, q.commit_timestamp DESC
          LIMIT 1)
        UNION ALL
        (SELECT 2 AS br, q.value_ns::float8 AS value_ns
           FROM query_measurements q
           LEFT JOIN commits c ON c.commit_sha = q.commit_sha
          WHERE ${groupPred}
            AND q.query_idx = s.query_idx
            AND q.engine = s.engine
            AND q.format = s.format
            AND q.value_ns > 0
            AND q.commit_timestamp IS NULL
          ORDER BY c.timestamp DESC NULLS LAST
          LIMIT 1)
        ORDER BY br
        LIMIT 1
      ) latest
     ORDER BY s.query_idx, s.engine || ':' || s.format
  `;
  const rows = (
    await getPool().query<{ query_idx: number; series: string; value_ns: number }>(text, params)
  ).rows;

  const rankings = rankSeries(
    rows.map((row) => ({ series: row.series, bucket: row.query_idx, value: row.value_ns })),
    (a, b) => a - b,
    QUERY_PENALTY_FLOOR_NS,
    0,
  );
  if (rankings.length === 0) {
    return null;
  }
  return {
    type: 'queryBenchmark',
    title: 'Performance Summary',
    rankings,
    explanation: 'Geomean of query time ratio to fastest (lower is better)',
  };
}
