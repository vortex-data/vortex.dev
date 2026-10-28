// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

export type RandomAccessStorage = 'nvme' | 's3';

/**
 * The producer encodes S3 storage as `{dataset}-s3/{pattern}` (or legacy
 * `taxi-s3`), since random_access_times has no separate storage dimension.
 */
export function randomAccessStorage(dataset: string): RandomAccessStorage {
  return dataset.split('/')[0].endsWith('-s3') ? 's3' : 'nvme';
}
