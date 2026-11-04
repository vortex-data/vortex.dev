// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyDeployment } from './verify-web-deploy.mjs';

const SHA = 'a'.repeat(40);
const chart = { commits: [{ sha: 'b'.repeat(40) }], series: { vortex: [1] } };
function fixture(overrides = {}) {
  const hits = new Map();
  return async (url) => {
    const path = url.pathname;
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (overrides[path]) return overrides[path]();
    if (path === '/api/health')
      return Response.json({ status: 'ok', build_sha: SHA, schema_version: 1 });
    if (path === '/api/groups')
      return Response.json({ groups: [{ slug: 'group', charts: [{ slug: 'chart' }] }] });
    if (path === '/api/group/group') return Response.json({ charts: [chart] });
    if (path === '/api/chart/chart')
      return Response.json(chart, {
        headers: { 'x-vercel-cache': hits.get(path) > 1 ? 'HIT' : 'MISS' },
      });
    return new Response(
      '<html><body data-role="global-filter-bar" data-chart-slug="chart">benchmarks</body></html>',
      {
        headers: {
          'content-type': 'text/html',
          'x-vercel-cache': hits.get(path) > 1 ? 'HIT' : 'MISS',
        },
      },
    );
  };
}
const noSleep = async () => {};

test('verifies a matching build and populated read paths after CDN warmup', async () => {
  assert.equal(
    await verifyDeployment('https://bench.test', SHA, 'production', fixture(), noSleep),
    'verified',
  );
});
test('accepts the build identity alone, which health returns without the cron secret', async () => {
  const fetcher = fixture({
    '/api/health': () => Response.json({ build_sha: SHA, schema_version: 1 }),
  });
  assert.equal(
    await verifyDeployment('https://bench.test', SHA, 'production', fetcher, noSleep),
    'verified',
  );
});
test('rejects a deployment whose database check fails', async () => {
  const fetcher = fixture({
    '/api/health': () => Response.json({ status: 'error', build_sha: SHA, schema_version: 1 }),
  });
  await assert.rejects(verifyDeployment('https://bench.test', SHA, 'production', fetcher, noSleep));
});
test('rejects an older healthy deployment', async () => {
  await assert.rejects(
    verifyDeployment('https://bench.test', 'c'.repeat(40), 'production', fixture(), noSleep),
    /different build/,
  );
});
test('reports protected previews without claiming verification; production fails', async () => {
  const fetcher = fixture({ '/api/health': () => new Response('', { status: 401 }) });
  assert.equal(
    await verifyDeployment('https://bench.test', SHA, 'preview', fetcher, noSleep),
    'protected',
  );
  await assert.rejects(
    verifyDeployment('https://bench.test', SHA, 'production', fetcher, noSleep),
    /production route/,
  );
});
test('fails on empty group data and a CDN that never hits', async () => {
  await assert.rejects(
    verifyDeployment(
      'https://bench.test',
      SHA,
      'production',
      fixture({
        '/api/groups': () => Response.json({ groups: [] }),
      }),
      noSleep,
    ),
    /populated groups/,
  );
  await assert.rejects(
    verifyDeployment(
      'https://bench.test',
      SHA,
      'production',
      fixture({
        '/api/chart/chart': () => Response.json(chart, { headers: { 'x-vercel-cache': 'MISS' } }),
      }),
      noSleep,
    ),
    /CDN did not report HIT/,
  );
});

test('accepts a global commit window with no measurement for the selected chart', async () => {
  assert.equal(
    await verifyDeployment(
      'https://bench.test',
      SHA,
      'production',
      fixture({
        '/api/group/group': () =>
          Response.json({ charts: [{ commits: [{ sha: SHA }], series: { vortex: [null] } }] }),
      }),
      noSleep,
    ),
    'verified',
  );
});

test('rejects a successful HTTP response containing only an error shell', async () => {
  await assert.rejects(
    verifyDeployment(
      'https://bench.test',
      SHA,
      'production',
      fixture({
        '/': () =>
          new Response('<html><body>Error</body></html>', {
            headers: { 'content-type': 'text/html' },
          }),
      }),
      noSleep,
    ),
    /rendered page content is missing/,
  );
});

