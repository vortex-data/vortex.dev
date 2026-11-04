// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { parseGroupFilter } from './group-filter';

describe('parseGroupFilter', () => {
  it('parses the readable anchor and deduplicates local overrides', () => {
    expect(
      parseGroupFilter({
        group: 'random-access',
        hide: ['a', 'b', 'a'],
        show: ['lance', 'lance'],
      }),
    ).toEqual({
      groupAnchor: 'random-access',
      hiddenSeries: ['a', 'b'],
      shownSeries: ['lance'],
      hiddenEngines: [],
      hiddenFormats: [],
    });
  });

  it('parses the Engine and Format rows', () => {
    expect(
      parseGroupFilter({
        group: 'tpc-h-nvme-sf-1',
        'hide-engine': ['datafusion', 'datafusion'],
        'hide-format': 'parquet',
      }),
    ).toEqual({
      groupAnchor: 'tpc-h-nvme-sf-1',
      hiddenSeries: [],
      shownSeries: [],
      hiddenEngines: ['datafusion'],
      hiddenFormats: ['parquet'],
    });
  });

  it('gives an explicit show precedence over a contradictory hide', () => {
    expect(parseGroupFilter({ group: 'random-access', hide: 'lance', show: 'lance' })).toEqual({
      groupAnchor: 'random-access',
      hiddenSeries: [],
      shownSeries: ['lance'],
      hiddenEngines: [],
      hiddenFormats: [],
    });
  });

  it('ignores hidden-series labels without a target group', () => {
    expect(parseGroupFilter({ hide: ['a', 'b'] })).toBeNull();
  });
});
