// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Shared testcontainers harness for the DB-backed vitest suites. This module
 * is imported only by `*.test.ts` files; it never reaches a production bundle.
 *
 * It centralizes the pieces the suites previously copy-pasted (and that had
 * already begun to drift in name): the Docker probe, the migration runner, the
 * container-boot + `BENCH_DB_*` env wiring, and the canonical three-commit
 * chart fixture mirroring `server/tests/common/mod.rs`.
 */

import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';

// Mirror the repo's Python `_docker_available()` precedent: the integration
// tests need a Docker daemon, so they are skipped (not failed) when one is
// absent.
export function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Start a disposable Postgres instance and apply the actual migration runner.
 * Callers own teardown: resetPool(), then container.stop(). Requires uv on PATH.
 */
export async function startBenchContainer(
  options: { applySchema?: boolean } = {},
): Promise<StartedPostgreSqlContainer> {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env.BENCH_DB_HOST = container.getHost();
  process.env.BENCH_DB_PORT = String(container.getPort());
  process.env.BENCH_DB_NAME = container.getDatabase();
  process.env.BENCH_DB_USER = container.getUsername();
  process.env.BENCH_DB_PASSWORD = container.getPassword();
  process.env.BENCH_DB_SSL = 'disable';
  if (options.applySchema !== false) {
    try {
      execFileSync(
        'uv',
        [
          'run',
          '--no-project',
          fileURLToPath(new URL('../../scripts/migrate-schema.py', import.meta.url)),
          'apply',
        ],
        {
          env: {
            ...process.env,
            PGHOST: container.getHost(),
            PGPORT: String(container.getPort()),
            PGDATABASE: container.getDatabase(),
            PGUSER: container.getUsername(),
            PGPASSWORD: container.getPassword(),
            PGSSLMODE: 'disable',
          },
          stdio: 'pipe',
        },
      );
    } catch (error) {
      await container.stop();
      throw error;
    }
  }
  return container;
}

// The canonical web UI fixture contains three oldest-first commits. Vortex and
// Parquet occur on each commit. Lance occurs only on the oldest commit to test
// its sparse cadence. Each commit adds a bias to keep other series non-flat.
export const COMMITS: ReadonlyArray<readonly [string, string, string]> = [
  ['1'.repeat(40), '2026-04-23T12:00:00Z', 'first commit'],
  ['2'.repeat(40), '2026-04-24T12:00:00Z', 'second commit'],
  ['3'.repeat(40), '2026-04-25T12:00:00Z', 'third commit'],
];

/** The fixture's shared (arbitrary) tree SHA. */
export const TREE_SHA = 'fedcba9876543210fedcba9876543210fedcba98';

/** Render the fixture commit URL for `sha`, matching the ingest writer. */
export function commitUrl(sha: string): string {
  return `https://github.com/vortex-data/vortex/commit/${sha}`;
}

/** Seed the canonical three-commit fixture (see [`COMMITS`]) into `pool`. */
export async function seedChartFixture(pool: Pool): Promise<void> {
  let id = 0;
  const mid = (): number => {
    id += 1;
    return id;
  };
  for (const [sha, ts, msg] of COMMITS) {
    await pool.query(
      `INSERT INTO commits (commit_sha, timestamp, message, tree_sha, url)
       VALUES ($1, $2::timestamptz, $3, $4, $5)`,
      [sha, ts, msg, TREE_SHA, commitUrl(sha)],
    );
  }
  for (let i = 0; i < COMMITS.length; i += 1) {
    const sha = COMMITS[i][0];
    const bias = i * 50_000;
    // query_measurements: Q1 has two engine/format series, Q2 has one.
    const qm: ReadonlyArray<readonly [number, string, string, number]> = [
      [1, 'datafusion', 'vortex-file-compressed', 1_000_000 + bias],
      [1, 'duckdb', 'parquet', 800_000 + bias],
      [2, 'datafusion', 'vortex-file-compressed', 600_000 + bias],
    ];
    for (const [queryIdx, engine, format, valueNs] of qm) {
      await pool.query(
        `INSERT INTO query_measurements
           (measurement_id, commit_sha, dataset, dataset_variant, scale_factor,
            query_idx, storage, engine, format, value_ns, all_runtimes_ns,
            commit_timestamp)
         VALUES ($1, $2, 'tpch', NULL, '1', $3, 'nvme', $4, $5, $6, '{1}'::bigint[],
                 (SELECT timestamp FROM commits WHERE commit_sha = $2))`,
        [mid(), sha, queryIdx, engine, format, valueNs],
      );
    }
    const compTimes: Array<readonly [string, string, number]> = [
      ['vortex-file-compressed', 'encode', 9_000 + bias],
      ['vortex-file-compressed', 'decode', 5_000 + bias],
      ['parquet', 'encode', 18_000 + 2 * bias],
      ['parquet', 'decode', 10_000 + 2 * bias],
    ];
    if (i === 0) {
      compTimes.push(['lance', 'encode', 36_000], ['lance', 'decode', 20_000]);
    }
    for (const [format, op, valueNs] of compTimes) {
      await pool.query(
        `INSERT INTO compression_times
           (measurement_id, commit_sha, dataset, dataset_variant, format, op,
            value_ns, all_runtimes_ns)
         VALUES ($1, $2, 'tpch-lineitem', NULL, $3, $4, $5, '{1}'::bigint[])`,
        [mid(), sha, format, op, valueNs],
      );
    }
    const compSizes: Array<readonly [string, number]> = [
      ['vortex-file-compressed', 4_000 + bias],
      ['parquet', 8_000 + 2 * bias],
    ];
    if (i === 0) {
      // Arrow IPC is not present in every run. The summary must use its latest
      // per-dataset value without tying it to the current Vortex snapshot.
      compSizes.push(['arrow-ipc', 32_000]);
      compSizes.push(['lance', 16_000]);
    }
    const uncompressedBytes = 32_000 + 8 * bias;
    for (const [format, valueBytes] of compSizes) {
      await pool.query(
        `INSERT INTO compression_sizes
           (measurement_id, commit_sha, dataset, dataset_variant, format,
            value_bytes, uncompressed_bytes)
         VALUES ($1, $2, 'tpch-lineitem', NULL, $3, $4, $5)`,
        [mid(), sha, format, valueBytes, uncompressedBytes],
      );
    }
    const randomAccess: ReadonlyArray<readonly [string, number]> = [
      ['vortex-file-compressed', 500 + bias],
      ['parquet', 1_000 + 2 * bias],
      ['arrow-ipc', 1_500 + 3 * bias],
    ];
    for (const [format, valueNs] of randomAccess) {
      for (const [openMode, modeValueNs] of [
        ['cached', valueNs],
        ['reopen', valueNs * 10],
      ] as const) {
        await pool.query(
          `INSERT INTO random_access_times
             (measurement_id, commit_sha, dataset, format, open_mode, value_ns, all_runtimes_ns)
           VALUES ($1, $2, 'taxi', $3, $4, $5, '{1}'::bigint[])`,
          [mid(), sha, format, openMode, modeValueNs],
        );
      }
    }
    await pool.query(
      `INSERT INTO vector_search_runs
         (measurement_id, commit_sha, dataset, layout, flavor, threshold, value_ns,
          all_runtimes_ns, matches, rows_scanned, bytes_scanned, iterations)
       VALUES ($1, $2, 'cohere-large-10m', 'partitioned', 'vortex-turboquant', 0.75, $3,
               '{1}'::bigint[], 42, 1000000, 5000000, 1)`,
      [mid(), sha, 7_000 + bias],
    );
  }
}
