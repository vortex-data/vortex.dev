// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import {
  matchHas,
  prepareDestination,
} from 'next/dist/shared/lib/router/utils/prepare-destination';
import { describe, expect, it } from 'vitest';

import nextConfig, { benchPrefixCdnRules } from '../../../next.config.mjs';

interface Rewrite {
  source: string;
  destination: string;
  has?: Parameters<typeof matchHas>[2];
  missing?: Parameters<typeof matchHas>[3];
}

/**
 * The path a request reaches after next.config.mjs's beforeFiles rewrites,
 * matched with Next.js's own path and `has` matchers. Rules apply in order,
 * each to the path the ones before it produced, as Next.js does.
 */
async function rewritten(host: string, path: string): Promise<string> {
  const rewrites = (await nextConfig.rewrites()) as { beforeFiles: Rewrite[] };
  let pathname = path;
  for (const rule of rewrites.beforeFiles) {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true, strict: true })(pathname);
    if (!params) {
      continue;
    }
    const req = { headers: { host } } as unknown as Parameters<typeof matchHas>[0];
    const hasParams = matchHas(req, {}, rule.has, rule.missing);
    if (!hasParams) {
      continue;
    }
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: { ...params, ...hasParams },
      query: {},
    });
    pathname = parsedDestination.pathname ?? pathname;
  }
  return pathname;
}

describe('next.config.mjs rewrites', () => {
  it("serve bench from the root of bench.vortex.dev, apart from Next.js's assets and the cron", async () => {
    expect(await rewritten('bench.vortex.dev', '/')).toBe('/bench');
    expect(await rewritten('bench.vortex.dev', '/chart/qm.x')).toBe('/bench/chart/qm.x');
    expect(await rewritten('bench.vortex.dev', '/api/group/g')).toBe('/bench/api/group/g');
    expect(await rewritten('bench.vortex.dev', '/icon-dark.png')).toBe('/bench/icon-dark.png');
    expect(await rewritten('bench.vortex.dev', '/_next/static/chunks/a.js')).toBe(
      '/_next/static/chunks/a.js',
    );
    expect(await rewritten('bench.vortex.dev', '/bench/api/health')).toBe('/bench/api/health');
    expect(await rewritten('bench.vortex.dev:443', '/')).toBe('/bench');
  });

  it("keep bench off the site's own hosts, except the cron's health check", async () => {
    for (const host of ['vortex.dev', 'www.vortex.dev']) {
      expect(await rewritten(host, '/bench'), host).toBe('/not-found');
      expect(await rewritten(host, '/bench/chart/qm.x'), host).toBe('/not-found');
      expect(await rewritten(host, '/bench/api/groups'), host).toBe('/not-found');
      expect(await rewritten(host, '/bench/api/healthz'), host).toBe('/not-found');
      expect(await rewritten(host, '/bench/api/health'), host).toBe('/bench/api/health');
      expect(await rewritten(host, '/'), host).toBe('/');
    }
  });

  it('leave bench under /bench on every other host', async () => {
    for (const host of ['localhost:3000', 'vortex-abc-vortex-data.vercel.app']) {
      expect(await rewritten(host, '/bench'), host).toBe('/bench');
      expect(await rewritten(host, '/bench/chart/qm.x'), host).toBe('/bench/chart/qm.x');
    }
  });

  it("keep the site's plain Open Graph image URLs", async () => {
    expect(await rewritten('vortex.dev', '/opengraph-image')).toBe('/opengraph-image-12o0cb');
    expect(await rewritten('vortex.dev', '/blog/welcome/opengraph-image')).toBe(
      '/blog/welcome/opengraph-image-fx5gi7',
    );
  });
});

describe("the CDN rule for bench's /bench form", () => {
  it('is not sent in production, where bench.vortex.dev must never get a /bench page', () => {
    expect(benchPrefixCdnRules('production')).toEqual([]);
  });

  it("covers the landing and chart pages elsewhere, but not on the sites' own hosts", () => {
    for (const env of ['preview', 'development', undefined]) {
      const rules = benchPrefixCdnRules(env);
      expect(rules.map((rule: { source: string }) => rule.source)).toEqual([
        '/bench',
        '/bench/chart/:slug',
      ]);
      for (const rule of rules) {
        expect(rule.missing.map((c: { value: string }) => c.value)).toEqual([
          '^(www\\.)?vortex\\.dev$',
          '^bench\\.vortex\\.dev$',
        ]);
      }
    }
  });
});
