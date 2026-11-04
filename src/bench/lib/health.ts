// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { sql } from './db';
import { SCHEMA_VERSION } from './schema-version';

/** The deployment's identity, which `GET /api/health` returns to every caller. */
export interface DeploymentIdentity {
  schema_version: number;
  build_sha: string;
}

/** Database liveness and deployment identity, for a caller allowed to run the check. */
export interface HealthResponse extends DeploymentIdentity {
  status: 'ok' | 'error';
}

/** Return the schema version and commit this deployment serves, without a query. */
export function deploymentIdentity(): DeploymentIdentity {
  return {
    schema_version: SCHEMA_VERSION,
    build_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
  };
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
  return { status, ...deploymentIdentity() };
}
