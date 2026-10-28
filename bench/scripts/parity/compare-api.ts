// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Compare the read API of two bench servers that share one database.
 *
 * Run as `bun compare-api.ts <base-url> <head-url>`; it prints one line per mismatch and a
 * summary, and exits non-zero when anything differs. `run.sh` calls it after it starts both
 * servers.
 */

/** Largest number of URLs in flight at once. Each server holds at most 8 database connections. */
const DEFAULT_CONCURRENCY = 4;
/** Every chart at this index interval (starting at the first chart) also gets `?n=all`. */
const FULL_HISTORY_EVERY = 25;
/** `?n=all` can read the whole history of a chart, so the deadline is generous. */
const REQUEST_TIMEOUT_MS = 180_000;

/** The parts of `GET /api/groups` that decide which URLs to request. */
interface GroupLinks {
  slug: string;
  charts: { slug: string }[];
}

/** The parts of a response the parity check compares. */
interface Captured {
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  body: string;
}

/** The outcome of one comparison run. */
export interface ApiComparison {
  /** URLs requested from each server, so the full run requested twice this many. */
  requests: number;
  /** One line per mismatch. */
  mismatches: string[];
}

/** Options for {@link compareApiDetailed}. */
export interface CompareOptions {
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

/** The path and values of the first difference in document order, or null when the values agree. */
function firstDifference(base: unknown, head: unknown, path: string): string | null {
  if (Array.isArray(base) && Array.isArray(head)) {
    const shared = Math.min(base.length, head.length);
    for (let i = 0; i < shared; i++) {
      const found = firstDifference(base[i], head[i], `${path}[${i}]`);
      if (found !== null) {
        return found;
      }
    }
    return base.length === head.length
      ? null
      : `${path}: array length ${base.length} != ${head.length}`;
  }
  if (isRecord(base) && isRecord(head)) {
    const baseKeys = Object.keys(base);
    const headKeys = Object.keys(head);
    for (const key of baseKeys) {
      if (!Object.hasOwn(head, key)) {
        return `${childPath(path, key)}: missing from head`;
      }
      const found = firstDifference(base[key], head[key], childPath(path, key));
      if (found !== null) {
        return found;
      }
    }
    for (const key of headKeys) {
      if (!Object.hasOwn(base, key)) {
        return `${childPath(path, key)}: missing from base`;
      }
    }
    const baseOrder = baseKeys.join(',');
    const headOrder = headKeys.join(',');
    return baseOrder === headOrder
      ? null
      : `${path}: key order ${show(baseOrder)} != ${show(headOrder)}`;
  }
  return base === head ? null : `${path}: ${show(base)} != ${show(head)}`;
}

function firstByteDifference(base: string, head: string): string {
  const limit = Math.min(base.length, head.length);
  let offset = 0;
  while (offset < limit && base[offset] === head[offset]) {
    offset++;
  }
  const excerpt = (text: string) =>
    JSON.stringify(text.slice(Math.max(0, offset - 20), offset + 40));
  return `at byte ${offset}: ${excerpt(base)} != ${excerpt(head)}`;
}

/**
 * Compare two response bodies. Clients see bytes, so equal bytes are the only match: when they
 * differ, parse both and name the first differing path, with a byte offset as the fallback for
 * differences JSON parsing hides (formatting, or the order of integer-like keys).
 *
 * @returns null when the bodies are identical, otherwise one line that describes the difference.
 */
export function diffJson(base: string, head: string): string | null {
  if (base === head) {
    return null;
  }
  let parsedBase: unknown;
  let parsedHead: unknown;
  try {
    parsedBase = JSON.parse(base);
    parsedHead = JSON.parse(head);
  } catch {
    return `bodies differ and are not both JSON, ${firstByteDifference(base, head)}`;
  }
  return (
    firstDifference(parsedBase, parsedHead, '$') ??
    `bodies differ in formatting, not in JSON content, ${firstByteDifference(base, head)}`
  );
}

async function capture(origin: string, path: string): Promise<Captured> {
  const response = await fetch(new URL(path, origin), {
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    cacheControl: response.headers.get('cache-control'),
    body: await response.text(),
  };
}

async function captureOrError(origin: string, path: string): Promise<Captured | Error> {
  try {
    return await capture(origin, path);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function compareCaptured(path: string, base: Captured | Error, head: Captured | Error): string[] {
  const lines: string[] = [];
  for (const [side, result] of [
    ['base', base],
    ['head', head],
  ] as const) {
    if (result instanceof Error) {
      lines.push(`${path}: ${side} request failed: ${result.message}`);
    } else if (result.status >= 500) {
      // A server error on both sides would otherwise compare equal and hide that no data was read.
      lines.push(`${path}: ${side} answered ${result.status}, so nothing was compared`);
    }
  }
  if (base instanceof Error || head instanceof Error) {
    return lines;
  }
  if (base.status !== head.status) {
    lines.push(`${path}: status ${base.status} != ${head.status}`);
  }
  if (base.contentType !== head.contentType) {
    lines.push(`${path}: content-type ${show(base.contentType)} != ${show(head.contentType)}`);
  }
  if (base.cacheControl !== head.cacheControl) {
    lines.push(`${path}: cache-control ${show(base.cacheControl)} != ${show(head.cacheControl)}`);
  }
  const bodyDifference = diffJson(base.body, head.body);
  if (bodyDifference !== null) {
    lines.push(`${path}: body differs ${bodyDifference}`);
  }
  return lines;
}

async function readGroups(baseUrl: string): Promise<GroupLinks[]> {
  const result = await capture(baseUrl, '/api/groups');
  if (result.status !== 200) {
    throw new Error(`base GET /api/groups answered ${result.status}; is the database restored?`);
  }
  const parsed: unknown = JSON.parse(result.body);
  const groups = isRecord(parsed) ? parsed.groups : undefined;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error('base GET /api/groups returned no groups; is the database restored?');
  }
  return groups as GroupLinks[];
}

/** The URLs to request from each server, in a stable order. */
export function planRequests(groups: GroupLinks[]): string[] {
  const paths = ['/api/groups'];
  for (const group of groups) {
    paths.push(`/api/group/${group.slug}?n=100`, `/api/group/${group.slug}?n=50`);
  }
  const chartSlugs = [...new Set(groups.flatMap((group) => group.charts.map((c) => c.slug)))];
  for (const [index, slug] of chartSlugs.entries()) {
    paths.push(`/api/chart/${slug}?n=100`);
    if (index % FULL_HISTORY_EVERY === 0) {
      paths.push(`/api/chart/${slug}?n=all`);
    }
  }
  return paths;
}

async function mapPool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

/**
 * Whether a request fills the group cache. Those fills (`cachedGroups` and
 * `cachedDefaultGroupCharts` in `lib/data-cache.ts`) take one PostgreSQL advisory lock for the whole
 * database, and a fill that finds the lock taken fails with a 500 after a few retries. Both servers
 * share one database, so two fills at once, even on different servers, can fail.
 */
function fillsGroupCache(path: string): boolean {
  return path === '/api/groups' || /^\/api\/group\/[^?]+\?n=100$/.test(path);
}

/** Runs one piece of work at a time, in the order requested. */
function serialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** Like {@link compareApi}, and also reports how many URLs it requested from each server. */
export async function compareApiDetailed(
  baseUrl: string,
  headUrl: string,
  options: CompareOptions = {},
): Promise<ApiComparison> {
  const paths = planRequests(await readGroups(baseUrl));
  const oneFillAtATime = serialQueue();
  let done = 0;
  const lines = await mapPool(paths, options.concurrency ?? DEFAULT_CONCURRENCY, async (path) => {
    const fetchBoth = async (): Promise<[Captured | Error, Captured | Error]> =>
      fillsGroupCache(path)
        ? oneFillAtATime(async () => [
            await captureOrError(baseUrl, path),
            await captureOrError(headUrl, path),
          ])
        : Promise.all([captureOrError(baseUrl, path), captureOrError(headUrl, path)]);
    const [base, head] = await fetchBoth();
    options.onProgress?.(++done, paths.length);
    return compareCaptured(path, base, head);
  });
  return { requests: paths.length, mismatches: lines.flat() };
}

/**
 * Request the read API from both servers and compare status, `content-type`, `cache-control` and
 * body: `/api/groups`; `/api/group/{slug}` at `?n=100` and `?n=50` for every group;
 * `/api/chart/{slug}?n=100` for every chart; and `/api/chart/{slug}?n=all` for every 25th chart.
 * The group and chart slugs come from the base server's `/api/groups`.
 *
 * @returns one line per mismatch; empty when the servers agree.
 */
export async function compareApi(baseUrl: string, headUrl: string): Promise<string[]> {
  return (await compareApiDetailed(baseUrl, headUrl)).mismatches;
}

if (import.meta.main) {
  const [baseUrl, headUrl] = process.argv.slice(2);
  if (!baseUrl || !headUrl) {
    console.error('usage: bun compare-api.ts <base-url> <head-url>');
    process.exit(2);
  }
  const started = Date.now();
  const { requests, mismatches } = await compareApiDetailed(baseUrl, headUrl, {
    onProgress: (done, total) => {
      if (done % 200 === 0 || done === total) {
        console.error(`compared ${done} of ${total} URLs`);
      }
    },
  });
  for (const line of mismatches) {
    console.log(line);
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`API: ${requests} URLs on each server, ${mismatches.length} mismatches, ${seconds}s`);
  process.exit(mismatches.length === 0 ? 0 : 1);
}
