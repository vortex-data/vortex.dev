// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Chart as ChartJs, TooltipModel } from 'chart.js';

import {
  displaySeriesLabel,
  escapeHtml,
  firstLine,
  formatDisplayValue,
  IDENTITY_UNIT,
  predecessorValue,
  shortDate,
  shortSha,
  truncate,
} from '@/lib/chart-format';

import { benchDatasets } from './datasets';
import type { CardState } from './types';

/**
 * The external tooltip handler factory, ported verbatim from v3 including the
 * flicker fix: the tooltip host is ALWAYS `pointer-events: none` (via CSS); the
 * previous v2 implementation flipped it to `auto` when visible and the cursor
 * would oscillate between canvas and tooltip at event-loop frequency. Clicks on
 * a data point are handled by the chart's `onClick`, so the tooltip itself
 * never needs to be interactive.
 */
export function externalTooltipHandler(state: CardState, host: HTMLDivElement | null) {
  return (context: { chart: ChartJs; tooltip: TooltipModel<'line'> }) => {
    const tt = context.tooltip;
    if (!host) {
      return;
    }
    if (tt.opacity === 0) {
      host.style.opacity = '0';
      return;
    }

    const chart = context.chart;
    const firstDp = tt.dataPoints?.[0];
    if (!firstDp) {
      host.style.opacity = '0';
      return;
    }
    // Snap to a single commit: `mode: "nearest"` means `firstDp.dataIndex` is
    // the single closest data point to the cursor (skipping nulls). If the
    // cursor falls between two LTTB-kept points, exactly one wins.
    const idx = firstDp.dataIndex;
    const commit = state.payload?.commits?.[idx] ?? null;
    const displayUnit = state.displayUnit ?? IDENTITY_UNIT;

    // Build one row per dataset from each series' `rawData` so the tooltip
    // shows raw measurements even when LTTB nulled out `dataset.data[idx]`.
    // Iterating `chart.data.datasets` directly (instead of `tt.dataPoints`)
    // guarantees one row per series at this single commit.
    const rowItems = benchDatasets(chart)
      .map((ds, dsIndex) => {
        const meta = chart.getDatasetMeta(dsIndex);
        if (meta?.hidden || ds.hidden) {
          return null;
        }
        const raw = ds.rawData?.[idx];
        if (raw === null || raw === undefined || Number.isNaN(raw)) {
          return null;
        }
        // Per-row delta is `(current - previous) / previous`, where "previous"
        // is the chronologically preceding commit per the BAN-pinned `idx - 1`
        // oldest-first walk in [`predecessorValue`].
        const prevRaw = predecessorValue(ds.rawData ?? [], idx);
        let deltaHtml = '';
        if (prevRaw !== null && prevRaw !== 0) {
          const pct = ((raw - prevRaw) / prevRaw) * 100;
          const cls =
            pct > 0
              ? 'tt-delta tt-delta--worse'
              : pct < 0
                ? 'tt-delta tt-delta--better'
                : 'tt-delta';
          const sign = pct > 0 ? '+' : '';
          deltaHtml = `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
        }
        return { label: ds.label ?? '', color: String(ds.borderColor), raw, deltaHtml };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Top-to-bottom order matches the visual stack of lines at this x.
    rowItems.sort((a, b) => b.raw - a.raw);

    const rows = rowItems
      .map(
        (r) =>
          `<div class="tt-row">` +
          `<span class="tt-swatch" style="background:${r.color}"></span>` +
          `<span class="tt-label">${escapeHtml(displaySeriesLabel(r.label))}</span>` +
          `<span class="tt-value">${escapeHtml(formatDisplayValue(r.raw, displayUnit))}</span>` +
          r.deltaHtml +
          `</div>`,
      )
      .join('');

    // If every series was hidden or had no value at this commit, treat this as
    // a no-op hover instead of flashing an empty popup.
    if (!rows) {
      host.style.opacity = '0';
      return;
    }

    const titleHtml =
      `<div class="tt-title">` +
      `${escapeHtml(shortSha(commit?.sha))} · ${escapeHtml(shortDate(commit?.timestamp))}` +
      `</div>`;

    // Short SHA + first-line commit message, truncated. The full URL (or PR
    // URL) is wired up via the chart's onClick handler.
    const msg = truncate(firstLine(commit?.message ?? ''), 80);
    const footerLine = commit?.sha
      ? msg
        ? `${escapeHtml(shortSha(commit.sha))} · ${escapeHtml(msg)}`
        : escapeHtml(shortSha(commit.sha))
      : escapeHtml(msg);
    const footerHtml = footerLine
      ? `<div class="tt-footer"><div class="tt-msg">${footerLine}</div></div>`
      : '';

    host.innerHTML = `${titleHtml}<div class="tt-rows">${rows}</div>${footerHtml}`;

    // Position the tooltip relative to its container, offset 12px from the
    // cursor; flip horizontally if it would overflow.
    const canvasRect = context.chart.canvas.getBoundingClientRect();
    const parent = host.parentNode as HTMLElement;
    const hostRect = parent.getBoundingClientRect();
    const x = canvasRect.left - hostRect.left + tt.caretX;
    const y = canvasRect.top - hostRect.top + tt.caretY;
    host.style.opacity = '1';
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    // Measure after the content swap so flipping is correct.
    const ttWidth = host.offsetWidth || 0;
    const containerWidth = parent.clientWidth || 0;
    const flip = x + ttWidth + 24 > containerWidth;
    host.style.transform = flip ? 'translate(calc(-100% - 12px), 12px)' : 'translate(12px, 12px)';
  };
}
