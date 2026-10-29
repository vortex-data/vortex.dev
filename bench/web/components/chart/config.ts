// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type {
  ActiveElement,
  Chart as ChartJs,
  ChartConfiguration,
  ChartEvent,
  LegendItem,
  Plugin,
} from 'chart.js';

import { displaySeriesLabel, parsePrNumber, type VisibleRange } from '@/lib/chart-format';

import { externalTooltipHandler } from './tooltip';
import type { BenchDataset, CardState } from './types';

/** Subtle, theme-neutral grid line color (slate-gray at low opacity), matching
 * the v2 frontend's faint gridlines a reviewer preferred over the heavier
 * Chart.js default. */
const GRID_COLOR = 'rgba(148, 163, 184, 0.14)';

// ---------------------------------------------------------------------------
// Crosshair plugin: draws a vertical line at the chart's active hover index.
// An inline plugin is cheaper than chartjs-plugin-crosshair, which is overkill
// for this one feature.
// ---------------------------------------------------------------------------
const crosshairPlugin: Plugin<'line'> = {
  id: 'benchCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!active || active.length === 0) {
      return;
    }
    const x = active[0]!.element.x;
    const ya = chart.scales?.y;
    if (!ya || !Number.isFinite(x)) {
      return;
    }
    const ctx = chart.ctx;
    ctx.save();
    // `--muted` from the page theme, read lazily so dark mode picks up the
    // right color.
    const muted =
      getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#9ca3af';
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, ya.top);
    ctx.lineTo(x, ya.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/** The Chart.js config for one card's line chart, built once at construction. */
export function lineChartConfig(input: {
  Chart: typeof ChartJs;
  state: CardState;
  tooltipHost: HTMLDivElement | null;
  labels: string[];
  datasets: BenchDataset[];
  range: VisibleRange;
  legendPosition: 'top' | 'bottom';
  onZoom: (chart: ChartJs) => void;
}): ChartConfiguration<'line', (number | null)[], string> {
  const { Chart, state, tooltipHost, labels, datasets, range, legendPosition, onZoom } = input;
  return {
    type: 'line',
    data: { labels, datasets },
    plugins: [crosshairPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Snap to the single nearest commit THAT HAS RENDERED DATA. After
      // LTTB most commit indices are null in `dataset.data`; `mode:
      // "index"` would pick null indices (empty tooltip) and `mode: "x"`
      // would pick multiple closely-packed LTTB columns at once (duplicate
      // rows). `intersect: false` keeps the tooltip active anywhere on the
      // chart and, combined with `pointer-events: none` on the host, is
      // also the flicker fix.
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      onClick: (event: ChartEvent, _active: ActiveElement[], c: ChartJs) => {
        const native = event.native;
        if (!native) {
          return;
        }
        const points = c.getElementsAtEventForMode(
          native,
          'nearest',
          { intersect: false, axis: 'x' },
          true,
        );
        if (points.length === 0) {
          return;
        }
        const commit = state.payload?.commits?.[points[0]!.index];
        if (!commit) {
          return;
        }
        const pr = parsePrNumber(commit.message);
        const url = pr ? `https://github.com/vortex-data/vortex/pull/${pr}` : commit.url;
        if (url) {
          window.open(url, '_blank', 'noopener');
        }
      },
      scales: {
        y: {
          type: state.ui.y === 'log' ? 'logarithmic' : 'linear',
          beginAtZero: state.ui.y !== 'log',
          grid: { color: GRID_COLOR },
          // The axis title reflects the locked display unit; empty for
          // dimensionless kinds so a "1.2x speedup" chart does not get an
          // arbitrary label.
          title: {
            display: state.displayUnit.axisLabel !== '',
            text: state.displayUnit.axisLabel,
          },
        },
        x: {
          min: range.min,
          max: range.max,
          grid: { color: GRID_COLOR },
          title: { display: false },
          // One tick per commit is unreadable on a 5000-commit history;
          // Chart.js picks a sensible subset.
          ticks: { maxTicksLimit: 12, autoSkip: true },
        },
      },
      plugins: {
        legend: {
          position: legendPosition,
          // Rewrite only the displayed legend text (vortex-file-compressed ->
          // vortex); `dataset.label` stays the real key the toggle/filter use.
          labels: {
            generateLabels: (ci) => {
              const items = Chart.defaults.plugins.legend.labels.generateLabels(ci);
              for (const item of items) {
                if (typeof item.text === 'string') {
                  item.text = displaySeriesLabel(item.text);
                }
              }
              return items;
            },
          },
          // Wrap the default toggle to record the per-card override and
          // keep `dataset.hidden` in sync with the legend's visibility
          // flag; the filter passes write to `dataset.hidden`, so they
          // need to track each other.
          onClick: (_e: ChartEvent, item: LegendItem, legend) => {
            const ci = legend.chart;
            const ds = ci.data.datasets[item.datasetIndex ?? 0];
            const label = ds?.label;
            if (label) {
              state.overrides[label] = true;
            }
            const visible = ci.isDatasetVisible(item.datasetIndex ?? 0);
            ci.setDatasetVisibility(item.datasetIndex ?? 0, !visible);
            if (ds) {
              // Flipped: was visible means now hidden, and vice versa.
              ds.hidden = visible;
            }
            ci.update();
          },
        },
        tooltip: {
          enabled: false,
          external: externalTooltipHandler(state, tooltipHost),
        },
        // A mouse drag draws a selection rectangle and zooms to it (the v3
        // behavior), never pans. Panning is reserved for the wheel (manual
        // listener below) and the range strip, so a plain drag highlights a
        // region without sliding the axes. Wheel-zoom is disabled because
        // wheel means PAN here.
        zoom: {
          zoom: {
            wheel: { enabled: false },
            drag: { enabled: true, backgroundColor: 'rgba(37, 99, 235, 0.10)' },
            mode: 'x',
            onZoom: (ctx) => onZoom(ctx.chart),
          },
          // Drag-to-pan is disabled so a drag is a zoom selection, not a pan.
          // The plugin's `chart.pan()` API (used by the wheel listener and the
          // range strip) is NOT gated by this flag, so wheel/strip panning is
          // unaffected; only the built-in drag-pan gesture is removed.
          pan: {
            enabled: false,
            mode: 'x',
          },
          limits: {
            x: { min: 0, max: Math.max(0, labels.length - 1), minRange: 4 },
          },
        },
      },
    },
  };
}
