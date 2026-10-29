// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Chart as ChartJs, ChartDataset } from 'chart.js';

import type { DisplayUnit, NormalizedChartPayload } from '@/lib/chart-format';
import type { QueueEntry } from '@/lib/chart-store';

/** A Chart.js line dataset extended with the bench-specific carry-alongs. */
export interface BenchDataset extends ChartDataset<'line', (number | null)[]> {
  /** The unmodified payload values; the tooltip reads these regardless of
   * which indices LTTB kept in `data`. */
  rawData: (number | null)[];
  /** Engine/format tag used by the global filter's bulk hide/show. */
  benchMeta: { engine?: string | undefined; format?: string | undefined };
}

/** The per-island mutable state, the port of the v3 `canvas.__bench_*` contract. */
export interface CardState {
  chart: ChartJs | null;
  constructing: boolean;
  payload: NormalizedChartPayload | null;
  ui: { y: 'linear' | 'log'; scope: number | 'all' };
  /** Series labels the user has explicitly legend-toggled on this card. Once
   * set, the global/group filters no longer drive that label here. */
  overrides: Record<string, true>;
  displayUnit: DisplayUnit;
  /** v3 also tracked `__bench_inline_trimmed`; it was write-only there and is
   * dropped here. `payload.history.complete` carries the same information. */
  fullLoaded: boolean;
  initialFetchEntry: QueueEntry | null;
  fullFetchEntry: QueueEntry | null;
  fullFetchPending: Promise<void> | null;
  /** The in-flight `?n=100` fetch's per-fetch aborter; lets a group close or
   * destroy cancel it without aborting the controller-lifetime `aborter`. */
  initialFetchController: AbortController | null;
  /** The in-flight `?n=all` fetch's per-fetch aborter; same role as above. */
  fullFetchController: AbortController | null;
  /** True once this card has rendered a bounded window (so the chip is shown);
   * a chart born complete never sets it and shows no chip. */
  everWindowed: boolean;
  /** The most recent full-history fetch failed; the chip offers a retry. */
  chipError: boolean;
  /** The pointer is currently resting on this card (chip shows the action). */
  hovering: boolean;
  /** Pending hover-dwell prefetch timer; cleared on `pointerleave`/destroy. */
  hoverDwellTimer: ReturnType<typeof setTimeout> | null;
  /** A full-history fetch returned 404: there is nothing beyond the window to
   * load, so the chip stops offering the action and hovers stop re-fetching. */
  fullUnavailable: boolean;
  yUserSet: boolean;
  stripRender: (() => void) | null;
  rebuild: ((chart: ChartJs) => void) | null;
  wheelAttached: boolean;
  disposed: boolean;
}

/** The DOM handles the controller operates on, resolved from refs at call time. */
export interface CardElements {
  card: HTMLElement | null;
  canvas: HTMLCanvasElement | null;
  tooltipHost: HTMLDivElement | null;
  slider: HTMLInputElement | null;
  badge: HTMLSpanElement | null;
  chip: HTMLButtonElement | null;
  strip: HTMLDivElement | null;
  stripWindow: HTMLDivElement | null;
}

/** React-state setters the controller drives (low-frequency UI bits only). */
export interface CardCallbacks {
  setY: (y: 'linear' | 'log') => void;
  setLoading: (on: boolean) => void;
  setError: (msg: string | null) => void;
  /** Show/hide the initial-fetch retry control in the error region. */
  setRetryable: (on: boolean) => void;
  /** Flip once the Chart.js instance exists, so the pre-data placeholder hides. */
  setConstructed: (on: boolean) => void;
}
