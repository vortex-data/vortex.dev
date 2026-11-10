// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * How the benchmarks behind bench are run and scored, in words. The
 * methodology page (`/methodology`) and `llms.txt` both print it.
 *
 * The machines, schedules, versions and measurements come from the monorepo's
 * `develop` branch at e59b236d7b (2026-11-03): `.github/workflows/develop-bench.yml`,
 * `nightly-bench.yml` and `sql-bench-matrix.yml`, the SQL suites in
 * `bench-orchestrator/bench_orchestrator/ci_matrix/catalog.py`, the runners in
 * `bench-orchestrator/bench_orchestrator/cli.py`, `scripts/random-access-split.py`
 * and `scripts/compress-split.py`, `scripts/setup-benchmark.sh`, and the versions
 * in `Cargo.toml`, `Cargo.lock` and `vortex-duckdb/build.rs`. Update this file
 * when those change.
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
    'series’ time on that query. 1.00× is the fastest. Lower is better.',
  /** No vector search results reach bench yet; `llms.txt` prints this only if some do. */
  vectorSearch:
    'the geometric mean, over the thresholds, of the series’ time divided by the fastest ' +
    'series’ time at that threshold. 1.00× is the fastest. Lower is better.',
  randomAccess:
    'the geometric mean, over the datasets, of the series’ time divided by the fastest ' +
    'series’ time on that dataset. 1.00× is the fastest. Lower is better.',
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
        'and TPC-DS at scale factors 10 and 100. Benchmarks that run on pull requests only ' +
        'comment on the pull request. Their results never reach bench.',
    ],
  },
  {
    title: 'Machines and storage',
    text: [
      'The benchmarks run on dedicated AWS c8gd.metal-24xl instances (Graviton4, arm64) ' +
        'in us-east-1, with binaries built for the host CPU (-C target-cpu=native). Before ' +
        'a run, the machine sets the performance CPU governor and turns swap off. NVMe ' +
        'results read files from the instance’s local disk. S3 results read the same files ' +
        'from an S3 bucket in us-east-1.',
    ],
  },
  {
    title: 'Engines and formats',
    text: [
      'Queries run on DataFusion 55 and DuckDB 2.0. The formats are Vortex (its default ' +
        'and compact write strategies), Apache Parquet, Lance 13, Arrow IPC, DuckDB’s own ' +
        'format, and, for random access, LitData. Not every suite runs every format. The ' +
        'compression and file size benchmarks write Parquet with parquet-rs 59 and zstd at ' +
        'level 3. ClickBench reads its published Parquet files.',
    ],
  },
  {
    title: 'How a result is measured',
    text: [
      'SQL suites drop the operating system’s page cache before each query, run it ' +
        'several times, and record the median time. Most suites run each query 5 times. ' +
        'TPC-H at scale factors 1 and 10 and Appian run it 10 times, TPC-DS at scale ' +
        'factor 100 runs it 3 times, and the Vortex queries run it 100 times.',
      'Random access drops the page cache before each dataset, format, access pattern, ' +
        'and open mode, repeats the lookups for 10 seconds, and records the median. Hot ' +
        'results keep one file open after a one-second untimed warm-up. Cold results open ' +
        'the file again, footer included, for each lookup.',
      'The compression benchmark drops the page cache before each dataset, writes and ' +
        'scans it 5 times, and records the fastest run.',
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
      'Total is the sum of a format’s file sizes over the datasets that every format has.',
      'The compression summaries leave out the wide table and sparse-wide datasets, which ' +
        'have many variants each. The file size summary also leaves out statpopgen, and counts ' +
        'the TPC-H l_comment column once, because its canonical and chunked files are the ' +
        'same size. These datasets still have charts.',
      'The string encoding benchmark compares its encoders with FSST instead of Parquet, so ' +
        'its throughput and size scores divide by FSST’s.',
      'Each summary uses each series’ newest result on develop.',
    ],
  },
];
