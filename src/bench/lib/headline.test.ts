// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { groupHeadline, headlineText } from '@/lib/headline';
import type { SeriesRanking, Summary } from '@/lib/summary';

const VX = 'vortex-file-compressed';
const r = (name: string, score: number, measured = 10, total = 10): SeriesRanking => ({
  name,
  score,
  totalRuntime: 1,
  measured,
  total,
});
const vx = (engine: string, score = 1, measured = 10) => r(`${engine}:${VX}`, score, measured);
const pq = (engine: string, score: number, measured = 10) =>
  r(`${engine}:parquet`, score, measured);
const query = (...rankings: SeriesRanking[]): Summary => ({
  type: 'queryBenchmark',
  title: 'q',
  rankings,
  explanation: 'e',
});
const compression = (...rows: [string, 'encode' | 'decode', number][]): Summary => ({
  type: 'compression',
  title: 'Write Throughput',
  explanation: 'e',
  rankings: rows.map(([name, operation, ratio]) => ({ name, operation, ratio })),
});
const ra = (hot: SeriesRanking[], cold: SeriesRanking[]): Summary => ({
  type: 'randomAccess',
  hotRankings: hot,
  coldRankings: cold,
  explanation: 'e',
});
const vs = (...rankings: SeriesRanking[]): Summary => ({
  type: 'vectorSearch',
  title: 'v',
  rankings,
  explanation: 'e',
});
const line = (s: Summary | undefined) => {
  const h = groupHeadline(s);
  return h && headlineText(h);
};

