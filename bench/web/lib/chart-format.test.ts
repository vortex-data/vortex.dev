// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalHistory,
  chartAriaLabel,
  chartHasRecentData,
  chartPriority,
  clampRangeWindow,
  collectAllValues,
  commitDateLabel,
  decimateSeries,
  displayFormat,
  displaySeriesLabel,
  escapeHtml,
  FETCH_TIMEOUT_MS,
  firstLine,
  formatDisplayValue,
  HOVER_DWELL_MS,
  HOVER_PREFETCH_PRIORITY,
  IDENTITY_UNIT,
  INTERACTION_FULL_PRIORITY,
  LAZY_HYDRATION_ROOT_MARGIN,
  latestValuesSentence,
  lttbIndices,
  magnitudeReference,
  MAX_VISIBLE_POINTS,
  normalizeChartPayload,
  parseFilterCsv,
  parsePrNumber,
  pickDisplayUnit,
  predecessorValue,
  rangeTouchesUnloadedHistory,
  seedActiveFormats,
  seedActiveFromAllowlist,
  seriesOrder,
  seriesPassesFilter,
  seriesPassesGroupFilter,
  seriesStyle,
  shortDate,
  shortSha,
  singleSearchParam,
  throttle,
  truncate,
  visibleRange,
} from './chart-format';
import type { ChartResponse, CommitPoint } from './queries';

function commit(sha: string): CommitPoint {
  return {
    sha,
    timestamp: '2026-06-01T00:00:00Z',
    message: `subject for ${sha}`,
    url: `https://example.invalid/${sha}`,
  };
}

function payloadOf(
  commits: CommitPoint[],
  series: Record<string, (number | null)[]>,
  history?: ChartResponse['history'],
): ChartResponse {
  return {
    display_name: 'test chart',
    unit_kind: 'time_ns',
    history: history ?? {
      total_commits: commits.length,
      start_index: 0,
      loaded_commits: commits.length,
      complete: true,
    },
    commits,
    series,
  };
}

