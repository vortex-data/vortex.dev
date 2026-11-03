// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface HeaderRule {
  source: string;
  has?: Array<{ type: string; value: string }>;
  headers: Array<{ key: string; value: string }>;
}

// Read vercel.json from disk (not an import) so the assertion pins the actual
// shipped config the way Vercel reads it.
const vercelConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../vercel.json', import.meta.url)), 'utf8'),
) as { crons?: Array<{ path: string; schedule: string }>; headers?: HeaderRule[] };

const CDN_CACHE = 'max-age=300, stale-while-revalidate=86400';

/**
 * The host a `has` condition matches. Vercel reads the value as a regular
 * expression, so it must be anchored and escaped, as `next.config.mjs` writes
 * it: a bare `bench.vortex.dev` would also match `benchxvortex.dev`.
 */
function hostName(pattern: string): string {
  const match = /^\^(.*)\$$/.exec(pattern);
  if (!match) {
    throw new Error(`host condition ${pattern} is not anchored`);
  }
  // Labels joined by escaped dots, and nothing else: an unescaped dot or any
  // other regular-expression character fails.
  if (!/^[a-z0-9-]+(?:\\\.[a-z0-9-]+)+$/.test(match[1]!)) {
    throw new Error(`host condition ${pattern} is not an escaped host name`);
  }
  return match[1]!.replaceAll('\\.', '.');
}

/** The paths (with any host condition) that get bench's page CDN rule. */
function cdnCachedSources(): string[] {
  return (vercelConfig.headers ?? [])
    .filter((rule) =>
      rule.headers.some((h) => h.key === 'Vercel-CDN-Cache-Control' && h.value === CDN_CACHE),
    )
    .map((rule) => {
      const host = rule.has?.find((c) => c.type === 'host')?.value;
      return host ? `${hostName(host)}${rule.source}` : rule.source;
    })
    .sort();
}

describe('vercel.json keep-warm cron', () => {
  it('pings /bench/api/health every 2 minutes to keep the function + DB pool warm', () => {
    expect(vercelConfig.crons).toContainEqual({
      path: '/bench/api/health',
      schedule: '*/2 * * * *',
    });
  });
});

describe("vercel.json CDN rule for bench's pages", () => {
  it('covers the landing, methodology and chart pages on bench.vortex.dev, and nothing else', () => {
    // Header rules match the path as requested, before the rewrites in
    // next.config.mjs. The marketing site's `/` (any other host) must not get
    // the rule, and neither may the /bench form in production, whose HTML
    // differs (next.config.mjs adds that form's rule outside production).
    expect(cdnCachedSources()).toEqual([
      'bench.vortex.dev/',
      'bench.vortex.dev/chart/:slug',
      'bench.vortex.dev/methodology',
    ]);
  });
});
