// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getPool, resetPool } from './db';
import {
  chartPayload,
  collectGroupCharts,
  collectGroups,
  groupChartPayloads,
  historyFor,
  seriesFor,
  type Group,
} from './queries';
import { chartKeyFromSlug, groupKeyFromSlug, type ChartKey, type GroupKey } from './slug';
import {
  type BenchDatabase,
  commitUrl,
  integrationDatabaseAvailable,
  seedChartFixture,
  startBenchDatabase,
  TREE_SHA,
} from './test-harness';
import { type CommitWindow, parseCommitWindow } from './window';

describe('historyFor', () => {
  it('bounds a long history to the window', () => {
    expect(historyFor(125, { kind: 'last', n: 100 })).toEqual({
      total_commits: 125,
      start_index: 25,
      loaded_commits: 100,
      complete: false,
    });
  });

  it('keeps a short history whole', () => {
    expect(historyFor(3, { kind: 'last', n: 100 })).toEqual({
      total_commits: 3,
      start_index: 0,
      loaded_commits: 3,
      complete: true,
    });
  });

  it('loads everything for ?n=all', () => {
    expect(historyFor(125, { kind: 'all' })).toEqual({
      total_commits: 125,
      start_index: 0,
      loaded_commits: 125,
      complete: true,
    });
  });

  it('reports an empty history as complete', () => {
    expect(historyFor(0, { kind: 'last', n: 100 })).toEqual({
      total_commits: 0,
      start_index: 0,
      loaded_commits: 0,
      complete: true,
    });
  });
});

describe('seriesFor', () => {
  it.each([
    [
      'QueryMeasurement',
      { engine: 'duckdb', format: 'parquet' },
      { key: 'duckdb:parquet', engine: 'duckdb', format: 'parquet' },
    ],
    [
      'CompressionTime',
      { format: 'parquet', op: 'encode' },
      { key: 'parquet:encode', engine: undefined, format: 'parquet' },
    ],
    ['CompressionSize', { format: 'lance' }, { key: 'lance', engine: undefined, format: 'lance' }],
    [
      'RandomAccess',
      { format: 'parquet', open_mode: 'reopen' },
      { key: 'parquet:cold', engine: undefined, format: 'parquet' },
    ],
    [
      'VectorSearch',
      { flavor: 'vortex-turboquant' },
      { key: 'vortex-turboquant', engine: undefined, format: undefined },
    ],
  ] as const)('names the %s series', (kind, cols, expected) => {
    expect(seriesFor(kind, { commit_sha: 'a', value: 1, ...cols })).toEqual(expected);
  });
});

const databaseAvailable = integrationDatabaseAvailable();

/** The oracle: each link's `chartPayload`, named and flattened as the group route does. */
async function expectedCharts(group: Group, window: CommitWindow): Promise<string> {
  const charts: unknown[] = [];
  for (const link of group.charts) {
    const payload = await chartPayload(chartKeyFromSlug(link.slug), window);
    if (payload !== null) {
      charts.push({ name: link.name, slug: link.slug, ...payload });
    }
  }
  return JSON.stringify(charts);
}

describe.skipIf(!databaseAvailable)('groupChartPayloads on the canonical fixture', () => {
  let database: BenchDatabase;

  const Q1: ChartKey = {
    k: 'QueryMeasurement',
    dataset: 'tpch',
    dataset_variant: null,
    scale_factor: '1',
    storage: 'nvme',
    query_idx: 1,
  };
  const TPCH: GroupKey = {
    k: 'QueryGroup',
    dataset: 'tpch',
    dataset_variant: null,
    scale_factor: '1',
    storage: 'nvme',
  };

  beforeAll(async () => {
    database = await startBenchDatabase();
    await seedChartFixture(getPool());
  });

  afterAll(async () => {
    await resetPool();
    await database.stop();
  });

  it.each(['1', '2', '100', 'all'])(
    'every group matches chartPayload byte for byte at ?n=%s',
    async (n) => {
      const window = parseCommitWindow(n);
      const groups = await collectGroups();
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        const bundle = await collectGroupCharts(groupKeyFromSlug(group.slug), window);
        expect(JSON.stringify(bundle?.charts ?? [])).toBe(await expectedCharts(group, window));
      }
    },
  );

  it('issues two statements for a group of up to 25 charts', async () => {
    const group = (await collectGroups()).find((g) => g.name === 'TPC-H (NVMe) (SF=1)');
    const keys = (group?.charts ?? []).map((link) => chartKeyFromSlug(link.slug));
    expect(keys.length).toBeGreaterThan(1);
    const spy = vi.spyOn(getPool(), 'query');
    const payloads = await groupChartPayloads(TPCH, keys, parseCommitWindow(null));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(payloads.every((payload) => payload !== null)).toBe(true);
  });

  it('adds one rows statement per 25 more charts and keeps chart order', async () => {
    const window = parseCommitWindow(null);
    // 25 charts with no rows fill the first slice, so Q1 and Q2 land in the second.
    const empty = Array.from({ length: 25 }, (_, i) => ({ ...Q1, query_idx: 100 + i }));
    const keys: ChartKey[] = [...empty, { ...Q1, query_idx: 2 }, Q1];
    const expected = await Promise.all(keys.map((key) => chartPayload(key, window)));
    const spy = vi.spyOn(getPool(), 'query');
    const payloads = await groupChartPayloads(TPCH, keys, window);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(payloads.slice(25).every((payload) => payload !== null)).toBe(true);
    expect(JSON.stringify(payloads)).toBe(JSON.stringify(expected));
  });

  it('returns null in place of a chart with no rows', async () => {
    const window = parseCommitWindow(null);
    const payloads = await groupChartPayloads(TPCH, [Q1, { ...Q1, query_idx: 99 }], window);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toBeNull();
    expect(JSON.stringify(payloads[0])).toBe(JSON.stringify(await chartPayload(Q1, window)));
  });
});