describe('small formatting helpers', () => {
  it('shortens SHAs and dates and stringifies non-strings defensively', () => {
    expect(shortSha('abcdef0123456789')).toBe('abcdef0');
    expect(shortSha(42)).toBe('42');
    expect(shortDate('2026-06-09T18:00:00Z')).toBe('2026-06-09');
    expect(shortDate(null)).toBe('');
  });

  it('truncates with an ellipsis only past the cap', () => {
    expect(truncate('hello', 5)).toBe('hello');
    expect(truncate('hello!', 5)).toBe('hell…');
    expect(truncate(undefined, 5)).toBe('');
  });

  it('takes the first line of a multi-line message', () => {
    expect(firstLine('one\ntwo')).toBe('one');
    expect(firstLine('single')).toBe('single');
    expect(firstLine(7)).toBe('');
  });

  it('parses squash-merge PR numbers and rejects everything else', () => {
    expect(parsePrNumber('fix: a thing (#1234)')).toBe('1234');
    expect(parsePrNumber('no pr here')).toBeNull();
    expect(parsePrNumber(undefined)).toBeNull();
  });

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('seriesStyle', () => {
  const tag = (engine: string, format: string) => ({ engine, format });
  const style = (engine: string, format: string, theme: 'dark' | 'light' = 'dark') =>
    seriesStyle(`${engine}:${format}`, tag(engine, format), theme);

  it('draws Vortex in cobalt on both cards, with the thickest line', () => {
    for (const theme of ['dark', 'light'] as const) {
      expect(style('datafusion', 'vortex-file-compressed', theme).color).toBe('#2f63ff');
    }
    expect(style('datafusion', 'vortex-file-compressed').width).toBeGreaterThan(
      style('datafusion', 'parquet').width,
    );
    expect(style('datafusion', 'parquet').width).toBeGreaterThan(style('duckdb', 'lance').width);
  });

  it("draws the duckdb run of a format dashed, in the format's color and width", () => {
    for (const format of ['vortex-file-compressed', 'vortex-compact', 'parquet', 'lance']) {
      for (const theme of ['dark', 'light'] as const) {
        const datafusion = style('datafusion', format, theme);
        const duckdb = style('duckdb', format, theme);
        expect(duckdb.color, format).toBe(datafusion.color);
        expect(duckdb.width, format).toBe(datafusion.width);
        expect(datafusion.dash, format).toEqual([]);
        expect(duckdb.dash, format).toEqual([6, 4]);
      }
    }
  });

  it('draws a cold random-access run dashed and a hot one solid', () => {
    const cold = seriesStyle('parquet:cold', { format: 'parquet' }, 'dark');
    const hot = seriesStyle('parquet:hot', { format: 'parquet' }, 'dark');
    expect(cold.color).toBe(hot.color);
    expect(cold.dash).toEqual([6, 4]);
    expect(hot.dash).toEqual([]);
  });

  it('changes color, never width or dash, with the theme', () => {
    const dark = style('duckdb', 'parquet', 'dark');
    const light = style('duckdb', 'parquet', 'light');
    expect(light.color).not.toBe(dark.color);
    expect(light.width).toBe(dark.width);
    expect(light.dash).toEqual(dark.dash);
  });

  it('derives engine/format from the label when meta is absent', () => {
    expect(seriesStyle('duckdb:parquet', undefined, 'dark')).toEqual(style('duckdb', 'parquet'));
  });

  it('colors the engine-less series by their format', () => {
    // Compression-time, size and random-access series carry a format but no
    // engine; they take the format's signature color, as datafusion does.
    const comp = seriesStyle('parquet:encode', { format: 'parquet' }, 'light');
    expect(comp).toEqual(style('datafusion', 'parquet', 'light'));
    expect(seriesStyle('arrow-ipc', { format: 'arrow-ipc' }, 'dark')).toEqual(
      style('datafusion', 'arrow'),
    );
  });

  it('falls back to a thin neutral gray for an unknown series', () => {
    const unknown = style('datafusion', 'mystery');
    expect(unknown.color).toBe('#8a8a87');
    expect(unknown.width).toBeLessThan(style('datafusion', 'vortex-file-compressed').width);
  });
});

// ---------------------------------------------------------------------------
// Palette legibility. The series colors must read against the card and apart
// from each other, also for readers with red-green color blindness. The
// helpers below are the standard formulas, written out so the test needs no
// color library: WCAG 2.x relative luminance and contrast, CIE Lab (D65),
// CIEDE2000, and the Machado, Oliveira and Fernandes (2009) simulation of
// protanopia and deuteranopia at full severity, applied in linear sRGB.
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
type Lab = [number, number, number];

const srgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearRgb = (hex: string): Rgb => srgb(hex).map(linear) as Rgb;

function luminance(hex: string): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The HSL hue in degrees, the hue the design brief names (cobalt is 225°). */
function hslHue(hex: string): number {
  const [r, g, b] = srgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) {
    return 0;
  }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function labOf([r, g, b]: Rgb): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

type Vision = 'normal' | 'protanopia' | 'deuteranopia';

const MACHADO: Record<Exclude<Vision, 'normal'>, number[][]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

function seen(hex: string, vision: Vision): Lab {
  const rgb = linearRgb(hex);
  if (vision === 'normal') {
    return labOf(rgb);
  }
  const m = MACHADO[vision];
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return labOf(
    m.map((row) => clamp(row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2])) as Rgb,
  );
}

/** CIEDE2000 (Sharma, Wu and Dalal 2005), with kL = kC = kH = 1. */
function deltaE2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const cBar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hueOf = (b: number, a: number): number =>
    a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360;
  const hp1 = hueOf(b1, ap1);
  const hp2 = hueOf(b2, ap2);
  let dhp = 0;
  if (cp1 * cp2 !== 0) {
    dhp = hp2 - hp1;
    dhp += dhp > 180 ? -360 : dhp < -180 ? 360 : 0;
  }
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dhp / 2) * rad);
  const lBar = (l1 + l2) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    hBar =
      Math.abs(hp1 - hp2) > 180
        ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2
        : (hp1 + hp2) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hBar - 30) * rad) +
    0.24 * Math.cos(2 * hBar * rad) +
    0.32 * Math.cos((3 * hBar + 6) * rad) -
    0.2 * Math.cos((4 * hBar - 63) * rad);
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cpBar;
  const sh = 1 + 0.015 * cpBar * t;
  const rt =
    -Math.sin(2 * 30 * Math.exp(-(((hBar - 275) / 25) ** 2)) * rad) *
    2 *
    Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7));
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

const deltaE = (a: string, b: string, vision: Vision = 'normal'): number =>
  deltaE2000(seen(a, vision), seen(b, vision));

const colorBlind = (a: string, b: string): number =>
  Math.min(deltaE(a, b, 'protanopia'), deltaE(a, b, 'deuteranopia'));

describe('the color helpers', () => {
  it('match the published reference values', () => {
    // Sharma, Wu and Dalal (2005), table 1, pairs 1, 7 and 17.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 6);
    expect(hslHue('#2f63ff')).toBeCloseTo(225, 0);
    // Machado's matrices keep white white and black black.
    expect(deltaE('#ffffff', '#ffffff', 'deuteranopia')).toBe(0);
    expect(seen('#ffffff', 'protanopia')[0]).toBeCloseTo(100, 0);
  });
});

