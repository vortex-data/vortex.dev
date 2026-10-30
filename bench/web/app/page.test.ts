// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { renderToReadableStream, renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Group } from '@/lib/queries';

const { GROUPS, UNIVERSE, READ } = vi.hoisted(() => {
  const groups: Group[] = [
    {
      name: 'TPC-H NVMe SF=10',
      slug: 'query.eyJrIjoiUXVlcnlHcm91cCJ9',
      charts: [{ name: 'q1', slug: 'query.eyJhIjoxfQ' }],
      summary: {
        type: 'queryBenchmark',
        title: 'TPC-H',
        rankings: [
          {
            name: 'duckdb:vortex-file-compressed',
            score: 1,
            totalRuntime: 1,
            measured: 22,
            total: 22,
          },
          { name: 'duckdb:parquet', score: 2.5, totalRuntime: 2.5, measured: 22, total: 22 },
        ],
        explanation: 'lower is better',
      },
    },
    {
      name: 'Random Access',
      slug: 'random_access.eyJrIjoiUmFuZG9tQWNjZXNzR3JvdXAifQ',
      charts: [{ name: 'taxi', slug: 'ra.eyJhIjoyfQ' }],
      summary: {
        type: 'randomAccess',
        hotRankings: [{ name: 'vortex', score: 1, totalRuntime: 1_500_000, measured: 1, total: 1 }],
        coldRankings: [],
        explanation: 'lower is better',
      },
    },
  ];
  return {
    GROUPS: groups,
    UNIVERSE: { engines: ['duckdb'], formats: ['parquet', 'vortex'] },
    // How long the mocked group read takes: 0 is a Data Cache hit.
    READ: { ms: 0 },
  };
});

vi.mock('@/lib/data-cache', () => ({
  cachedGroups: () => new Promise((resolve) => setTimeout(() => resolve(GROUPS), READ.ms)),
  cachedFilterUniverse: async () => UNIVERSE,
}));

const { default: Home } = await import('@/app/page');

/** The landing page's server HTML, as a browser gets it. */
async function landingHtml(): Promise<string> {
  return renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
}

/** The landing page streamed as a browser gets it, in order, until done. */
async function streamedHtml(): Promise<string> {
  const stream = await renderToReadableStream(await Home({ searchParams: Promise.resolve({}) }));
  return new Response(stream).text();
}

/** The text a reader sees in `html` with JavaScript off: `<noscript>`
 * content shows, and anything `hidden` (or inside it) does not. */
function visibleText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const el of [...doc.querySelectorAll('[hidden], script, template')]) {
    el.remove();
  }
  return doc.body.textContent ?? '';
}

describe('the landing page', () => {
  it('sends every group as visible HTML, with no loading fallback in its place', async () => {
    const html = await landingHtml();
    const text = visibleText(html);
    expect(text).not.toContain('Loading benchmark summaries');
    for (const group of GROUPS) {
      expect(text).toContain(group.name);
    }
    // Each group's header row: its chart count and, here, its headline.
    expect(text).toContain('1 chart');
    expect(text).toContain('faster than Parquet');
    // Each group's summary table.
    expect(html.match(/class="benchmark-scores-summary/g)).toHaveLength(GROUPS.length);
  });

  it('opens <main> with a no-JavaScript note that says the summaries are complete', async () => {
    const html = await landingHtml();
    const note = html.indexOf(
      '<noscript><p class="no-script no-script--lead">These summaries are complete without JavaScript. The charts need it.</p></noscript>',
    );
    expect(note).toBeGreaterThan(html.indexOf('<main>'));
    expect(note).toBeLessThan(html.indexOf('class="group-details"'));
  });

  it('places the open-groups bootstrap before the first group and its finish step after the last', async () => {
    const html = await landingHtml();
    const bootstrap = html.indexOf('data-role="open-groups-bootstrap"');
    expect(bootstrap).toBeGreaterThan(0);
    expect(bootstrap).toBeLessThan(html.indexOf('class="group-details"'));
    expect(html.indexOf('data-role="open-groups-finish"')).toBeGreaterThan(
      html.lastIndexOf('class="group-details"'),
    );
  });

  it('streams the same page with no Suspense boundary on a fast read', async () => {
    const html = await streamedHtml();
    expect(html).not.toContain('Loading benchmark summaries');
    expect(html).not.toContain('<!--$?-->');
    expect(visibleText(html)).toContain(GROUPS[0]!.name);
  });

  describe('on a slow read (a Data Cache miss)', () => {
    afterEach(() => {
      READ.ms = 0;
    });

    it('stops waiting at the threshold and renders the loading view in a Suspense boundary', async () => {
      READ.ms = 400;
      const started = performance.now();
      const page = await Home({ searchParams: Promise.resolve({}) });
      const waited = performance.now() - started;
      expect(waited).toBeGreaterThanOrEqual(140);
      expect(waited).toBeLessThan(350);
      // The boundary's content awaits the read, so a render that cannot wait
      // shows the fallback: the loading view, which says to reload without
      // JavaScript. (Next.js streams the groups behind it; the browser checks
      // in the report cover that.)
      const html = renderToStaticMarkup(page);
      const text = visibleText(html);
      expect(text).toContain('Loading benchmark summaries');
      expect(text).toContain('Without JavaScript this page cannot finish loading.');
      expect(text).not.toContain(GROUPS[0]!.name);
    });

    it('renders the groups once the read finishes', async () => {
      READ.ms = 400;
      const html = await streamedHtml();
      expect(visibleText(html)).toContain(GROUPS[0]!.name);
    });
  });
});
