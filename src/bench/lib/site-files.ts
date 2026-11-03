// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The files crawlers and language models read on bench.vortex.dev:
 *
 * 1. `robots.txt`, which opens every page to crawlers and names the sitemap
 * 2. `sitemap.xml`, with the landing page, the methodology page and every chart
 * 3. `llms.txt` (https://llmstxt.org), the results of every group as text
 *
 * Each is a pure function of the groups `/api/groups` serves, so the routes in
 * `src/app/(bench)/bench` only read the data and send the text. Every URL is
 * bench's public one, whichever host serves the file.
 */

import { groupAnchors } from '@/bench/lib/anchor';
import { groupDocUrl } from '@/bench/lib/benchmark-docs';
import { formatCompressionSizeRatio, formatThroughput, formatTimeNs } from '@/bench/lib/format';
import { groupHeadline, headlineText } from '@/bench/lib/headline';
import { METHODOLOGY, SCORES } from '@/bench/lib/methodology';
import type { ChartResponse, Group, UnitKind } from '@/bench/lib/queries';
import type { SeriesRanking, Summary } from '@/bench/lib/summary';

/** bench's public origin. */
export const BENCH_URL = 'https://bench.vortex.dev';

/** What bench is, for the landing page's description and the top of `llms.txt`. */
export const BENCH_DESCRIPTION =
  'Benchmark results for Vortex, an open-source columnar file format, compared with ' +
  'Apache Parquet, Lance, and Arrow IPC: scan and write throughput, file size, random ' +
  'access, and TPC-H, TPC-DS, ClickBench, and other query suites on DuckDB and DataFusion.';

/** The landing page's sections link to their group by its readable anchor. */
function groupUrl(anchor: string): string {
  return `${BENCH_URL}/#${anchor}`;
}

/** A chart page's public URL. */
export function chartUrl(slug: string): string {
  return `${BENCH_URL}/chart/${slug}`;
}

/** A value in its unit, as `12.34 ms`, `1.21 GB`, `850 MB/s`. */
export function formatValue(value: number, unitKind: UnitKind): string {
  switch (unitKind) {
    case 'time_ns':
      return formatTimeNs(value);
    case 'bytes':
      return value >= 1e9
        ? `${(value / 1e9).toPrecision(3)} GB`
        : value >= 1e6
          ? `${(value / 1e6).toPrecision(3)} MB`
          : `${(value / 1e3).toPrecision(3)} kB`;
    case 'throughput_mb_s':
      return `${value.toFixed(0)} MB/s`;
    case 'ratio':
      return `${value.toFixed(2)}x`;
    case 'count':
      return String(value);
  }
}

/**
 * A chart page's description: each series' newest value, best first, and the
 * newest commit the chart holds. Throughput is best high; every other unit
 * this site charts is best low.
 */
export function chartDescription(chart: ChartResponse): string {
  const latest = Object.entries(chart.series).flatMap(([name, values]) => {
    const value = values.findLast((v): v is number => v !== null && Number.isFinite(v));
    return value === undefined ? [] : [{ name, value }];
  });
  const sign = chart.unit_kind === 'throughput_mb_s' ? -1 : 1;
  latest.sort((a, b) => sign * (a.value - b.value));
  const commit = chart.commits.at(-1);
  const values = latest
    .map(({ name, value }) => `${seriesLabel(name)} ${formatValue(value, chart.unit_kind)}`)
    .join(', ');
  return (
    `${chart.display_name}, the newest result of each series on Vortex's develop branch` +
    (commit === undefined ? '' : ` as of ${commit.timestamp.slice(0, 10)}`) +
    (values === '' ? '.' : `: ${values}.`)
  );
}

/**
 * schema.org `Dataset` markup for the landing page, naming each group as a
 * variable measured.
 */
export function datasetJsonLd(groups: readonly Group[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Vortex benchmark results',
    description: BENCH_DESCRIPTION,
    url: `${BENCH_URL}/`,
    isAccessibleForFree: true,
    keywords: [
      'Vortex',
      'columnar file format',
      'Apache Parquet',
      'Lance',
      'Arrow',
      'DuckDB',
      'DataFusion',
      'TPC-H',
      'TPC-DS',
      'ClickBench',
      'benchmark',
    ],
    creator: { '@type': 'Organization', name: 'Vortex', url: 'https://vortex.dev' },
    isBasedOn: 'https://github.com/vortex-data/vortex',
    measurementTechnique: `${BENCH_URL}/methodology`,
    variableMeasured: groups.map((group) => group.name),
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'text/markdown',
        contentUrl: `${BENCH_URL}/llms.txt`,
      },
    ],
  };
}