describe('series palette legibility', () => {
  const CARD = { dark: '#171716', light: '#ffffff' } as const;
  const THEMES = ['dark', 'light'] as const;
  const VORTEX = '#2f63ff';
  const tag = (engine: string, format: string) => ({ engine, format });
  const query = (key: string) => {
    const [engine, format] = key.split(':') as [string, string];
    return { key, engine, format };
  };
  /** Every series a TPC-H style query chart can hold at once. */
  const QUERY = [
    'datafusion:vortex-file-compressed',
    'duckdb:vortex-file-compressed',
    'datafusion:vortex-compact',
    'duckdb:vortex-compact',
    'datafusion:parquet',
    'duckdb:parquet',
    'duckdb:duckdb',
    'datafusion:lance',
    'duckdb:lance',
    'datafusion:arrow',
  ].map(query);
  /** The engine-less formats of the compression, size and random-access charts. */
  const FORMATS = [
    'vortex-file-compressed',
    'vortex-compact',
    'parquet',
    'duckdb',
    'lance',
    'arrow',
    'arrow-ipc',
  ];
  /** arrow-ipc is Arrow on disk: the two share one color and never one chart. */
  const family = (format: string): string => (format === 'arrow-ipc' ? 'arrow' : format);
  const queryColor = (
    q: { key: string; engine: string; format: string },
    theme: 'dark' | 'light',
  ) => seriesStyle(q.key, tag(q.engine, q.format), theme).color;
  const formatColor = (format: string, theme: 'dark' | 'light') =>
    seriesStyle(format, { format }, theme).color;

  for (const theme of THEMES) {
    describe(`on the ${theme} card`, () => {
      it('gives every series at least 3:1 contrast against the card', () => {
        const colors = [
          ...QUERY.map((q) => queryColor(q, theme)),
          ...FORMATS.map((f) => formatColor(f, theme)),
          seriesStyle('datafusion:mystery', tag('datafusion', 'mystery'), theme).color,
        ];
        for (const color of colors) {
          expect(contrast(color, CARD[theme]), color).toBeGreaterThanOrEqual(3);
        }
      });

      it('keeps every pair of formats at least ΔE2000 25 apart, and 12 for color-blind readers', () => {
        for (const [i, a] of FORMATS.entries()) {
          for (const b of FORMATS.slice(i + 1)) {
            if (family(a) === family(b)) {
              continue;
            }
            const [ca, cb] = [formatColor(a, theme), formatColor(b, theme)];
            expect(deltaE(ca, cb), `${a} ${ca} / ${b} ${cb}`).toBeGreaterThanOrEqual(25);
            expect(colorBlind(ca, cb), `${a} ${ca} / ${b} ${cb}`).toBeGreaterThanOrEqual(12);
          }
        }
      });

      it('gives every series of a query chart its format color, on every engine', () => {
        for (const q of QUERY) {
          expect(queryColor(q, theme), q.key).toBe(formatColor(q.format, theme));
        }
      });

      it('draws Vortex in cobalt, with Lance and Parquet well away from its hue', () => {
        expect(formatColor('vortex-file-compressed', theme)).toBe(VORTEX);
        const vortexHue = hslHue(VORTEX);
        for (const q of QUERY.filter((q) => q.format === 'lance')) {
          expect(hueGap(hslHue(queryColor(q, theme)), vortexHue), q.key).toBeGreaterThanOrEqual(25);
        }
        for (const q of QUERY.filter((q) => q.format === 'parquet')) {
          expect(hueGap(hslHue(queryColor(q, theme)), vortexHue), q.key).toBeGreaterThanOrEqual(20);
        }
      });

      it("keeps every other format out of Vortex's blue family", () => {
        // Blue family: HSL hue 215-235° within 15 L* of Vortex's cobalt.
        // vortex-compact may sit in it or out of it; the ΔE rules keep it
        // apart from vortex-file-compressed either way.
        const vortexL = labOf(linearRgb(VORTEX))[0];
        const others = QUERY.filter(
          (q) => q.format !== 'vortex-file-compressed' && q.format !== 'vortex-compact',
        );
        for (const q of others) {
          const color = queryColor(q, theme);
          const inHue = hslHue(color) >= 215 && hslHue(color) <= 235;
          const nearL = Math.abs(labOf(linearRgb(color))[0] - vortexL) < 15;
          expect(inHue && nearL, `${q.key} ${color}`).toBe(false);
        }
      });
    });
  }
});

describe('seriesOrder', () => {
  const tag = (engine: string, format: string) => ({ engine, format });
  const ord = (engine: string, format: string) =>
    seriesOrder(`${engine}:${format}`, tag(engine, format));

  it('layers formats front-to-back: vortex, parquet, vortex-compact, duckdb, lance, arrow', () => {
    const ranks = [
      ord('datafusion', 'vortex-file-compressed'),
      ord('datafusion', 'parquet'),
      ord('datafusion', 'vortex-compact'),
      ord('duckdb', 'duckdb'),
      ord('datafusion', 'lance'),
      ord('datafusion', 'arrow'),
    ];
    const sorted = [...ranks].sort((a, b) => a - b);
    expect(ranks).toEqual(sorted);
  });

  it('draws datafusion ahead of duckdb within a format', () => {
    expect(ord('datafusion', 'vortex-file-compressed')).toBeLessThan(
      ord('duckdb', 'vortex-file-compressed'),
    );
  });

  it('keeps the whole Vortex pair in front of the whole Parquet pair', () => {
    expect(ord('duckdb', 'vortex-file-compressed')).toBeLessThan(ord('datafusion', 'parquet'));
  });
});

