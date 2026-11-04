// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/bench/lib/db';
import { GET } from './route';

vi.mock('@/bench/lib/db', () => ({ sql: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(sql).mockReset();
});

function request(authorization?: string): Request {
  return new Request('https://bench.vortex.dev/api/health', {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe('GET /api/health', () => {
  it('returns deployment identity after exactly one connectivity query', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    vi.mocked(sql).mockResolvedValue([]);

    const response = await GET(request());

    expect(sql).toHaveBeenCalledExactlyOnceWith(['SELECT 1']);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'ok',
      schema_version: 3,
      build_sha: 'abc123',
    });
  });

  it('returns an uncached 503 without exposing the database error', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
    vi.mocked(sql).mockRejectedValue(new Error('private database detail'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'error',
      schema_version: 3,
      build_sha: 'unknown',
    });
  });

  it('runs the check for the cron secret once CRON_SECRET is set', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    vi.mocked(sql).mockResolvedValue([]);

    const response = await GET(request('Bearer cron-secret'));

    expect(sql).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      schema_version: 3,
      build_sha: 'abc123',
    });
  });

  it.each([
    ['no header', undefined],
    ['a wrong secret', 'Bearer other-secret'],
    ['the secret without the scheme', 'cron-secret'],
  ])('returns the identity alone, with no query, for %s', async (_label, authorization) => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');

    const response = await GET(request(authorization));

    expect(sql).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ schema_version: 3, build_sha: 'abc123' });
  });
});
