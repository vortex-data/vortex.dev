// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { describe, expect, it } from 'vitest';

import { byteUnit, formatBytes, formatBytesIn, formatTimeNs } from './format';

describe('formatTimeNs', () => {
  it('renders sub-microsecond values as whole nanoseconds', () => {
    expect(formatTimeNs(0)).toBe('0 ns');
    expect(formatTimeNs(1)).toBe('1 ns');
    expect(formatTimeNs(999)).toBe('999 ns');
    // Rounds to whole ns (zero decimals), matching Rust `{ns:.0}`.
    expect(formatTimeNs(12.6)).toBe('13 ns');
  });

  it('renders the microsecond tier with two decimals and an ASCII "us"', () => {
    expect(formatTimeNs(1_000)).toBe('1.00 us');
    expect(formatTimeNs(1_500)).toBe('1.50 us');
    // The us tier extends right up to (but not including) 1e6 ns; 999_999 ns
    // rounds to 1000.00 us, matching Rust's `format!("{:.2}", 999.999)`.
    expect(formatTimeNs(999_999)).toBe('1000.00 us');
  });

  it('renders the millisecond tier with two decimals', () => {
    expect(formatTimeNs(1_000_000)).toBe('1.00 ms');
    expect(formatTimeNs(1_500_000)).toBe('1.50 ms');
    expect(formatTimeNs(999_999_999)).toBe('1000.00 ms');
  });

  it('renders the second tier with two decimals', () => {
    expect(formatTimeNs(1_000_000_000)).toBe('1.00 s');
    expect(formatTimeNs(2_500_000_000)).toBe('2.50 s');
    expect(formatTimeNs(90_000_000_000)).toBe('90.00 s');
  });

  it('keeps the sign while picking the tier from the magnitude', () => {
    expect(formatTimeNs(-500)).toBe('-500 ns');
    expect(formatTimeNs(-1_500)).toBe('-1.50 us');
    expect(formatTimeNs(-2_000_000)).toBe('-2.00 ms');
  });
});

describe('formatBytes', () => {
  it('keeps sizes from 1 MB up in MB, with a thousands separator', () => {
    expect(formatBytes(1_000_000)).toBe('1.0 MB');
    expect(formatBytes(1_428_150_000)).toBe('1,428.2 MB');
    expect(formatBytes(20_000_000_000)).toBe('20,000.0 MB');
  });

  it('uses KB and B below 1 MB', () => {
    expect(formatBytes(999_949)).toBe('999.9 KB');
    expect(formatBytes(2_500)).toBe('2.5 KB');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('gives a set of sizes the unit of its largest', () => {
    const unit = byteUnit(1_428_150_000);
    expect(unit).toBe('MB');
    expect(formatBytesIn(2_500, unit)).toBe('0.0');
    expect(formatBytesIn(1_428_150_000, unit)).toBe('1,428.2');
    expect(formatBytesIn(999.6, 'B')).toBe('1000');
  });
});
