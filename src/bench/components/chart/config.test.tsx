// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import type { Chart as ChartJs } from 'chart.js';
import { afterEach, describe, expect, it } from 'vitest';

import { applyDragWash } from './config';

afterEach(() => document.documentElement.style.removeProperty('--wash'));

describe('applyDragWash', () => {
  it('re-reads --wash into the drag selection, so a theme change reaches a drawn chart', () => {
    const chart = {
      options: {
        plugins: { zoom: { zoom: { drag: { enabled: true, backgroundColor: 'rgb(0, 0, 0)' } } } },
      },
    } as unknown as ChartJs;
    document.documentElement.style.setProperty('--wash', 'rgb(240, 240, 240)');
    applyDragWash(chart);
    expect(chart.options.plugins?.zoom?.zoom?.drag?.backgroundColor).toBe('rgb(240, 240, 240)');
  });

  it('leaves a chart without a drag selection alone', () => {
    const chart = { options: { plugins: {} } } as unknown as ChartJs;
    expect(() => applyDragWash(chart)).not.toThrow();
  });
});
