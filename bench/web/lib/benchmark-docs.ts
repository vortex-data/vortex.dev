// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Links from a group on this site to the benchmark's explainer doc in the
 * monorepo — the same docs the monorepo's PR benchmark comment links with its
 * 📖 glyph (`scripts/compare-benchmark-jsons.py::format_title`, fed by
 * `Benchmark::doc_path` in `vortex-bench`).
 *
 * The blurb in [`./descriptions`] is one editorial sentence; these links are
 * the long form — what the suite actually measures, which queries or datasets
 * it runs, and how to run it locally.
 *
 * The group slug carries the SQL suite's dataset name, but the wire format does
 * not carry [`Benchmark::doc_path`]. [`QUERY_DOCS`] mirrors that upstream
 * mapping explicitly because the doc path does not follow one enforced naming
 * convention. An unmapped group renders no link instead of guessing a URL or
 * linking to a guide that does not describe the benchmark.
 */

import { groupKeyFromSlug, type GroupKey } from './slug';

/** The monorepo that owns every benchmark and its explainer doc. */
const VORTEX_REPO = 'https://github.com/vortex-data/vortex';

/**
 * The ref the links pin to. `develop` is the monorepo's default branch: the
 * site tracks whatever is deployed rather than any one commit, so an unpinned
 * branch link is the one that stays correct as the docs move.
 */
const VORTEX_REF = 'develop';

/**
 * SQL suite dataset names mapped to their upstream [`Benchmark::doc_path`].
 * Update this table when a suite is added or its document moves upstream.
 */
const QUERY_DOCS: Readonly<Record<string, string>> = {
  appian: 'vortex-bench/sql/appian/README.md',
  clickbench: 'vortex-bench/sql/clickbench.md',
  'clickbench-sorted': 'vortex-bench/sql/clickbench.md#sorted-variant',
  fineweb: 'vortex-bench/sql/fineweb.md',
  gharchive: 'vortex-bench/sql/gharchive.md',
  polarsignals: 'vortex-bench/sql/polarsignals.md',
  'public-bi': 'vortex-bench/sql/public-bi.md',
  spatialbench: 'vortex-bench/sql/spatialbench.md',
  statpopgen: 'vortex-bench/sql/statpopgen.md',
  tpcds: 'vortex-bench/sql/tpcds/README.md',
  tpch: 'vortex-bench/sql/tpch/README.md',
  vortex: 'vortex-bench/sql/vortex/README.md',
};

/** The compression benchmark, whose two measurement kinds share one doc. */
const COMPRESS_BENCH_DOC = 'benchmarks/compress-bench/README.md';

/** The random-access benchmark. */
const RANDOM_ACCESS_BENCH_DOC = 'benchmarks/random-access-bench/README.md';

/**
 * The GitHub URL of the doc describing what a group's benchmark measures,
 * taken from the group's slug. Returns `null` when the slug does not parse or
 * the group has no matching explainer document.
 */
export function groupDocUrl(slug: string): string | null {
  let key: GroupKey;
  try {
    key = groupKeyFromSlug(slug);
  } catch {
    return null;
  }
  const path = groupDocPath(key);
  return path === null ? null : `${VORTEX_REPO}/blob/${VORTEX_REF}/${path}`;
}

/**
 * The repo-relative doc path for a group key. Exported for tests, so the
 * derivation can be pinned without the repo URL in every case.
 */
export function groupDocPath(key: GroupKey): string | null {
  switch (key.k) {
    case 'CompressionTimeGroup':
    case 'CompressionSizeGroup':
      return COMPRESS_BENCH_DOC;
    case 'RandomAccessGroup':
      return RANDOM_ACCESS_BENCH_DOC;
    case 'QueryGroup':
      return QUERY_DOCS[key.dataset] ?? null;
    case 'VectorSearchGroup':
      return null;
  }
}
