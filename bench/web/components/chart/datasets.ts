// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Chart as ChartJs } from 'chart.js';

import {
  seriesOrder,
  seriesPassesFilter,
  seriesStyle,
  type NormalizedChartPayload,
} from '@/lib/chart-format';
import { getGlobalFilterSnapshot } from '@/lib/chart-store';

import type { BenchDataset } from './types';

/** Read a chart's datasets with the bench carry-alongs visible to the types. */
export function benchDatasets(chart: ChartJs): BenchDataset[] {
  return chart.data.datasets as BenchDataset[];
}

/**
 * Build the per-series dataset shells. `data` starts as a full-length
 * null-padded array; `rebuildVisibleAndUpdate` fills it in based on the current
 * visible range. `rawData` holds a reference to the original payload so the
 * tooltip can show raw values regardless of LTTB.
 */
export function buildDatasets(payload: NormalizedChartPayload): BenchDataset[] {
  const raw = payload.series ?? {};
  const meta = payload.series_meta ?? {};
  const n = payload.commits.length;
  const global = getGlobalFilterSnapshot();
  return Object.keys(raw)
    .sort()
    .map((name) => {
      const seriesMeta = meta[name] ?? {};
      const rawValues = Array.isArray(raw[name]) ? raw[name] : [];
      // Tier-based style: the named Vortex/Parquet series get vivid, thicker
      // lines; everything else is muted and thin (see `seriesStyle`).
      const style = seriesStyle(name, seriesMeta);
      const coldRandomAccess = name.endsWith(':cold');
      // `data` starts null-padded; `rebuildVisibleAndUpdate` fills the current
      // visible window with raw or LTTB-kept values. With `spanGaps: true` the
      // line connects across nulls, so a series with partial coverage still
      // draws as a continuous trend; markers only appear at non-null indices.
      const data = new Array<number | null>(n).fill(null);
      return {
        label: name,
        data,
        rawData: rawValues,
        borderColor: style.color,
        backgroundColor: `${style.color}20`,
        borderWidth: style.width,
        // `undefined` draws a solid line. Chart.js's types forbid an explicit
        // `undefined` under `exactOptionalPropertyTypes`; the cast changes no value.
        borderDash: (coldRandomAccess ? [6, 4] : undefined) as number[],
        // Layer the hero series on top: Vortex in front ... arrow at the back,
        // datafusion ahead of duckdb. Lower `order` renders on top in Chart.js.
        order: seriesOrder(name, seriesMeta),
        spanGaps: true,
        tension: 0,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointHitRadius: 8,
        pointStyle: 'cross',
        benchMeta: { engine: seriesMeta.engine, format: seriesMeta.format },
        hidden: !seriesPassesFilter(seriesMeta, global.active, global.universe),
      } satisfies BenchDataset;
    });
}
