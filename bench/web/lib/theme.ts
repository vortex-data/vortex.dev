// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The page theme as the charts see it. The theme is the `data-theme` attribute
 * on `<html>` when the reader chose one, otherwise the system preference. The
 * header's toggle writes the attribute; the charts read it to pick their
 * palette and listen for changes to recolor.
 */

import type { ChartTheme } from '@/lib/chart-format';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The forced or media-derived effective theme (`chart-init.js::effectiveTheme`). */
export function effectiveTheme(): ChartTheme {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') {
    return forced;
  }
  if (window.matchMedia?.(DARK_QUERY).matches) {
    return 'dark';
  }
  return 'light';
}

const listeners = new Set<() => void>();
let watching = false;

/** Start the one shared watch: the `data-theme` attribute and the system
 * preference. Every chart card subscribes to it, so a page with many cards
 * still has one observer. */
function watch(): void {
  if (watching) {
    return;
  }
  watching = true;
  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };
  new MutationObserver(notify).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  window.matchMedia?.(DARK_QUERY).addEventListener?.('change', notify);
}

/**
 * Call `listener` when the effective theme can have changed, until `signal`
 * aborts. The listener can run when the theme did not change (the attribute
 * set to its own value), so it must be idempotent.
 */
export function onThemeChange(listener: () => void, signal: AbortSignal): void {
  if (signal.aborted) {
    return;
  }
  watch();
  listeners.add(listener);
  signal.addEventListener('abort', () => listeners.delete(listener), { once: true });
}
