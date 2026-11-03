// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FilterBar } from '@/components/FilterBar';
import { parseFilterCsv, seriesPassesFilter } from '@/lib/chart-format';
import { getGlobalFilterSnapshot } from '@/lib/chart-store';
import { resetUrlWrites, URL_WRITE_DELAY_MS } from '@/lib/url-writes';

/** Fake the write scheduler's timers and its clock, `performance.now()`. */
function useFakeClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
}

const universe = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet', 'lance'] };

describe('global filter URL round trips', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetUrlWrites(window);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    resetUrlWrites(window);
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

  /** The URL once a pending write has landed: chip clicks inside the write delay wait for it. */
  async function settledUrl(): Promise<URL> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, URL_WRITE_DELAY_MS));
    });
    return new URL(window.location.href);
  }

  async function reload(): Promise<void> {
    await settledUrl();
    await act(async () => root.unmount());
    await mount();
  }

  it.each(['/', '/chart/qm.example'])(
    'preserves none and all formats after reload on %s',
    async (path) => {
      window.history.replaceState(
        null,
        '',
        `${path}?n=all&group=random-access&hide=duckdb&show=lance#random-access,tpc-h-nvme-sf-1`,
      );
      await mount();
      expect(getGlobalFilterSnapshot().active.formats).toEqual(['vortex', 'parquet']);

      for (const engine of universe.engines) await click('engine', engine);
      for (const format of ['vortex', 'parquet']) await click('format', format);
      let url = await settledUrl();
      expect(url.searchParams.get('engine')).toBe('');
      expect(url.searchParams.get('format')).toBe('');
      await reload();
      expect(getGlobalFilterSnapshot().active).toEqual({ engines: [], formats: [] });

      await click('engine', '*');
      await click('format', '*');
      url = await settledUrl();
      expect(url.searchParams.has('engine')).toBe(false);
      expect(url.searchParams.get('format')).toBe('vortex,parquet,lance');
      expect(url.searchParams.get('n')).toBe('all');
      expect(url.searchParams.get('group')).toBe('random-access');
      expect(url.searchParams.get('hide')).toBe('duckdb');
      expect(url.searchParams.get('show')).toBe('lance');
      expect(url.hash).toBe('#random-access,tpc-h-nvme-sf-1');
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
    expect((await settledUrl()).searchParams.get('format')).toBe('vortex,old,older');
    await reload();
    expect(getGlobalFilterSnapshot().active.formats).toEqual(['vortex', 'old', 'older']);
  });

  // Safari refuses more than 100 `history.replaceState` calls in 10 seconds, and Next.js adds one
  // of its own to each of ours, so the chips share the open groups' coalesced writes.
  it('writes the URL a few times for a burst of chip clicks, and ends current', async () => {
    window.history.replaceState(null, '', '/?n=all#tpc-h-nvme-sf-1');
    await mount();
    useFakeClock();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const writes: number[] = [];
    replaceState.mockImplementation(function (this: History, ...args) {
      writes.push(Date.now());
      return History.prototype.replaceState.apply(this, args);
    });

    // 200 clicks 25 ms apart: 5 seconds, twice Safari's budget of calls if each one wrote.
    for (let i = 0; i < 200; i += 1) {
      await click('engine', 'duckdb');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25);
      });
    }
    expect(writes.length).toBeLessThanOrEqual(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_WRITE_DELAY_MS);
    });
    expect(writes.length).toBeLessThanOrEqual(4);

    // 200 toggles leave duckdb as it started: on.
    const url = new URL(window.location.href);
    expect(url.searchParams.has('engine')).toBe(false);
    expect(url.searchParams.get('n')).toBe('all');
    expect(url.hash).toBe('#tpc-h-nvme-sf-1');

    // One more click after a quiet spell writes at once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(URL_WRITE_DELAY_MS);
    });
    await click('engine', 'duckdb');
    expect(new URL(window.location.href).searchParams.get('engine')).toBe('datafusion');
  });

  it('writes a pending chip change when the page is hidden', async () => {
    window.history.replaceState(null, '', '/chart/qm.example');
    await mount();
    useFakeClock();
    await click('format', 'vortex');
    await click('format', 'parquet');
    expect(new URL(window.location.href).searchParams.get('format')).toBe('parquet');

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(new URL(window.location.href).searchParams.get('format')).toBe('');
  });

  it('writes a pending chip change before a same-origin link is followed', async () => {
    window.history.replaceState(null, '', '/chart/qm.example');
    await mount();
    useFakeClock();
    await click('format', 'vortex');
    await click('format', 'parquet');
    expect(new URL(window.location.href).searchParams.get('format')).toBe('parquet');

    const link = document.createElement('a');
    link.href = '/';
    link.addEventListener('click', (event) => event.preventDefault());
    document.body.appendChild(link);
    await act(async () => {
      link.click();
    });
    link.remove();
    expect(new URL(window.location.href).searchParams.get('format')).toBe('');
  });
});
