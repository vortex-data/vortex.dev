// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import type { ChartResponse, Group } from '@/bench/lib/queries';
import {
  chartDescription,
  chartSeriesLabel,
  datasetJsonLd,
  jsonLdScript,
  llmsText,
  robotsText,
  seriesLabel,
  sitemapXml,
  summaryLines,
} from '@/bench/lib/site-files';

const VX = 'vortex-file-compressed';

const groups: Group[] = [
  {
    name: 'Compression',
    slug: 'ctg.eyJrIjoiQ29tcHJlc3Npb25UaW1lR3JvdXAifQ',
    charts: [{ name: 'taxi', slug: 'ct.taxi' }],
    description: 'Measures write and scan throughput for Vortex, Parquet, and Lance files',
    summary: {
      type: 'compression',
      title: 'Write Throughput',
      explanation: 'e',
      rankings: [
        { name: VX, operation: 'encode', ratio: 2.04, throughputGbS: 1.97 },
        { name: 'parquet', operation: 'encode', ratio: 1, throughputGbS: 1.15 },
        { name: VX, operation: 'decode', ratio: 5.18, throughputGbS: 51.09 },
        { name: 'parquet', operation: 'decode', ratio: 1, throughputGbS: 9.9 },
      ],
    },
  },
  {
    name: 'Clickbench',
    slug: 'qmg.clickbench',
    charts: [
      { name: 'Q0', slug: 'qm.q0' },
      { name: 'Q1', slug: 'qm.a&b' },
    ],
    summary: {
      type: 'queryBenchmark',
      title: 'Performance Summary',
      explanation: 'e',
      rankings: [
        { name: `duckdb:${VX}`, score: 1, totalRuntime: 3_657_835_993, measured: 43, total: 43 },
        { name: 'datafusion:parquet', score: 1.6, totalRuntime: 5e9, measured: 40, total: 43 },
      ],
    },
  },
];

describe('robotsText', () => {
  it('opens bench to every crawler but the API, and names the sitemap', () => {
    const text = robotsText();
    expect(text).toContain('User-agent: *\nAllow: /\nDisallow: /api/\n');
    expect(text).toContain('Sitemap: https://bench.vortex.dev/sitemap.xml');
  });
});

describe('sitemapXml', () => {
  it('lists the landing page, the methodology page and every chart, escaped', () => {
    const xml = sitemapXml(groups);
    expect(xml.match(/<loc>[^<]*<\/loc>/g)).toEqual([
      '<loc>https://bench.vortex.dev/</loc>',
      '<loc>https://bench.vortex.dev/methodology</loc>',
      '<loc>https://bench.vortex.dev/chart/ct.taxi</loc>',
      '<loc>https://bench.vortex.dev/chart/qm.q0</loc>',
      '<loc>https://bench.vortex.dev/chart/qm.a&amp;b</loc>',
    ]);
  });
});

describe('seriesLabel', () => {
  it('names engines and formats in words, and keeps names it does not know', () => {
    expect(seriesLabel(`datafusion:${VX}`)).toBe('DataFusion on Vortex');
    expect(seriesLabel('duckdb:duckdb')).toBe("DuckDB on DuckDB's own format");
    expect(seriesLabel('arrow-ipc')).toBe('Arrow IPC');
    expect(seriesLabel('onpair-12')).toBe('onpair-12');
  });
});

describe('chartSeriesLabel', () => {
  it("reads each chart kind's series keys", () => {
    expect(chartSeriesLabel('QueryMeasurement', `duckdb:${VX}`)).toBe('DuckDB on Vortex');
    expect(chartSeriesLabel('CompressionTime', `${VX}:encode`)).toBe('Vortex write');
    expect(chartSeriesLabel('CompressionTime', 'parquet:decode')).toBe('Parquet scan');
    expect(chartSeriesLabel('RandomAccess', 'parquet:hot')).toBe('Parquet (hot)');
    expect(chartSeriesLabel('CompressionSize', 'lance')).toBe('Lance');
    expect(chartSeriesLabel('VectorSearch', 'flat')).toBe('flat');
  });
});