describe('groupHeadline', () => {
  it('compares Vortex with Parquet per engine, DuckDB first', () => {
    const s = query(
      vx('datafusion'),
      pq('duckdb', 2.5),
      pq('datafusion', 2.3),
      vx('duckdb'),
      r('duckdb:vortex-compact', 0.5),
    );
    expect(line(s)).toBe('DuckDB 2.5× · DataFusion 2.3× faster than Parquet');
    expect(groupHeadline(s)?.parts.map((p) => p.tone)).toEqual(['better', 'better']);
  });

  it.each([
    [2.5, 'DuckDB 2.5× faster than Parquet'],
    [0.25, 'DuckDB 4.0× slower than Parquet'],
    [1.05, 'DuckDB ≈ same vs Parquet'],
    [0.95, 'DuckDB ≈ same vs Parquet'],
    [1.06, 'DuckDB 1.1× faster than Parquet'],
    [0.94, 'DuckDB 1.1× slower than Parquet'],
    [9.96, 'DuckDB 10× faster than Parquet'],
    [60.4, 'DuckDB 60× faster than Parquet'],
  ])('reads a Parquet-to-Vortex score ratio of %s as "%s"', (ratio, expected) => {
    expect(line(query(vx('duckdb'), pq('duckdb', ratio)))).toBe(expected);
  });

  it('gives each engine its own verdict when they disagree', () => {
    expect(
      line(query(vx('duckdb'), pq('duckdb', 2.5), vx('datafusion', 2), pq('datafusion', 1))),
    ).toBe('DuckDB 2.5× faster · DataFusion 2.0× slower vs Parquet');
  });

  it('marks partial coverage', () => {
    expect(line(query(vx('duckdb', 1, 9), pq('duckdb', 2.5)))).toBe(
      'DuckDB 2.5× faster than Parquet (partial)',
    );
  });

  it('reads "Vortex only" when no engine ran Parquet', () => {
    expect(line(query(vx('datafusion'), r('duckdb:vortex-compact', 1)))).toBe('Vortex only');
    expect(line(query(vx('datafusion', 1, 9)))).toBe('Vortex only (partial)');
  });

  it('leaves out an engine that ran only Vortex', () => {
    expect(line(query(vx('duckdb'), pq('duckdb', 2.5), vx('datafusion')))).toBe(
      'DuckDB 2.5× faster than Parquet',
    );
  });

  // Its Parquet result is one the row would otherwise hide.
  it('marks partial when it leaves out an engine that ran only Parquet', () => {
    expect(line(query(vx('duckdb'), pq('duckdb', 2.5), pq('datafusion', 1)))).toBe(
      'DuckDB 2.5× faster than Parquet (partial)',
    );
    expect(
      line(query(pq('duckdb', 0.25), vx('duckdb'), vx('datafusion', 1, 0), pq('datafusion', 1))),
    ).toBe('DuckDB 4.0× slower than Parquet (partial)');
  });

  it('orders unknown engines after DuckDB and DataFusion, by name, and labels them by name', () => {
    expect(
      line(
        query(
          vx('polars'),
          pq('polars', 2),
          vx('arrow'),
          pq('arrow', 4),
          vx('datafusion'),
          pq('datafusion', 3),
          vx('duckdb'),
          pq('duckdb', 5),
        ),
      ),
    ).toBe('DuckDB 5.0× · DataFusion 3.0× · arrow 4.0× · polars 2.0× faster than Parquet');
  });

  it.each([
    [9.94, 'DuckDB 9.9× faster than Parquet'],
    [9.95, 'DuckDB 10× faster than Parquet'],
    [0.05, 'DuckDB 20× slower than Parquet'],
  ])('reads a ratio of %s at a display boundary as "%s"', (ratio, expected) => {
    expect(line(query(vx('duckdb'), pq('duckdb', ratio)))).toBe(expected);
  });

  it.each([
    ['no summary', undefined],
    ['only Parquet', query(pq('duckdb', 1))],
    ['an unmeasured Vortex series', query(vx('duckdb', 1, 0), pq('duckdb', 2))],
    ['a zero score', query(vx('duckdb', 0), pq('duckdb', 2))],
    ['compression without Vortex', compression(['parquet', 'encode', 1])],
    [
      'ratios that are not positive and finite',
      compression([VX, 'encode', 0], [VX, 'decode', Number.NaN]),
    ],
    [
      'an empty size summary',
      { type: 'compressionSize', title: 's', rankings: [], explanation: 'e' },
    ],
    ['empty random-access rankings', ra([], [])],
    ['unmeasured vector-search flavors', vs(r('vortex-turboquant', 1, 0))],
  ])('shows no headline for %s', (_case, summary) => {
    expect(groupHeadline(summary as Summary | undefined)).toBeNull();
  });

  it('reads encode and decode throughput against Parquet', () => {
    expect(
      line(
        compression(
          [VX, 'encode', 1.6],
          [VX, 'decode', 5.1],
          ['parquet', 'encode', 1],
          ['lance', 'decode', 0.6],
        ),
      ),
    ).toBe('encode 1.6× · decode 5.1× faster than Parquet');
    expect(line(compression([VX, 'encode', 0.5], [VX, 'decode', 5.1]))).toBe(
      'encode 2.0× slower · decode 5.1× faster vs Parquet',
    );
  });

  // A multiple once Vortex is twice Parquet's size (by the printed percentage)
  // or half of it, so no size ever reads "100% larger" or "100% smaller".
  it.each([
    [1.07, '7% larger than Parquet', 'worse'],
    [0.85, '15% smaller than Parquet', 'better'],
    [1.004, 'same size as Parquet', 'same'],
    [0.996, 'same size as Parquet', 'same'],
    [2.4, '2.4× larger than Parquet', 'worse'],
    [1.994, '99% larger than Parquet', 'worse'],
    [1.995, '2.0× larger than Parquet', 'worse'],
    [2.0, '2.0× larger than Parquet', 'worse'],
    [0.505, '50% smaller than Parquet', 'better'],
    [0.5, '2.0× smaller than Parquet', 'better'],
    [0.004, '250× smaller than Parquet', 'better'],
  ])('reads a size ratio of %s as "%s"', (ratio, expected, tone) => {
    const h = groupHeadline({
      type: 'compressionSize',
      title: 's',
      explanation: 'e',
      rankings: [{ name: VX, minRatio: ratio, ratio, maxRatio: ratio, compressionRatio: 5 }],
    });
    expect(h && headlineText(h)).toBe(expected);
    expect(h?.parts[0]?.tone).toBe(tone);
  });

  it('reads hot and cold random access against Parquet', () => {
    expect(line(ra([r(VX, 1), r('parquet', 60.4)], [r(VX, 1), r('parquet', 32)]))).toBe(
      'hot 60× · cold 32× faster than Parquet',
    );
    expect(line(ra([r(VX, 1), r('parquet', 60.4, 1, 2)], []))).toBe(
      'hot 60× faster than Parquet (partial)',
    );
  });

  it('reads random access as "Vortex only" when neither side ran Parquet', () => {
    expect(line(ra([r(VX, 1)], [r(VX, 1)]))).toBe('Vortex only');
    expect(line(ra([r(VX, 1)], [r(VX, 1, 3, 4), r('parquet', 2, 0)]))).toBe(
      'Vortex only (partial)',
    );
  });

  it('marks random access partial when one side ran only Parquet', () => {
    expect(line(ra([r(VX, 1), r('parquet', 60.4)], [r('parquet', 32)]))).toBe(
      'hot 60× faster than Parquet (partial)',
    );
  });

  it('names the fastest measured vector-search flavor', () => {
    expect(line(vs(r('vortex-turboquant', 1), r('vortex-default', 1.4)))).toBe(
      'fastest: vortex-turboquant',
    );
    expect(line(vs(r('vortex-turboquant', 1, 0), r('vortex-default', 1.4)))).toBe(
      'fastest: vortex-default',
    );
    expect(groupHeadline(vs(r('vortex-turboquant', 1)))?.parts[0]?.tone).toBe('neutral');
  });

  it('names the first of tied vector-search flavors and skips a score that is not a number', () => {
    expect(line(vs(r('vortex-default', 1.4), r('vortex-turboquant', 1.4)))).toBe(
      'fastest: vortex-default',
    );
    expect(line(vs(r('vortex-turboquant', Number.NaN), r('vortex-default', 1.4)))).toBe(
      'fastest: vortex-default',
    );
    expect(line(vs(r('vortex-turboquant', Number.NaN)))).toBeNull();
  });
});
