// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

/**
 * The URL of a root-relative bench path under `base`. A base with a path (a deployment's own URL
 * with `/bench`) serves bench under that prefix, where the landing page is the prefix itself: with
 * a trailing slash it redirects.
 */
export function benchUrl(base, path) {
  const prefix = base.pathname.replace(/\/+$/, '');
  if (prefix === '') return new URL(path, base);
  return new URL(`${prefix}${path === '/' ? '' : path}`, base);
}

/**
 * Verify the public read paths within a three-minute deadline. `base` is where bench is served:
 * `https://bench.vortex.dev`, or a deployment's own URL with `/bench`. `headers` go with every
 * request to `base`, such as Vercel's protection bypass for a protected deployment URL.
 *
 * `cdnBase` is where the CDN check runs: a repeated landing page and chart API request must report
 * a cache HIT there. Left out, it is `base`. A different `cdnBase` (bench.vortex.dev, for a check
 * on a deployment's own URL) gets the check only while its `/api/health` reports this build; until
 * then the check is skipped and the result is `cdn-skipped`. An empty `cdnBase` skips it too.
 * bench's HTML differs between its two URL forms, so production caches only the
 * bench.vortex.dev form, and that is the one to check.
 */
export async function verifyDeployment(
  base,
  sha,
  environment,
  fetchImpl = fetch,
  sleep = setTimeout,
  headers = {},
  cdnBase = base,
) {
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.ok(['preview', 'production'].includes(environment));
  const origin = new URL(base);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  const deadline = Date.now() + 180_000;
  const target = { origin, headers };

  async function request(path, validate, at = target) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remaining = deadline - Date.now();
      assert.ok(remaining > 0, 'Deployment verification deadline exceeded');
      try {
        const response = await fetchImpl(benchUrl(at.origin, path), {
          headers: at.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        });
        const location = response.headers.get('location');
        const redirect =
          location && [301, 302, 303, 307, 308].includes(response.status)
            ? new URL(location, at.origin)
            : null;
        const vercelSso =
          redirect?.origin === 'https://vercel.com' && redirect.pathname === '/sso-api';
        if ([401, 403].includes(response.status) || vercelSso) {
          if (environment === 'preview') return 'protected';
          throw new Error(`Public production route ${path} returned ${response.status}`);
        }
        assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
        return await validate(response);
      } catch (error) {
        lastError = error;
        if (attempt < 3) await sleep(Math.min(2_000, Math.max(0, deadline - Date.now())));
      }
    }
    throw lastError;
  }

  async function json(path, validate) {
    return request(path, async (response) => {
      assert.match(response.headers.get('content-type') ?? '', /application\/json/);
      const body = await response.json();
      validate(body);
      return body;
    });
  }

  function chart(body) {
    assert.ok(Array.isArray(body.commits), 'Chart commits must be an array');
    assert.ok(
      body.series && typeof body.series === 'object' && !Array.isArray(body.series),
      'Chart series must be an object',
    );
    for (const values of Object.values(body.series)) {
      assert.ok(
        Array.isArray(values) &&
          values.length === body.commits.length &&
          values.every(
            (value) => value === null || (typeof value === 'number' && Number.isFinite(value)),
          ),
        'Chart series must align with its commit window',
      );
    }
  }

  const health = await json('/api/health', (body) => {
    assert.equal(body.status, 'ok');
    assert.equal(body.build_sha, sha, 'Health reports a different build');
    assert.ok(Number.isInteger(body.schema_version));
  });
  if (health === 'protected') return 'protected';
  const groups = await json('/api/groups', (body) => {
    assert.ok(
      Array.isArray(body.groups) && body.groups.some((group) => group.charts?.length),
      'No populated groups',
    );
  });
  if (groups === 'protected') return 'protected';
  const group = groups.groups.find((item) => item.charts?.length);
  const groupPath = `/api/group/${encodeURIComponent(group.slug)}?n=1`;
  const groupBody = await json(groupPath, (body) => {
    assert.ok(Array.isArray(body.charts) && body.charts.length > 0);
    chart(body.charts[0]);
  });
  if (groupBody === 'protected') return 'protected';
  const chartSlug = encodeURIComponent(group.charts[0].slug);
  const chartBody = await json(`/api/chart/${chartSlug}`, chart);
  if (chartBody === 'protected') return 'protected';
  for (const path of ['/', `/chart/${chartSlug}`]) {
    const result = await request(path, async (response) => {
      assert.match(response.headers.get('content-type') ?? '', /text\/html/);
      const html = await response.text();
      assert.ok(
        html.includes(
          path === '/' ? 'data-role="global-filter-bar"' : `data-chart-slug="${chartSlug}"`,
        ),
        `${path}: rendered page content is missing`,
      );
    });
    if (result === 'protected') return 'protected';
  }
  if (!cdnBase) return 'cdn-skipped';
  const cdn = { origin: new URL(cdnBase), headers: {} };
  const sameHost = cdn.origin.href === origin.href;
  if (sameHost) {
    cdn.headers = headers;
  } else {
    assert.equal(cdn.origin.protocol, 'https:');
    assert.equal(cdn.origin.pathname, '/', 'cdnBase serves bench from its root');
    if (!(await servesBuild(cdn.origin))) return 'cdn-skipped';
  }
  // Request the same URLs again, without a cache-busting query, to verify CDN reuse. On a
  // different host, the first request warms the cache.
  for (const path of ['/', `/api/chart/${chartSlug}`]) {
    if (!sameHost) {
      await request(path, (response) => response.arrayBuffer(), cdn);
    }
    const result = await request(
      path,
      async (response) => {
        await response.arrayBuffer();
        assert.equal(
          response.headers.get('x-vercel-cache'),
          'HIT',
          `${new URL(path, cdn.origin).href}: CDN did not report HIT`,
        );
      },
      cdn,
    );
    if (result === 'protected') return 'protected';
  }
  return 'verified';

  /**
   * Whether `at` serves this build: its health reports this commit. Vercel moves a domain to a
   * new production deployment once that deployment is ready, so allow it a minute; a domain still
   * served by another project or deployment never matches.
   */
  async function servesBuild(at) {
    for (let attempt = 0; attempt < 7; attempt++) {
      try {
        const response = await fetchImpl(benchUrl(at, '/api/health'), {
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, deadline - Date.now()))),
        });
        if (response.ok && (await response.json()).build_sha === sha) return true;
      } catch {
        // An unreachable or unfamiliar host is not this build.
      }
      if (attempt < 6) await sleep(Math.min(10_000, Math.max(0, deadline - Date.now() - 30_000)));
    }
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Vercel's Protection Bypass for Automation, when the deployment URL is protected.
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    // An optional fourth argument is where the CDN check runs (see verifyDeployment); an empty
    // one skips it.
    const [base, sha, environment, cdnBase = base] = process.argv.slice(2);
    const result = await verifyDeployment(
      base,
      sha,
      environment,
      fetch,
      setTimeout,
      bypass ? { 'x-vercel-protection-bypass': bypass } : {},
      cdnBase,
    );
    const message = {
      protected:
        'Deployment created; preview protection blocked verification. Health, build identity, and CDN caching remain unverified.',
      'cdn-skipped': `Verified build SHA, health, representative group/chart JSON and HTML pages. CDN caching unverified: ${cdnBase || 'no CDN URL was given'} does not serve this build yet.`,
      verified:
        'Verified build SHA, health, representative group/chart JSON, HTML pages, and CDN HIT.',
    }[result];
    console.log(`${result === 'verified' ? '' : '::notice::'}${message}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
