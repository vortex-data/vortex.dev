// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { getChartUnitLabel, subscribeChartUnitLabel } from '@/bench/lib/chart-store';

/**
 * The chart page's unit, in its meta line. The server renders the unit of the
 * window it sent (`initial`); once the chart draws, this follows the unit the
 * y-axis is drawn in, which changes when the full history loads and its older
 * values need a larger unit.
 */
export function ChartUnit({ slug, initial }: { slug: string; initial: string }) {
  const subscribe = useCallback((cb: () => void) => subscribeChartUnitLabel(slug, cb), [slug]);
  const label = useSyncExternalStore(
    subscribe,
    () => getChartUnitLabel(slug) ?? initial,
    () => initial,
  );
  return <code>{label}</code>;
}
