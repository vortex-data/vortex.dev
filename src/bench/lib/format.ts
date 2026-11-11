// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Shared display formatting helpers for the read UI.
 *
 * The time helper mirrors the v3 server-rendered HTML layer. Summary time
 * values arrive in nanoseconds from the `value_ns` columns.
 */

/**
 * Format a nanosecond duration into a compact `s` / `ms` / `us` / `ns` string,
 * the port of `server/src/html/summary.rs::format_time_ns`.
 *
 * The tier thresholds and the two-decimal (`s` / `ms` / `us`) vs zero-decimal
 * (`ns`) precision match the Rust source exactly; the unit suffix is a leading
 * space plus the ASCII unit (`us`, not `μs`), again matching v3.
 */
export function formatTimeNs(ns: number): string {
  const abs = Math.abs(ns);
  if (abs >= 1_000_000_000) {
    return `${(ns / 1_000_000_000).toFixed(2)} s`;
  }
  if (abs >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(2)} ms`;
  }
  if (abs >= 1_000) {
    return `${(ns / 1_000).toFixed(2)} us`;
  }
  return `${ns.toFixed(0)} ns`;
}

/** A size ratio to three significant figures, as `1.14x`. */
export function formatCompressionSizeRatio(value: number): string {
  return `${Number(value.toPrecision(3))}x`;
}

const BYTES_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** A decimal byte unit. Sizes stay in MB from 1 MB up, so large totals compare at a glance. */
export type ByteUnit = 'MB' | 'KB' | 'B';

/** The unit `formatBytes` gives `bytes`. Pass the largest of a set to give the set one unit. */
export function byteUnit(bytes: number): ByteUnit {
  if (bytes >= 1_000_000) {
    return 'MB';
  }
  return bytes >= 1_000 ? 'KB' : 'B';
}

/** A byte count in `unit` without the unit: one decimal place for MB and KB, as `1,428.2`. */
export function formatBytesIn(bytes: number, unit: ByteUnit): string {
  switch (unit) {
    case 'MB':
      return BYTES_FORMAT.format(bytes / 1_000_000);
    case 'KB':
      return BYTES_FORMAT.format(bytes / 1_000);
    case 'B':
      return String(Math.round(bytes));
  }
}

/** A byte count in decimal units, as `1,428.2 MB`. */
export function formatBytes(bytes: number): string {
  const unit = byteUnit(bytes);
  return `${formatBytesIn(bytes, unit)} ${unit}`;
}

/** Aggregate throughput as the summary card shows it: MB/s for writes, GB/s for scans. */
export function formatThroughput(valueGbS: number, operation: 'encode' | 'decode'): string {
  return operation === 'encode'
    ? `${(valueGbS * 1000).toFixed(0)} MB/s`
    : `${valueGbS.toFixed(2)} GB/s`;
}
