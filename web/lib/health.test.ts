// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { collectHealth } from './health';
import { resetPool } from './db';
import { dockerAvailable, startBenchContainer } from './test-harness';

describe.skipIf(!dockerAvailable())('collectHealth (testcontainers Postgres)', () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await startBenchContainer({ applySchema: false });
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
