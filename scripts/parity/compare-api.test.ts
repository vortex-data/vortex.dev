// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { afterEach, expect, test } from 'bun:test';
import { chartKeyFromSlug, groupKeyFromSlug } from '../../web/lib/slug';
import {
  compareApi,
  compareApiDetailed,
  diffJson,
  MALFORMED_SLUG,
  pageTitle,
  planRequests,
  UNKNOWN_CHART_SLUG,
} from './compare-api';

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
  const plan = planRequests(groups)
    .filter((request) => request.path.startsWith('/api/') && request.status === 200)
    .map((request) => request.path);
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
  const plan = planRequests([{ slug: 'we ird/slug?x', charts: [{ slug: 'c d#e' }] }]).map(
    (request) => request.path,
  );
  expect(plan).toContain('/api/group/we%20ird%2Fslug%3Fx?n=100');
  expect(plan).toContain('/api/group/we%20ird%2Fslug%3Fx?n=50');
  expect(plan).toContain('/api/chart/c%20d%23e?n=100');
  expect(plan).toContain('/api/chart/c%20d%23e?n=all');
  expect(plan).toContain('/chart/c%20d%23e');
});
test('a chart linked from two groups is requested once', () => {
  const plan = planRequests([
    { slug: 'g0', charts: [{ slug: 'shared' }] },
    { slug: 'g1', charts: [{ slug: 'shared' }] },
  ]).map((request) => request.path);
  expect(plan.filter((p) => p.startsWith('/api/chart/shared'))).toHaveLength(2);
});
test('every API URL from the base must answer 200, and its body is compared', () => {
  const plan = planRequests([{ slug: 'g', charts: [{ slug: 'c' }] }]);
  for (const path of ['/api/groups', '/api/group/g?n=100', '/api/chart/c?n=all']) {
    expect(plan).toContainEqual({ path, status: 200, compare: 'body' });
  }
});
test('the plan loads the pages the screenshots use and compares their titles', () => {
  const groups = Array.from({ length: 7 }, (_, i) => ({
    slug: `g${i}`,
    charts: [{ slug: `g${i}-first` }, { slug: `g${i}-second` }],
  }));
  const pages = planRequests(groups).filter((request) => !request.path.startsWith('/api/'));
  expect(pages.filter((request) => request.status === 200)).toEqual(
    ['/', '/chart/g0-first', '/chart/g1-first', '/chart/g2-first', '/chart/g3-first']
      .concat('/chart/g4-first')
      .map((path) => ({ path, status: 200, compare: 'title' })),
  );
});
test('the plan probes an unknown and a malformed slug and expects their error statuses', () => {
  const probes = planRequests([{ slug: 'g', charts: [{ slug: 'c' }] }]).filter(
    (request) => request.status !== 200,
  );
  expect(probes).toEqual([
    { path: `/chart/${UNKNOWN_CHART_SLUG}`, status: 404, compare: 'title' },
    { path: `/api/chart/${UNKNOWN_CHART_SLUG}?n=100`, status: 404, compare: 'body' },
    { path: `/chart/${MALFORMED_SLUG}`, status: 404, compare: 'title' },
    { path: `/api/chart/${MALFORMED_SLUG}?n=100`, status: 400, compare: 'body' },
    { path: `/api/group/${MALFORMED_SLUG}?n=100`, status: 400, compare: 'body' },
  ]);
});
test("the app's own parser accepts the unknown slug and rejects the malformed one", () => {
  expect(chartKeyFromSlug(UNKNOWN_CHART_SLUG).k).toBe('CompressionTime');
  expect(() => chartKeyFromSlug(MALFORMED_SLUG)).toThrow();
  expect(() => groupKeyFromSlug(MALFORMED_SLUG)).toThrow();
  expect(encodeURIComponent(UNKNOWN_CHART_SLUG)).toBe(UNKNOWN_CHART_SLUG);
  expect(encodeURIComponent(MALFORMED_SLUG)).toBe(MALFORMED_SLUG);
});

