// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import type { Chart as ChartJs, TooltipModel } from 'chart.js';
import { describe, expect, it } from 'vitest';

import { pickDisplayUnit, type NormalizedChartPayload } from '@/bench/lib/chart-format';
import type { UnitKind } from '@/bench/lib/queries';

import { externalTooltipHandler } from './tooltip';
import type { CardState } from './types';

/**
 * The tooltip for one series that moves from `before` to `after` between two
 * commits, hovered at the newer commit, on a chart whose values are `unitKind`.
 */
function tooltipFor(unitKind: UnitKind, before: number, after: number): HTMLDivElement {
  const payload = {
    display_name: 'chart',
    unit_kind: unitKind,
    history: { total_commits: 2, start_index: 0, loaded_commits: 2, complete: true },
    commits: [
      { sha: 'a'.repeat(40), timestamp: '2026-11-01T00:00:00Z', message: 'one', url: '' },
      { sha: 'b'.repeat(40), timestamp: '2026-11-02T00:00:00Z', message: 'two', url: '' },
    ],
    series: { vortex: [before, after] },
  } satisfies NormalizedChartPayload;
  const state = {
    payload,
    displayUnit: pickDisplayUnit(unitKind, [before, after]),
  } as unknown as CardState;
  const parent = document.createElement('div');
  const host = document.createElement('div');
  parent.append(host);
  const chart = {
    data: {
      datasets: [{ label: 'vortex', borderColor: '#000', rawData: [before, after], benchMeta: {} }],
    },
    getDatasetMeta: () => ({ hidden: false }),
    canvas: document.createElement('canvas'),
  } as unknown as ChartJs;
  const tooltip = {
    opacity: 1,
    caretX: 0,
    caretY: 0,
    dataPoints: [{ dataIndex: 1 }],
  } as unknown as TooltipModel<'line'>;
  externalTooltipHandler(state, host)({ chart, tooltip });
  return host;
}

function deltaClass(host: HTMLDivElement): string | undefined {
  return host.querySelector('.tt-delta')?.className;
}

describe('the tooltip delta', () => {
  it('marks a slower time as worse and a faster one as better', () => {
    expect(deltaClass(tooltipFor('time_ns', 100, 120))).toBe('tt-delta tt-delta--worse');
    expect(deltaClass(tooltipFor('time_ns', 120, 100))).toBe('tt-delta tt-delta--better');
  });

  it('marks a larger size as worse', () => {
    expect(deltaClass(tooltipFor('bytes', 100, 120))).toBe('tt-delta tt-delta--worse');
  });

  // Higher is better on a throughput chart.
  it('marks a rise in throughput as better and a fall as worse', () => {
    const rise = tooltipFor('throughput_mb_s', 100, 120);
    expect(deltaClass(rise)).toBe('tt-delta tt-delta--better');
    expect(rise.querySelector('.tt-delta')?.textContent).toBe('+20.0%');
    expect(deltaClass(tooltipFor('throughput_mb_s', 120, 100))).toBe('tt-delta tt-delta--worse');
  });

  it('leaves no change uncoloured', () => {
    expect(deltaClass(tooltipFor('throughput_mb_s', 100, 100))).toBe('tt-delta');
  });
});