describe('summaryLines', () => {
  it('gives a query ranking with its time and coverage', () => {
    expect(summaryLines(groups[1]!.summary!).slice(2)).toEqual([
      '1. DuckDB on Vortex: 1.00x the fastest, total 3.66 s (all 43 queries)',
      '2. DataFusion on Parquet: 1.60x the fastest, total 5.00 s ' +
        '(40 of 43 queries; each missing one scored with a penalty)',
    ]);
  });

  it('gives write and scan throughput against Parquet', () => {
    const lines = summaryLines(groups[0]!.summary!);
    expect(lines).toContain('1. Vortex: 2.04x Parquet, 1970 MB/s');
    expect(lines).toContain('1. Vortex: 5.18x Parquet, 51.09 GB/s');
  });

  it('compares string encoders with FSST', () => {
    const lines = summaryLines({
      type: 'compression',
      title: 'Write Throughput',
      explanation: 'e',
      rankings: [{ name: 'fsst', operation: 'encode', ratio: 1 }],
    });
    expect(lines[0]).toContain('divided by FSST’s');
    expect(lines).toContain('1. FSST: the baseline');
  });

  it('gives sizes against Parquet and Arrow', () => {
    expect(
      summaryLines({
        type: 'compressionSize',
        title: 't',
        explanation: 'e',
        rankings: [
          { name: VX, minRatio: 0.677, ratio: 1.137, maxRatio: 1.549, compressionRatio: 5.744 },
        ],
      }).at(-1),
    ).toBe(
      '1. Vortex: 1.14x the size of Parquet (from 0.677x to 1.55x across datasets), ' +
        '5.74x smaller than Arrow in memory',
    );
  });
});

describe('llmsText', () => {
  const text = llmsText(groups, new Date('2026-11-03T14:05:30Z'));

  it('follows llms.txt: a title, a summary quote, then sections', () => {
    expect(text.startsWith('# Vortex Benchmarks\n\n> Benchmark results for Vortex')).toBe(true);
    expect(text).toContain('## Methodology\n');
    expect(text).toContain('## Results\n');
    expect(text).toContain('## Optional\n');
  });

  it('dates the summaries', () => {
    expect(text).toContain('These summaries were read at 2026-11-03 14:05 UTC.');
  });

  it("gives each group's headline, rankings and links", () => {
    expect(text).toContain(
      '### Compression\n\nMeasures write and scan throughput for Vortex, Parquet, and Lance files.',
    );
    expect(text).toContain('Vortex compared with Parquet: ');
    expect(text).toContain('- [Clickbench charts](https://bench.vortex.dev/#clickbench)');
    expect(text).toContain(
      '- [What Compression measures](https://github.com/vortex-data/vortex/blob/develop/benchmarks/compress-bench/README.md)',
    );
  });
});

describe('chartDescription', () => {
  const chart = (unit_kind: ChartResponse['unit_kind']): ChartResponse => ({
    display_name: 'clickbench Q0',
    unit_kind,
    history: { total_commits: 2, start_index: 0, loaded_commits: 2, complete: true },
    commits: [
      { sha: 'a', timestamp: '2026-11-01T00:00:00Z', message: '', url: '' },
      { sha: 'b', timestamp: '2026-11-02T00:00:00Z', message: '', url: '' },
    ],
    series: {
      'datafusion:parquet': [3e6, 2e6],
      [`datafusion:${VX}`]: [1e6, null],
      'datafusion:lance': [null, null],
    },
  });

  it("gives each series' newest value, best first, and the newest commit's date", () => {
    expect(chartDescription(chart('time_ns'), 'QueryMeasurement')).toBe(
      "clickbench Q0, the newest result of each series on Vortex's develop branch as of " +
        '2026-11-02: DataFusion on Vortex 1.00 ms, DataFusion on Parquet 2.00 ms.',
    );
  });

  it('puts the highest throughput first', () => {
    expect(chartDescription(chart('throughput_mb_s'), 'QueryMeasurement')).toContain(
      'DataFusion on Parquet 2000000 MB/s, DataFusion on Vortex 1000000 MB/s.',
    );
  });
});

describe('the Dataset JSON-LD', () => {
  it('names every group as a variable measured', () => {
    expect(datasetJsonLd(groups).variableMeasured).toEqual(['Compression', 'Clickbench']);
  });

  it('cannot close its script element', () => {
    expect(jsonLdScript({ name: '</script><script>' })).toBe(
      '{"name":"\\u003c/script>\\u003cscript>"}',
    );
  });
});