test('the page title is the document title, read as a browser shows it', () => {
  expect(pageTitle('<html><head><title>A &amp; B</title></head></html>')).toBe('A & B');
  expect(pageTitle('<title>\n  Two   words \n</title>')).toBe('Two words');
  expect(pageTitle('<title>it&#39;s &#x27;q&#x27; &lt;x&gt; &quot;y&quot;</title>')).toBe(
    `it's 'q' <x> "y"`,
  );
  // An inline SVG's title labels the icon, not the page.
  expect(
    pageTitle('<body><svg><title>icon</title></svg><title data-x="1">Page</title></body>'),
  ).toBe('Page');
  expect(pageTitle('<title>First</title><title>Second</title>')).toBe('First');
  expect(pageTitle('<html><head></head></html>')).toBeNull();
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
const TITLE = 'Vortex Benchmarks';
const NOT_FOUND_TITLE = '404: This page could not be found.';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, s-maxage=300' },
    ...init,
  });
}

function html(title: string | null, init: ResponseInit = {}, script = 'build-1'): Response {
  const head = title === null ? '' : `<title>${title}</title>`;
  return new Response(`<!DOCTYPE html><html><head>${head}<script src="/${script}.js"></script>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    ...init,
  });
}

type Override = (request: Request) => Response | undefined | Promise<Response | undefined>;

/**
 * A fake bench server. It answers `/api/groups` with `groups`; every other URL goes to `override`
 * first and, when that returns nothing, gets the answer the app gives: 200 for the data and the
 * pages, 404 for the unknown chart, 400 from the API and 404 from the page for the malformed slug.
 */
function api(override?: Override, groups: unknown = GROUPS): Handler {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/groups') {
      return json(groups);
    }
    const answer = await override?.(request);
    if (answer !== undefined) {
      return answer;
    }
    const isApi = pathname.startsWith('/api/');
    if (pathname.endsWith(`/${MALFORMED_SLUG}`)) {
      return isApi
        ? json({ error: 'bad_request' }, { status: 400 })
        : html(NOT_FOUND_TITLE, { status: 404 });
    }
    if (pathname.endsWith(`/${UNKNOWN_CHART_SLUG}`)) {
      return isApi
        ? json({ error: 'not_found' }, { status: 404 })
        : html(NOT_FOUND_TITLE, { status: 404 });
    }
    return isApi ? json({ value: 1 }) : html(TITLE);
  };
}

/** The data URLs, the two pages and the five error probes planned for {@link GROUPS}. */
const PLANNED = 5 + 2 + 5;

test('servers that answer alike have no mismatches', async () => {
  const result = await compareApiDetailed(serve(api()), serve(api()));
  expect(result.mismatches).toEqual([]);
  // /api/groups, two windows for the group, the chart at n=100 and n=all, the landing page, the
  // chart page, and the five error probes.
  expect(result.requests).toBe(PLANNED);
});

test('the result tallies the statuses and the body bytes that were compared', async () => {
  const result = await compareApiDetailed(serve(api()), serve(api()));
  expect(result.statuses).toEqual({ '200': 14, '404': 6, '400': 4 });
  const length = async (response: Response) => (await response.text()).length;
  const perSide =
    JSON.stringify(GROUPS).length +
    4 * JSON.stringify({ value: 1 }).length +
    2 * (await length(html(TITLE))) +
    2 * (await length(html(NOT_FOUND_TITLE))) +
    JSON.stringify({ error: 'not_found' }).length +
    2 * JSON.stringify({ error: 'bad_request' }).length;
  expect(result.bytes).toEqual({ base: perSide, head: perSide });
});

test('a different body, status, content-type and cache-control are each reported', async () => {
  const base = serve(api());
  const head = serve(
    api((request) => {
      const { pathname } = new URL(request.url);
      if (pathname === '/api/group/g') {
        return json({ value: 2 }, { status: 404 });
      }
      return pathname === '/api/chart/c'
        ? new Response(JSON.stringify({ value: 1 }), {
            headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' },
          })
        : undefined;
    }),
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
      : undefined,
  );
  const result = await compareApiDetailed(serve(missing), serve(missing));
  expect(result.mismatches).toContain(
    `/api/chart/c?n=100: base answered 404 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(result.mismatches).toContain(
    `/api/chart/c?n=100: head answered 404 instead of 200, ${NOTHING_COMPARED}`,
  );
  expect(result.mismatches.filter((line) => !line.startsWith('/api/chart/c?n='))).toEqual([]);
  expect(result.statuses).toEqual({ '200': 10, '404': 10, '400': 4 });
});

