// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, expect, test } from 'bun:test';
import { compareApi, compareApiDetailed, diffJson, planRequests } from './compare-api';

test('identical bodies match', () => {
  expect(diffJson('{"a":[1,2]}', '{"a":[1,2]}')).toBeNull();
});
test('a changed value is reported with its path', () => {
  expect(diffJson('{"a":[1,2]}', '{"a":[1,3]}')).toContain('a[1]');
});
test('key order counts, because clients see bytes', () => {
  expect(diffJson('{"a":1,"b":2}', '{"b":2,"a":1}')).not.toBeNull();
});
test('a key order difference names the object', () => {
  expect(diffJson('{"o":{"a":1,"b":2}}', '{"o":{"b":2,"a":1}}')).toContain('$.o: key order');
});
test('a missing key and a different array length are reported with their paths', () => {
  expect(diffJson('{"a":{"b":1}}', '{"a":{}}')).toContain('$.a.b: missing from head');
  expect(diffJson('{"a":{}}', '{"a":{"b":1}}')).toContain('$.a.b: missing from base');
  expect(diffJson('{"a":[1]}', '{"a":[1,2]}')).toContain('$.a: array length 1 != 2');
});
test('a key that is not an identifier is written in brackets', () => {
  expect(diffJson('{"a b":1}', '{"a b":2}')).toContain('$["a b"]');
});
test('formatting that parses to the same JSON still counts', () => {
  expect(diffJson('{"a":1}', '{"a": 1}')).toContain('formatting');
  expect(diffJson('{"2":1,"1":2}', '{"1":2,"2":1}')).toContain('at byte 2');
});
test('bodies that are not JSON are compared as bytes', () => {
  expect(diffJson('not json', 'not json')).toBeNull();
  expect(diffJson('not json', 'not jsoN')).toContain('not both JSON');
});

test('the plan covers every group and chart, and every 25th chart in full', () => {
  const charts = Array.from({ length: 51 }, (_, i) => ({ slug: `c${i}` }));
  const groups = [
    { slug: 'g0', charts: charts.slice(0, 30) },
    { slug: 'g1', charts: charts.slice(30) },
  ];
  const plan = planRequests(groups);
  expect(plan.slice(0, 5)).toEqual([
    '/api/groups',
    '/api/group/g0?n=100',
    '/api/group/g0?n=50',
    '/api/group/g1?n=100',
    '/api/group/g1?n=50',
  ]);
  expect(plan.filter((p) => p.startsWith('/api/chart/') && p.endsWith('?n=100'))).toHaveLength(51);
  expect(plan.filter((p) => p.endsWith('?n=all'))).toEqual([
    '/api/chart/c0?n=all',
    '/api/chart/c25?n=all',
    '/api/chart/c50?n=all',
  ]);
});
test('slugs are percent-encoded in the planned URLs', () => {
  const plan = planRequests([{ slug: 'we ird/slug?x', charts: [{ slug: 'c d#e' }] }]);
  expect(plan).toContain('/api/group/we%20ird%2Fslug%3Fx?n=100');
  expect(plan).toContain('/api/group/we%20ird%2Fslug%3Fx?n=50');
  expect(plan).toContain('/api/chart/c%20d%23e?n=100');
  expect(plan).toContain('/api/chart/c%20d%23e?n=all');
});
test('a chart linked from two groups is requested once', () => {
  const plan = planRequests([
    { slug: 'g0', charts: [{ slug: 'shared' }] },
    { slug: 'g1', charts: [{ slug: 'shared' }] },
  ]);
  expect(plan.filter((p) => p.startsWith('/api/chart/shared'))).toHaveLength(2);
});

type Handler = (request: Request) => Response | Promise<Response>;
const servers: ReturnType<typeof Bun.serve>[] = [];

function serve(handler: Handler): string {
  const server = Bun.serve({ port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    void server.stop(true);
  }
});

const GROUPS = { groups: [{ slug: 'g', charts: [{ slug: 'c' }] }] };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=300' },
    ...init,
  });
}

function api(overrides: Handler = () => json({ value: 1 })): Handler {
  return (request) =>
    new URL(request.url).pathname === '/api/groups' ? json(GROUPS) : overrides(request);
}

test('servers that answer alike have no mismatches', async () => {
  const result = await compareApiDetailed(serve(api()), serve(api()));
  expect(result.mismatches).toEqual([]);
  // /api/groups, two windows for the group, and the chart at n=100 and n=all.
  expect(result.requests).toBe(5);
});

test('the result tallies the statuses and the body bytes that were compared', async () => {
  const result = await compareApiDetailed(serve(api()), serve(api()));
  expect(result.statuses).toEqual({ '200': 10 });
  const groupsBytes = JSON.stringify(GROUPS).length;
  const valueBytes = JSON.stringify({ value: 1 }).length;
  expect(result.bytes).toEqual({
    base: groupsBytes + 4 * valueBytes,
    head: groupsBytes + 4 * valueBytes,
  });
});

