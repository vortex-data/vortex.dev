// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupToolbar } from '@/components/GroupToolbar';
import {
  initGlobalFilter,
  noteChartRecentData,
  noteGroupSeries,
  setShowEmptyCharts,
  toggleGroupSeries,
} from '@/lib/chart-store';

const UNIVERSE = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] };

describe('GroupToolbar (server-rendered markup)', () => {
  const html = renderToStaticMarkup(<GroupToolbar groupSlug="random_access" universe={UNIVERSE} />);

  it('renders the v3 group-toolbar contract: Y buttons, dropdown, reset', () => {
    expect(html).toContain('data-role="group-toolbar"');
    expect(html).toContain('data-group-y="linear"');
    expect(html).toContain('data-group-y="log"');
    expect(html).toContain('data-role="group-filter-dropdown"');
    expect(html).toContain('data-role="group-filter-trigger"');
    expect(html).toContain('data-role="group-filter-panel"');
    expect(html).toContain('data-role="group-toolbar-reset"');
    expect(html).toContain('Reset group');
  });

  it('ships linear highlighted as the resting group-Y default', () => {
    expect(html).toMatch(/toolbar-btn toolbar-btn--active[^>]*data-group-y="linear"/);
  });

  it('renders engine/format macro rows plus an empty lazy series row', () => {
    for (const value of [...UNIVERSE.engines, ...UNIVERSE.formats]) {
      expect(html).toContain(`data-value="${value}"`);
    }
    expect(html).toContain('data-role="group-series-chips"');
    // Three "all" chips: engine row, format row, series row.
    const allChips = html.match(/data-value="\*"/g);
    expect(allChips).toHaveLength(3);
    // Macro chips render inactive while no series is known (the v3
    // post-`syncGroupChipsUi` state): no known series, nothing to match.
    expect(html).not.toContain('filter-chip filter-chip--active');
  });

  it('renders NO empty-charts toggle while the group has no classified empty chart', () => {
    expect(html).not.toContain('data-role="group-empty-toggle"');
  });
});

describe('GroupToolbar empty-charts toggle', () => {
  // The module-scope group store outlives renders, so noting empty charts
  // before rendering mirrors a bundle fetch having classified the group.
  it('appears once empty charts are known, to the LEFT of the Reset button', () => {
    const slug = 'toolbar-empty-charts';
    noteChartRecentData(slug, 'c1', false);
    noteChartRecentData(slug, 'c2', false);
    const html = renderToStaticMarkup(<GroupToolbar groupSlug={slug} universe={UNIVERSE} />);
    expect(html).toContain('data-role="group-empty-toggle"');
    expect(html).toContain('Show 2 empty charts');
    expect(html).toMatch(/data-role="group-empty-toggle"[^>]*aria-pressed="false"/);
    const toggleIdx = html.indexOf('data-role="group-empty-toggle"');
    const resetIdx = html.indexOf('data-role="group-toolbar-reset"');
    expect(toggleIdx).toBeGreaterThanOrEqual(0);
    expect(toggleIdx).toBeLessThan(resetIdx);
  });

  it('singularizes the label and flips to "Hide" while revealed', () => {
    const slug = 'toolbar-empty-charts-one';
    noteChartRecentData(slug, 'c1', false);
    let html = renderToStaticMarkup(<GroupToolbar groupSlug={slug} universe={UNIVERSE} />);
    expect(html).toContain('Show 1 empty chart');
    expect(html).not.toContain('Show 1 empty charts');

    setShowEmptyCharts(slug, true);
    html = renderToStaticMarkup(<GroupToolbar groupSlug={slug} universe={UNIVERSE} />);
    expect(html).toContain('Hide 1 empty chart');
    expect(html).toMatch(/data-role="group-empty-toggle"[^>]*aria-pressed="true"/);
  });
});

describe('GroupToolbar cascading filters', () => {
  it('lets a series chip restore a globally hidden format', () => {
    const slug = 'toolbar-global-fallback';
    const universe = { ...UNIVERSE, formats: [...UNIVERSE.formats, 'lance'] };
    initGlobalFilter(universe, [], []);
    noteGroupSeries(slug, { lance: { format: 'lance' } });

    let html = renderToStaticMarkup(<GroupToolbar groupSlug={slug} universe={universe} />);
    expect(html).toMatch(/data-group-filter="series" data-value="lance" aria-pressed="false"/);

    toggleGroupSeries(slug, 'lance');
    html = renderToStaticMarkup(<GroupToolbar groupSlug={slug} universe={universe} />);
    expect(html).toMatch(/data-group-filter="series" data-value="lance" aria-pressed="true"/);
  });
});