// Commits oldest first. D and E share a timestamp, so (timestamp, sha) order puts D first.
const C0 = '0'.repeat(40);
const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const D = 'd'.repeat(40);
const E = 'e'.repeat(40);
const F = 'f'.repeat(40);
const EDGE_COMMITS: ReadonlyArray<readonly [string, string]> = [
  [C0, '2026-06-01T00:00:00Z'],
  [C1, '2026-06-02T00:00:00Z'],
  [C2, '2026-06-03T00:00:00Z'],
  [D, '2026-06-04T00:00:00Z'],
  [E, '2026-06-04T00:00:00Z'],
  [F, '2026-06-05T00:00:00Z'],
];
const ALL_SHAS = EDGE_COMMITS.map(([sha]) => sha);

function queryGroup(scaleFactor: string | null, storage: string): GroupKey {
  return {
    k: 'QueryGroup',
    dataset: 'grp',
    dataset_variant: null,
    scale_factor: scaleFactor,
    storage,
  };
}

function queryChart(group: GroupKey, queryIdx: number): ChartKey {
  if (group.k !== 'QueryGroup') {
    throw new Error('expected a query group');
  }
  const { dataset, dataset_variant, scale_factor, storage } = group;
  return {
    k: 'QueryMeasurement',
    dataset,
    dataset_variant,
    scale_factor,
    storage,
    query_idx: queryIdx,
  };
}

const G = queryGroup(null, 'nvme');
const S = queryGroup('1', 'nvme');
const T = queryGroup(null, 's3');
const G_CHARTS = [1, 2, 3].map((idx) => queryChart(G, idx));