/**
 * JSON for an inline `<script type="application/ld+json">`. `<` is escaped,
 * so no value can close the script element.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}

export function robotsText(): string {
  return [
    '# Every page is open to crawlers, including AI crawlers.',
    `# ${BENCH_URL}/llms.txt holds every result as text, for language models.`,
    '# The JSON API is for the pages; llms.txt and the pages hold the same results.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${BENCH_URL}/sitemap.xml`,
    '',
  ].join('\n');
}

function escapeXml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function sitemapXml(groups: readonly Group[]): string {
  const urls = [
    `${BENCH_URL}/`,
    `${BENCH_URL}/methodology`,
    ...groups.flatMap((group) => group.charts.map((chart) => chartUrl(chart.slug))),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

const ENGINES: ReadonlyMap<string, string> = new Map([
  ['duckdb', 'DuckDB'],
  ['datafusion', 'DataFusion'],
]);

const FORMATS: ReadonlyMap<string, string> = new Map([
  ['vortex-file-compressed', 'Vortex'],
  ['vortex-compact', 'Vortex (compact)'],
  ['parquet', 'Parquet'],
  ['lance', 'Lance'],
  ['arrow-ipc', 'Arrow IPC'],
  ['arrow', 'Arrow'],
  ['duckdb', "DuckDB's own format"],
  ['fsst', 'FSST'],
]);

/**
 * A series in words: `engine:format` as "DataFusion on Parquet", a format alone
 * by its name. A name this table does not know stays as bench spells it.
 */
export function seriesLabel(name: string): string {
  const [first = '', second] = name.split(':');
  if (second === undefined) {
    return FORMATS.get(first) ?? first;
  }
  return `${ENGINES.get(first) ?? first} on ${FORMATS.get(second) ?? second}`;
}

function coverage(item: SeriesRanking, unit: string): string {
  return item.measured >= item.total
    ? `all ${item.total} ${unit}`
    : `${item.measured} of ${item.total} ${unit}; each missing one scored with a penalty`;
}

function timingLines(rankings: readonly SeriesRanking[], unit: string, runtime: string): string[] {
  return rankings.map(
    (item, idx) =>
      `${idx + 1}. ${seriesLabel(item.name)}: ${item.score.toFixed(2)}x the fastest` +
      (item.measured > 0 ? `, ${runtime} ${formatTimeNs(item.totalRuntime)}` : '') +
      ` (${coverage(item, unit)})`,
  );
}

