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
 * in `Cargo.toml`, `Cargo.lock` and `vortex-duckdb/build.rs`. The Parquet
 * settings come from vortex-data/vortex#11720: `parquet_writer_properties()` in
 * `vortex-bench/src/utils/parquet.rs`, and `snappy_parquet_size()` in
 * `benchmarks/compress-bench/src/parquet.rs`. The tuning results in "How Parquet
 * is written" are that PR's. Update this file when those change.
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
  arrow:
    'the geometric mean, over the datasets, of the data’s size in memory as Arrow divided by ' +
    'the format’s file size. Higher is better.',
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
        'format, and, for random access, LitData. Not every suite runs every format.',
      'Vortex has more than one way to scan a file in each query engine. bench shows each ' +
        'suite’s default scan. The benchmark reports on pull requests also compare the others.',
      'Parquet has two variants, which differ only in their codec. Parquet is zstd at level ' +
        '3, and it is the baseline of the throughput and file size scores. Parquet (Snappy) ' +
        'is the same Parquet with Snappy, the default codec of DuckDB, Spark, and PyArrow. ' +
        'Only the compression benchmark and TPC-DS at scale factor 1 write it, for its ' +
        'size. Both are written with ' +
        'parquet-rs 59, except SpatialBench’s Parquet, which its generator writes with ' +
        'parquet-rs 56.',
      'Every SQL suite’s Parquet is zstd Parquet, except in ClickBench and FineWeb, which ' +
        'query their published Parquet files as Parquet. ClickBench prescribes its files, ' +
        'which are Snappy, so its Parquet results are not zstd Parquet and do not use the ' +
        'settings below.',
    ],
  },
  {
    title: 'How Parquet is written',
    text: [
      'The zstd Parquet is tuned to be good at everything bench measures: file size, scans, ' +
        'and random access. Every suite that generates Parquet writes it with one set of ' +
        'settings, and only the row group size depends on the storage. Each setting below ' +
        'was tested on its own, on TPC-H at scale factor 10 with both engines and on the ' +
        'random access datasets, on a 16-core Apple M-series Mac with local NVMe. Two runs ' +
        'with the same settings differed by up to 2% on DataFusion and 6% on DuckDB, so ' +
        'smaller differences are noise.',
      'Compression is zstd at level 3, the default of DuckDB and parquet-java. Level 1 made ' +
        'the files 7.5% larger, and level 9 made them 1.6% smaller. Neither changed query ' +
        'times by more than noise.',
      'A column chunk’s dictionary holds at most 64 KiB. When it outgrows that, the rest of ' +
        'the chunk is written without one. parquet-rs’s default of 1 MiB keeps dictionaries ' +
        'for columns with many distinct values, such as keys and comments. With 1 MiB ' +
        'dictionaries, the TPC-H files were 22% larger, DataFusion was 8% slower, and lookups ' +
        'were up to 2.8 times slower. DuckDB makes the choice once per column chunk: it keeps ' +
        'a dictionary when the chunk has at most one distinct value for every five rows.',
      'Data pages hold at most 20,000 rows and 1 MiB, the defaults of parquet-rs. ' +
        'parquet-java uses the same row limit, which it chose so that the page index has ' +
        'enough pages to skip. Each file has a page index, which records each page’s ' +
        'minimum, maximum, and position. With it, a lookup reads and decodes only the pages ' +
        'that hold its rows. Against pages limited by size alone, the row limit made lookups ' +
        'up to 4 times faster, at the same file size and with query times within noise. ' +
        'Leaving out the page index saved no space. DuckDB 2.0 writes no page index, and its ' +
        'column chunks are usually one page.',
      'The files have no Bloom filters. Filters on every column made the TPC-H files 14% ' +
        'larger and made no query faster.',
      'Row groups hold 122,880 rows, DuckDB’s default, in files that queries read from ' +
        'local NVMe. They hold 1,048,576 rows, parquet-rs’s default, in files read from S3, ' +
        'in the random access files, and in the compression benchmark’s files. On the ' +
        'benchmark machines, the smaller row groups made TPC-H at scale factor 10 28% to 38% ' +
        'faster on NVMe. On S3, the larger ones made ' +
        'DataFusion 14% to 21% faster and DuckDB 3% to 8% slower. The page index lets a ' +
        'lookup skip pages inside a row group, so random access keeps parquet-rs’s default.',
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
      'A query suite also ranks a series that missed a query below every series that ran ' +
        'them all. Lance cannot run TPC-DS query 72, so it ranks below the complete series ' +
        'on TPC-DS at scale factor 1.',
      `Write and scan throughput scores are ${SCORES.throughput}`,
      `File size scores are ${SCORES.size}`,
      'The Compression & File Size summary also gives each format’s ratio versus Arrow: ' +
        `${SCORES.arrow} ` +
        'The Arrow size is the memory that the compression benchmark’s data takes once it is ' +
        'read from Parquet into Arrow arrays, with string and binary view columns read as ' +
        'plain string and binary columns. The SQL suites record no Arrow size, so this ratio ' +
        'covers the compression benchmark’s datasets alone. The summary orders the formats by ' +
        'their file size score, which also covers TPC-DS.',
      'Total is the sum of a format’s file sizes over the datasets that every format has. ' +
        'The Compression & File Size summary instead gives a total only to a format that has ' +
        'every dataset in the summary, and ranks a format that lacks a dataset after the ' +
        'formats that have them all.',
      'The compression time summary leaves out the wide table and sparse-wide datasets, ' +
        'which have many variants each. The Compression & File Size summary counts each of ' +
        'those two suites as one dataset, the geometric mean of its ratios. It also leaves ' +
        'out statpopgen, and counts ' +
        'the TPC-H l_comment column once, because its canonical and chunked files are the ' +
        'same size. It does not rank DuckDB’s database file, which is a query engine’s ' +
        'storage, not a file format. These datasets and DuckDB’s file still have charts.',
      'The string encoding benchmark compares its encoders with FSST instead of Parquet, so ' +
        'its throughput and size scores divide by FSST’s.',
      'Each summary uses each series’ newest result on develop.',
    ],
  },
];
