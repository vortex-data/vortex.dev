// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupSection } from '@/components/GroupSection';
import type { FilterUniverse } from '@/lib/chart-format';
import type { Group } from '@/lib/queries';

const UNIVERSE: FilterUniverse = {
  engines: ['datafusion', 'duckdb'],
  formats: ['parquet', 'vortex'],
};

/** The summary row's text, as a reader sees it. */
function summaryText(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.querySelector('summary')?.textContent ?? '';
}

const RANDOM_ACCESS: Group = {
  name: 'Random Access',
  slug: 'random_access.eyJrIjoiUmFuZG9tQWNjZXNzR3JvdXAifQ',
  charts: [
    { name: 'gnomad', slug: 'ra.eyJhIjoxfQ' },
    { name: 'taxi', slug: 'ra.eyJhIjoyfQ' },
  ],
  summary: {
    type: 'randomAccess',
    hotRankings: [{ name: 'vortex', score: 1, totalRuntime: 1_500_000, measured: 1, total: 1 }],
    coldRankings: [],
    explanation: 'lower is better',
  },
  description: 'Tests selecting arbitrary row indices on NVMe',
};

const TPCH: Group = {
  name: 'TPC-H NVMe SF=10',
  slug: 'query.eyJrIjoiUXVlcnlHcm91cCJ9',
  charts: [{ name: 'q1', slug: 'query.eyJhIjoxfQ' }],
  summary: {
    type: 'queryBenchmark',
    title: 'TPC-H',
    rankings: [
      { name: 'duckdb:vortex-file-compressed', score: 1, totalRuntime: 1, measured: 22, total: 22 },
      { name: 'duckdb:parquet', score: 2.5, totalRuntime: 2.5, measured: 22, total: 22 },
    ],
    explanation: 'lower is better',
  },
};

describe('GroupSection', () => {
  it('renders the group-details shell with a collapsed disclosure', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={5}
        universe={UNIVERSE}
      />,
    );
    expect(html).toContain('class="group-details"');
    expect(html).toContain('data-group-name="Random Access"');
    expect(html).toContain(`data-group-slug="${RANDOM_ACCESS.slug}"`);
    // The readable anchor is the section's id, the target of group
    // permalinks (`/#random-access`) - NOT the opaque API slug.
    expect(html).toContain('id="random-access"');
    // The disclosure is collapsed by default (no `open` attribute on the tag).
    expect(html).toContain('<details class="group-disclosure">');
    expect(html).toContain('<span class="group-name">Random Access</span>');
  });

  it('renders the description info-icon and a pluralized chart count', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    expect(html).toContain('class="group-info-icon"');
    expect(html).toContain('data-tooltip="Tests selecting arbitrary row indices on NVMe"');
    expect(html).toContain('2 charts');
  });

  it('links the group to its benchmark doc in the monorepo', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    expect(html).toContain('class="group-docs-link"');
    expect(html).toContain(
      'title="View a detailed description of the Random Access benchmark on GitHub"',
    );
    expect(html).toContain(
      'href="https://github.com/vortex-data/vortex/blob/develop/benchmarks/random-access-bench/README.md"',
    );
    expect(html).toContain('target="_blank"');
  });

  it('omits the docs link when the group slug does not parse', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={{ ...RANDOM_ACCESS, slug: 'not-a-slug' }}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    expect(html).not.toContain('group-docs-link');
  });

  it('renders the copy-link button in the summary header', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    expect(html).toContain('class="group-permalink"');
    expect(html).toContain('aria-label="Copy link to Random Access"');
  });

  it('renders the summary card after the disclosure, so a collapsed group shows it', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    // The `<details>` holds only the summary row; the card follows it, so the
    // browser shows the card whether the group is open or not.
    const card = html.indexOf('benchmark-scores-summary--random-access');
    expect(html).toContain('</summary></details>');
    expect(card).toBeGreaterThan(html.indexOf('</details>'));
    expect(card).toBeLessThan(html.indexOf('class="group-body"'));
    expect(html).toContain('>Hot</h3>');
  });

  it('renders an empty group body and no chart or toolbar markup while collapsed', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={5}
        universe={UNIVERSE}
      />,
    );
    // The body mounts its toolbar and chart cards only once the group opens.
    // It is the section's last child, after the disclosure and the card.
    expect(html).toContain('<div class="group-body"></div>');
    expect(html.endsWith('<div class="group-body"></div></section>')).toBe(true);
    expect(html).not.toContain('class="chart-card"');
    expect(html).not.toContain('data-role="group-toolbar"');
    expect(html).not.toContain('<canvas');
  });

  it('uses the singular "chart" label for a single-chart group and omits a missing description', () => {
    const single: Group = {
      name: 'Vector Search',
      slug: 'vs.eyJrIjoiVmVjdG9yU2VhcmNoR3JvdXAifQ',
      charts: [{ name: 'recall', slug: 'vs.eyJhIjoxfQ' }],
    };
    const html = renderToStaticMarkup(
      <GroupSection group={single} anchor="vector-search" startIndex={0} universe={UNIVERSE} />,
    );
    expect(html).toContain('<span class="group-count">1 chart</span>');
    expect(html).not.toContain('class="group-info-icon"');
    // A group with no summary renders no summary card.
    expect(html).not.toContain('class="benchmark-scores-summary"');
  });

  it('renders the headline as text inside the summary row', () => {
    const html = renderToStaticMarkup(
      <GroupSection group={TPCH} anchor="tpc-h-nvme-sf-10" startIndex={0} universe={UNIVERSE} />,
    );
    const row = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'));
    expect(row).toContain('class="group-headline"');
    expect(row).toContain('data-tone="better"');
    expect(summaryText(html)).toContain('DuckDB 2.5× faster than Parquet');
  });

  it('spells a slower result in words and marks partial coverage in the row', () => {
    const group: Group = {
      ...TPCH,
      summary: {
        type: 'queryBenchmark',
        title: 'TPC-H',
        explanation: 'lower is better',
        rankings: [
          {
            name: 'duckdb:vortex-file-compressed',
            score: 1,
            totalRuntime: 1,
            measured: 22,
            total: 22,
          },
          { name: 'duckdb:parquet', score: 2.5, totalRuntime: 1, measured: 22, total: 22 },
          {
            name: 'datafusion:vortex-file-compressed',
            score: 2,
            totalRuntime: 1,
            measured: 21,
            total: 22,
          },
          { name: 'datafusion:parquet', score: 1, totalRuntime: 1, measured: 22, total: 22 },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <GroupSection group={group} anchor="tpc-h-nvme-sf-10" startIndex={0} universe={UNIVERSE} />,
    );
    const row = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'));
    expect(row).toContain('data-tone="better"');
    expect(row).toContain('data-tone="worse"');
    expect(summaryText(html)).toContain(
      'DuckDB 2.5× faster · DataFusion 2.0× slower vs Parquet (partial)',
    );
  });

  it('renders no headline when the summary has no Vortex series', () => {
    const html = renderToStaticMarkup(
      <GroupSection
        group={RANDOM_ACCESS}
        anchor="random-access"
        startIndex={0}
        universe={UNIVERSE}
      />,
    );
    expect(html).not.toContain('group-headline');
  });
});
