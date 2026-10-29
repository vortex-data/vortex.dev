// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { timingSafeEqual } from 'node:crypto';

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';

import { BENCH_DATA_TAG } from '@/lib/data-cache';

/**
 * `POST /api/revalidate` marks the [`BENCH_DATA_TAG`] Data Cache entries stale, so
 * they refresh against freshly ingested data (see below). `scripts/post-ingest.py`
 * calls this after a successful Postgres write. Auth is a bearer token compared
 * in constant time against `BENCH_REVALIDATE_TOKEN`; a missing env var fails
 * closed with `503` so an unconfigured deployment never silently accepts
 * unauthenticated revalidation. The response is never CDN-cached.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expected = process.env.BENCH_REVALIDATE_TOKEN;
  if (expected === undefined || expected === '') {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  const header = request.headers.get('authorization');
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (provided === null || !constantTimeEquals(provided, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // The `'max'` profile marks the entries stale rather than dropping them: after
  // an ingest, the next read serves the previous data once while the entry
  // refreshes in the background, and the read after that gets the new data. So
  // no read waits on the group-fill lock because of an ingest. Dropping the
  // entries (`{ expire: 0 }`) made every read after an ingest wait on it, and
  // with ingests about once a minute during benchmark runs, reads ran out of
  // retries and failed. The cost: new results can take about one more CDN cycle
  // (five minutes) to show, since the CDN's refresh may be the read that gets
  // the previous data.
  revalidateTag(BENCH_DATA_TAG, 'max');
  return NextResponse.json({ revalidated: true }, { status: 200 });
}

/**
 * Constant-time string compare. `timingSafeEqual` throws on length mismatch, so
 * the length is checked first; returning early on a length difference leaks only
 * the token length, not its contents.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ab, bb);
}