describe('the chart canvas label', () => {
  const MS = pickDisplayUnit('time_ns', [2_500_000]);

  it('names the chart alone before it has data', () => {
    expect(chartAriaLabel('tpch q1', null)).toBe('tpch q1 chart');
  });

  const COMMITS = [
    { timestamp: '2026-10-25T10:00:00Z' },
    { timestamp: '2026-10-26T10:00:00Z' },
    { timestamp: '2026-10-27T10:00:00Z' },
  ];

  it("states each series' latest value in the display unit, in one dated sentence", () => {
    const sentence = latestValuesSentence(
      [
        { label: 'duckdb:parquet', values: [3_000_000, 2_000_000, 2_500_000] },
        { label: 'duckdb:vortex-file-compressed', values: [1_200_000, 1_100_000, 1_000_000] },
      ],
      COMMITS,
      MS,
    );
    expect(sentence).toBe(
      'Latest commit with data (2026-10-27): duckdb:parquet 2.50 ms, duckdb:vortex 1.00 ms.',
    );
    expect(chartAriaLabel('tpch q1', sentence)).toBe(
      'tpch q1 chart. Latest commit with data (2026-10-27): duckdb:parquet 2.50 ms, duckdb:vortex 1.00 ms.',
    );
  });

  it('takes the latest commit where any series has a value, and leaves out a series without one there', () => {
    expect(
      latestValuesSentence(
        [
          { label: 'datafusion:parquet', values: [3_000_000, null, null] },
          { label: 'duckdb:parquet', values: [3_000_000, 2_000_000, null] },
          { label: 'duckdb:lance', values: [Number.NaN, Number.NaN, Number.NaN] },
          { label: 'duckdb:arrow', values: [] },
        ],
        // The newest commit has no results yet; a padded slot has no commit.
        [null, ...COMMITS],
        MS,
      ),
    ).toBe('Latest commit with data (2026-10-25): duckdb:parquet 2.00 ms.');
  });

  it('says so when no series is shown, or none has data', () => {
    expect(latestValuesSentence([], COMMITS, MS)).toBe('No series is shown.');
    expect(
      latestValuesSentence([{ label: 'vortex', values: [null, null, null] }], COMMITS, MS),
    ).toBe('No visible series has data.');
  });

  it('gives a dimensionless value without a unit, and no date when the commit has none', () => {
    expect(
      latestValuesSentence(
        [{ label: 'vortex', values: [4.25] }],
        [{ timestamp: undefined as unknown as string }],
        pickDisplayUnit('ratio', [4.25]),
      ),
    ).toBe('Latest commit with data: vortex 4.25.');
  });
});

describe('displayFormat / displaySeriesLabel', () => {
  it('renames only vortex-file-compressed to vortex', () => {
    expect(displayFormat('vortex-file-compressed')).toBe('vortex');
    expect(displayFormat('vortex-compact')).toBe('vortex-compact');
    expect(displayFormat('parquet')).toBe('parquet');
  });

  it('rewrites the vortex token in any colon-delimited label', () => {
    expect(displaySeriesLabel('datafusion:vortex-file-compressed')).toBe('datafusion:vortex');
    expect(displaySeriesLabel('duckdb:vortex-file-compressed')).toBe('duckdb:vortex');
    // Compression-time labels are format:op, so the token leads.
    expect(displaySeriesLabel('vortex-file-compressed:encode')).toBe('vortex:encode');
    expect(displaySeriesLabel('vortex-file-compressed')).toBe('vortex');
    // Untouched labels pass through.
    expect(displaySeriesLabel('datafusion:parquet')).toBe('datafusion:parquet');
  });
});

describe('commitDateLabel', () => {
  it('formats a commit timestamp as MMM D, YYYY', () => {
    expect(commitDateLabel(commit('abc'))).toBe('Jun 1, 2026');
  });

  it('derives the date from the ISO prefix so it is timezone-stable', () => {
    expect(
      commitDateLabel({ sha: 'x', timestamp: '2026-01-09T23:30:00Z', message: '', url: '' }),
    ).toBe('Jan 9, 2026');
  });

  it('returns empty for virtual slots and malformed timestamps', () => {
    expect(commitDateLabel(null)).toBe('');
    expect(commitDateLabel({ sha: 'x', timestamp: '', message: '', url: '' })).toBe('');
  });

  it('returns empty when the date prefix has no month or no day', () => {
    const label = (timestamp: string) =>
      commitDateLabel({ sha: 'x', timestamp, message: '', url: '' });
    expect(label('2026/06/19T00:00:00Z')).toBe('');
    expect(label('abcdefghij')).toBe('');
    // A valid month but no day.
    expect(label('1-1xxxxxxxxx')).toBe('');
  });
});

describe('magnitudeReference', () => {
  it('takes the median of finite nonzero magnitudes', () => {
    expect(magnitudeReference([1, 3, 2])).toBe(2);
    // Even count averages the middle pair.
    expect(magnitudeReference([1, 2, 3, 4])).toBe(2.5);
    // Magnitude, not signed value.
    expect(magnitudeReference([-10])).toBe(10);
  });

  it('skips zeros, nulls, and non-finite values', () => {
    expect(magnitudeReference([0, null, undefined, NaN, Infinity, 5])).toBe(5);
    expect(magnitudeReference([0, 0])).toBeNull();
    expect(magnitudeReference([])).toBeNull();
  });
});

