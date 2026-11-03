// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { NextResponse } from 'next/server';

import { collectHealth } from '@/lib/health';

// A liveness probe must reflect the live database, never a cached snapshot.
export const dynamic = 'force-dynamic';

/** Return an uncached database liveness check with deployment identity. */
export async function GET() {
  const health = await collectHealth();
  return NextResponse.json(health, {
    status: health.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
