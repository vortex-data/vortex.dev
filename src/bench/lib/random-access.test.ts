// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import { randomAccessStorage } from './random-access';

// Matches push_v3_random_access_record in the monorepo random-access producer.
describe('randomAccessStorage', () => {
  it.each([
    ['taxi', 'nvme'],
    ['taxi/correlated', 'nvme'],
    ['feature-vectors/uniform', 'nvme'],
    ['taxi-s3', 's3'],
    ['taxi-s3/correlated', 's3'],
    ['feature-vectors-s3/uniform', 's3'],
    ['taxi/pattern-s3', 'nvme'],
    ['taxi-s3-copy/uniform', 'nvme'],
  ] as const)('assigns %s to %s', (dataset, storage) => {
    expect(randomAccessStorage(dataset)).toBe(storage);
  });
});
