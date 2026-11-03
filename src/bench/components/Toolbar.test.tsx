// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Toolbar } from '@/bench/components/Toolbar';

const UNIVERSE = { engines: ['datafusion', 'duckdb'], formats: ['parquet', 'vortex'] };

describe('Toolbar (server-rendered)', () => {
  const html = renderToStaticMarkup(
    <Toolbar universe={UNIVERSE} initialEngines={[]} initialFormats={[]} />,
  );

  it("titles the page, under the site's header", () => {
    expect(html).toMatch(/^<div class="bench-toolbar"><h1 class="bench-title">Benchmarks<\/h1>/);
  });

  it('renders expand/collapse-all controls in sentence case', () => {
    expect(html).toContain('data-action="expand-all"');
    expect(html).toContain('data-action="collapse-all"');
    expect(html).toContain('<span>Expand all</span>');
    expect(html).toContain('<span>Collapse all</span>');
  });

  // The site's header holds the wordmark and the GitHub button.
  it('holds no logo and no link', () => {
    expect(html).not.toMatch(/<a |<img /);
  });

  it('renders the theme toggle with the v3 server-default label', () => {
    expect(html).toContain('data-role="theme-toggle"');
    expect(html).toContain('data-next-theme="light"');
    expect(html).toContain('theme-toggle-label');
  });

  it('renders the global filter dropdown with one chip per universe value', () => {
    expect(html).toContain('data-role="global-filter-bar"');
    expect(html).toContain('data-role="filter-trigger"');
    expect(html).toContain('data-role="filter-panel"');
    for (const value of [...UNIVERSE.engines, ...UNIVERSE.formats]) {
      expect(html).toContain(`data-value="${value}"`);
    }
    // One "all" reset chip per dimension row.
    const allChips = html.match(/data-value="\*"/g);
    expect(allChips).toHaveLength(2);
  });

  it('marks every control that does nothing without JavaScript', () => {
    for (const control of [
      'data-action="expand-all"',
      'data-action="collapse-all"',
      'data-role="global-filter-bar"',
      'data-role="theme-toggle"',
    ]) {
      expect(html).toContain(`${control} data-requires-js="true"`);
    }
    expect(html.match(/data-requires-js/g)).toHaveLength(4);
  });

  it('omits the filter dropdown when the universe is empty', () => {
    const bare = renderToStaticMarkup(
      <Toolbar universe={{ engines: [], formats: [] }} initialEngines={[]} initialFormats={[]} />,
    );
    expect(bare).not.toContain('data-role="global-filter-bar"');
  });
});
