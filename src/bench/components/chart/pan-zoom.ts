// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import type { Chart as ChartJs } from 'chart.js';

import { clampRangeWindow } from '@/lib/chart-format';

import type { CardElements, CardState } from './types';

/** Wheel means horizontal pan (the zoom plugin only offers wheel-zoom), so a
 * manual `wheel` listener translates the dominant delta into `chart.pan`. */
export function attachWheelPan(
  canvas: HTMLCanvasElement,
  chart: ChartJs,
  state: CardState,
  rebuild: (chart: ChartJs) => void,
  signal: AbortSignal,
): void {
  if (state.wheelAttached) {
    return;
  }
  state.wheelAttached = true;
  canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      // Horizontal-wheel-or-shift+wheel pans horizontally; plain vertical
      // wheel also pans so trackpad scroll moves through commit history
      // without modifier keys.
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!dx) {
        return;
      }
      e.preventDefault();
      chart.pan({ x: dx * 0.5 }, undefined, 'none');
      rebuild(chart);
    },
    { passive: false, signal },
  );
}

/**
 * Bind the range scrollbar strip below the canvas: the highlighted window
 * matches the chart's visible x-range and can be dragged or edge-resized to
 * pan/zoom. Ported verbatim from v3's pointer math.
 */
export function bindRangeStrip(
  chart: ChartJs,
  els: Pick<CardElements, 'strip' | 'stripWindow'>,
  state: CardState,
  rebuildRange: (chart: ChartJs, min: number, max: number) => void,
  signal: AbortSignal,
): void {
  const { strip, stripWindow } = els;
  if (!strip || !stripWindow) {
    return;
  }

  const commitCount = (): number => (chart.data.labels ?? []).length;

  const visibleBounds = (): { min: number; max: number } => {
    const n = commitCount();
    if (n <= 0) {
      return { min: 0, max: 0 };
    }
    const maxIdx = n - 1;
    const sx = chart.options.scales?.x ?? {};
    let min = typeof sx.min === 'number' && Number.isFinite(sx.min) ? sx.min : 0;
    let max = typeof sx.max === 'number' && Number.isFinite(sx.max) ? sx.max : maxIdx;
    min = Math.max(0, Math.min(maxIdx, min));
    max = Math.max(min, Math.min(maxIdx, max));
    return { min, max };
  };

  const render = (): void => {
    const n = commitCount();
    if (n <= 0) {
      stripWindow.style.left = '0%';
      stripWindow.style.width = '100%';
      return;
    }
    const b = visibleBounds();
    const span = Math.max(1, n - 1);
    let leftPct = (b.min / span) * 100;
    let widthPct = ((b.max - b.min) / span) * 100;
    // A minimum visible width keeps the handles grabbable when zoomed in
    // tight on a single commit.
    if (widthPct < 1.5) {
      widthPct = 1.5;
    }
    if (leftPct + widthPct > 100) {
      leftPct = 100 - widthPct;
    }
    stripWindow.style.left = `${leftPct}%`;
    stripWindow.style.width = `${widthPct}%`;
    strip.setAttribute('aria-valuenow', String(Math.round(leftPct)));
  };

  const setRange = (rawMin: number, rawMax: number): void => {
    const n = commitCount();
    if (n <= 0) {
      return;
    }
    const maxIdx = n - 1;
    // Looser than the plugin's `limits.x.minRange = 4`; the strip allows a
    // tighter window. `clampRangeWindow` collapses the minimum span to zero on
    // a single-commit chart so a bare-track click cannot push `x.max` one slot
    // past the only label.
    const { min: newMin, max: newMax } = clampRangeWindow(maxIdx, rawMin, rawMax);
    const sx = chart.options.scales?.x;
    if (!sx) {
      return;
    }
    sx.min = newMin;
    sx.max = newMax;
    // Track scope so the toolbar slider stays consistent on later drags.
    state.ui.scope = Math.round(newMax - newMin + 1);
    rebuildRange(chart, newMin, newMax);
    render();
  };

  const pxToIndex = (px: number, trackWidth: number): number => {
    const n = commitCount();
    if (n <= 1 || trackWidth <= 0) {
      return 0;
    }
    const pct = Math.max(0, Math.min(1, px / trackWidth));
    return pct * (n - 1);
  };

  let dragState: {
    mode: 'pan' | 'resize-left' | 'resize-right';
    rect: DOMRect;
    startX: number;
    startMin: number;
    startMax: number;
    pointerId: number;
  } | null = null;

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== undefined && e.button !== 0) {
      return;
    }
    const target = e.target as HTMLElement;
    const role = target.getAttribute?.('data-role');
    const rect = strip.getBoundingClientRect();
    let b = visibleBounds();
    const idxAtCursor = pxToIndex(e.clientX - rect.left, rect.width);

    let mode: 'pan' | 'resize-left' | 'resize-right';
    if (role === 'range-handle-left') {
      mode = 'resize-left';
    } else if (role === 'range-handle-right') {
      mode = 'resize-right';
    } else if (role === 'range-window') {
      mode = 'pan';
    } else {
      // Click on bare track: jump the window so its center lands at the
      // cursor, then begin a pan drag.
      const width = b.max - b.min;
      const newMin = idxAtCursor - width / 2;
      setRange(newMin, newMin + width);
      b = visibleBounds();
      mode = 'pan';
    }
    dragState = {
      mode,
      rect,
      startX: e.clientX,
      startMin: b.min,
      startMax: b.max,
      pointerId: e.pointerId,
    };
    try {
      strip.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort; drag still works without it.
    }
    e.preventDefault();
    strip.classList.add('chart-range-strip--dragging');
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragState) {
      return;
    }
    const n = commitCount();
    if (n <= 1) {
      return;
    }
    const dxIdx = ((e.clientX - dragState.startX) / Math.max(1, dragState.rect.width)) * (n - 1);
    if (dragState.mode === 'pan') {
      setRange(dragState.startMin + dxIdx, dragState.startMax + dxIdx);
    } else if (dragState.mode === 'resize-left') {
      setRange(dragState.startMin + dxIdx, dragState.startMax);
    } else {
      setRange(dragState.startMin, dragState.startMax + dxIdx);
    }
  };

  const onPointerUp = (): void => {
    if (!dragState) {
      return;
    }
    try {
      strip.releasePointerCapture(dragState.pointerId);
    } catch {
      // Capture may already be released; nothing to do.
    }
    dragState = null;
    strip.classList.remove('chart-range-strip--dragging');
  };

  strip.addEventListener('pointerdown', onPointerDown, { signal });
  strip.addEventListener('pointermove', onPointerMove, { signal });
  strip.addEventListener('pointerup', onPointerUp, { signal });
  strip.addEventListener('pointercancel', onPointerUp, { signal });

  // Expose the strip's render so the toolbar slider, wheel-pan, and the
  // throttled LTTB rebuild keep the strip in lockstep without knowing strip
  // internals.
  state.stripRender = render;
  render();
}
