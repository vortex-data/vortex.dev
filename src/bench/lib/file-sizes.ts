// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Which charts the File Sizes group holds. It joins two tables: `compression_sizes`, the
 * size of each `compress-bench` dataset in each format, and `file_sizes`, the files that the
 * SQL suites write. Both are one dataset's size per format per commit.
 */

import { compressionSuite } from './compression-suite';

/** The File Sizes group's display name. */
export const FILE_SIZES_GROUP_NAME = 'File Sizes';

/** One SQL suite's data at one scale factor, as `file_sizes` spells them. */
export interface FileSizeScope {
  benchmark: string;
  scale_factor: string;
}

/**
 * The SQL suites' data the group charts, in this order. The other scopes in `file_sizes` stay
 * in the table, for the PR benchmark comments, but the group leaves them out. TPC-DS is at
 * SF1 because develop writes it on every commit, with Vortex Compact and DuckDB; it writes SF10
 * only nightly, with Parquet and Vortex alone.
 */
export const FILE_SIZE_SCOPES: readonly FileSizeScope[] = [
  { benchmark: 'clickbench', scale_factor: '1.0' },
  { benchmark: 'tpch', scale_factor: '10.0' },
  { benchmark: 'tpcds', scale_factor: '1.0' },
];

/**
 * The SQL scopes the summary ranks: TPC-DS alone.
 *
 * - ClickBench measures the Parquet files it downloads, which are not zstd, so it has no
 *   baseline to compare with.
 * - TPC-H comes from the same generator as the `compress-bench` TPC-H tables (lineitem, orders,
 *   and partsupp), which the summary already ranks. Ranking both would count TPC-H twice.
 */
export const FILE_SIZE_SUMMARY_SCOPES: readonly FileSizeScope[] = [
  { benchmark: 'tpcds', scale_factor: '1.0' },
];

/** Whether the group charts this SQL scope. */
export function isFileSizeScope(benchmark: string, scaleFactor: string): boolean {
  return FILE_SIZE_SCOPES.some(
    (scope) => scope.benchmark === benchmark && scope.scale_factor === scaleFactor,
  );
}

/**
 * `compression_sizes` charts the group leaves out. Each entry is a `dataset` and
 * `dataset_variant`, exactly.
 *
 * - The rows that the SQL suites wrote before `file_sizes` existed: Vortex sizes only, the last
 *   on 2026-05-28. `file_sizes` holds those suites' sizes now.
 * - The 10-column wide tables, which `compress-bench` stopped writing on 2025-10-07.
 *
 * None of them has a Parquet size, so the summary, which pairs every size with Parquet's, never
 * counts them either.
 */
const HIDDEN_SIZE_DATASETS: readonly (readonly [string, string | null])[] = [
  ['appian', null],
  ['clickbench', null],
  ['fineweb', null],
  ['polarsignals', '1000000'],
  ['statpopgen', '100000'],
  ['tpcds', null],
  ['tpch', null],
  ['tpch', '10'],
  ['tpch', '100'],
  ['wide table cols=10 chunks=1 rows=1000', null],
  ['wide table cols=10 chunks=50 rows=1000', null],
];

/** Whether the group charts this `compression_sizes` dataset: a current `compress-bench` one. */
export function isFileSizesDataset(dataset: string, datasetVariant: string | null): boolean {
  return (
    compressionSuite(dataset) === 'compress' &&
    !HIDDEN_SIZE_DATASETS.some(
      ([hiddenDataset, hiddenVariant]) =>
        hiddenDataset === dataset && hiddenVariant === datasetVariant,
    )
  );
}
