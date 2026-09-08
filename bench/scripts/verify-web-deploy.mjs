// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';

/** Verify the public read paths within a three-minute deadline. */
export async function verifyDeployment(base, sha, environment, fetchImpl = fetch, sleep = setTimeout) {
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.ok(['preview', 'production'].includes(environment));
  const origin = new URL(base);
  assert.equal(origin.protocol, 'https:');
  assert.equal(origin.username + origin.password + origin.search + origin.hash, '');
  const deadline = Date.now() + 180_000;

  async function request(path, validate) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt++) {
      const remaining = deadline - Date.now();
      assert.ok(remaining > 0, 'Deployment verification deadline exceeded');
      try {
        const response = await fetchImpl(new URL(path, origin), {
          redirect: 'manual',
          signal: AbortSignal.timeout(Math.min(20_000, remaining)),
        });
        const location = response.headers.get('location');
        const redirect = location && [301, 302, 303, 307, 308].includes(response.status)
          ? new URL(location, origin) : null;
        const vercelSso = redirect?.origin === 'https://vercel.com' && redirect.pathname === '/sso-api';
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
    assert.ok(body.series && typeof body.series === 'object' && !Array.isArray(body.series),
      'Chart series must be an object');
    for (const values of Object.values(body.series)) {
      assert.ok(Array.isArray(values) && values.length === body.commits.length &&
        values.every((value) => value === null || (typeof value === 'number' && Number.isFinite(value))),
      'Chart series must align with its commit window');
    }
  }

  const health = await json('/api/health', (body) => {
    assert.equal(body.status, 'ok');
    assert.equal(body.build_sha, sha, 'Health reports a different build');
    assert.ok(Number.isInteger(body.schema_version));
  });
  if (health === 'protected') return 'protected';
  const groups = await json('/api/groups', (body) => {
    assert.ok(Array.isArray(body.groups) && body.groups.some((group) => group.charts?.length),
      'No populated groups');
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
      assert.ok(html.includes(path === '/'
        ? 'data-role="global-filter-bar"'
        : `data-chart-slug="${chartSlug}"`), `${path}: rendered page content is missing`);
    });
    if (result === 'protected') return 'protected';
  }
  // Repeat the same URLs, without a cache-busting query, to verify CDN reuse.
  for (const path of ['/', `/api/chart/${chartSlug}`]) {
    const result = await request(path, async (response) => {
      await response.arrayBuffer();
      assert.equal(response.headers.get('x-vercel-cache'), 'HIT', `${path}: CDN did not report HIT`);
    });
    if (result === 'protected') return 'protected';
  }
  return 'verified';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await verifyDeployment(...process.argv.slice(2));
    const message = result === 'protected'
      ? 'Deployment created; preview protection blocked verification. Health, build identity, and CDN caching remain unverified.'
      : 'Verified build SHA, health, representative group/chart JSON, HTML pages, and CDN HIT.';
    console.log(`${result === 'protected' ? '::notice::' : ''}${message}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
