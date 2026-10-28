// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The route handlers route the default window through `unstable_cache`
// (`lib/data-cache.ts`), which needs Next's request/build `incrementalCache`
// context that plain vitest does not provide. These tests verify the route plus
// query behavior against the real testcontainer, not the cache layer (covered by
// `lib/data-cache.test.ts`), so make the cache wrapper a transparent pass-through.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
}));

import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  collectGroupCharts,
  collectGroups,
  groupNameQuery,
  type GroupChartsResponse,
  type GroupsResponse,
} from './queries';
import { groupDescription } from './descriptions';
import { READ_API_CACHE_CONTROL } from './cache';
import { collectGroupSummary } from './summary';
import { chartKeyToSlug, groupKeyFromSlug, groupKeyToSlug } from './slug';
import {
  commitUrl,
  dockerAvailable,
  seedChartFixture,
  startBenchContainer,
  TREE_SHA,
} from './test-harness';
import { parseCommitWindow } from './window';
import { getPool, resetPool } from './db';
import { GET as getGroups } from '@/app/api/groups/route';
import { GET as getGroup } from '@/app/api/group/[slug]/route';

function expectDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${message} to be defined`);
  }
  return value;
}

// The canonical fixture's summary maths (ratio 2.0, geomean 0.5, the query
// missing-series penalty) reproduce the v2-contract values asserted by
// `server/tests/group_api.rs`; see `seedChartFixture` in `./test-harness`.
describe.skipIf(!dockerAvailable())(
  'collectGroups + group endpoints (testcontainers Postgres)',
  () => {
    let container: StartedPostgreSqlContainer;

    beforeAll(async () => {
      container = await startBenchContainer();
      await seedChartFixture(getPool());
    });

    afterAll(async () => {
      await resetPool();
      await container.stop();
    });

    it('orders groups by the canonical GROUP_ORDER, with unknown groups last', async () => {
      const groups = await collectGroups();
      // Random-access sections precede Clickbench in GROUP_ORDER.
      expect(groups.map((g) => g.name)).toEqual([
        'Compression',
        'Compression Size',
        'Random Access (NVMe)',
        'TPC-H (NVMe) (SF=1)',
        'cohere-large-10m / partitioned',
      ]);
    });

    it('computes the random-access summary (geomean ratio to fastest)', async () => {
      const groups = await collectGroups();
      const summary = expectDefined(
        groups.find((g) => g.name === 'Random Access (NVMe)')?.summary,
        'random access summary',
      );
      if (summary.type !== 'randomAccess') {
        throw new Error(`expected randomAccess summary, got ${summary.type}`);
      }
      expect(summary.hotRankings[0].name).toBe('vortex-file-compressed');
      expect(summary.hotRankings[1].name).toBe('parquet');
      expect(summary.hotRankings[2].name).toBe('arrow-ipc');
      expect(summary.coldRankings.map((r) => r.name)).toEqual([
        'vortex-file-compressed',
        'parquet',
        'arrow-ipc',
      ]);
      // The fixture's newest commit has vortex=100_500 and parquet=201_000 on
      // the one `taxi` chart. Arrow IPC is 301_500 on the same chart.
      expect(summary.hotRankings[0].score).toBeCloseTo(1.0, 6);
      expect(summary.hotRankings[1].score).toBeCloseTo(1.9999005, 6);
      expect(summary.hotRankings[2].score).toBeCloseTo(2.999801, 6);
      expect(summary.hotRankings[0].totalRuntime).toBeCloseTo(100_500, 6);
      expect(summary.hotRankings[1].totalRuntime).toBeCloseTo(201_000, 6);
      expect(summary.hotRankings[2].totalRuntime).toBeCloseTo(301_500, 6);
      expect(summary.hotRankings.map((r) => [r.measured, r.total])).toEqual([
        [1, 1],
        [1, 1],
        [1, 1],
      ]);
    });

    it('summarizes the vector-search group instead of leaving it blank', async () => {
      const groups = await collectGroups();
      const summary = expectDefined(
        groups.find((g) => g.name === 'cohere-large-10m / partitioned')?.summary,
        'vector search summary',
      );
      if (summary.type !== 'vectorSearch') {
        throw new Error(`expected vectorSearch summary, got ${summary.type}`);
      }
      expect(summary.title).toBe('Vector Search Performance');
      expect(summary.rankings.map((r) => r.name)).toEqual(['vortex-turboquant']);
      expect(summary.rankings[0].score).toBeCloseTo(1.0, 6);
      // The newest commit's value for the group's single threshold.
      expect(summary.rankings[0].totalRuntime).toBeCloseTo(107_000, 6);
    });

    it('computes compression rankings with Parquet and Lance baselines', async () => {
      const groups = await collectGroups();
      const summary = expectDefined(
        groups.find((g) => g.name === 'Compression')?.summary,
        'compression summary',
      );
      if (summary.type !== 'compression') {
        throw new Error(`expected compression summary, got ${summary.type}`);
      }
      const byKey = new Map(
        summary.rankings.map((ranking) => [`${ranking.operation}:${ranking.name}`, ranking]),
      );
      expect(byKey.get('encode:vortex-file-compressed')?.ratio).toBeCloseTo(2.0, 6);
      expect(byKey.get('encode:parquet')?.ratio).toBeCloseTo(1.0, 6);
      expect(byKey.get('encode:lance')?.ratio).toBeCloseTo(0.5, 6);
      expect(byKey.get('decode:vortex-file-compressed')?.ratio).toBeCloseTo(2.0, 6);
      expect(byKey.get('decode:parquet')?.ratio).toBeCloseTo(1.0, 6);
      expect(byKey.get('decode:lance')?.ratio).toBeCloseTo(0.5, 6);
      expect(byKey.get('encode:vortex-file-compressed')?.throughputGbS).toBeCloseTo(
        832_000 / 109_000,
        6,
      );
      expect(byKey.get('encode:parquet')?.throughputGbS).toBeCloseTo(832_000 / 218_000, 6);
      expect(byKey.get('encode:lance')?.throughputGbS).toBeCloseTo(832_000 / 36_000, 6);
      expect(byKey.get('decode:vortex-file-compressed')?.throughputGbS).toBeCloseTo(
        832_000 / 105_000,
        6,
      );
      expect(byKey.get('decode:parquet')?.throughputGbS).toBeCloseTo(832_000 / 210_000, 6);
      expect(byKey.get('decode:lance')?.throughputGbS).toBeCloseTo(832_000 / 20_000, 6);
    });

    it('computes compression-size rankings for Vortex, Parquet, Lance, and Arrow IPC', async () => {
      const groups = await collectGroups();
      const summary = expectDefined(
        groups.find((g) => g.name === 'Compression Size')?.summary,
        'compression size summary',
      );
      if (summary.type !== 'compressionSize') {
        throw new Error(`expected compressionSize summary, got ${summary.type}`);
      }
      expect(summary.rankings.map((ranking) => ranking.name)).toEqual([
        'lance',
        'arrow-ipc',
        'vortex-file-compressed',
        'parquet',
      ]);
      const byName = new Map(summary.rankings.map((ranking) => [ranking.name, ranking]));
      expect(byName.get('vortex-file-compressed')?.ratio).toBeCloseTo(0.5, 6);
      expect(byName.get('parquet')?.ratio).toBeCloseTo(1.0, 6);
      expect(byName.get('lance')?.ratio).toBeCloseTo(2.0, 6);
      expect(byName.get('arrow-ipc')?.ratio).toBeCloseTo(4.0, 6);
      expect(byName.get('vortex-file-compressed')?.compressionRatio).toBeCloseTo(8.0, 6);
      expect(byName.get('parquet')?.compressionRatio).toBeCloseTo(4.0, 6);
      // Lance and Arrow IPC use their newest file sizes and the newest logical
      // Arrow size for the dataset, even though the commits do not match.
      expect(byName.get('lance')?.compressionRatio).toBeCloseTo(52.0, 6);
      expect(byName.get('arrow-ipc')?.compressionRatio).toBeCloseTo(26.0, 6);
    });

    it('computes the query-benchmark summary with v2 missing-series penalty', async () => {
      const groups = await collectGroups();
      const summary = expectDefined(
        groups.find((g) => g.name === 'TPC-H (NVMe) (SF=1)')?.summary,
        'query summary',
      );
      if (summary.type !== 'queryBenchmark') {
        throw new Error(`expected queryBenchmark summary, got ${summary.type}`);
      }
      expect(summary.rankings[0].name).toBe('datafusion:vortex-file-compressed');
      expect(summary.rankings[1].name).toBe('duckdb:parquet');
      expect(summary.rankings[0].score).toBeLessThan(summary.rankings[1].score);
      // Exact geomean scores pin the penalty model (not just the ordering). At the
      // latest commit datafusion has Q1=1_100_000, Q2=700_000 and duckdb has only
      // Q1=900_000; bestByQuery is {Q1: 900_000, Q2: 700_000}. datafusion scores
      // sqrt((10+1_100_000)/(10+900_000) * 1) = sqrt(1100010/900010); duckdb is
      // missing Q2 so it takes the penalty max(900_000,300_000)*2 = 1_800_000,
      // scoring sqrt(1 * (10+1_800_000)/(10+700_000)) = sqrt(1800010/700010). The
      // penalty is what pushes duckdb (best raw Q1) below datafusion.
      expect(summary.rankings[0].score).toBeCloseTo(1.10554, 5);
      expect(summary.rankings[1].score).toBeCloseTo(1.60356, 5);
      // datafusion series has Q1 + Q2; duckdb series has Q1 only.
      expect(summary.rankings[0].totalRuntime).toBeCloseTo(1_800_000, 6);
      expect(JSON.stringify(summary)).toContain('"totalRuntime"');
    });

    it('attaches editorial descriptions and omits them where v2 has none', async () => {
      const groups = await collectGroups();
      expect(groups.find((g) => g.name === 'Random Access (NVMe)')?.description).toBe(
        'Tests performance of selecting arbitrary row indices from a file on NVMe storage',
      );
      expect(groups.find((g) => g.name === 'TPC-H (NVMe) (SF=1)')?.description).toBe(
        'TPC-H benchmark queries on local NVMe storage at SF=1 (~1GB of data)',
      );
      const vector = expectDefined(
        groups.find((g) => g.name === 'cohere-large-10m / partitioned'),
        'vector-search group',
      );
      // Vector-search groups now carry a summary (every group kind does), but
      // still have no editorial description.
      expect(vector.summary?.type).toBe('vectorSearch');
      expect(vector.description).toBeUndefined();
    });

    it('GET /api/groups returns the canonical group list with summaries', async () => {
      const res = await getGroups();
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(READ_API_CACHE_CONTROL);
      const body = (await res.json()) as GroupsResponse;
      expect(body.groups.map((g) => g.name)).toEqual([
        'Compression',
        'Compression Size',
        'Random Access (NVMe)',
        'TPC-H (NVMe) (SF=1)',
        'cohere-large-10m / partitioned',
      ]);
    });

    it('collectGroupCharts inlines flattened chart payloads for one group', async () => {
      const slug = groupKeyToSlug({
        k: 'QueryGroup',
        dataset: 'tpch',
        dataset_variant: null,
        scale_factor: '1',
        storage: 'nvme',
      });
      const group = expectDefined(
        await collectGroupCharts(groupKeyFromSlug(slug), parseCommitWindow(null)),
        'group charts',
      );
      expect(group.name).toBe('TPC-H (NVMe) (SF=1)');
      expect(group.summary?.type).toBe('queryBenchmark');
      expect(group.description).toBe(
        'TPC-H benchmark queries on local NVMe storage at SF=1 (~1GB of data)',
      );
      expect(group.charts.map((c) => c.name)).toEqual(['Q1', 'Q2']);
      const q1 = group.charts[0];
      // The chart link's slug round-trips to the same `/api/chart` slug.
      expect(q1.slug).toBe(
        chartKeyToSlug({
          k: 'QueryMeasurement',
          dataset: 'tpch',
          dataset_variant: null,
          scale_factor: '1',
          storage: 'nvme',
          query_idx: 1,
        }),
      );
      // The ChartResponse payload is flattened in alongside `name` / `slug`.
      expect(q1.display_name).toBe('tpch sf=1 Q1 [nvme]');
      expect(q1.commits).toHaveLength(3);
      expect(q1.series['datafusion:vortex-file-compressed']).toEqual([
        1_000_000, 1_050_000, 1_100_000,
      ]);
    });

    it('GET /api/group/{slug} returns the group, honoring ?n', async () => {
      const slug = groupKeyToSlug({
        k: 'QueryGroup',
        dataset: 'tpch',
        dataset_variant: null,
        scale_factor: '1',
        storage: 'nvme',
      });
      const full = await getGroup(new Request(`http://localhost/api/group/${slug}`), {
        params: Promise.resolve({ slug }),
      });
      expect(full.status).toBe(200);
      expect(full.headers.get('cache-control')).toBe(READ_API_CACHE_CONTROL);
      const body = (await full.json()) as GroupChartsResponse;
      expect(body.summary?.type).toBe('queryBenchmark');
      expect(body.charts).toHaveLength(2);

      const windowed = await getGroup(new Request(`http://localhost/api/group/${slug}?n=1`), {
        params: Promise.resolve({ slug }),
      });
      expect(windowed.status).toBe(200);
      const windowedBody = (await windowed.json()) as GroupChartsResponse;
      for (const chart of windowedBody.charts) {
        expect(chart.commits).toHaveLength(1);
      }
    });

    it('GET /api/group/{slug} returns 404 for a well-formed slug with no data', async () => {
      const slug = groupKeyToSlug({
        k: 'QueryGroup',
        dataset: 'nonexistent',
        dataset_variant: null,
        scale_factor: null,
        storage: 'nvme',
      });
      const res = await getGroup(new Request(`http://localhost/api/group/${slug}`), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found', message: 'group not found' });
      expect(res.headers.get('cache-control')).toBeNull();
    });

    it('treats cached-only random-access rows as hot access', async () => {
      const pool = getPool();
      await pool.query("DELETE FROM random_access_times WHERE open_mode = 'reopen'");

      const summary = await collectGroupSummary({ k: 'RandomAccessGroup', storage: 'nvme' });
      if (summary === null || summary.type !== 'randomAccess') {
        throw new Error('expected a randomAccess summary');
      }
      expect(summary.hotRankings.map((ranking) => ranking.name)).toEqual([
        'vortex-file-compressed',
        'parquet',
        'arrow-ipc',
      ]);
      expect(summary.coldRankings).toEqual([]);

      const group = expectDefined(
        await collectGroupCharts(
          { k: 'RandomAccessGroup', storage: 'nvme' },
          parseCommitWindow(null),
        ),
        'cached-only random access group',
      );
      expect(Object.keys(group.charts[0].series).sort()).toEqual([
        'arrow-ipc:hot',
        'parquet:hot',
        'vortex-file-compressed:hot',
      ]);
    });
  },
);

