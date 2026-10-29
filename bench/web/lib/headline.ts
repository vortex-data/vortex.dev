// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * The one-line headline on a folded landing-page group: how Vortex compares
 * with Parquet, derived from the `summary` the group already carries.
 *
 * Pure and server-safe. It reads the same rankings the summary card shows and
 * does no new math beyond one ratio per part. It never invents a number: when
 * the series it needs are missing, unmeasured or degenerate it returns `null`
 * and the row shows no headline.
 *
 * Every verdict is spelled in words ("4.0× slower"), so a result that looks
 * bad for Vortex reads as plainly as a good one. `tone` only lets the page
 * style a part; it never carries the meaning alone.
 */

import { displayFormat } from '@/lib/chart-format';
import type { SeriesRanking, Summary } from '@/lib/summary';

export type HeadlineTone = 'better' | 'worse' | 'same' | 'neutral';

export interface HeadlinePart {
  text: string;
  tone: HeadlineTone;
}

export interface Headline {
  /** The parts, in reading order; the text joins them with ` · `. */
  parts: HeadlinePart[];
  /** Trailing words that apply to every part (`faster than Parquet`), if any. */
  suffix: string | null;
  /** True when a series behind a part has fewer measured buckets than the group
   * has, or when an engine (or a hot/cold side) ran Parquet but not Vortex and
   * is therefore left out. */
  partial: boolean;
}

const VORTEX = 'vortex-file-compressed';
const PARQUET = 'parquet';

/** A ratio within this band of 1 reads as "≈ same". */
const SAME_LOW = 0.95;
const SAME_HIGH = 1.05;

/** From this multiple up, the display drops the decimal (`10×`, not `10.0×`). */
const WHOLE_MULTIPLE_FROM = 9.95;

const ENGINE_LABELS: ReadonlyMap<string, string> = new Map([
  ['duckdb', 'DuckDB'],
  ['datafusion', 'DataFusion'],
]);
const ENGINE_ORDER = ['duckdb', 'datafusion'];

/** The Headline's words, parts first, then the suffix and the partial mark. */
export function headlineText(headline: Headline): string {
  let text = headline.parts.map((part) => part.text).join(' · ');
  if (headline.suffix !== null) {
    text += ` ${headline.suffix}`;
  }
  if (headline.partial) {
    text += ' (partial)';
  }
  return text;
}

/**
 * The headline for one group's summary, or `null` when the summary is missing
 * or has nothing honest to say.
 */
