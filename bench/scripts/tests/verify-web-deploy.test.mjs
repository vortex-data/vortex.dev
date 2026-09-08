// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDeployment } from '../verify-web-deploy.mjs';

const SHA = 'a'.repeat(40);
const chart = { commits: [{ sha: 'b'.repeat(40) }], series: { vortex: [1] } };
function fixture(overrides = {}) {
  const hits = new Map();
  return async (url) => {
    const path = url.pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (overrides[path]) return overrides[path]();
    if (path === '/api/health') return Response.json({ status: 'ok', build_sha: SHA, schema_version: 1 });
    if (path === '/api/groups') return Response.json({ groups: [{ slug: 'group', charts: [{ slug: 'chart' }] }] });
    if (path === '/api/group/group') return Response.json({ charts: [chart] });
    if (path === '/api/chart/chart') return Response.json(chart, { headers: { 'x-vercel-cache': hits.get(path) > 1 ? 'HIT' : 'MISS' } });
    return new Response('<html><body data-role="global-filter-bar" data-chart-slug="chart">benchmarks</body></html>', {
      headers: { 'content-type': 'text/html', 'x-vercel-cache': hits.get(path) > 1 ? 'HIT' : 'MISS' },
    });
  };
}
const noSleep = async () => {};

test('verifies a matching build and populated read paths after CDN warmup', async () => {
  assert.equal(await verifyDeployment('https://bench.test', SHA, 'production', fixture(), noSleep), 'verified');
});
test('rejects an older healthy deployment', async () => {
  await assert.rejects(verifyDeployment('https://bench.test', 'c'.repeat(40), 'production', fixture(), noSleep), /different build/);
});
test('reports protected previews without claiming verification; production fails', async () => {
  const fetcher = fixture({ '/api/health': () => new Response('', { status: 401 }) });
  assert.equal(await verifyDeployment('https://bench.test', SHA, 'preview', fetcher, noSleep), 'protected');
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', fetcher, noSleep), /production route/);
});
test('fails on empty group data and a CDN that never hits', async () => {
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', fixture({
    '/api/groups': () => Response.json({ groups: [] }),
  }), noSleep), /populated groups/);
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', fixture({
    '/api/chart/chart': () => Response.json(chart, { headers: { 'x-vercel-cache': 'MISS' } }),
  }), noSleep), /CDN did not report HIT/);
});

test('accepts a global commit window with no measurement for the selected chart', async () => {
  assert.equal(await verifyDeployment('https://bench.test', SHA, 'production', fixture({
    '/api/group/group': () => Response.json({ charts: [{ commits: [{ sha: SHA }], series: { vortex: [null] } }] }),
  }), noSleep), 'verified');
});

test('rejects a successful HTTP response containing only an error shell', async () => {
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', fixture({
    '/': () => new Response('<html><body>Error</body></html>', { headers: { 'content-type': 'text/html' } }),
  }), noSleep), /rendered page content is missing/);
});

test('recognizes Vercel SSO redirects only as protected previews', async () => {
  const redirect = (location) => fixture({
    '/api/health': () => new Response(null, { status: 302, headers: { location } }),
  });
  const sso = redirect('https://vercel.com/sso-api?url=https%3A%2F%2Fbench.test');
  assert.equal(await verifyDeployment('https://bench.test', SHA, 'preview', sso, noSleep), 'protected');
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', sso, noSleep), /production route/);
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'preview', redirect('https://example.com/login'), noSleep), /HTTP 302/);
});
