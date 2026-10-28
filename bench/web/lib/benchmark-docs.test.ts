// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { groupDocPath, groupDocUrl } from '@/lib/benchmark-docs';
import { groupKeyToSlug } from '@/lib/slug';

/** A query group for `dataset`; the other dims do not affect the doc. */
function queryGroup(dataset: string) {
  return {
    k: 'QueryGroup',
    dataset,
    dataset_variant: null,
    scale_factor: null,
    storage: 'nvme',
  } as const;
}

describe('groupDocPath', () => {
  it('mirrors every current SQL suite Benchmark::doc_path', () => {
    const expected = {
      appian: 'vortex-bench/sql/appian/README.md',
      clickbench: 'vortex-bench/sql/clickbench.md',
      'clickbench-sorted': 'vortex-bench/sql/clickbench.md#sorted-variant',
      fineweb: 'vortex-bench/sql/fineweb.md',
      gharchive: 'vortex-bench/sql/gharchive.md',
      polarsignals: 'vortex-bench/sql/polarsignals.md',
      'public-bi': 'vortex-bench/sql/public-bi.md',
      spatialbench: 'vortex-bench/sql/spatialbench.md',
      statpopgen: 'vortex-bench/sql/statpopgen.md',
      tpcds: 'vortex-bench/sql/tpcds/README.md',
      tpch: 'vortex-bench/sql/tpch/README.md',
      vortex: 'vortex-bench/sql/vortex/README.md',
    };
    for (const [dataset, path] of Object.entries(expected)) {
      expect(groupDocPath(queryGroup(dataset))).toBe(path);
    }
  });

  it('maps the three non-query families to their benchmark crate', () => {
    expect(groupDocPath({ k: 'CompressionTimeGroup' })).toBe('benchmarks/compress-bench/README.md');
    // Two measurement kinds of one benchmark, so one doc.
    expect(groupDocPath({ k: 'CompressionSizeGroup' })).toBe('benchmarks/compress-bench/README.md');
    expect(groupDocPath({ k: 'RandomAccessGroup', storage: 'nvme' })).toBe(
      'benchmarks/random-access-bench/README.md',
    );
  });

  it('returns null for vector search because upstream has no matching explainer', () => {
    expect(groupDocPath({ k: 'VectorSearchGroup', dataset: 'sift-1m', layout: 'flat' })).toBeNull();
  });

  it('returns null instead of inventing a path for an unmapped SQL suite', () => {
    expect(groupDocPath(queryGroup('some-new-suite'))).toBeNull();
    expect(groupDocPath(queryGroup('../../etc/passwd'))).toBeNull();
  });
});

describe('groupDocUrl', () => {
  it('pins the monorepo default branch', () => {
    expect(groupDocUrl(groupKeyToSlug(queryGroup('clickbench')))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md',
    );
  });

  it('keeps the doc anchor in the URL', () => {
    expect(groupDocUrl(groupKeyToSlug(queryGroup('clickbench-sorted')))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md#sorted-variant',
    );
  });

  it('reads the dataset through the slug, not the display name', () => {
    // A variant shares its parent suite's doc: only `dataset` selects it.
    const variant = {
      k: 'QueryGroup',
      dataset: 'clickbench',
      dataset_variant: 'partitioned',
      scale_factor: '10',
      storage: 's3',
    } as const;
    expect(groupDocUrl(groupKeyToSlug(variant))).toBe(
      'https://github.com/vortex-data/vortex/blob/develop/vortex-bench/sql/clickbench.md',
    );
  });

  it('returns null for a slug that does not parse', () => {
    expect(groupDocUrl('not-a-slug')).toBeNull();
    expect(groupDocUrl('qmg.!!!!')).toBeNull();
  });

  it('returns null for groups without a matching explainer', () => {
    expect(groupDocUrl(groupKeyToSlug(queryGroup('some-new-suite')))).toBeNull();
    expect(
      groupDocUrl(groupKeyToSlug({ k: 'VectorSearchGroup', dataset: 'sift-1m', layout: 'flat' })),
    ).toBeNull();
  });
});