// Isolated summary-math fidelity tests (each test truncates and seeds its own
// scenario). They pin two areas the shared fixture leaves under-covered:
//  Compression latest-timestamp semantics:
//  - sub-second timestamps must not be truncated to whole seconds (regression
//    for the `to_char(... SS)` round-trip that exact-equality-rebound a coarser
//    text value and silently dropped the summary);
//  - decode is aggregated at the encode-derived timestamp, not decode's own;
//  - the timestamp falls back to the latest decode pair when no encode exists.
//  Query-summary penalty model:
//  - the 300_000 ns penalty floor is exercised (all runtimes below it) so a
//    missing query flips the ranking, pinning the floor + ratio formula.
describe.skipIf(!dockerAvailable())('summary math fidelity (testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;
  let measurementId = 0;

  function nextId(): number {
    measurementId += 1;
    return measurementId;
  }

  async function insertCommit(sha: string, ts: string): Promise<void> {
    await getPool().query(
      `INSERT INTO commits (commit_sha, timestamp, message, tree_sha, url)
         VALUES ($1, $2::timestamptz, $3, $4, $5)`,
      [sha, ts, 'fidelity fixture', TREE_SHA, commitUrl(sha)],
    );
  }

  // One complete vortex/parquet compression-time pair for a single op.
  async function insertCompTimePair(
    sha: string,
    op: string,
    vortexNs: number,
    parquetNs: number,
  ): Promise<void> {
    await getPool().query(
      `INSERT INTO compression_times
           (measurement_id, commit_sha, dataset, dataset_variant, format, op,
            value_ns, all_runtimes_ns)
         VALUES ($1, $2, 'tpch-lineitem', NULL, 'vortex-file-compressed', $4, $5, '{1}'::bigint[]),
                ($3, $2, 'tpch-lineitem', NULL, 'parquet',                $4, $6, '{1}'::bigint[])`,
      [nextId(), sha, nextId(), op, vortexNs, parquetNs],
    );
  }

  // One complete vortex/parquet compression-size pair.
  async function insertCompSizePair(
    sha: string,
    vortexBytes: number,
    parquetBytes: number,
  ): Promise<void> {
    const uncompressedBytes = parquetBytes * 4;
    await getPool().query(
      `INSERT INTO compression_sizes
           (measurement_id, commit_sha, dataset, dataset_variant, format,
            value_bytes, uncompressed_bytes)
         VALUES ($1, $2, 'tpch-lineitem', NULL, 'vortex-file-compressed', $4, $6),
                ($3, $2, 'tpch-lineitem', NULL, 'parquet',                $5, $6)`,
      [nextId(), sha, nextId(), vortexBytes, parquetBytes, uncompressedBytes],
    );
  }

  beforeAll(async () => {
    container = await startBenchContainer();
  });

  afterAll(async () => {
    await resetPool();
    await container.stop();
  });

  beforeEach(async () => {
    await getPool().query(
      `TRUNCATE compression_times, compression_sizes, query_measurements,
                random_access_times, vector_search_runs, commits`,
    );
  });

  // One latest-value query_measurements row for the shared tpch query group.
  async function insertQuery(
    sha: string,
    queryIdx: number,
    engine: string,
    format: string,
    valueNs: number,
  ): Promise<void> {
    await getPool().query(
      `INSERT INTO query_measurements
           (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
            query_idx, storage, engine, format, value_ns, all_runtimes_ns,
            commit_timestamp)
         VALUES ($1, $2, 'tpch', NULL, '1', $3, 'nvme', $4, $5, $6, '{1}'::bigint[],
                 (SELECT timestamp FROM commits WHERE commit_sha = $2))`,
      [nextId(), sha, queryIdx, engine, format, valueNs],
    );
  }

  // One random-access measurement for a `{dataset}/{pattern}` chart. The
  // producer (`benchmarks/random-access-bench`) writes `dataset` in exactly
  // this shape, plus a legacy bare `taxi`.
  async function insertRandomAccess(
    sha: string,
    dataset: string,
    format: string,
    valueNs: number,
  ): Promise<void> {
    await getPool().query(
      `INSERT INTO random_access_times
           (measurement_id, commit_sha, dataset, format, value_ns, all_runtimes_ns)
         VALUES ($1, $2, $3, $4, $5, '{1}'::bigint[])`,
      [nextId(), sha, dataset, format, valueNs],
    );
  }

  it('splits random-access groups, summaries, and chart bundles by storage', async () => {
    const sha = 'a'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    for (const dataset of ['taxi', 'taxi/uniform', 'taxi-s3', 'taxi-s3/uniform']) {
      await insertRandomAccess(sha, dataset, 'vortex', 100);
    }

    const groups = await collectGroups();
    expect(groups.map((group) => group.name)).toEqual([
      'Random Access (NVMe)',
      'Random Access (S3)',
    ]);
    for (const [index, storage] of (['nvme', 's3'] as const).entries()) {
      const datasets =
        storage === 'nvme' ? ['taxi', 'taxi/uniform'] : ['taxi-s3', 'taxi-s3/uniform'];
      expect(groupKeyFromSlug(groups[index].slug)).toEqual({ k: 'RandomAccessGroup', storage });
      expect(groups[index].charts).toEqual(
        datasets.map((dataset) => ({
          name: dataset,
          slug: chartKeyToSlug({ k: 'RandomAccess', dataset }),
        })),
      );
      const bundle = await collectGroupCharts(
        { k: 'RandomAccessGroup', storage },
        parseCommitWindow(null),
      );
      expect(bundle?.charts.map((chart) => chart.display_name)).toEqual(datasets);
      expect(bundle?.summary).toMatchObject({
        type: 'randomAccess',
        hotRankings: [{ name: 'vortex', totalRuntime: 200, measured: 1, total: 1 }],
        coldRankings: [],
      });
    }

    await getPool().query(
      "DELETE FROM random_access_times WHERE dataset IN ('taxi', 'taxi/uniform')",
    );
    expect((await collectGroups()).map((group) => group.name)).toEqual(['Random Access (S3)']);
    expect(
      await collectGroupCharts(
        { k: 'RandomAccessGroup', storage: 'nvme' },
        parseCommitWindow(null),
      ),
    ).toBeNull();
  });

  it('ranks random access over every chart, not the alphabetically first one', async () => {
    // The bug this pins: the old summary walked the group's chart links and
    // published the first populated chart's raw times under the group-wide
    // title, so `lance` winning `feature-vectors/correlated` was reported as
    // `lance` leading random access outright -- even though it is 3x slower on
    // the two other charts. Ranking over all three charts reverses that.
    const sha = 'a'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    await insertRandomAccess(sha, 'feature-vectors/correlated', 'lance', 350_000);
    await insertRandomAccess(
      sha,
      'feature-vectors/correlated',
      'vortex-file-compressed',
      1_100_000,
    );
    await insertRandomAccess(sha, 'nested-structs/uniform', 'lance', 3_000_000);
    await insertRandomAccess(sha, 'nested-structs/uniform', 'vortex-file-compressed', 1_000_000);
    await insertRandomAccess(sha, 'taxi', 'lance', 3_000_000);
    await insertRandomAccess(sha, 'taxi', 'vortex-file-compressed', 1_000_000);

    const summary = expectDefined(
      await collectGroupSummary({ k: 'RandomAccessGroup', storage: 'nvme' }),
      'random-access summary',
    );
    if (summary.type !== 'randomAccess') {
      throw new Error(`expected randomAccess summary, got ${summary.type}`);
    }
    expect(summary.hotRankings.map((r) => r.name)).toEqual(['vortex-file-compressed', 'lance']);
    // vortex: cbrt(1100000/350000 * 1 * 1); lance: cbrt(1 * 3 * 3).
    expect(summary.hotRankings[0].score).toBeCloseTo(Math.cbrt(1_100_010 / 350_010), 5);
    expect(summary.hotRankings[1].score).toBeCloseTo(Math.cbrt((3_000_010 / 1_000_010) ** 2), 5);
    expect(summary.hotRankings[0].totalRuntime).toBeCloseTo(3_100_000 / 3, 6);
  });

  it('keeps an intermittently benchmarked format at its own latest run', async () => {
    // `lance` runs less often than Vortex. Pinning every format to one global
    // latest commit dropped it from the card entirely on any commit it skipped;
    // each format is instead read at its own newest run per chart, the same
    // freshness policy the compression summaries use.
    const older = 'b'.repeat(40);
    const newer = 'c'.repeat(40);
    await insertCommit(older, '2026-04-22T12:00:00Z');
    await insertCommit(newer, '2026-04-23T12:00:00Z');
    await insertRandomAccess(older, 'taxi', 'lance', 4_000_000);
    await insertRandomAccess(older, 'taxi', 'vortex-file-compressed', 2_000_000);
    // The newer commit has no `lance` row.
    await insertRandomAccess(newer, 'taxi', 'vortex-file-compressed', 1_000_000);

    const summary = expectDefined(
      await collectGroupSummary({ k: 'RandomAccessGroup', storage: 'nvme' }),
      'random-access summary',
    );
    if (summary.type !== 'randomAccess') {
      throw new Error(`expected randomAccess summary, got ${summary.type}`);
    }
    const byName = new Map(summary.hotRankings.map((r) => [r.name, r]));
    // Vortex is read at the newer commit, lance at its own older one.
    expect(byName.get('vortex-file-compressed')?.totalRuntime).toBeCloseTo(1_000_000, 6);
    expect(byName.get('lance')?.totalRuntime).toBeCloseTo(4_000_000, 6);
  });

  it('penalizes a format that skipped a chart instead of scoring it on a subset', async () => {
    // A format measured only where it wins would otherwise take #1 on a
    // one-chart geomean. `lance` is fastest on the chart it ran and absent from
    // the other; the missing chart is imputed `max(itsWorstChart, 0) * 2`, which
    // is what drops it behind the format measured everywhere.
    const sha = 'd'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    await insertRandomAccess(sha, 'feature-vectors/correlated', 'lance', 100_000);
    await insertRandomAccess(sha, 'feature-vectors/correlated', 'vortex-file-compressed', 200_000);
    await insertRandomAccess(sha, 'taxi', 'vortex-file-compressed', 50_000);

    const summary = expectDefined(
      await collectGroupSummary({ k: 'RandomAccessGroup', storage: 'nvme' }),
      'random-access summary',
    );
    if (summary.type !== 'randomAccess') {
      throw new Error(`expected randomAccess summary, got ${summary.type}`);
    }
    expect(summary.hotRankings.map((r) => r.name)).toEqual(['vortex-file-compressed', 'lance']);
    const byName = new Map(summary.hotRankings.map((r) => [r.name, r]));
    // lance: sqrt(1 * (10 + 200_000) / (10 + 50_000)) with penalty
    // max(100_000, 0) * 2 = 200_000 on the chart it skipped.
    expect(byName.get('lance')?.score).toBeCloseTo(Math.sqrt(200_010 / 50_010), 6);
    expect(byName.get('lance')?.measured).toBe(1);
    expect(byName.get('lance')?.total).toBe(2);
    // `totalRuntime` sums only the charts it actually ran; the penalty is a
    // scoring device, not a reported measurement.
    expect(byName.get('lance')?.totalRuntime).toBeCloseTo(100_000, 6);
    expect(byName.get('vortex-file-compressed')?.score).toBeCloseTo(
      Math.sqrt(200_010 / 100_010),
      6,
    );
    expect(byName.get('vortex-file-compressed')?.measured).toBe(2);
  });

  it('summarizes a vector-search group across its thresholds', async () => {
    const sha = 'e'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    const rows: ReadonlyArray<readonly [string, number, number]> = [
      ['vortex-turboquant', 0.5, 1_000],
      ['vortex-turboquant', 0.75, 2_000],
      ['vortex-flat', 0.5, 2_000],
      ['vortex-flat', 0.75, 8_000],
    ];
    for (const [flavor, threshold, valueNs] of rows) {
      await getPool().query(
        `INSERT INTO vector_search_runs
             (measurement_id, commit_sha, dataset, layout, flavor, threshold, value_ns,
              all_runtimes_ns, matches, rows_scanned, bytes_scanned, iterations)
           VALUES ($1, $2, 'cohere-large-10m', 'partitioned', $3, $4, $5,
                   '{1}'::bigint[], 42, 1000000, 5000000, 1)`,
        [nextId(), sha, flavor, threshold, valueNs],
      );
    }

    const summary = expectDefined(
      await collectGroupSummary({
        k: 'VectorSearchGroup',
        dataset: 'cohere-large-10m',
        layout: 'partitioned',
      }),
      'vector-search summary',
    );
    if (summary.type !== 'vectorSearch') {
      throw new Error(`expected vectorSearch summary, got ${summary.type}`);
    }
    expect(summary.rankings.map((r) => r.name)).toEqual(['vortex-turboquant', 'vortex-flat']);
    expect(summary.rankings[0].score).toBeCloseTo(1.0, 6);
    // sqrt((2010/1010) * (8010/2010)).
    expect(summary.rankings[1].score).toBeCloseTo(Math.sqrt((2010 / 1010) * (8010 / 2010)), 6);
  });

  it('keeps a sub-second latest commit timestamp (no whole-second truncation)', async () => {
    // A single commit whose timestamp carries microseconds. The pre-fix code
    // rendered MAX(ts) to whole-second text and rebound it with exact
    // equality, so this pair no longer matched and the summary dropped.
    const sha = 'a'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00.123456Z');
    await insertCompTimePair(sha, 'encode', 1_000, 3_000);
    await insertCompTimePair(sha, 'decode', 1_000, 2_000);
    await insertCompSizePair(sha, 1_000, 4_000);

    const time = expectDefined(
      await collectGroupSummary({ k: 'CompressionTimeGroup' }),
      'compression-time summary',
    );
    if (time.type !== 'compression') {
      throw new Error(`expected compression summary, got ${time.type}`);
    }
    const timeByKey = new Map(
      time.rankings.map((ranking) => [`${ranking.operation}:${ranking.name}`, ranking]),
    );
    expect(timeByKey.get('encode:vortex-file-compressed')?.ratio).toBeCloseTo(3.0, 6);
    expect(timeByKey.get('encode:parquet')?.ratio).toBeCloseTo(1.0, 6);
    expect(timeByKey.get('decode:vortex-file-compressed')?.ratio).toBeCloseTo(2.0, 6);
    expect(timeByKey.get('decode:parquet')?.ratio).toBeCloseTo(1.0, 6);

    const size = expectDefined(
      await collectGroupSummary({ k: 'CompressionSizeGroup' }),
      'compression-size summary',
    );
    if (size.type !== 'compressionSize') {
      throw new Error(`expected compressionSize summary, got ${size.type}`);
    }
    expect(size.rankings.map((ranking) => ranking.name)).toEqual([
      'vortex-file-compressed',
      'parquet',
    ]);
    expect(size.rankings[0].ratio).toBeCloseTo(0.25, 6);
    expect(size.rankings[1].ratio).toBeCloseTo(1.0, 6);
  });

  it('selects one commit when the latest timestamps collide', async () => {
    const lowerSha = '4'.repeat(40);
    const higherSha = '5'.repeat(40);
    const timestamp = '2026-04-23T12:00:00Z';
    await insertCommit(lowerSha, timestamp);
    await insertCommit(higherSha, timestamp);
    await insertCompTimePair(lowerSha, 'encode', 1_000, 2_000);
    await insertCompTimePair(higherSha, 'encode', 1_000, 4_000);
    await insertCompSizePair(lowerSha, 1_000, 2_000);
    await insertCompSizePair(higherSha, 2_000, 8_000);

    const time = expectDefined(
      await collectGroupSummary({ k: 'CompressionTimeGroup' }),
      'compression-time summary',
    );
    if (time.type !== 'compression') {
      throw new Error(`expected compression summary, got ${time.type}`);
    }
    const vortexTime = expectDefined(
      time.rankings.find(
        (ranking) => ranking.operation === 'encode' && ranking.name === 'vortex-file-compressed',
      ),
      'Vortex compression ranking',
    );
    expect(vortexTime.ratio).toBeCloseTo(4.0, 6);

    const size = expectDefined(
      await collectGroupSummary({ k: 'CompressionSizeGroup' }),
      'compression-size summary',
    );
    if (size.type !== 'compressionSize') {
      throw new Error(`expected compressionSize summary, got ${size.type}`);
    }
    const vortexSize = expectDefined(
      size.rankings.find((ranking) => ranking.name === 'vortex-file-compressed'),
      'Vortex compression-size ranking',
    );
    expect(vortexSize.ratio).toBeCloseTo(0.25, 6);
  });

  it('aggregates decode at the encode-derived timestamp, not decode’s own latest', async () => {
    // Encode pair only at the OLDER commit; decode pair only at the NEWER
    // commit. The summary timestamp is encode-derived, so the decode geomean is
    // taken at the encode commit (no decode pair there) and is therefore
    // omitted, matching the Rust single-timestamp aggregation.
    const older = 'b'.repeat(40);
    const newer = 'c'.repeat(40);
    await insertCommit(older, '2026-04-23T12:00:00Z');
    await insertCommit(newer, '2026-04-24T12:00:00Z');
    await insertCompTimePair(older, 'encode', 1_000, 3_000);
    await insertCompTimePair(newer, 'decode', 1_000, 2_000);

    const summary = expectDefined(
      await collectGroupSummary({ k: 'CompressionTimeGroup' }),
      'compression-time summary',
    );
    if (summary.type !== 'compression') {
      throw new Error(`expected compression summary, got ${summary.type}`);
    }
    expect(summary.rankings.map((ranking) => `${ranking.operation}:${ranking.name}`)).toEqual([
      'encode:vortex-file-compressed',
      'encode:parquet',
    ]);
    expect(summary.rankings[0].ratio).toBeCloseTo(3.0, 6);
  });

  it('falls back to the latest decode timestamp when there is no encode pair', async () => {
    const sha = 'd'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    await insertCompTimePair(sha, 'decode', 1_000, 2_000);

    const summary = expectDefined(
      await collectGroupSummary({ k: 'CompressionTimeGroup' }),
      'compression-time summary',
    );
    if (summary.type !== 'compression') {
      throw new Error(`expected compression summary, got ${summary.type}`);
    }
    expect(summary.rankings.map((ranking) => `${ranking.operation}:${ranking.name}`)).toEqual([
      'decode:vortex-file-compressed',
      'decode:parquet',
    ]);
    expect(summary.rankings[0].ratio).toBeCloseTo(2.0, 6);
  });

  it('applies the 300_000 penalty floor so a missing query flips the ranking', async () => {
    // All present runtimes are below the 300_000 ns floor, so the missing-query
    // penalty is max(maxRuntime, 300_000) * 2 = 600_000 for both series (the
    // floor, not maxRuntime, sets it). duckdb has the fastest Q1 (50_000) but is
    // missing Q2, so the floor penalty pushes it BELOW datafusion. This pins both
    // the penalty floor constant and the (10+v)/(10+best) ratio formula.
    const sha = 'e'.repeat(40);
    await insertCommit(sha, '2026-04-23T12:00:00Z');
    await insertQuery(sha, 1, 'datafusion', 'vortex-file-compressed', 100_000);
    await insertQuery(sha, 2, 'datafusion', 'vortex-file-compressed', 200_000);
    await insertQuery(sha, 1, 'duckdb', 'parquet', 50_000);

    const summary = expectDefined(
      await collectGroupSummary({
        k: 'QueryGroup',
        dataset: 'tpch',
        dataset_variant: null,
        scale_factor: '1',
        storage: 'nvme',
      }),
      'query summary',
    );
    if (summary.type !== 'queryBenchmark') {
      throw new Error(`expected queryBenchmark summary, got ${summary.type}`);
    }
    // bestByQuery = {Q1: 50_000, Q2: 200_000}.
    // datafusion: sqrt((10+100_000)/(10+50_000) * 1) = sqrt(100010/50010).
    // duckdb: missing Q2 -> floor penalty 600_000;
    //   sqrt(1 * (10+600_000)/(10+200_000)) = sqrt(600010/200010).
    expect(summary.rankings.map((r) => r.name)).toEqual([
      'datafusion:vortex-file-compressed',
      'duckdb:parquet',
    ]);
    expect(summary.rankings[0].score).toBeCloseTo(1.414143, 5);
    expect(summary.rankings[1].score).toBeCloseTo(1.732022, 5);
  });
});

