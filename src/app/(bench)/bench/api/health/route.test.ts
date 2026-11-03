// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from '@/lib/db';
import { GET } from './route';

vi.mock('@/lib/db', () => ({ sql: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(sql).mockReset();
});

describe('GET /api/health', () => {
  it('returns deployment identity after exactly one connectivity query', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    vi.mocked(sql).mockResolvedValue([]);

    const response = await GET();

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
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', undefined);
    vi.mocked(sql).mockRejectedValue(new Error('private database detail'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'error',
      schema_version: 3,
      build_sha: 'unknown',
    });
  });
});
