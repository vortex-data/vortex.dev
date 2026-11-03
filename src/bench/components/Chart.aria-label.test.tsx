// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import type { Chart as ChartJs, LegendItem } from 'chart.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chart } from '@/components/Chart';
import { lineChartConfig } from '@/components/chart/config';
import type { CardState } from '@/components/chart/types';
import { IDENTITY_UNIT, visibleRange } from '@/lib/chart-format';
import { resetGroup, resetPayloadCache, toggleGroupSeries } from '@/lib/chart-store';

// A Chart.js stand-in with the parts the controller touches after it
// constructs a chart: the data, the options and dataset visibility.
class StubChart {
  data: { labels: unknown[]; datasets: { hidden?: boolean }[] };
  options: Record<string, unknown>;
  constructor(
    _canvas: HTMLCanvasElement,
    config: { data: StubChart['data']; options: Record<string, unknown> },
  ) {
    this.data = { labels: config.data.labels ?? [], datasets: config.data.datasets ?? [] };
    this.options = config.options ?? {};
  }
  isDatasetVisible(i: number): boolean {
    return !this.data.datasets[i]?.hidden;
  }
  update(): void {}
  destroy(): void {}
}

vi.mock('@/lib/chart-js', () => ({
  loadChartJs: () => Promise.resolve(StubChart),
}));

const GROUP = 'aria-label-group';

/** A four-commit timing payload, as the production data has it: the newest
 * commit has no results yet, and `datafusion:parquet` has none at the commit
 * before it either. */
const PAYLOAD = {
  display_name: 'tpch q1',
  unit_kind: 'time_ns',
  history: { total_commits: 4, start_index: 0, loaded_commits: 4, complete: true },
  commits: Array.from({ length: 4 }, (_, i) => ({
    sha: `sha${i}`,
    timestamp: `2026-01-0${i + 1}T00:00:00Z`,
    message: `commit ${i}`,
    url: `https://github.com/x/y/commit/sha${i}`,
  })),
  series: {
    'datafusion:parquet': [3_000_000, 2_800_000, null, null],
    'duckdb:parquet': [3_000_000, 2_000_000, 2_500_000, null],
    'duckdb:vortex-file-compressed': [1_200_000, 1_100_000, 1_000_000, null],
  },
  series_meta: {
    'datafusion:parquet': { engine: 'datafusion', format: 'parquet' },
    'duckdb:parquet': { engine: 'duckdb', format: 'parquet' },
    'duckdb:vortex-file-compressed': { engine: 'duckdb', format: 'vortex-file-compressed' },
  },
};

function json(status: number, body: unknown): Response {
  return { ok: status === 200, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('the chart canvas label', () => {
  let container: HTMLElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetPayloadCache();
    // The group bundle 404s, so the island fetches its own payload.
    vi.stubGlobal('fetch', (url: string | URL) =>
      Promise.resolve(String(url).includes('/api/group/') ? json(404, {}) : json(200, PAYLOAD)),
    );
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    container.remove();
    vi.unstubAllGlobals();
    resetPayloadCache();
    resetGroup(GROUP);
  });

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });
  }

  function label(): string | null {
    return container.querySelector('canvas')?.getAttribute('aria-label') ?? null;
  }

  it('names the chart, then adds the latest visible values once the data loads', async () => {
    container.innerHTML =
      '<section class="group-details">' +
      '<details class="group-disclosure" open><summary class="group-summary">g</summary></details>' +
      '<div class="group-body"><div class="chart-grid"><div id="mount"></div></div></div>' +
      '</section>';
    root = createRoot(container.querySelector('#mount') as HTMLElement);
    await act(async () => {
      root?.render(<Chart slug="qm.tpch-q1" name="tpch q1" index={0} groupSlug={GROUP} />);
    });
    expect(container.querySelector('canvas')?.getAttribute('role')).toBe('img');

    await flush();
    expect(label()).toBe(
      'tpch q1 chart. Latest commit with data (2026-01-03): duckdb:parquet 2.50 ms, duckdb:vortex 1.00 ms.',
    );

    // Hiding a series in the group drops it from the label.
    await act(async () => {
      toggleGroupSeries(GROUP, 'duckdb:parquet');
    });
    expect(label()).toBe(
      'tpch q1 chart. Latest commit with data (2026-01-03): duckdb:vortex 1.00 ms.',
    );
  });

  it('restates the label after a legend click shows or hides a series', () => {
    const onLegendToggle = vi.fn();
    const config = lineChartConfig({
      Chart: { defaults: { plugins: { legend: { labels: {} } } } } as unknown as typeof ChartJs,
      state: {
        payload: null,
        ui: { y: 'linear', scope: 100 },
        overrides: {},
        displayUnit: IDENTITY_UNIT,
      } as unknown as CardState,
      tooltipHost: null,
      labels: [],
      datasets: [],
      range: visibleRange(0, 100),
      legendPosition: 'bottom',
      onZoom: () => {},
      onLegendToggle,
    });
    const chart = {
      data: { datasets: [{ label: 'duckdb:parquet' }] },
      isDatasetVisible: () => true,
      setDatasetVisibility: () => {},
      update: () => {},
    };
    const onClick = config.options?.plugins?.legend?.onClick as unknown as (
      e: unknown,
      item: Pick<LegendItem, 'datasetIndex'>,
      legend: { chart: typeof chart },
    ) => void;
    onClick({}, { datasetIndex: 0 }, { chart });
    expect(onLegendToggle).toHaveBeenCalledTimes(1);
  });
});
