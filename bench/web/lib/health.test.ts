// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { collectHealth } from './health';
import { resetPool } from './db';
import {
  type BenchDatabase,
  integrationDatabaseAvailable,
  startBenchDatabase,
} from './test-harness';

const databaseAvailable = integrationDatabaseAvailable();

describe.skipIf(!databaseAvailable)('collectHealth (testcontainers Postgres)', () => {
  let container: BenchDatabase;

  beforeAll(async () => {
    container = await startBenchDatabase({ applySchema: false });
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await resetPool();
    await container.stop();
  });

  it('checks connectivity without requiring benchmark tables', async () => {
    expect(await collectHealth()).toEqual({
      status: 'ok',
      schema_version: 3,
      build_sha: 'unknown',
    });
  });
});