// PR-5.1.5 read-path skip-scan fidelity. The canonical fixture above cannot
// exercise these paths: it seeds a single query group with one format per
// engine and stamps every commit_timestamp, so the summary skip scan's
// format-successor branch, the NULLS-LAST latest emulation (a transient
// NULL-stamped row must not beat an older stamped row; an all-NULL series must
// still appear via the fallback arm), and most of the discovery successor's
// NULL-partition branches never execute. This block seeds exactly those shapes.
describe.skipIf(!dockerAvailable())(
  'read-path skip-scan fidelity (testcontainers Postgres)',
  () => {
    let container: StartedPostgreSqlContainer;

    const COMMIT_A = 'a'.repeat(40);
    const COMMIT_B = 'b'.repeat(40);

    beforeAll(async () => {
      container = await startBenchContainer();
      const pool = getPool();
      // COMMIT_B is NEWER than COMMIT_A: the NULLS-LAST probe must still prefer
      // COMMIT_A's stamped row over COMMIT_B's unstamped one.
      await pool.query(
        `INSERT INTO commits (commit_sha, timestamp, message, tree_sha, url) VALUES
         ($1, '2026-05-01T12:00:00Z', 'older', $3, $4),
         ($2, '2026-05-02T12:00:00Z', 'newer', $3, $5)`,
        [COMMIT_A, COMMIT_B, TREE_SHA, commitUrl(COMMIT_A), commitUrl(COMMIT_B)],
      );
      // One v2-allowlisted query group (tpch / NULL / '1' / nvme) shaped to fire
      // every summary successor branch: e1 has TWO formats (format successor),
      // e2 is a second engine (engine successor), q2 exists for e1:f1 (query_idx
      // successor). e1:f1 additionally carries a NEWER NULL-stamped row that must
      // lose to the stamped 111, and e9:f9 is an all-NULL-stamped series that
      // must surface through the fallback arm.
      const rows: ReadonlyArray<
        readonly [number, string, number, string, string, number, boolean]
      > = [
        // [measurement_id, sha, query_idx, engine, format, value_ns, stamped]
        [1, COMMIT_A, 1, 'e1', 'f1', 111, true],
        [2, COMMIT_B, 1, 'e1', 'f1', 222, false],
        [3, COMMIT_A, 1, 'e1', 'f2', 444, true],
        [4, COMMIT_A, 1, 'e2', 'f1', 555, true],
        [5, COMMIT_A, 2, 'e1', 'f1', 666, true],
        [6, COMMIT_B, 1, 'e9', 'f9', 333, false],
        // A second, OLDER unstamped row for e9:f9: the all-NULL fallback must
        // deterministically pick COMMIT_B's 333 (newest via the commits join),
        // not an arbitrary row.
        [7, COMMIT_A, 1, 'e9', 'f9', 999, false],
      ];
      for (const [mid, sha, queryIdx, engine, format, valueNs, stamped] of rows) {
        await pool.query(
          `INSERT INTO query_measurements
           (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
            query_idx, storage, engine, format, value_ns, all_runtimes_ns,
            commit_timestamp)
         VALUES ($1, $2, 'tpch', NULL, '1', $3, 'nvme', $4, $5, $6, '{1}'::bigint[],
                 CASE WHEN $7 THEN (SELECT timestamp FROM commits WHERE commit_sha = $2)
                      ELSE NULL END)`,
          [mid, sha, queryIdx, engine, format, valueNs, stamped],
        );
      }
      // Discovery fan-out: every NULL/non-NULL combination of the two nullable
      // dimensions across two storages and two query indices, plus a second
      // sparse dataset, so all 15 successor branches and both NULL-partition
      // steps execute against the GROUP BY oracle below.
      let mid = 100;
      for (const variant of ['v1', 'v2', null]) {
        for (const scale of ['1', '10', null]) {
          for (const storage of ['nvme', 's3']) {
            for (const queryIdx of [1, 2]) {
              mid += 1;
              await pool.query(
                `INSERT INTO query_measurements
                 (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
                  query_idx, storage, engine, format, value_ns, all_runtimes_ns)
               VALUES ($1, $2, 'alpha', $3, $4, $5, $6, 'e1', 'f1', 1, '{1}'::bigint[])`,
                [mid, COMMIT_A, variant, scale, queryIdx, storage],
              );
            }
          }
        }
      }
      await pool.query(
        `INSERT INTO query_measurements
         (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
          query_idx, storage, engine, format, value_ns, all_runtimes_ns)
       VALUES (200, $1, 'beta', NULL, NULL, 7, 's3', 'e1', 'f1', 1, '{1}'::bigint[])`,
        [COMMIT_A],
      );
    });

    afterAll(async () => {
      await resetPool();
      await container.stop();
    });

    it('prefers a stamped row over a newer NULL-stamped row and keeps all-NULL series', async () => {
      const summary = await collectGroupSummary({
        k: 'QueryGroup',
        dataset: 'tpch',
        dataset_variant: null,
        scale_factor: '1',
        storage: 'nvme',
      });
      if (summary === null || summary.type !== 'queryBenchmark') {
        throw new Error(`expected queryBenchmark summary, got ${summary?.type}`);
      }
      const byName = new Map(summary.rankings.map((r) => [r.name, r.totalRuntime]));
      // e1:f1's latest for Q1 is the STAMPED 111, not the newer NULL-stamped 222
      // (plus its Q2 value 666); e9:f9 has only NULL-stamped rows and must still
      // appear via the fallback arm, which must pick the NEWEST commit's 333
      // over the older 999 (the fallback orders by the joined
      // commits.timestamp). Flipping the probe to a plain `commit_timestamp
      // DESC` (NULLS FIRST) order, or dropping the fallback's ORDER BY, fails
      // this test.
      expect(byName.get('e1:f1')).toBeCloseTo(111 + 666, 6);
      expect(byName.get('e9:f9')).toBeCloseTo(333, 6);
    });

    it('enumerates the format, engine, and query_idx successor branches', async () => {
      const summary = await collectGroupSummary({
        k: 'QueryGroup',
        dataset: 'tpch',
        dataset_variant: null,
        scale_factor: '1',
        storage: 'nvme',
      });
      if (summary === null || summary.type !== 'queryBenchmark') {
        throw new Error(`expected queryBenchmark summary, got ${summary?.type}`);
      }
      const byName = new Map(summary.rankings.map((r) => [r.name, r.totalRuntime]));
      // Four distinct series: e1's second format (format successor), e2 (engine
      // successor), and e1:f1's q2 row (query_idx successor) all survive.
      expect([...byName.keys()].sort()).toEqual(['e1:f1', 'e1:f2', 'e2:f1', 'e9:f9']);
      expect(byName.get('e1:f2')).toBeCloseTo(444, 6);
      expect(byName.get('e2:f1')).toBeCloseTo(555, 6);
    });

    it('discovery skip scan matches the GROUP BY oracle across NULL partitions', async () => {
      // The replaced GROUP BY is the oracle: identical tuples, identical
      // NULLS FIRST presentation order, computed over the same seeded data.
      const oracle = await getPool().query<{
        dataset: string;
        dataset_variant: string | null;
        scale_factor: string | null;
        storage: string;
        query_idx: number;
      }>(
        `SELECT dataset, dataset_variant, scale_factor, storage, query_idx
         FROM query_measurements
        GROUP BY dataset, dataset_variant, scale_factor, storage, query_idx
        ORDER BY dataset, dataset_variant NULLS FIRST,
                 scale_factor NULLS FIRST, storage, query_idx`,
      );
      const expected = new Map<string, string[]>();
      for (const row of oracle.rows) {
        const groupSlug = groupKeyToSlug({
          k: 'QueryGroup',
          dataset: row.dataset,
          dataset_variant: row.dataset_variant,
          scale_factor: row.scale_factor,
          storage: row.storage,
        });
        const chartSlug = chartKeyToSlug({
          k: 'QueryMeasurement',
          dataset: row.dataset,
          dataset_variant: row.dataset_variant,
          scale_factor: row.scale_factor,
          storage: row.storage,
          query_idx: row.query_idx,
        });
        const charts = expected.get(groupSlug) ?? [];
        charts.push(chartSlug);
        expected.set(groupSlug, charts);
      }
      const groups = await collectGroups();
      const actual = new Map<string, string[]>(
        groups
          .filter((g) => groupKeyFromSlug(g.slug).k === 'QueryGroup')
          .map((g) => [g.slug, g.charts.map((c) => c.slug)]),
      );
      expect(actual).toEqual(expected);
    });
  },
);