test('recognizes Vercel SSO redirects only as protected previews', async () => {
  const redirect = (location) =>
    fixture({
      '/api/health': () => new Response(null, { status: 302, headers: { location } }),
    });
  const sso = redirect('https://vercel.com/sso-api?url=https%3A%2F%2Fbench.test');
  assert.equal(
    await verifyDeployment('https://bench.test', SHA, 'preview', sso, noSleep),
    'protected',
  );
  await assert.rejects(
    verifyDeployment('https://bench.test', SHA, 'production', sso, noSleep),
    /production route/,
  );
  await assert.rejects(
    verifyDeployment(
      'https://bench.test',
      SHA,
      'preview',
      redirect('https://example.com/login'),
      noSleep,
    ),
    /HTTP 302/,
  );
});

test("verifies bench under /bench on a deployment's own URL, with the given headers", async () => {
  const seen = [];
  const inner = fixture();
  const underBench = async (url, init) => {
    seen.push({ path: url.pathname, bypass: init.headers['x-vercel-protection-bypass'] });
    assert.ok(url.pathname.startsWith('/bench'), url.pathname);
    const path = url.pathname === '/bench' ? '/' : url.pathname.slice('/bench'.length);
    return inner(new URL(`${path}${url.search}`, url.origin));
  };
  assert.equal(
    await verifyDeployment(
      'https://vortex-abc.vercel.app/bench',
      SHA,
      'production',
      underBench,
      noSleep,
      { 'x-vercel-protection-bypass': 'secret' },
    ),
    'verified',
  );
  assert.ok(seen.some((request) => request.path === '/bench'));
  assert.ok(seen.some((request) => request.path === '/bench/api/health'));
  assert.ok(seen.every((request) => request.bypass === 'secret'));
});

/** A deployment URL serving bench under /bench, and bench.vortex.dev serving `liveSha`. */
function twoHosts(liveSha, { hitOnHost = true } = {}) {
  const deployment = fixture();
  const hostHits = new Map();
  const seen = [];
  const fetcher = async (url, init) => {
    seen.push({ host: url.host, path: url.pathname, headers: init.headers ?? {} });
    if (url.host === 'bench.vortex.dev') {
      const path = url.pathname;
      hostHits.set(path, (hostHits.get(path) ?? 0) + 1);
      if (path === '/api/health') return Response.json({ status: 'ok', build_sha: liveSha });
      const cache = hitOnHost && hostHits.get(path) > 1 ? 'HIT' : 'MISS';
      return new Response('{}', { headers: { 'x-vercel-cache': cache } });
    }
    const path = url.pathname === '/bench' ? '/' : url.pathname.slice('/bench'.length);
    // The /bench form is never CDN-cached in production.
    const response = await deployment(new URL(`${path}${url.search}`, url.origin));
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? '',
        'x-vercel-cache': 'MISS',
      },
    });
  };
  return { fetcher, seen };
}
const bypass = { 'x-vercel-protection-bypass': 'secret' };
const onDeployment = (fetcher, cdnBase) =>
  verifyDeployment(
    'https://vortex-abc.vercel.app/bench',
    SHA,
    'production',
    fetcher,
    noSleep,
    bypass,
    cdnBase,
  );

test('checks the CDN on bench.vortex.dev once it serves this build, without the bypass', async () => {
  const { fetcher, seen } = twoHosts(SHA);
  assert.equal(await onDeployment(fetcher, 'https://bench.vortex.dev'), 'verified');
  const onHost = seen.filter((request) => request.host === 'bench.vortex.dev');
  assert.ok(onHost.some((request) => request.path === '/'));
  assert.ok(onHost.every((request) => !('x-vercel-protection-bypass' in request.headers)));
});

test('skips the CDN check while bench.vortex.dev serves another build', async () => {
  const { fetcher, seen } = twoHosts('c'.repeat(40));
  assert.equal(await onDeployment(fetcher, 'https://bench.vortex.dev'), 'cdn-skipped');
  assert.ok(
    seen.every((request) => request.host !== 'bench.vortex.dev' || request.path === '/api/health'),
  );
});

test('fails when bench.vortex.dev serves this build but its CDN never hits', async () => {
  const { fetcher } = twoHosts(SHA, { hitOnHost: false });
  await assert.rejects(onDeployment(fetcher, 'https://bench.vortex.dev'), /CDN did not report HIT/);
});

test('skips the CDN check when no CDN URL is given', async () => {
  const { fetcher } = twoHosts(SHA);
  assert.equal(await onDeployment(fetcher, ''), 'cdn-skipped');
});
