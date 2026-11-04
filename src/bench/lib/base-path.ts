// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * Where bench's pages and APIs live in the URL space.
 *
 * bench is the app's routes under `/bench` (`src/app/(bench)/bench`). Its own
 * host, `bench.vortex.dev`, serves them from the root: `next.config.mjs`
 * rewrites that host's paths onto `/bench`, so bench's public URLs are the
 * same as when it was an app of its own. On every other host (a preview, the
 * deployment's own URL, local dev) bench is at `/bench`.
 *
 * So every root-relative link or fetch bench makes goes through [`benchPath`]
 * with the base for the host the page was served on. The root layout reads it
 * from the request's `Host` header ([`benchBaseForHost`]) and hands it to the
 * client components (`components/BenchBase.tsx`). A path from the request
 * itself (`location.pathname`) already carries the base.
 */

/** The host that serves bench from the root. */
const BENCH_HOST = 'bench.vortex.dev';

/** The path bench's routes live under on every other host. */
const BENCH_PREFIX = '/bench';

/** The prefix of bench's paths: none on its own host, `/bench` elsewhere. */
export type BenchBase = '' | typeof BENCH_PREFIX;

/**
 * The base for a request's `Host` header (or `location.host`), port and case
 * aside. A missing host gets the prefixed form, which works on every host.
 */
export function benchBaseForHost(host: string | null | undefined): BenchBase {
  const hostname = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '');
  return hostname === BENCH_HOST ? '' : BENCH_PREFIX;
}

/**
 * A root-relative bench path (`/`, `/chart/{slug}`, `/api/…`, `/#anchor`) as
 * it is addressed under `base`. The landing page is the base itself: `/bench`,
 * not `/bench/`, which would redirect.
 */
export function benchPath(base: BenchBase, path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`benchPath takes a root-relative path, not ${JSON.stringify(path)}`);
  }
  if (base === '') {
    return path;
  }
  // `/`, `/?query` and `/#fragment` are the landing page.
  if (path === '/' || path.startsWith('/?') || path.startsWith('/#')) {
    return `${base}${path.slice(1)}`;
  }
  return `${base}${path}`;
}