test('an expected error status passes, and any other status on that probe fails', async () => {
  const page = `/chart/${UNKNOWN_CHART_SLUG}`;
  const found = api((request) =>
    new URL(request.url).pathname === page ? html(TITLE) : undefined,
  );
  const result = await compareApiDetailed(serve(api()), serve(found));
  expect(result.mismatches).toEqual([
    `${page}: head answered 200 instead of 404, ${NOTHING_COMPARED}`,
    `${page}: status 404 != 200`,
    `${page}: title ${JSON.stringify(NOT_FOUND_TITLE)} != ${JSON.stringify(TITLE)}`,
  ]);
});

test('an API error probe compares its body too', async () => {
  const path = `/api/group/${MALFORMED_SLUG}`;
  const other = api((request) =>
    new URL(request.url).pathname === path
      ? json({ error: 'invalid' }, { status: 400 })
      : undefined,
  );
  const lines = await compareApi(serve(api()), serve(other));
  expect(lines).toEqual([`${path}?n=100: body differs $.error: "bad_request" != "invalid"`]);
});

test('a page compares its title, not the rest of its HTML', async () => {
  const rebuilt = api((request) =>
    ['/', '/chart/c'].includes(new URL(request.url).pathname)
      ? html(TITLE, {}, 'build-2')
      : undefined,
  );
  expect(await compareApi(serve(api()), serve(rebuilt))).toEqual([]);

  const retitled = api((request) =>
    new URL(request.url).pathname === '/' ? html('Benchmarks') : undefined,
  );
  expect(await compareApi(serve(api()), serve(retitled))).toEqual([
    `/: title ${JSON.stringify(TITLE)} != "Benchmarks"`,
  ]);
});

test('a page without a title fails, because nothing was compared', async () => {
  const untitled = api((request) =>
    new URL(request.url).pathname === '/chart/c' ? html(null) : undefined,
  );
  expect(await compareApi(serve(untitled), serve(untitled))).toEqual([
    `/chart/c: base sent no <title>, ${NOTHING_COMPARED}`,
    `/chart/c: head sent no <title>, ${NOTHING_COMPARED}`,
  ]);
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
  const app = api(undefined, groups);
  const handler: Handler = (request) => {
    const { pathname, search } = new URL(request.url);
    seen.push(pathname + search);
    return app(request);
  };
  const result = await compareApi(serve(handler), serve(handler));
  expect(result).toEqual([]);
  expect(seen).toContain('/api/group/we%20ird%2Fslug%3Fx?n=100');
  expect(seen).toContain('/api/chart/c%20d%23e?n=all');
  expect(seen).toContain('/chart/c%20d%23e');
  expect(seen.filter((path) => path.includes(' ') || path.includes('#'))).toEqual([]);
});

test('an unreachable head is reported for every URL', async () => {
  const base = serve(api());
  const head = serve(api());
  await servers[servers.length - 1].stop(true);
  const lines = await compareApi(base, head);
  expect(lines).toHaveLength(PLANNED);
  expect(lines[0]).toContain('head request failed');
});

test('requests that fill the group cache never overlap, even across the two servers', async () => {
  const groups = {
    groups: ['g0', 'g1', 'g2'].map((slug) => ({ slug, charts: [{ slug: `${slug}-chart` }] })),
  };
  const app = api(undefined, groups);
  let fills = 0;
  let mostFills = 0;
  let mostRequests = 0;
  let requests = 0;
  const handler: Handler = async (request) => {
    const url = new URL(request.url);
    // The landing page reads every group through the same cache as /api/groups.
    const fill =
      url.pathname === '/' ||
      url.pathname === '/api/groups' ||
      (url.pathname.startsWith('/api/group/') && url.search === '?n=100');
    requests++;
    mostRequests = Math.max(mostRequests, requests);
    if (fill) {
      mostFills = Math.max(mostFills, ++fills);
    }
    await Bun.sleep(5);
    if (fill) {
      fills--;
    }
    requests--;
    return app(request);
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
