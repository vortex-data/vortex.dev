// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { groupAnchor, groupAnchors } from '@/lib/anchor';

describe('groupAnchor', () => {
  it('slugifies real group display names into readable anchors', () => {
    expect(groupAnchor('Compression')).toBe('compression');
    expect(groupAnchor('Compression Size')).toBe('compression-size');
    expect(groupAnchor('Random Access')).toBe('random-access');
    expect(groupAnchor('TPC-H (NVMe) (SF=1)')).toBe('tpc-h-nvme-sf-1');
    expect(groupAnchor('TPC-DS (NVMe) (SF=1)')).toBe('tpc-ds-nvme-sf-1');
    expect(groupAnchor('Statistical and Population Genetics')).toBe(
      'statistical-and-population-genetics',
    );
    expect(groupAnchor('fineweb [nvme]')).toBe('fineweb-nvme');
    expect(groupAnchor('fineweb [s3]')).toBe('fineweb-s3');
  });

  it('collapses punctuation runs and trims edge dashes', () => {
    expect(groupAnchor('  A -- weird // name!  ')).toBe('a-weird-name');
  });

  it('never returns an empty anchor', () => {
    expect(groupAnchor('***')).toBe('group');
  });
});

describe('groupAnchors', () => {
  it('anchors names in order and de-duplicates collisions with suffixes', () => {
    expect(groupAnchors(['Random Access', 'random access', 'Random-Access!'])).toEqual([
      'random-access',
      'random-access-2',
      'random-access-3',
    ]);
  });

  it('keeps the full production group list collision-free', () => {
    const names = [
      'Compression',
      'Compression Size',
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
      'Random Access',
      'Statistical and Population Genetics',
      'PolarSignals Profiling',
      'fineweb [nvme]',
      'fineweb [s3]',
      'appian [nvme]',
    ];
    expect(groupAnchors(names)).toEqual([
      'compression',
      'compression-size',
      'clickbench',
      'tpc-h-nvme-sf-1',
      'tpc-h-s3-sf-1',
      'tpc-h-nvme-sf-10',
      'tpc-h-s3-sf-10',
      'tpc-h-nvme-sf-100',
      'tpc-h-s3-sf-100',
      'tpc-ds-nvme-sf-1',
      'tpc-ds-nvme-sf-10',
      'tpc-ds-nvme-sf-100',
      'tpc-ds-s3-sf-10',
      'tpc-ds-s3-sf-100',
      'random-access',
      'statistical-and-population-genetics',
      'polarsignals-profiling',
      'fineweb-nvme',
      'fineweb-s3',
      'appian-nvme',
    ]);
  });
});