/** One summary's rankings as Markdown lines, best first, with their units. */
export function summaryLines(summary: Summary): string[] {
  switch (summary.type) {
    case 'queryBenchmark':
      return [
        `Score: ${SCORES.query} Total: the sum of the newest time of each query.`,
        '',
        ...timingLines(summary.rankings, 'queries', 'total'),
      ];
    case 'vectorSearch':
      return [
        `Score: ${SCORES.query}`,
        '',
        ...timingLines(summary.rankings, 'thresholds', 'total'),
      ];
    case 'randomAccess':
      return [
        `Score: ${SCORES.randomAccess} Mean: the mean time per dataset.`,
        ...(
          [
            ['Hot (the accessor is reused after a one-second warm-up)', summary.hotRankings],
            ['Cold (a new accessor opens inside each timed take)', summary.coldRankings],
          ] as const
        ).flatMap(([title, rankings]) =>
          rankings.length === 0
            ? []
            : ['', `${title}:`, '', ...timingLines(rankings, 'datasets', 'mean')],
        ),
      ];
    case 'compression': {
      // The string encoding group compares its encoders with FSST.
      const baseline = summary.rankings.some((item) => item.name === 'fsst') ? 'FSST' : 'Parquet';
      return [
        `Score: ${SCORES.throughput.replace('Parquet', baseline)}`,
        ...(['encode', 'decode'] as const).flatMap((operation) => {
          const rankings = summary.rankings.filter((item) => item.operation === operation);
          return rankings.length === 0
            ? []
            : [
                '',
                `${operation === 'encode' ? 'Write' : 'Scan'} throughput:`,
                '',
                ...rankings.map(
                  (item, idx) =>
                    `${idx + 1}. ${seriesLabel(item.name)}: ` +
                    (seriesLabel(item.name) === baseline
                      ? 'the baseline'
                      : `${item.ratio.toFixed(2)}x ${baseline}`) +
                    (item.throughputGbS === undefined
                      ? ''
                      : `, ${formatThroughput(item.throughputGbS, operation)}`),
                ),
              ];
        }),
      ];
    }
    case 'compressionSize': {
      const baseline = summary.baseline ?? 'Parquet';
      return [
        `Score: ${SCORES.size.replace('Parquet', baseline)}`,
        '',
        ...summary.rankings.map(
          (item, idx) =>
            `${idx + 1}. ${seriesLabel(item.name)}: ` +
            (seriesLabel(item.name) === baseline
              ? 'the baseline'
              : `${formatCompressionSizeRatio(item.ratio)} the size of ${baseline} ` +
                `(from ${formatCompressionSizeRatio(item.minRatio)} ` +
                `to ${formatCompressionSizeRatio(item.maxRatio)} across datasets)`) +
            (item.compressionRatio === null
              ? ''
              : `, ${formatCompressionSizeRatio(item.compressionRatio)} smaller than Arrow in memory`),
        ),
      ];
    }
  }
}

/** `2026-11-03 14:05 UTC`. */
function utcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * `llms.txt`: what bench is, how it measures, and every group's summary in
 * words, with links to the group, its explainer and the methodology page.
 * `readAt` is when the summaries were read.
 */
export function llmsText(groups: readonly Group[], readAt: Date): string {
  const anchors = groupAnchors(groups.map((group) => group.name));
  const lines = [
    '# Vortex Benchmarks',
    '',
    `> ${BENCH_DESCRIPTION}`,
    '',
    `Vortex (https://vortex.dev) is an Apache-2.0 project of the Linux Foundation. ` +
      'The benchmarks run on every push to the `develop` branch of ' +
      'https://github.com/vortex-data/vortex and nightly, and each summary below uses each ' +
      `series' newest result there. These summaries were read at ${utcMinute(readAt)}.`,
    '',
    `How the benchmarks are run: ${BENCH_URL}/methodology`,
    '',
    '## Methodology',
    '',
    ...METHODOLOGY.flatMap((section) => [
      `### ${section.title}`,
      '',
      ...section.text.flatMap((paragraph) => [paragraph, '']),
    ]),
    '## Results',
    '',
  ];
  groups.forEach((group, i) => {
    lines.push(`### ${group.name}`, '');
    if (group.description !== undefined) {
      lines.push(`${group.description}.`, '');
    }
    // The landing page's headline, when it compares Vortex with Parquet.
    const headline = groupHeadline(group.summary);
    const headlineWords = headline === null ? '' : headlineText(headline);
    if (headlineWords.includes('Parquet')) {
      lines.push(`Vortex compared with Parquet: ${headlineWords}.`, '');
    }
    if (group.summary !== undefined) {
      lines.push(...summaryLines(group.summary), '');
    }
    const doc = groupDocUrl(group.slug);
    lines.push(
      `- [${group.name} charts](${groupUrl(anchors[i]!)}): ` +
        `${group.charts.length} ${group.charts.length === 1 ? 'chart' : 'charts'} ` +
        'of the results over recent commits',
    );
    if (doc !== null) {
      lines.push(`- [What ${group.name} measures](${doc})`);
    }
    lines.push('');
  });
  lines.push(
    '## Optional',
    '',
    `- [Methodology](${BENCH_URL}/methodology): the machines, engines, and scoring`,
    '- [Vortex documentation](https://docs.vortex.dev/llms.txt)',
    '- [Vortex homepage](https://vortex.dev/llms.txt)',
    '- [Benchmark source code](https://github.com/vortex-data/vortex/tree/develop/vortex-bench)',
    '',
  );
  return lines.join('\n');
}