// Slug-decode rejection short-circuits to a 400 before any DB call, so this
// runs without Docker, matching the chart route's input-validation contract.
describe('GET /api/group/[slug] input validation (no DB)', () => {
  it('returns 400 for a structurally malformed slug', async () => {
    const slug = 'not-a-slug';
    const res = await getGroup(new Request(`http://localhost/api/group/${slug}`), {
      params: Promise.resolve({ slug }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_request', message: 'invalid group slug' });
    expect(res.headers.get('cache-control')).toBeNull();
  });
});

// PR-5.0.5: restore v2's two flat group names (statpopgen / polarsignals) so
// their editorial descriptions attach. These are pure `groupNameQuery` +
// `groupDescription` assertions, so they run without Docker and discriminate the
// special-case directly: removing either branch reverts the name to the legacy
// `dataset sf=N [storage]` fallback, which fails both the name and the
// description-attach expectations below.
describe('groupNameQuery v2-name special-cases (PR-5.0.5, no DB)', () => {
  it('maps statpopgen to its v2 name and attaches the gnomAD description', () => {
    // Production statpopgen rows carry scale_factor=null (the ingest dim-mapping
    // emits None); the special-case ignores scaleFactor, so the flat name renders.
    const name = groupNameQuery('statpopgen', null, null, 'nvme');
    expect(name).toBe('Statistical and Population Genetics');
    expect(groupDescription(name)).toBe(
      'A suite of Statistical and Population genetics queries using the gnomAD dataset',
    );
  });

  it('maps polarsignals to its v2 name and attaches the profiling description', () => {
    // Same null scale_factor as statpopgen in production.
    const name = groupNameQuery('polarsignals', null, null, 'nvme');
    expect(name).toBe('PolarSignals Profiling');
    expect(groupDescription(name)).toBe(
      'Profiling data benchmark modeled on PolarSignals/Parca, exercising scan-layer ' +
        'performance with projection and filter pushdown on deeply nested schemas',
    );
  });

  it('keeps the existing tpch/tpcds/clickbench branches unchanged', () => {
    expect(groupNameQuery('tpch', null, '1', 'nvme')).toBe('TPC-H (NVMe) (SF=1)');
    expect(groupNameQuery('tpcds', null, '10', 's3')).toBe('TPC-DS (S3) (SF=10)');
    expect(groupNameQuery('clickbench', null, null, 'nvme')).toBe('Clickbench');
  });

  it('still falls through to the legacy label for an unknown dataset', () => {
    expect(groupNameQuery('fineweb', null, '1', 'nvme')).toBe('fineweb sf=1 [nvme]');
  });
});
