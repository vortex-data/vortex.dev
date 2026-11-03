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

export function compressionSuite(dataset: string): CompressionSuite {
  return dataset.startsWith(STRING_DATASET_PREFIX) ? 'strings' : 'compress';
}
