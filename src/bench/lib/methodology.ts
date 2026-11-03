// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * How the benchmarks behind bench are run and scored, in words. The
 * methodology page (`/methodology`) and `llms.txt` both print it.
 *
 * The machines, schedules and versions come from the monorepo's `develop`
 * branch, as of 2026-11-03: `.github/workflows/develop-bench.yml`,
 * `nightly-bench.yml` and `sql-bench-matrix.yml`, the SQL suites in
 * `bench-orchestrator/bench_orchestrator/ci_matrix/catalog.py`, and the
 * versions in `Cargo.toml`, `vortex-duckdb/build.rs` and
 * `benchmarks/lance-bench/Cargo.toml`. Update this file when those change.
 * The scoring is this site's own (`summary.ts`).
 */

export interface MethodologySection {
  title: string;
  /** Paragraphs. */
  text: string[];
}

/** What each kind of summary score means, one sentence each. */
export const SCORES = {
  query:
    'the geometric mean, over the queries, of the series’ time divided by the fastest ' +
    'series’ time on that query. 1.00x is the fastest; lower is better.',
  randomAccess:
    'the geometric mean, over the datasets, of the series’ time divided by the fastest ' +
    'series’ time on that dataset. 1.00x is the fastest; lower is better.',
  throughput:
    'the geometric mean, over the datasets, of the format’s throughput divided by ' +
    'Parquet’s. Higher is better.',
  size:
    'the geometric mean, over the datasets, of the format’s file size divided by ' +
    'Parquet’s. Lower is better.',
} as const;

export const METHODOLOGY: readonly MethodologySection[] = [
  {
    title: 'When the benchmarks run',
    text: [
      'Every push to the develop branch of https://github.com/vortex-data/vortex runs the ' +
        'compression, string encoding, random access, and SQL query benchmarks, and bench ' +
        'records their results. A nightly run at 00:00 UTC adds TPC-H at scale factor 100 ' +
        'and TPC-DS at scale factors 10 and 100. Benchmarks run on pull requests only ' +
        'comment on the pull request; their results never reach bench.',
    ],
  },
  {
    title: 'Machines and storage',
    text: [
      'The benchmarks run on dedicated AWS c8gd.metal-24xl instances (Graviton4, arm64) ' +
        'in us-east-1, with binaries built for the host CPU (-C target-cpu=native). ' +
        'NVMe results read files from the instance’s local disk. S3 results read the same ' +
        'files from an S3 bucket in us-east-1.',
    ],
  },
  {
    title: 'Engines and formats',
    text: [
      'Queries run on DataFusion 55 and DuckDB 2.0. The formats are Vortex (its default ' +
        'and compact write strategies), Apache Parquet, Lance 13, Arrow IPC, and DuckDB’s ' +
        'own format; not every suite runs every format. Parquet files are written by ' +
        'parquet-rs 59.2, except where a suite takes its data as published (ClickBench) or ' +
        'from DuckDB (TPC-DS).',
    ],
  },
  {
    title: 'How a result is measured',
    text: [
      'SQL suites run each query several times (5 by default, 10 for TPC-H) after ' +
        'dropping the operating system’s page cache, and record the median time. Random ' +
        'access repeats each format’s lookups for 10 seconds and records the median. The ' +
        'compression benchmark writes and scans each dataset 5 times and records the ' +
        'fastest run.',
    ],
  },
  {
    title: 'How the summaries are scored',
    text: [
      `A query suite’s score is ${SCORES.query}`,
      `Random access scores are ${SCORES.randomAccess}`,
      'In both, a query or dataset a series did not run counts as twice that series’ own ' +
        'slowest time, and at least twice the fastest series’ time, so a series cannot ' +
        'rank well by skipping work. Each summary says how many a series ran.',
      `Write and scan throughput scores are ${SCORES.throughput}`,
      `File size scores are ${SCORES.size}`,
      'Each summary uses each series’ newest result on develop.',
    ],
  },
];