describe.skipIf(!databaseAvailable)('groupChartPayloads at the window edges', () => {
  let database: BenchDatabase;
  let measurementId = 0;

  async function insertQuery(
    group: GroupKey,
    sha: string,
    queryIdx: number,
    engine: string,
    valueNs: number,
    stamped = true,
  ): Promise<void> {
    if (group.k !== 'QueryGroup') {
      throw new Error('expected a query group');
    }
    measurementId += 1;
    // `commit_timestamp` is stamped from `commits`, as the writers do, unless `stamped` is false.
    await getPool().query(
      `INSERT INTO query_measurements
           (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
            query_idx, storage, engine, format, value_ns, all_runtimes_ns,
            commit_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'f1', $9, '{1}'::bigint[],
                 (SELECT timestamp FROM commits WHERE commit_sha = $2 AND $10))`,
      [
        measurementId,
        sha,
        group.dataset,
        group.dataset_variant,
        group.scale_factor,
        queryIdx,
        group.storage,
        engine,
        valueNs,
        stamped,
      ],
    );
  }

  beforeAll(async () => {
    database = await startBenchDatabase();
    for (const [sha, ts] of EDGE_COMMITS) {
      await getPool().query(
        `INSERT INTO commits (commit_sha, timestamp, message, tree_sha, url)
           VALUES ($1, $2::timestamptz, $3, $4, $5)`,
        [sha, ts, `commit ${sha.slice(0, 1)}`, TREE_SHA, commitUrl(sha)],
      );
    }
    for (const [i, sha] of ALL_SHAS.entries()) {
      await insertQuery(G, sha, 1, 'e1', 10 * (i + 1));
      await insertQuery(G, sha, 1, 'e2', 1_000 + i);
      await insertQuery(S, sha, 1, 'e1', 100 + i);
      await insertQuery(T, sha, 1, 'e1', 200 + i);
    }
    await insertQuery(G, E, 2, 'e1', 7);
    await insertQuery(G, F, 2, 'e1', 8);
    await insertQuery(G, C0, 3, 'e1', 9);
    // An unstamped row on an older commit of a stamped series: the chart's first row ignores it,
    // as `MIN` does.
    await insertQuery(G, C1, 2, 'e1', 5, false);
    for (const [sha, dataset, variant, valueNs] of [
      [C1, 'cx', null, 11],
      [F, 'cx', null, 12],
      [D, 'cx', 'v1', 21],
      [E, 'cx', 'v1', 22],
      [C0, 'cy', 'v1', 31],
    ] as const) {
      measurementId += 1;
      await getPool().query(
        `INSERT INTO compression_times
             (measurement_id, commit_sha, dataset, dataset_variant, format, op,
              value_ns, all_runtimes_ns)
           VALUES ($1, $2, $3, $4, 'f1', 'encode', $5, '{1}'::bigint[])`,
        [measurementId, sha, dataset, variant, valueNs],
      );
    }
  });

  afterAll(async () => {
    await resetPool();
    await database.stop();
  });

  it.each(['1', '2', '3', '4', 'all'])(
    'group payloads match chartPayload byte for byte at ?n=%s',
    async (n) => {
      const window = parseCommitWindow(n);
      for (const [group, keys] of [
        [G, G_CHARTS],
        [S, [queryChart(S, 1)]],
        [T, [queryChart(T, 1)]],
      ] as const) {
        const expected = await Promise.all(keys.map((key) => chartPayload(key, window)));
        expect(JSON.stringify(await groupChartPayloads(group, keys, window))).toBe(
          JSON.stringify(expected),
        );
      }
    },
  );

  it('gives each chart its own window', async () => {
    const [q1, q2, q3] = await groupChartPayloads(G, G_CHARTS, parseCommitWindow('4'));
    expect(q1?.history).toEqual({
      total_commits: 6,
      start_index: 2,
      loaded_commits: 4,
      complete: false,
    });
    expect(q2?.history).toEqual({
      total_commits: 3,
      start_index: 0,
      loaded_commits: 3,
      complete: true,
    });
    // D shares E's timestamp, so it is on Q2's axis although Q2 has no row there.
    expect(q2?.commits.map((c) => c.sha)).toEqual([D, E, F]);
    expect(q2?.series).toEqual({ 'e1:f1': [null, 7, 8] });
    expect(q3?.series).toEqual({});
    expect(q3?.history).toEqual({
      total_commits: 6,
      start_index: 2,
      loaded_commits: 4,
      complete: false,
    });
  });

  it.each(['1', '4', 'all'])(
    'matches chartPayload when compression variants mix NULL and non-NULL at ?n=%s',
    async (n) => {
      const window = parseCommitWindow(n);
      const keys: ChartKey[] = [
        { k: 'CompressionTime', dataset: 'cx', dataset_variant: 'v1' },
        { k: 'CompressionTime', dataset: 'cx', dataset_variant: null },
        { k: 'CompressionTime', dataset: 'cy', dataset_variant: null },
        { k: 'CompressionTime', dataset: 'cy', dataset_variant: 'v1' },
      ];
      const expected = await Promise.all(keys.map((key) => chartPayload(key, window)));
      expect(expected[2]).toBeNull();
      const spy = vi.spyOn(getPool(), 'query');
      const payloads = await groupChartPayloads({ k: 'CompressionTimeGroup' }, keys, window);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(payloads)).toBe(JSON.stringify(expected));
    },
  );

  it('keeps sibling groups apart', async () => {
    const window = parseCommitWindow('all');
    const [g] = await groupChartPayloads(G, [queryChart(G, 1)], window);
    const [s] = await groupChartPayloads(S, [queryChart(S, 1)], window);
    expect(g?.series['e1:f1']).toEqual([10, 20, 30, 40, 50, 60]);
    expect(s?.series['e1:f1']).toEqual([100, 101, 102, 103, 104, 105]);
  });

  it('refuses a chart from another group', async () => {
    await expect(
      groupChartPayloads(G, [queryChart(S, 1)], parseCommitWindow(null)),
    ).rejects.toThrow('is not in group');
  });
});
