// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilterBar } from '@/components/FilterBar';
import { parseFilterCsv, seriesPassesFilter } from '@/lib/chart-format';
import { getGlobalFilterSnapshot } from '@/lib/chart-store';

const universe = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet', 'lance'] };

describe('global filter URL round trips', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function mount(): Promise<void> {
    const params = new URL(window.location.href).searchParams;
    root = createRoot(container);
    await act(async () => {
      root.render(
        <FilterBar
          universe={universe}
          initialEngines={parseFilterCsv(params.get('engine'))}
          initialFormats={parseFilterCsv(params.get('format'))}
        />,
      );
    });
  }

  async function click(dim: string, value: string): Promise<void> {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(`[data-filter="${dim}"][data-value="${value}"]`)!
        .click();
    });
  }

  async function reload(): Promise<void> {
    await act(async () => root.unmount());
    await mount();
  }

  it.each(['/', '/chart/qm.example'])(
    'preserves none and all formats after reload on %s',
    async (path) => {
      window.history.replaceState(
        null,
        '',
        `${path}?n=all&group=random-access&hide=duckdb&show=lance#random-access`,
      );
      await mount();
      expect(getGlobalFilterSnapshot().active.formats).toEqual(['vortex', 'parquet']);

      for (const engine of universe.engines) await click('engine', engine);
      for (const format of ['vortex', 'parquet']) await click('format', format);
      let url = new URL(window.location.href);
      expect(url.searchParams.get('engine')).toBe('');
      expect(url.searchParams.get('format')).toBe('');
      await reload();
      expect(getGlobalFilterSnapshot().active).toEqual({ engines: [], formats: [] });

      await click('engine', '*');
      await click('format', '*');
      url = new URL(window.location.href);
      expect(url.searchParams.has('engine')).toBe(false);
      expect(url.searchParams.get('format')).toBe('vortex,parquet,lance');
      expect(url.searchParams.get('n')).toBe('all');
      expect(url.searchParams.get('group')).toBe('random-access');
      expect(url.searchParams.get('hide')).toBe('duckdb');
      expect(url.searchParams.get('show')).toBe('lance');
      expect(url.hash).toBe('#random-access');
      expect(url.pathname).toBe(path);
      await reload();
      expect(getGlobalFilterSnapshot().active).toEqual(universe);
    },
  );

  it('keeps stale explicit allowlists filtered even when their length matches the universe', async () => {
    window.history.replaceState(null, '', '/?engine=duckdb,gone&format=vortex,old,older');
    await mount();
    const { active } = getGlobalFilterSnapshot();
    expect(seriesPassesFilter({ engine: 'datafusion', format: 'vortex' }, active, universe)).toBe(
      false,
    );
    expect(seriesPassesFilter({ engine: 'duckdb', format: 'lance' }, active, universe)).toBe(false);
    expect(container.querySelector('[data-role="filter-badge"]')?.textContent).toBe('3');
    await click('engine', '*');
    expect(new URL(window.location.href).searchParams.get('format')).toBe('vortex,old,older');
    await reload();
    expect(getGlobalFilterSnapshot().active.formats).toEqual(['vortex', 'old', 'older']);
  });
});