test('a different body, status, content-type and cache-control are each reported', async () => {
  const base = serve(api());
  const head = serve(
    api((request) =>
      new URL(request.url).pathname === '/api/group/g'
        ? json({ value: 2 }, { status: 404 })
        : new Response(JSON.stringify({ value: 1 }), {
            headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
          }),
    ),
  );
  const lines = await compareApi(base, head);
  expect(lines).toContain('/api/group/g?n=100: status 200 != 404');
  expect(lines.some((l) => l.startsWith('/api/group/g?n=100: body differs $.value: 1 != 2'))).toBe(
    true,
  );
  expect(lines).toContain('/api/chart/c?n=100: content-type "application/json" != "text/plain"');
  expect(lines).toContain('/api/chart/c?n=100: cache-control "public, s-maxage=300" != "no-store"');
});

const NOTHING_COMPARED = 'so nothing was compared for this route';

test('a server error on both sides is reported, because nothing was compared', async () => {
  const failing = api(() => new Response('boom', { status: 500 }));
  const lines = await compareApi(serve(failing), serve(failing));
  expect(lines).toContain(
    `/api/chart/c?n=100: base answered 500 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(lines).toContain(
    `/api/chart/c?n=100: head answered 500 instead of 200, ${NOTHING_COMPARED}`,
  );
});

test('a 404 on both sides fails, because every planned URL comes from the base', async () => {
  const missing = api((request) =>
    new URL(request.url).pathname === '/api/chart/c'
      ? json({ error: 'not_found' }, { status: 404 })
      : json({ value: 1 }),
  );
  const result = await compareApiDetailed(serve(missing), serve(missing));
  expect(result.mismatches).toContain(
    `/api/chart/c?n=100: base answered 404 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(result.mismatches).toContain(
    `/api/chart/c?n=100: head answered 404 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(result.mismatches.filter((line) => !line.startsWith('/api/chart/c?n='))).toEqual([]);
  expect(result.statuses).toEqual({ '200': 6, '404': 4 });
});

test('a redirect or an empty 200 on both sides fails too', async () => {
  const odd = api((request) =>
    new URL(request.url).pathname === '/api/group/g'
      ? new Response(null, { status: 307, headers: { location: '/elsewhere' } })
      : new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  const lines = await compareApi(serve(odd), serve(odd));
  expect(lines).toContain(
    `/api/group/g?n=50: base answered 307 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(lines).toContain(
    `/api/chart/c?n=all: head answered 200 with an empty body, ${NOTHING_COMPARED}`,
  );
});

test('a slug that needs encoding reaches the servers encoded', async () => {
  const groups = { groups: [{ slug: 'we ird/slug?x', charts: [{ slug: 'c d#e' }] }] };
  const seen: string[] = [];
  const handler: Handler = (request) => {
    const { pathname, search } = new URL(request.url);
    seen.push(pathname + search);
    return pathname === '/api/groups' ? json(groups) : json({ value: 1 });
  };
  const result = await compareApi(serve(handler), serve(handler));
  expect(result).toEqual([]);
  expect(seen).toContain('/api/group/we%20ird%2Fslug%3Fx?n=100');
  expect(seen).toContain('/api/chart/c%20d%23e?n=all');
  expect(seen.filter((path) => path.includes(' ') || path.includes('#'))).toEqual([]);
});

test('an unreachable head is reported for every URL', async () => {
  const base = serve(api());
  const head = serve(api());
  await servers[servers.length - 1].stop(true);
  const lines = await compareApi(base, head);
  expect(lines).toHaveLength(5);
  expect(lines[0]).toContain('head request failed');
});

test('requests that fill the group cache never overlap, even across the two servers', async () => {
  const groups = {
    groups: ['g0', 'g1', 'g2'].map((slug) => ({ slug, charts: [{ slug: `${slug}-chart` }] })),
  };
  let fills = 0;
  let mostFills = 0;
  let mostRequests = 0;
  let requests = 0;
  const handler: Handler = async (request) => {
    const url = new URL(request.url);
    const fill = url.pathname === '/api/groups' || url.search === '?n=100';
    const isGroupPath = url.pathname.startsWith('/api/group');
    requests++;
    mostRequests = Math.max(mostRequests, requests);
    if (fill && isGroupPath) {
      mostFills = Math.max(mostFills, ++fills);
    }
    await Bun.sleep(5);
    if (fill && isGroupPath) {
      fills--;
    }
    requests--;
    return url.pathname === '/api/groups' ? json(groups) : json({ value: 1 });
  };
  const result = await compareApiDetailed(serve(handler), serve(handler));
  expect(result.mismatches).toEqual([]);
  expect(mostFills).toBe(1);
  // Other requests still run side by side, so the check stays quick.
  expect(mostRequests).toBeGreaterThan(1);
});

test('an empty base is an error, not a pass', async () => {
  const empty = serve(() => json({ groups: [] }));
  await expect(compareApi(empty, empty)).rejects.toThrow('no groups');
});
