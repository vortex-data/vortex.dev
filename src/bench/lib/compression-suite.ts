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
 * `LIKE` patterns for the `compress-bench` datasets the compression summaries leave out: the
 * `wide table cols=… chunks=… rows=…` and `sparse-wide-*` suites. They are pathological cases
 * with many variants each, so in a geomean over all datasets they would be heavily
 * over-represented. They still chart in the group. Both patterns are anchored at the start of the
 * name, as `compress-bench` writes it, so a dataset that only mentions them is not dropped.
 */
export const SUMMARY_EXCLUDED_DATASET_PATTERNS: readonly string[] = [
  'wide table %',
  'sparse-wide-%',
];

/**
 * `LIKE` patterns for the datasets the compression size summary also leaves out, on top of
 * `SUMMARY_EXCLUDED_DATASET_PATTERNS`. They still chart in the group, and the compression time
 * summary keeps them.
 *
 * - `tpc-h l_comment chunked` writes the same column as `tpc-h l_comment canonical`, so their
 *   files are the same size. Only the input to the encoder differs, which matters for time but
 *   not for size. The size summary counts the column once, as `canonical`.
 * - `statpopgen`, which joined `compress-bench` on 2026-11-06, is left out of the size summary.
 *   The pattern also matches the older `statpopgen/100000` rows, which have no Parquet size and
 *   so were never in the summary.
 *
 * Both names are exact. `_` is a `LIKE` wildcard, but no other dataset name matches.
 */
export const SIZE_SUMMARY_EXCLUDED_DATASET_PATTERNS: readonly string[] = [
  ...SUMMARY_EXCLUDED_DATASET_PATTERNS,
  'tpc-h l_comment chunked',
  'statpopgen',
];

export function compressionSuite(dataset: string): CompressionSuite {
  return dataset.startsWith(STRING_DATASET_PREFIX) ? 'strings' : 'compress';
}
