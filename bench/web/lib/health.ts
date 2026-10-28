// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { sql } from './db';
import { SCHEMA_VERSION } from './schema-version';

/** Database liveness and deployment identity returned by `GET /api/health`. */
export interface HealthResponse {
  status: 'ok' | 'error';
  schema_version: number;
  build_sha: string;
}

/** Check database connectivity without scanning benchmark tables. */
export async function collectHealth(): Promise<HealthResponse> {
  let status: HealthResponse['status'] = 'ok';
  try {
    await sql`SELECT 1`;
  } catch (error) {
    console.error('bench: database health check failed', error);
    status = 'error';
  }
  return {
    status,
    schema_version: SCHEMA_VERSION,
    build_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  };
}