describe('pickDisplayUnit', () => {
  it('steps time_ns by the median magnitude', () => {
    expect(pickDisplayUnit('time_ns', [500])).toMatchObject({
      multiplier: 1,
      suffix: 'ns',
      decimals: 0,
    });
    expect(pickDisplayUnit('time_ns', [5e3])).toMatchObject({ multiplier: 1e-3, suffix: 'µs' });
    expect(pickDisplayUnit('time_ns', [5e6])).toMatchObject({ multiplier: 1e-6, suffix: 'ms' });
    // ms is the ceiling: a slow (≥1s) benchmark stays in ms, never seconds.
    expect(pickDisplayUnit('time_ns', [5e9])).toMatchObject({
      multiplier: 1e-6,
      suffix: 'ms',
      axisLabel: 'Time (ms)',
    });
  });

  it('steps bytes by decimal multiples', () => {
    expect(pickDisplayUnit('bytes', [512])).toMatchObject({ suffix: 'B', decimals: 0 });
    expect(pickDisplayUnit('bytes', [2_000])).toMatchObject({ suffix: 'KB' });
    expect(pickDisplayUnit('bytes', [3_000_000])).toMatchObject({ suffix: 'MB' });
    expect(pickDisplayUnit('bytes', [3_000_000_000])).toMatchObject({
      suffix: 'GB',
      axisLabel: 'Size (GB)',
    });
    expect(pickDisplayUnit('bytes', [3_000_000_000_000])).toMatchObject({ suffix: 'TB' });
  });

  it('leaves dimensionless and throughput kinds unscaled', () => {
    expect(pickDisplayUnit('ratio', [1.5])).toMatchObject({
      multiplier: 1,
      suffix: '',
      axisLabel: '',
      decimals: 2,
    });
    expect(pickDisplayUnit('count', [12])).toMatchObject({ decimals: 0 });
    expect(pickDisplayUnit('throughput_mb_s', [100])).toMatchObject({ suffix: 'MB/s' });
  });

  it('falls back to identity for unknown kinds and empty values', () => {
    expect(pickDisplayUnit('future_unit', [1])).toEqual(IDENTITY_UNIT);
    // No usable values: time picks the smallest unit (ns).
    expect(pickDisplayUnit('time_ns', [])).toMatchObject({ suffix: 'ns' });
  });
});

