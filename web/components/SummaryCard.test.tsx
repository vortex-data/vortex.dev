// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SummaryCard } from '@/components/SummaryCard';
import type { Summary } from '@/lib/summary';

function render(summary?: Summary): string {
  return renderToStaticMarkup(<SummaryCard summary={summary} />);
}

describe('SummaryCard', () => {
  it('renders nothing when there is no summary', () => {
    expect(render(undefined)).toBe('');
  });

  it('renders hot and cold random-access rankings', () => {
    const html = render({
      type: 'randomAccess',
      hotRankings: [
        { name: 'vortex', score: 1, totalRuntime: 1_500_000, measured: 2, total: 2 },
        { name: 'parquet', score: 2, totalRuntime: 3_000_000, measured: 2, total: 2 },
      ],
      coldRankings: [{ name: 'parquet', score: 1, totalRuntime: 4_000_000, measured: 2, total: 2 }],
      explanation: 'Geomean of take time ratio to fastest across every dataset (lower is better)',
    });
    expect(html).toContain('benchmark-scores-summary--random-access');
    expect(html).toContain('aria-label="Hot and Cold Random Access"');
    expect(html).toContain('>Hot</h3>');
    expect(html).toContain('>Cold</h3>');
    expect(html).toContain('opens a new accessor inside each timed take');
    expect(html).toContain('It does not clear the OS page cache.');
    expect(html).toContain('#1');
    expect(html).toContain('vortex');
    expect(html).toContain('1.50 ms');
    expect(html).toContain('1.00x');
    expect(html).toContain('#2');
    expect(html).toContain('parquet');
    expect(html).toContain('3.00 ms');
    expect(html).toContain('2.00x');
    expect(html).toContain('4.00 ms');
    expect(html).toContain(
      'Geomean of take time ratio to fastest across every dataset (lower is better)',
    );
  });

  it('flags a partially measured series in its hover text', () => {
    const html = render({
      type: 'randomAccess',
      hotRankings: [
        { name: 'vortex', score: 1, totalRuntime: 1_500_000, measured: 9, total: 9 },
        { name: 'lance', score: 3, totalRuntime: 3_000_000, measured: 4, total: 9 },
        { name: 'arrow-ipc', score: 4, totalRuntime: 0, measured: 0, total: 9 },
      ],
      coldRankings: [],
      explanation: 'e',
    });
    // The full-coverage series keeps a bare label; the partial one says so, so
    // a penalty-inflated score is never presented as a like-for-like number.
    expect(html).toContain('title="vortex"');
    expect(html).toContain('measured in 4 of 9 datasets');
    expect(html).toContain('measured in 0 of 9 datasets');
    expect(html).toContain('<span class="score-runtime">—</span>');
    expect(html).toContain('random-access-scores--single');
    expect(html).toContain('aria-label="Hot Random Access"');
    expect(html).not.toContain('aria-label="Hot and Cold Random Access"');
    expect(html).not.toContain('>Cold</h3>');
  });

  it('renders nothing for a randomAccess card with no rankings', () => {
    expect(
      render({ type: 'randomAccess', hotRankings: [], coldRankings: [], explanation: 'e' }),
    ).toBe('');
  });

  it('uses two columns only for timing summaries with at least five results', () => {
    const ranking = (index: number) => ({
      name: `format-${index}`,
      score: index + 1,
      totalRuntime: 1_000,
      measured: 1,
      total: 1,
    });
    const fourResults = render({
      type: 'randomAccess',
      hotRankings: Array.from({ length: 4 }, (_, index) => ranking(index)),
      coldRankings: [],
      explanation: 'lower is better',
    });
    const fiveResults = render({
      type: 'queryBenchmark',
      title: 'Performance Summary',
      rankings: Array.from({ length: 5 }, (_, index) => ranking(index)),
      explanation: 'lower is better',
    });

    expect(fourResults).toContain('class="scores-list random-access-scores-list"');
    expect(fourResults).not.toContain('scores-list--split');
    expect(fiveResults).toContain('class="scores-list scores-list--split"');
  });

  it('renders compression rankings with ratios and aggregate throughput', () => {
    const html = render({
      type: 'compression',
      title: 'Write Throughput',
      rankings: [
        {
          name: 'vortex-file-compressed',
          operation: 'encode',
          ratio: 2.5,
          throughputGbS: 6.25,
        },
        { name: 'parquet', operation: 'encode', ratio: 1 },
        { name: 'lance', operation: 'encode', ratio: 0.8 },
        {
          name: 'vortex-file-compressed',
          operation: 'decode',
          ratio: 1.8,
          throughputGbS: 4.5,
        },
        { name: 'parquet', operation: 'decode', ratio: 1 },
        { name: 'lance', operation: 'decode', ratio: 0.6 },
      ],
      explanation: 'higher is better',
    });
    expect(html).toContain('aria-label="Write Throughput and Scan Throughput"');
    expect(html).toContain('<h3 class="scores-title">Write Throughput</h3>');
    expect(html).toContain('<h3 class="scores-title">Scan Throughput</h3>');
    expect(html).not.toContain('compression-scores-subtitle');
    expect(html).toContain('class="compression-scores-panel"');
    expect(html).toContain('>vortex</span>');
    expect(html).toContain('2.50x');
    expect(html).toContain('>lance</span>');
    expect(html).toContain('1.80x');
    expect(html).toContain('6250 MB/s');
    expect(html).toContain('4.50 GB/s');
    expect(html).not.toContain('6.25 GB/s');
    expect(html.match(/#1/g)).toHaveLength(2);
  });

  it('renders nothing for a compression card with no rankings', () => {
    expect(render({ type: 'compression', title: 't', rankings: [], explanation: 'e' })).toBe('');
  });

  it('renders Parquet size ranges and in-memory Arrow compression ratios', () => {
    const html = render({
      type: 'compressionSize',
      title: 'Compression Size Summary',
      rankings: [
        {
          name: 'vortex-file-compressed',
          minRatio: 0.55,
          ratio: 0.45,
          maxRatio: 1.55,
          compressionRatio: 8.25,
        },
        {
          name: 'parquet',
          minRatio: 1,
          ratio: 1,
          maxRatio: 1,
          compressionRatio: 4.5,
        },
        {
          name: 'lance',
          minRatio: 1.1,
          ratio: 1.2,
          maxRatio: 1.3,
          compressionRatio: null,
        },
      ],
      explanation: 'higher is better',
    });
    expect(html).not.toContain('<h3 class="scores-title">Compression Size Summary</h3>');
    expect(html).toContain('class="compression-size-scores"');
    expect(html).toContain('Vs Arrow');
    expect(html).toContain('Vs Parquet');
    expect(html).not.toContain('GeoMean');
    expect(html.match(/📊 Mean/g)).toHaveLength(1);
    expect(html).toContain('⬇️ Min');
    expect(html).toContain('⬆️ Max');
    expect(html).toContain('class="score-value compression-size-value">8.25x</span>');
    expect(html).toContain('class="score-runtime compression-size-value">0.55x</span>');
    expect(html).toContain('class="score-value compression-size-value">0.45x</span>');
    expect(html).toContain('class="score-runtime compression-size-value">1.55x</span>');
    expect(html.indexOf('8.25x')).toBeLessThan(html.indexOf('0.55x'));
    expect(html).toContain('parquet');
    expect(html).toContain('lance');
    expect(html).toContain('class="score-rank">#3</span>');
    expect(html).toContain('class="score-value compression-size-value">—</span>');
    expect(html).toContain(
      'class="visually-hidden">vortex: minimum 0.55x, mean 0.45x, maximum 1.55x</span>',
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('GB');
  });

  it('renders a queryBenchmark card with scores and total runtimes', () => {
    const html = render({
      type: 'queryBenchmark',
      title: 'Performance Summary',
      rankings: [
        {
          name: 'vortex:vortex-file',
          score: 1.0,
          totalRuntime: 5_000_000_000,
          measured: 1,
          total: 1,
        },
      ],
      explanation: 'lower is better',
    });
    expect(html).toContain('#1');
    expect(html).toContain('vortex:vortex-file');
    expect(html).toContain('1.00x');
    expect(html).toContain('5.00 s');
  });

  it('renders a vectorSearch card through the shared timing arm', () => {
    const html = render({
      type: 'vectorSearch',
      title: 'Vector Search Performance',
      rankings: [
        { name: 'vortex-turboquant', score: 1.0, totalRuntime: 7_000, measured: 2, total: 2 },
      ],
      explanation: 'lower is better',
    });
    expect(html).toContain('<h3 class="scores-title">Vector Search Performance</h3>');
    expect(html).toContain('vortex-turboquant');
    expect(html).toContain('1.00x');
  });
});
