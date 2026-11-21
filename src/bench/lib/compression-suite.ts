// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Which benchmark suite wrote a compression row: `compress-bench`, or `string-bench`,
 * which shares the compression tables under the `strings/` dataset prefix with the
 * string encoder in `dataset_variant`.
 */
export type CompressionSuite = 'compress' | 'strings';

/** Dataset prefix `string-bench` gives every row it writes. */
export const STRING_DATASET_PREFIX = 'strings/';

/** The `LIKE` pattern matching every `string-bench` dataset. */
export const STRING_DATASET_PATTERN = `${STRING_DATASET_PREFIX}%`;

/**
 * `LIKE` patterns for the `compress-bench` datasets the compression time summary leaves out: the
 * `wide table cols=… chunks=… rows=…` and `sparse-wide-*` suites. They are pathological cases
 * with many variants each, so in a geomean over all datasets they would be heavily
 * over-represented. They still chart in the group. The Compression & File Size summary counts each suite as
 * one dataset instead (`SIZE_SUMMARY_FAMILIES`). Both patterns are anchored at the start of the
 * name, as `compress-bench` writes it, so a dataset that only mentions them is not dropped.
 */
export const SUMMARY_EXCLUDED_DATASET_PATTERNS: readonly string[] = [
  'wide table %',
  'sparse-wide-%',
];

/**
 * `LIKE` patterns for the `compress-bench` datasets the Compression & File Size summary leaves out. They still
 * chart in the group, and the compression time summary keeps them (minus
 * `SUMMARY_EXCLUDED_DATASET_PATTERNS`).
 *
 * - `tpc-h l_comment chunked` writes the same column as `tpc-h l_comment canonical`, so their
 *   files are the same size. Only the input to the encoder differs, which matters for time but
 *   not for size. The size summary counts the column once, as `canonical`.
 * - The wide tables with 50 chunks write the same files as the ones with 1 chunk, for the same
 *   reason. The size summary counts each column count once, as `chunks=1`.
 * - `statpopgen`, which joined `compress-bench` on 2026-11-06, is left out of the size summary.
 *   The pattern also matches the older `statpopgen/100000` rows, which have no Parquet size and
 *   so were never in the summary.
 *
 * `_` is a `LIKE` wildcard, but no other dataset name matches these patterns.
 */
export const SIZE_SUMMARY_EXCLUDED_DATASET_PATTERNS: readonly string[] = [
  'tpc-h l_comment chunked',
  'wide table cols=% chunks=50 rows=%',
  'statpopgen',
];

/**
 * Synthetic `compress-bench` families that the Compression & File Size summary counts as one dataset each:
 * the geometric mean of the family's ratios is one entry in the summary's geometric mean. A
 * family has several datasets of one kind, so counted one by one they would outweigh the real
 * datasets. Each family is the datasets whose names start with its prefix.
 */
export const SIZE_SUMMARY_FAMILIES: readonly { name: string; prefix: string }[] = [
  { name: 'wide table', prefix: 'wide table ' },
  { name: 'sparse-wide', prefix: 'sparse-wide-' },
];

export function compressionSuite(dataset: string): CompressionSuite {
  return dataset.startsWith(STRING_DATASET_PREFIX) ? 'strings' : 'compress';
}
