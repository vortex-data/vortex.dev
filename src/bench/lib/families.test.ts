// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import { FAMILIES, familyForChartKind, familyForGroupKind } from './families';

describe('FAMILIES registry', () => {
  it('lists the six fact tables in family.rs declaration order, then file_sizes', () => {
    expect(FAMILIES.map((f) => f.tableName)).toEqual([
      'query_measurements',
      'compression_times',
      'compression_sizes',
      'random_access_times',
      'vector_search_runs',
      'file_sizes',
    ]);
  });

  it('has distinct chart and group slug prefixes', () => {
    const chartPrefixes = FAMILIES.map((f) => f.chartSlugPrefix);
    const groupPrefixes = FAMILIES.map((f) => f.groupSlugPrefix);
    expect(new Set(chartPrefixes).size).toBe(chartPrefixes.length);
    expect(new Set(groupPrefixes).size).toBe(groupPrefixes.length);
  });

  it('pins the exact slug prefixes from family.rs', () => {
    expect(FAMILIES.map((f) => [f.chartSlugPrefix, f.groupSlugPrefix])).toEqual([
      ['qm', 'qmg'],
      ['ct', 'ctg'],
      ['cs', 'csg'],
      ['rat', 'rag'],
      ['vsr', 'vsg'],
      ['fs', 'fsg'],
    ]);
  });
});

describe('family lookups', () => {
  it('maps every chart kind to its family', () => {
    for (const family of FAMILIES) {
      expect(familyForChartKind(family.chartKind)).toBe(family);
    }
  });

  it('maps every group kind to its family', () => {
    for (const family of FAMILIES) {
      expect(familyForGroupKind(family.groupKind)).toBe(family);
    }
  });
});