export function groupHeadline(summary: Summary | undefined): Headline | null {
  if (summary === undefined) {
    return null;
  }
  switch (summary.type) {
    case 'queryBenchmark':
      return queryHeadline(summary.rankings);
    case 'randomAccess':
      return pairedHeadline([
        { label: 'hot', ...pickPair(summary.hotRankings) },
        { label: 'cold', ...pickPair(summary.coldRankings) },
      ]);
    case 'compression':
      return comparisonHeadline(
        (['encode', 'decode'] as const).map((operation) => ({
          label: operation,
          ratio:
            summary.rankings.find((row) => row.name === VORTEX && row.operation === operation)
              ?.ratio ?? Number.NaN,
          partial: false,
        })),
      );
    case 'compressionSize':
      return sizeHeadline(summary.rankings.find((row) => row.name === VORTEX)?.ratio);
    case 'vectorSearch':
      return vectorSearchHeadline(summary.rankings);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Ratios and verdicts.
// ---------------------------------------------------------------------------

/** A multiple of at least 1, as `2.5×`, or `10×` once it reaches 9.95. */
function multiple(m: number): string {
  return m < WHOLE_MULTIPLE_FROM ? `${m.toFixed(1)}×` : `${Math.round(m)}×`;
}

function isUsableRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio > 0;
}

interface Verdict {
  tone: 'better' | 'worse' | 'same';
  /** The multiple alone, such as `2.5×`; null for "≈ same". */
  multiple: string | null;
  /** The multiple with its direction, such as `2.5× faster`; `≈ same` for "≈ same". */
  words: string;
}

/** Read `ratio` as "how many times faster Vortex is". Needs a usable ratio. */
function judge(ratio: number): Verdict {
  if (ratio >= SAME_LOW && ratio <= SAME_HIGH) {
    return { tone: 'same', multiple: null, words: '≈ same' };
  }
  if (ratio > SAME_HIGH) {
    const m = multiple(ratio);
    return { tone: 'better', multiple: m, words: `${m} faster` };
  }
  const m = multiple(1 / ratio);
  return { tone: 'worse', multiple: m, words: `${m} slower` };
}

// ---------------------------------------------------------------------------
// Families that compare Vortex with Parquet through a ratio.
// ---------------------------------------------------------------------------

interface Comparison {
  label: string;
  /** How many times faster Vortex is than Parquet. */
  ratio: number;
  partial: boolean;
}

/**
 * One headline from several comparisons. When every part agrees on better (or
 * on worse) the multiples read straight through one shared suffix; otherwise
 * each part keeps its own verdict.
 */
function comparisonHeadline(comparisons: Comparison[]): Headline | null {
  const judged = comparisons
    .filter((comparison) => isUsableRatio(comparison.ratio))
    .map((comparison) => ({ ...comparison, verdict: judge(comparison.ratio) }));
  if (judged.length === 0) {
    return null;
  }
  const partial = judged.some((comparison) => comparison.partial);
  const allBetter = judged.every((comparison) => comparison.verdict.tone === 'better');
  const allWorse = judged.every((comparison) => comparison.verdict.tone === 'worse');
  if (allBetter || allWorse) {
    return {
      parts: judged.map(({ label, verdict }) => ({
        text: `${label} ${verdict.multiple}`,
        tone: verdict.tone,
      })),
      suffix: `${allBetter ? 'faster' : 'slower'} than Parquet`,
      partial,
    };
  }
  return {
    parts: judged.map(({ label, verdict }) => ({
      text: `${label} ${verdict.words}`,
      tone: verdict.tone,
    })),
    suffix: 'vs Parquet',
    partial,
  };
}

/** A series covers fewer buckets than its group has. */
function isPartial(series: SeriesRanking): boolean {
  return series.measured < series.total;
}

interface Pair {
  label: string;
  vortex: SeriesRanking | undefined;
  parquet: SeriesRanking | undefined;
}

/** The Vortex and Parquet series of a plain-named ranking; a series counts only when measured. */
function pickPair(rankings: SeriesRanking[]): Omit<Pair, 'label'> {
  const measured = (name: string) =>
    rankings.find((ranking) => ranking.name === name && ranking.measured > 0);
  return { vortex: measured(VORTEX), parquet: measured(PARQUET) };
}

/**
 * The shared rule for timing families: per pair, `score(parquet) / score(vortex)`.
 * A pair counts only when both sides were measured. When Vortex was measured
 * somewhere but no pair has a Parquet run at all, the headline is `Vortex only`.
 *
 * A pair with a Parquet run but no Vortex run is left out, and the headline is
 * then marked partial: the row would otherwise hide a result without a word.
 * A pair with only a Vortex run is left out silently.
 */
function pairedHeadline(pairs: Pair[]): Headline | null {
  if (pairs.every((pair) => pair.parquet === undefined)) {
    return vortexOnly(pairs.flatMap((pair) => (pair.vortex === undefined ? [] : [pair.vortex])));
  }
  const headline = comparisonHeadline(
    pairs.flatMap(({ label, vortex, parquet }) =>
      vortex === undefined || parquet === undefined
        ? []
        : [
            {
              label,
              ratio: parquet.score / vortex.score,
              partial: isPartial(vortex) || isPartial(parquet),
            },
          ],
    ),
  );
  const parquetOnly = pairs.some((pair) => pair.parquet !== undefined && pair.vortex === undefined);
  return headline !== null && parquetOnly ? { ...headline, partial: true } : headline;
}

function vortexOnly(vortexSeries: SeriesRanking[]): Headline | null {
  if (vortexSeries.length === 0) {
    return null;
  }
  return {
    parts: [{ text: 'Vortex only', tone: 'neutral' }],
    suffix: null,
    partial: vortexSeries.some(isPartial),
  };
}

// ---------------------------------------------------------------------------
// Query benchmarks: one part per engine.
// ---------------------------------------------------------------------------

function engineRank(engine: string): number {
  const index = ENGINE_ORDER.indexOf(engine);
  return index === -1 ? ENGINE_ORDER.length : index;
}

function compareEngines(a: string, b: string): number {
  const byRank = engineRank(a) - engineRank(b);
  if (byRank !== 0) {
    return byRank;
  }
  // Code-unit order, so the result does not depend on the viewer's locale.
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function queryHeadline(rankings: SeriesRanking[]): Headline | null {
  const byEngine = new Map<string, { vortex?: SeriesRanking; parquet?: SeriesRanking }>();
  for (const ranking of rankings) {
    if (ranking.measured <= 0) {
      continue;
    }
    const colon = ranking.name.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const engine = ranking.name.slice(0, colon);
    const format = ranking.name.slice(colon + 1);
    if (format !== VORTEX && format !== PARQUET) {
      continue;
    }
    let entry = byEngine.get(engine);
    if (entry === undefined) {
      entry = {};
      byEngine.set(engine, entry);
    }
    if (format === VORTEX) {
      entry.vortex ??= ranking;
    } else {
      entry.parquet ??= ranking;
    }
  }
  const pairs: Pair[] = [...byEngine.keys()].sort(compareEngines).map((engine) => ({
    label: ENGINE_LABELS.get(engine) ?? engine,
    vortex: byEngine.get(engine)?.vortex,
    parquet: byEngine.get(engine)?.parquet,
  }));
  return pairedHeadline(pairs);
}

// ---------------------------------------------------------------------------
// Compression size and vector search.
// ---------------------------------------------------------------------------

/**
 * `ratio` is Vortex's size over Parquet's, so below 1 is smaller. A size reads
 * as a percentage between half and twice Parquet's, and as a multiple outside
 * that: `2.0× larger` once the printed percentage would reach 100 (from 1.995),
 * and `2.0× smaller` once Parquet is at least twice Vortex's size (ratio 0.5
 * and below). No size reads "100% larger" or "100% smaller".
 */
function sizeHeadline(ratio: number | undefined): Headline | null {
  if (ratio === undefined || !isUsableRatio(ratio)) {
    return null;
  }
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  let part: HeadlinePart;
  if (ratio > 1 && pct >= 100) {
    part = { text: `${multiple(ratio)} larger than Parquet`, tone: 'worse' };
  } else if (ratio <= 0.5) {
    part = { text: `${multiple(1 / ratio)} smaller than Parquet`, tone: 'better' };
  } else if (pct === 0) {
    part = { text: 'same size as Parquet', tone: 'same' };
  } else if (ratio > 1) {
    part = { text: `${pct}% larger than Parquet`, tone: 'worse' };
  } else {
    part = { text: `${pct}% smaller than Parquet`, tone: 'better' };
  }
  return { parts: [part], suffix: null, partial: false };
}

/** No Parquet series exists here, so name the flavor with the lowest score. */
function vectorSearchHeadline(rankings: SeriesRanking[]): Headline | null {
  let fastest: SeriesRanking | undefined;
  for (const ranking of rankings) {
    if (ranking.measured <= 0 || !Number.isFinite(ranking.score)) {
      continue;
    }
    if (fastest === undefined || ranking.score < fastest.score) {
      fastest = ranking;
    }
  }
  if (fastest === undefined) {
    return null;
  }
  return {
    parts: [{ text: `fastest: ${displayFormat(fastest.name)}`, tone: 'neutral' }],
    suffix: null,
    partial: isPartial(fastest),
  };
}