describe('formatDisplayValue', () => {
  it('applies the locked multiplier, decimals, and suffix', () => {
    const unit = pickDisplayUnit('time_ns', [12e9]);
    expect(formatDisplayValue(12e9, unit)).toBe('12000.00 ms');
  });

  it('collapses missing values to an em dash', () => {
    expect(formatDisplayValue(null, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(undefined, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(NaN, IDENTITY_UNIT)).toBe('—');
    expect(formatDisplayValue(Infinity, IDENTITY_UNIT)).toBe('—');
  });
});

describe('collectAllValues', () => {
  it('concatenates non-null finite values across series', () => {
    const payload = payloadOf([commit('a'), commit('b')], {
      s1: [1, null],
      s2: [3, NaN as unknown as number],
    });
    expect(collectAllValues(payload).sort()).toEqual([1, 3]);
    expect(collectAllValues(null)).toEqual([]);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs immediately, then preserves the trailing call', () => {
    const calls: number[] = [];
    const fn = throttle((v: number) => calls.push(v), 100);
    fn(1);
    fn(2);
    fn(3);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(100);
    // The trailing timer fires once with the LAST pending arguments.
    expect(calls).toEqual([1, 3]);
  });
});

describe('lttbIndices', () => {
  it('returns every index when at or under the threshold', () => {
    expect(lttbIndices([0, 1, 2], [5, 6, 7], 3)).toEqual([0, 1, 2]);
    expect(lttbIndices([0, 1], [5, 6], 5)).toEqual([0, 1]);
  });

  it('returns every index for degenerate thresholds', () => {
    expect(lttbIndices([0, 1, 2, 3], [1, 2, 3, 4], 2)).toEqual([0, 1, 2, 3]);
  });

  it('keeps both endpoints and exactly threshold points, preferring peaks', () => {
    const n = 100;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = xs.map((x) => (x === 50 ? 1000 : Math.sin(x / 5)));
    const kept = lttbIndices(xs, ys, 10);
    expect(kept).toHaveLength(10);
    expect(kept[0]).toBe(0);
    expect(kept[9]).toBe(n - 1);
    // The big spike at index 50 forms the largest triangle in its bucket.
    expect(kept).toContain(50);
    // Indices are strictly increasing.
    for (let i = 1; i < kept.length; i++) {
      expect(kept[i]).toBeGreaterThan(kept[i - 1]!);
    }
  });
});

describe('decimateSeries', () => {
  it('keeps every commit with data and reports no downsampling under the cap', () => {
    const a = [1, 2, null, 4, 5];
    const b = [null, null, 3, null, null];
    const { kept, downsampled } = decimateSeries([a, b], 0, 4, 500);
    expect(downsampled).toBe(false);
    expect([...kept].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves a non-dominant series’ points when downsampling (regression)', () => {
    const N = 3000;
    // Series A: large values on EVERY commit, so it drives the max-across-series
    // union everywhere. Series B: small values on only a few recent commits.
    const a = Array.from({ length: N }, (_, i) => 1_000_000 + i);
    const b: (number | null)[] = new Array<number | null>(N).fill(null);
    const bPoints = [2990, 2993, 2996, 2999];
    for (const i of bPoints) {
      b[i] = 1_000;
    }
    const { kept, downsampled } = decimateSeries([a, b], 0, N - 1, 500);
    expect(downsampled).toBe(true);
    // The old shared-union LTTB kept only B's pinned last point (2999); every
    // one of B's points must now survive.
    for (const i of bPoints) {
      expect(kept.has(i)).toBe(true);
    }
  });

  it('keeps the total distinct x-positions within the cap', () => {
    const N = 5000;
    const a = Array.from({ length: N }, (_, i) => Math.sin(i / 7));
    const b = Array.from({ length: N }, (_, i) => Math.cos(i / 11) * 1_000);
    const { kept } = decimateSeries([a, b], 0, N - 1, 500);
    expect(kept.size).toBeLessThanOrEqual(500);
  });

  it('ignores series with no data in the visible window', () => {
    const a = [1, 2, 3];
    const empty = [null, null, null];
    const { kept, downsampled } = decimateSeries([a, empty], 0, 2, 500);
    expect(downsampled).toBe(false);
    expect([...kept].sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });
});

describe('canonicalHistory', () => {
  it('defaults to a complete history over the loaded commits', () => {
    const h = canonicalHistory({ commits: [commit('a'), commit('b')], history: undefined });
    expect(h).toEqual({ total_commits: 2, start_index: 0, loaded_commits: 2, complete: true });
  });

  it('clamps start_index into the valid placement window', () => {
    const h = canonicalHistory({
      commits: [commit('a')],
      history: { total_commits: 10, start_index: 99, loaded_commits: 1, complete: false },
    });
    expect(h.start_index).toBe(9);
    expect(h.total_commits).toBe(10);
  });

  it('derives complete from full coverage', () => {
    const h = canonicalHistory({
      commits: [commit('a'), commit('b')],
      history: { total_commits: 2, start_index: 0, loaded_commits: 2, complete: false },
    });
    expect(h.complete).toBe(true);
  });
});

describe('normalizeChartPayload', () => {
  it('passes complete payloads through the fast path unchanged', () => {
    const payload = payloadOf([commit('a'), commit('b')], { s: [1, 2] });
    const normalized = normalizeChartPayload(payload);
    expect(normalized.commits).toHaveLength(2);
    expect(normalized.series.s).toEqual([1, 2]);
    expect(normalized.history.complete).toBe(true);
  });

  it('pads a bounded window onto the full-history axis', () => {
    const payload = payloadOf(
      [commit('y'), commit('z')],
      { s: [7, 8] },
      {
        total_commits: 5,
        start_index: 3,
        loaded_commits: 2,
        complete: false,
      },
    );
    const normalized = normalizeChartPayload(payload);
    expect(normalized.commits).toHaveLength(5);
    expect(normalized.commits.slice(0, 3)).toEqual([null, null, null]);
    expect(normalized.commits[3]?.sha).toBe('y');
    expect(normalized.series.s).toEqual([null, null, null, 7, 8]);
  });

  it('is idempotent: normalizing twice equals normalizing once', () => {
    const payload = payloadOf(
      [commit('y')],
      { s: [7] },
      {
        total_commits: 3,
        start_index: 2,
        loaded_commits: 1,
        complete: false,
      },
    );
    const once = normalizeChartPayload(payload);
    const twice = normalizeChartPayload(once as unknown as ChartResponse);
    expect(twice.commits).toEqual(once.commits);
    expect(twice.series).toEqual(once.series);
    expect(twice.history).toEqual(once.history);
  });
});

describe('rangeTouchesUnloadedHistory', () => {
  const history = { total_commits: 10, start_index: 5, loaded_commits: 5, complete: false };

  it('fires when the range reaches before the loaded window', () => {
    expect(rangeTouchesUnloadedHistory({ history }, 2, 7)).toBe(true);
  });

  it('stays quiet inside the loaded window or when complete', () => {
    expect(rangeTouchesUnloadedHistory({ history }, 5, 9)).toBe(false);
    expect(rangeTouchesUnloadedHistory({ history: { ...history, complete: true } }, 0, 9)).toBe(
      false,
    );
    expect(rangeTouchesUnloadedHistory(null, 0, 9)).toBe(false);
  });
});

describe('visibleRange', () => {
  it('covers everything for "all" or an over-wide scope', () => {
    expect(visibleRange(10, 'all')).toEqual({ min: 0, max: 9 });
    expect(visibleRange(10, 50)).toEqual({ min: 0, max: 9 });
    expect(visibleRange(0, 5)).toEqual({ min: undefined, max: undefined });
  });

  it('anchors right with no current range', () => {
    expect(visibleRange(100, 10)).toEqual({ min: 90, max: 99 });
  });

  it('anchors right when flush with the newest commit (half-commit tolerance)', () => {
    expect(visibleRange(100, 10, { min: 50, max: 99.4 })).toEqual({ min: 90, max: 99 });
  });

  it('preserves the center when panned away from the right edge', () => {
    const r = visibleRange(100, 11, { min: 40, max: 60 });
    // Center 50 with width 11 keeps indices 45..55.
    expect(r).toEqual({ min: 45, max: 55 });
  });

  it('clamps a preserved center at the history edges', () => {
    expect(visibleRange(100, 21, { min: 0, max: 4 })).toEqual({ min: 0, max: 20 });
  });
});

describe('filter helpers', () => {
  const universe = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet'] };

  it('parses CSV allowlists with trimming and dedupe', () => {
    expect(parseFilterCsv('duckdb, datafusion,duckdb,,')).toEqual(['duckdb', 'datafusion']);
    expect(parseFilterCsv(null)).toBeNull();
    expect(parseFilterCsv(undefined)).toBeNull();
    expect(parseFilterCsv('')).toEqual([]);
  });

  it('seeds the active set from the allowlist or the whole universe', () => {
    expect(seedActiveFromAllowlist(null, universe.engines)).toEqual(['duckdb', 'datafusion']);
    // A non-empty allowlist is verbatim, even when stale against the universe.
    expect(seedActiveFromAllowlist(['gone'], universe.engines)).toEqual(['gone']);
  });

  it('seeds formats with lance hidden by default, but honors an explicit allowlist', () => {
    const formats = ['vortex', 'parquet', 'lance'];
    // No allowlist: lance is dropped from the default active set.
    expect(seedActiveFormats(null, formats)).toEqual(['vortex', 'parquet']);
    // An explicit allowlist is verbatim, so a `?format=` URL can pin lance on.
    expect(seedActiveFormats(['lance'], formats)).toEqual(['lance']);
    // A universe without lance is unaffected.
    expect(seedActiveFormats(null, ['vortex', 'parquet'])).toEqual(['vortex', 'parquet']);
  });

  it('hides a series only when its own dimension is filtered', () => {
    const active = { engines: ['duckdb'], formats: ['vortex', 'parquet'] };
    expect(seriesPassesFilter({ engine: 'duckdb', format: 'vortex' }, active, universe)).toBe(true);
    expect(seriesPassesFilter({ engine: 'datafusion', format: 'vortex' }, active, universe)).toBe(
      false,
    );
    // No engine tag: the engine filter does not apply.
    expect(seriesPassesFilter({ format: 'vortex' }, active, universe)).toBe(true);
    expect(seriesPassesFilter(undefined, active, universe)).toBe(true);
  });

  it('checks explicit membership after the filter universe initializes', () => {
    const active = { engines: ['duckdb', 'datafusion'], formats: ['vortex', 'parquet'] };
    expect(seriesPassesFilter({ engine: 'duckdb' }, active, universe)).toBe(true);
    expect(seriesPassesFilter({ engine: 'new-engine' }, active, universe)).toBe(false);
    expect(seriesPassesFilter({ format: 'new-format' }, active, universe)).toBe(false);
    expect(
      seriesPassesFilter(
        { engine: 'duckdb' },
        { engines: [], formats: [] },
        { engines: [], formats: [] },
      ),
    ).toBe(true);
  });

  it('applies per-group overrides before the fallback visibility', () => {
    const filter = { hiddenSeries: ['a'], shownSeries: ['lance'] };
    expect(seriesPassesGroupFilter(filter, 'a')).toBe(false);
    expect(seriesPassesGroupFilter(filter, 'lance', false)).toBe(true);
    expect(seriesPassesGroupFilter(filter, 'b', false)).toBe(false);
    expect(seriesPassesGroupFilter(null, 'a')).toBe(true);
  });
});

describe('predecessorValue (BAN-pinned tooltip delta walk)', () => {
  it('walks to idx - 1, never idx + 1: commits[] is oldest-first', () => {
    // Distinct neighbour values make a flipped walk unmistakable.
    expect(predecessorValue([10, 20, 30], 1)).toBe(10);
    expect(predecessorValue([10, 20, 30], 2)).toBe(20);
  });

  it('continues back across null-valued slots for sparse series', () => {
    expect(predecessorValue([10, null, NaN, undefined, 50], 4)).toBe(10);
  });

  it('returns null when no earlier measurement exists', () => {
    expect(predecessorValue([10, 20], 0)).toBeNull();
    expect(predecessorValue([null, 20], 1)).toBeNull();
    expect(predecessorValue([], 0)).toBeNull();
  });
});

describe('singleSearchParam', () => {
  it('passes strings through and rejects absent or repeated params', () => {
    expect(singleSearchParam('all')).toBe('all');
    expect(singleSearchParam(undefined)).toBeNull();
    expect(singleSearchParam(['a', 'b'])).toBeNull();
  });
});

describe('MAX_VISIBLE_POINTS contract', () => {
  it('keeps exactly the cap when downsampling above it', () => {
    const n = MAX_VISIBLE_POINTS * 2;
    const xs = Array.from({ length: n }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 10));
    expect(lttbIndices(xs, ys, MAX_VISIBLE_POINTS)).toHaveLength(MAX_VISIBLE_POINTS);
  });
});

describe('clampRangeWindow', () => {
  it('pins the window to [0, 0] on a single-commit chart (no phantom slot)', () => {
    // Regression: the range-strip bare-track-click path requested a window with
    // the pre-fix `minRange = 1`, which forced `max` to 1 on a single-commit
    // chart (`maxIdx === 0`), one slot past the only label. The fix collapses
    // the minimum span to zero when there is only one commit. (Discriminating:
    // the pre-fix math returned `{ min: 0, max: 1 }` here.)
    expect(clampRangeWindow(0, 0, 0)).toEqual({ min: 0, max: 0 });
    expect(clampRangeWindow(0, -5, 5)).toEqual({ min: 0, max: 0 });
  });

  it('enforces a one-commit minimum span on multi-commit charts', () => {
    expect(clampRangeWindow(10, 3, 3)).toEqual({ min: 3, max: 4 });
    expect(clampRangeWindow(10, 10, 10)).toEqual({ min: 9, max: 10 });
  });

  it('clamps requested bounds into [0, maxIdx]', () => {
    expect(clampRangeWindow(10, 3, 7)).toEqual({ min: 3, max: 7 });
    expect(clampRangeWindow(10, -5, 100)).toEqual({ min: 0, max: 10 });
  });
});

describe('hover-dwell prefetch constants', () => {
  it('dwell is a deliberate one-second pause, not an accidental sweep', () => {
    expect(HOVER_DWELL_MS).toBe(1000);
  });

  it('hover-prefetch priority sits above background (0) and below direct interaction', () => {
    expect(HOVER_PREFETCH_PRIORITY).toBeGreaterThan(0);
    expect(HOVER_PREFETCH_PRIORITY).toBeLessThan(INTERACTION_FULL_PRIORITY);
  });
});

describe('lazy-hydration + fetch-resilience constants', () => {
  it('the per-fetch timeout is a generous bound over a cold function first-hit', () => {
    // Cold Vercel first-hit measured ~7.8s; 30s leaves headroom so a slow-but-live
    // request is not falsely aborted, while still bounding a true hang.
    expect(FETCH_TIMEOUT_MS).toBe(30000);
  });

  it('the IO root margin pre-hydrates charts slightly before they scroll in', () => {
    expect(LAZY_HYDRATION_ROOT_MARGIN).toMatch(/px/);
  });
});

describe('chartHasRecentData', () => {
  it('is false for the empty-window wire shape (no series at all)', () => {
    // A chart whose fact rows all predate the latest-100 window arrives as 100
    // seeded commits with `series: {}` (the accumulator never records a row).
    expect(chartHasRecentData({ series: {} })).toBe(false);
  });

  it('is false when every series value is null', () => {
    expect(chartHasRecentData({ series: { a: [null, null], b: [null] } })).toBe(false);
  });

  it('is true when any series carries one real value', () => {
    expect(chartHasRecentData({ series: { a: [null, null], b: [null, 7] } })).toBe(true);
  });

  it('ignores NaN values', () => {
    expect(chartHasRecentData({ series: { a: [Number.NaN, null] } })).toBe(false);
  });

  it('inspects only the trailing window of a full-history payload', () => {
    // 150 slots with data only in the first 40: the trailing-100 window is all
    // null, so the chart classifies empty — the same verdict its `?n=100`
    // payload would produce.
    const stale = new Array<number | null>(150).fill(null);
    for (let i = 0; i < 40; i++) {
      stale[i] = i + 1;
    }
    expect(chartHasRecentData({ series: { a: stale } })).toBe(false);
    // One value inside the trailing window flips the verdict.
    const alive = [...stale];
    alive[149] = 42;
    expect(chartHasRecentData({ series: { a: alive } })).toBe(true);
  });

  it('honors an explicit window size', () => {
    const values = [1, null, null];
    expect(chartHasRecentData({ series: { a: values } }, 2)).toBe(false);
    expect(chartHasRecentData({ series: { a: values } }, 3)).toBe(true);
  });
});

describe('chartPriority', () => {
  it('ranks the first chart at +0 and later charts by their negated index', () => {
    // `+0`, not `-0`: `Object.is` (and so `toBe`) tells them apart.
    expect(Object.is(chartPriority(0), 0)).toBe(true);
    expect(chartPriority(7)).toBe(-7);
  });
});
