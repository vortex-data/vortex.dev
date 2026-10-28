// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

/**
 * `Cache-Control` for the read-API 200 responses: Vercel's edge CDN caches the response keyed by
 * the FULL request URL (so each `?n=` window is its own cache entry) for five minutes, matching
 * v2's S3 refresh cadence, and may serve it stale for up to an hour while it revalidates in the
 * background. The site is low-traffic, so the stale window keeps repeat visits on the CDN instead
 * of paying a cold function start. Error responses (400/404/500) deliberately omit this header so
 * they are never CDN-cached.
 *
 * The stale window was a day until the 2026-07-07 historical backfill made its cost visible: the
 * edge cache is URL-keyed and tag-blind, so after a write that CHANGES history (rather than
 * appending the newest commit, where a stale serve is indistinguishable from a fresh one), each
 * URL could keep serving pre-rewrite data for up to a day. One hour bounds that skew at a cost of
 * at most one extra function invocation per URL per hour.
 *
 * This replaces the route-segment `export const revalidate = 300` approach, which cannot express
 * the intended behavior: on handlers that read `request.url` the export is inert (the request-time
 * URL access forces dynamic rendering), and on parameterless handlers it forces a BUILD-time
 * prerender, making `next build` fail without a reachable database.
 */
export const READ_API_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';
