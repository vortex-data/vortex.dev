// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';
import {
  canonicalWindowQuery,
  COMMIT_WINDOW_RUNGS,
  commitWindowLimit,
  DEFAULT_COMMIT_WINDOW,
  MAX_NUMERIC_COMMIT_WINDOW,
  parseCommitWindow,
} from './window';

describe('parseCommitWindow', () => {
  it('defaults to the 100-commit window for null/undefined', () => {
    expect(parseCommitWindow(undefined)).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
    expect(parseCommitWindow(null)).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
  });

  it('parses "all" case-insensitively and trims surrounding whitespace', () => {
    expect(parseCommitWindow('all')).toEqual({ kind: 'all' });
    expect(parseCommitWindow('ALL')).toEqual({ kind: 'all' });
    expect(parseCommitWindow(' all ')).toEqual({ kind: 'all' });
  });

  it('parses a numeric window that is a rung', () => {
    for (const rung of COMMIT_WINDOW_RUNGS) {
      expect(parseCommitWindow(String(rung))).toEqual({ kind: 'last', n: rung });
    }
  });

  it('snaps any other count up to the next rung, and large values down to the max', () => {
    expect(parseCommitWindow('0')).toEqual({ kind: 'last', n: 25 });
    expect(parseCommitWindow('1')).toEqual({ kind: 'last', n: 25 });
    expect(parseCommitWindow('26')).toEqual({ kind: 'last', n: 50 });
    expect(parseCommitWindow('99')).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
    expect(parseCommitWindow('150')).toEqual({ kind: 'last', n: 200 });
    expect(parseCommitWindow('999')).toEqual({ kind: 'last', n: MAX_NUMERIC_COMMIT_WINDOW });
    expect(parseCommitWindow('99999')).toEqual({ kind: 'last', n: MAX_NUMERIC_COMMIT_WINDOW });
  });

  it('keeps the default and the cap on the ladder', () => {
    expect(COMMIT_WINDOW_RUNGS).toContain(DEFAULT_COMMIT_WINDOW);
    expect(COMMIT_WINDOW_RUNGS.at(-1)).toBe(MAX_NUMERIC_COMMIT_WINDOW);
    expect([...COMMIT_WINDOW_RUNGS]).toEqual([...COMMIT_WINDOW_RUNGS].sort((a, b) => a - b));
  });

  it('falls back to the default for malformed values', () => {
    expect(parseCommitWindow('banana')).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
    expect(parseCommitWindow('')).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
    expect(parseCommitWindow('-5')).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
    expect(parseCommitWindow('5.5')).toEqual({ kind: 'last', n: DEFAULT_COMMIT_WINDOW });
  });

  it('treats a value overflowing u32 as malformed (matches Rust parse::<u32>)', () => {
    expect(parseCommitWindow('99999999999999')).toEqual({
      kind: 'last',
      n: DEFAULT_COMMIT_WINDOW,
    });
  });
});

describe('commitWindowLimit', () => {
  it('returns the count for a bounded window and null for all', () => {
    expect(commitWindowLimit({ kind: 'last', n: 42 })).toBe(42);
    expect(commitWindowLimit({ kind: 'all' })).toBeNull();
    expect(commitWindowLimit(parseCommitWindow(undefined))).toBe(100);
  });
});

describe('canonicalWindowQuery', () => {
  const api = ['n'];
  const query = (search: string, allowed = api) =>
    canonicalWindowQuery(new URLSearchParams(search), allowed);

  it('leaves the default window alone, whatever else the query holds', () => {
    expect(query('')).toBeNull();
    expect(query('n=100')).toBeNull();
    expect(query('n=100&x=1')).toBeNull();
    expect(query('n=junk&x=1')).toBeNull();
  });

  it('accepts a canonical non-default window', () => {
    expect(query('n=all')).toBeNull();
    expect(query('n=50')).toBeNull();
    expect(query('n=1000')).toBeNull();
  });

  it('passes each kept value other than n through normalize', () => {
    const upper = (_name: string, value: string) => value.toUpperCase();
    expect(
      canonicalWindowQuery(new URLSearchParams('n=all&engine=a'), ['n', 'engine'], upper),
    ).toBe('n=all&engine=A');
    expect(
      canonicalWindowQuery(new URLSearchParams('n=all&engine=A'), ['n', 'engine'], upper),
    ).toBeNull();
  });

  it('drops parameters that are not allowed', () => {
    expect(query('n=all&x=1')).toBe('n=all');
    expect(query('x=1&n=50')).toBe('n=50');
  });

  it('respells n canonically', () => {
    expect(query('n=ALL')).toBe('n=all');
    expect(query('n=+0050')).toBe('n=50');
    expect(query('n=0')).toBe('n=25');
    expect(query('n=150')).toBe('n=200');
    expect(query('n=99999')).toBe(`n=${MAX_NUMERIC_COMMIT_WINDOW}`);
  });

  it('keeps the first value of a repeated parameter', () => {
    expect(query('n=all&n=5')).toBe('n=all');
  });

  it('drops a parameter that normalize maps to null', () => {
    const drop = () => null;
    expect(canonicalWindowQuery(new URLSearchParams('n=all&engine=a'), ['n', 'engine'], drop)).toBe(
      'n=all',
    );
  });

  it('puts the allowed parameters in the order of allowed', () => {
    const page = ['n', 'engine', 'format'];
    expect(query('n=all&engine=duckdb&format=vortex', page)).toBeNull();
    expect(query('engine=duckdb&n=all&format=vortex', page)).toBe(
      'n=all&engine=duckdb&format=vortex',
    );
    expect(query('engine=duckdb&utm_source=x&n=all', page)).toBe('n=all&engine=duckdb');
  });
});
