// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { collectHealth, deploymentIdentity } from '@/bench/lib/health';

// A liveness probe must reflect the live database, never a cached snapshot.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Whether this request may run the database check. When the project sets
 * `CRON_SECRET`, Vercel's cron sends `Authorization: Bearer <CRON_SECRET>`, and
 * the keep-warm workflow sends the same header; any other caller gets the
 * deployment identity alone, so it cannot make the route query the database.
 * Without `CRON_SECRET`, every caller runs the check.
 */
function mayCheckDatabase(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  // Hash both sides so the comparison takes the same time for any length.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(
    digest(request.headers.get('authorization') ?? ''),
    digest(`Bearer ${secret}`),
  );
}

/**
 * Return the deployment identity, with an uncached database liveness check for
 * a caller allowed to run it (200 when the database answers, 503 when not).
 */
export async function GET(request: Request) {
  if (!mayCheckDatabase(request)) {
    return NextResponse.json(deploymentIdentity(), { headers: NO_STORE });
  }
  const health = await collectHealth();
  return NextResponse.json(health, {
    status: health.status === 'ok' ? 200 : 503,
    headers: NO_STORE,
  });
}
