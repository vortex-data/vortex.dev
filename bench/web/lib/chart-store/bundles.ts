// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { chartHasRecentData, FETCH_TIMEOUT_MS } from '@/lib/chart-format';
import type { ChartResponse, GroupChartsResponse } from '@/lib/queries';

import { noteChartRecentData, noteGroupSeries } from './group-store';
import { bundleQueue, type QueueEntry } from './queues';

// ---------------------------------------------------------------------------
// Group-bundle fetch + session payload cache (PR-5.0.97).
// ---------------------------------------------------------------------------

// Session-lifetime cache of the default last-100 chart payloads, keyed by chart
// slug and filled by `ensureGroupBundle`. Closing and reopening a group reads
// from here, so it never refetches. An open tab keeps these until reload; a
// server-side revalidation is picked up on the next full load (a data-version
// invalidation is future work, not built here).
const payloadCache = new Map<string, ChartResponse>();

/** The cached default payload for `slug`, or `undefined` on a miss. */
export function getCachedPayload(slug: string): ChartResponse | undefined {
  return payloadCache.get(slug);
}

/** Seed the cache for one chart slug (idempotent; last write wins). Internal to
 * the store; `ensureGroupBundle` is its only caller. */
function primePayload(slug: string, payload: ChartResponse): void {
  payloadCache.set(slug, payload);
}

/** Only unavailable bundles and successful bundles missing a chart permit a
 * per-chart fallback. Failures require an explicit shared retry. */
export type BundleResult =
  | { status: 'success' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: unknown }
  | { status: 'aborted' };

// Successes persist for the session. Other settled outcomes persist until the
// group closes or the user retries, so later cards do not retry passively.
const settledBundles = new Map<string, BundleResult>();
const bundleRetryListeners = new Map<string, Set<() => void>>();

/** Subscribe a chart to user-initiated retries of its group bundle. */
export function subscribeGroupBundleRetry(groupSlug: string, cb: () => void): () => void {
  let listeners = bundleRetryListeners.get(groupSlug);
  if (!listeners) {
    listeners = new Set();
    bundleRetryListeners.set(groupSlug, listeners);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      bundleRetryListeners.delete(groupSlug);
    }
  };
}

/** Retry one failed bundle. Waiting cards join the first subscriber's request. */
export function retryGroupBundle(groupSlug: string): boolean {
  if (settledBundles.get(groupSlug)?.status !== 'failed') {
    return false;
  }
  settledBundles.delete(groupSlug);
  for (const cb of bundleRetryListeners.get(groupSlug) ?? []) {
    cb();
  }
  return true;
}

/** Clear the cache and in-flight bundle map. TEST-ONLY: production never evicts
 * within a tab session. */
export function resetPayloadCache(): void {
  payloadCache.clear();
  inFlightBundles.clear();
  settledBundles.clear();
}

/** A group's in-flight bundle fetch: the queue entry (for priority bumps), its
 * aborter (for group-close cancellation), and the settle promise callers join. */
interface BundleInFlight {
  entry: QueueEntry;
  controller: AbortController;
  promise: Promise<BundleResult>;
}

const inFlightBundles = new Map<string, BundleInFlight>();

/**
 * Fetch one group's default last-100 bundle (`/api/group/{slug}?n=100`) and
 * prime [`payloadCache`] for every chart in it. Concurrent callers for the same
 * group share one in-flight fetch (priority is bumped to the highest caller's).
 * A 404 permits per-chart fallback. Other failures remain shared until an
 * explicit retry or group reopen. Close cancellation stays silent.
 */
export function ensureGroupBundle(groupSlug: string, priority: number): Promise<BundleResult> {
  const settled = settledBundles.get(groupSlug);
  if (settled) {
    return Promise.resolve(settled);
  }
  const existing = inFlightBundles.get(groupSlug);
  if (existing) {
    if (priority > existing.entry.priority) {
      existing.entry.priority = priority;
      bundleQueue.drain();
    }
    return existing.promise;
  }
  const url = `/api/group/${encodeURIComponent(groupSlug)}?n=100`;
  const controller = new AbortController();
  const entry = bundleQueue.schedule(async () => {
    controller.signal.throwIfAborted();
    // The timeout starts when the task actually runs (not while queued), so it
    // bounds the fetch, not the queue wait. A `TimeoutError` reason lets the
    // catch tell a timeout apart from a close/destroy `AbortError`.
    const timer = setTimeout(
      () => controller.abort(new DOMException('Fetch timed out', 'TimeoutError')),
      FETCH_TIMEOUT_MS,
    );
    try {
      const r = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (r.status === 404) {
        return null;
      }
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      const body = (await r.json()) as GroupChartsResponse | null;
      if (body === null) {
        throw new Error('invalid group bundle');
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }, priority);
  const promise: Promise<BundleResult> = entry.promise
    .then((body): BundleResult => {
      if (inFlightBundles.get(groupSlug)?.entry !== entry) {
        return { status: 'aborted' };
      }
      controller.signal.throwIfAborted();
      if (body !== null) {
        const bundle = body as GroupChartsResponse;
        for (const chart of bundle.charts) {
          // `NamedChartResponse` is `ChartResponse & { name, slug }`; the extra
          // keys are harmless in the cached payload.
          primePayload(chart.slug, chart);
          noteGroupSeries(groupSlug, chart.series_meta);
          // The bundle IS the group's latest-100 window, so classify every
          // chart's empty-window state here — including cards that never
          // intersect the viewport (their islands never seed a payload).
          noteChartRecentData(groupSlug, chart.slug, chartHasRecentData(chart));
        }
        return { status: 'success' };
      }
      return { status: 'unavailable' };
    })
    .catch((err: unknown): BundleResult => {
      if (
        inFlightBundles.get(groupSlug)?.entry !== entry ||
        (controller.signal.aborted && controller.signal.reason?.name === 'AbortError')
      ) {
        return { status: 'aborted' };
      }
      return {
        status: 'failed',
        error: controller.signal.aborted ? controller.signal.reason : err,
      };
    })
    .then((result): BundleResult => {
      if (inFlightBundles.get(groupSlug)?.entry !== entry) {
        return { status: 'aborted' };
      }
      inFlightBundles.delete(groupSlug);
      settledBundles.set(groupSlug, result);
      return result;
    });
  inFlightBundles.set(groupSlug, { entry, controller, promise });
  return promise;
}

/** Abort a group's in-flight bundle fetch (on group close) and reset its
 * per-cycle state so a reopen re-issues. Idempotent. A successfully completed
 * bundle's cache stays valid, so a reopen of a fully cached group issues nothing. */
export function abortGroupBundle(groupSlug: string): void {
  const inFlight = inFlightBundles.get(groupSlug);
  if (inFlight) {
    inFlight.controller.abort(new DOMException('group closed', 'AbortError'));
    inFlightBundles.delete(groupSlug);
  }
  if (settledBundles.get(groupSlug)?.status !== 'success') {
    settledBundles.delete(groupSlug);
  }
}
