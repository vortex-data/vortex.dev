// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GroupToolbar } from '@/bench/components/GroupToolbar';
import { defined } from '@/lib/defined';
import {
  applyGroupMacro,
  getGroupSnapshot,
  initGlobalFilter,
  noteGroupSeries,
  toggleGroupSeries,
} from '@/bench/lib/chart-store';

const UNIVERSE = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] };

// Each row's "all" chip turns its own row back on and leaves the other rows'
// choices alone.
describe("GroupToolbar's all chips", () => {
  let root: Root | null = null;
  const host = document.createElement('div');

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    initGlobalFilter(UNIVERSE, null, null);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
  });

  /** Mount a group with one choice in each row, and click one row's "all" chip. */
  function clickAll(slug: string, dim: 'engine' | 'format' | 'series'): void {
    noteGroupSeries(slug, {
      'datafusion:parquet': { engine: 'datafusion', format: 'parquet' },
      'datafusion:vortex': { engine: 'datafusion', format: 'vortex' },
      'duckdb:parquet': { engine: 'duckdb', format: 'parquet' },
      'duckdb:vortex': { engine: 'duckdb', format: 'vortex' },
    });
    applyGroupMacro(slug, 'engine', 'datafusion');
    applyGroupMacro(slug, 'format', 'parquet');
    toggleGroupSeries(slug, 'duckdb:vortex');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<GroupToolbar groupSlug={slug} universe={UNIVERSE} />);
    });
    const chip = defined(
      host.querySelector<HTMLButtonElement>(`[data-group-filter="${dim}"][data-value="*"]`),
    );
    act(() => chip.click());
  }

  it('in the Engine row clears only the engines', () => {
    clickAll('rows-engine', 'engine');
    const snapshot = getGroupSnapshot('rows-engine');
    expect(snapshot.hiddenEngines).toEqual([]);
    expect(snapshot.hiddenFormats).toEqual(['parquet']);
    expect(snapshot.hiddenSeries).toEqual(['duckdb:vortex']);
  });

  it('in the Format row clears only the formats', () => {
    clickAll('rows-format', 'format');
    const snapshot = getGroupSnapshot('rows-format');
    expect(snapshot.hiddenEngines).toEqual(['datafusion']);
    expect(snapshot.hiddenFormats).toEqual([]);
    expect(snapshot.hiddenSeries).toEqual(['duckdb:vortex']);
  });

  it('in the Series row clears only the series', () => {
    clickAll('rows-series', 'series');
    const snapshot = getGroupSnapshot('rows-series');
    expect(snapshot.hiddenEngines).toEqual(['datafusion']);
    expect(snapshot.hiddenFormats).toEqual(['parquet']);
    expect(snapshot.hiddenSeries).toEqual([]);
  });
});
