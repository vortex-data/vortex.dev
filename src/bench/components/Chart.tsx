// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ChartController } from '@/components/chart/controller';
import {
  chartAriaLabel,
  chartPriority,
  LAZY_HYDRATION_ROOT_MARGIN,
  throttle,
  ZOOM_THROTTLE_MS,
} from '@/lib/chart-format';
import {
  abortGroupBundle,
  chartIsHiddenAsEmpty,
  emptyGroupSnapshot,
  ensureGroupBundle,
  getGlobalFilterSnapshot,
  getGroupSnapshot,
  subscribeGlobalFilter,
  subscribeGroup,
} from '@/lib/chart-store';
import type { ChartResponse } from '@/lib/queries';

/**
 * The per-chart client island, the React port of the per-card layer of
 * `server/static/chart-init.js`: the card chrome (title, toolbar, tooltip host,
 * canvas, range strip, downsample badge) plus the full interactive behavior.
 *
 * Architecture notes (where the port deviates mechanically from v3; the few
 * DELIBERATE behavioral deviations are documented at their sites, e.g.
 * `applyY`'s pre-construction recording and the permalink page's title row):
 *
 * - v3 planted per-chart state on the canvas node (`canvas.__bench_*`); here
 *   the same fields live in a [`CardState`] owned by a [`ChartController`]
 *   created once per EFFECT MOUNT (torn down in that effect's cleanup, so
 *   React StrictMode's dev replay gets a fresh controller), and the v3 free
 *   functions became its methods. On creation the controller replays the
 *   group store's current state (group Y), since the store outlives mounts.
 * - v3 wired group hydration per group (shard fetches); v4 has no shard route,
 *   so each island lazily fetches its own `/api/chart/{slug}?n=100` through the
 *   shared bounded [`hydrationQueue`] on group open (or pointer intent). The
 *   one-shot `?n=all` upgrade through [`fullHistoryQueue`] is opt-in: it runs
 *   only on per-chart intent (window-chip click, hover dwell, or pan/zoom into
 *   the unloaded region), never as an automatic group-open warmup.
 * - High-frequency mutations (slider value, badge text, range-strip geometry,
 *   tooltip markup, `dataset.data` rebuilds) stay imperative on refs, exactly
 *   as v3 mutated the DOM; React state is reserved for low-frequency bits (the
 *   Y-button highlight, the loading/error indicators, the canvas label).
 * - Group open/close stays native `<details>` behavior. On the landing page the
 *   island exists only while its group is open: [`GroupBody`] mounts the cards
 *   on the disclosure's `toggle` event (fired for user clicks and for scripted
 *   `open` writes such as Expand All), and at hydration, from a layout effect,
 *   for a group that is already open (the pre-paint script opened it, or the
 *   reader did before hydration). It unmounts them on close, so teardown
 *   runs through the mount effect's cleanup and `ChartController.destroy()`.
 *   The island's own `toggle` listener only disarms early when a close reaches
 *   it before React unmounts the island.
 */

/** Props for one chart island. */
export interface ChartIslandProps {
  /** The chart's payload slug (`/api/chart/{slug}` and the permalink). */
  slug: string;
  /** Display name rendered as the card title. */
  name: string;
  /** Page-unique chart index (v3's `data-chart-index` contract). */
  index: number;
  /** Enclosing group's slug on the landing page; omit on the permalink page. */
  groupSlug?: string;
  /** Server-fetched payload on the permalink page (skips the initial fetch). */
  initialPayload?: ChartResponse;
}

/**
 * One interactive chart card. Renders the full card chrome (the v3
 * `chart_card` markup) and drives Chart.js through a [`ChartController`].
 */
export function Chart({ slug, name, index, groupSlug, initialPayload }: ChartIslandProps) {
  const cardRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipHostRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const stripWindowRef = useRef<HTMLDivElement>(null);

  const [y, setY] = useState<'linear' | 'log'>('linear');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [constructed, setConstructed] = useState(false);
  // The canvas label's sentence about the latest commit with data (`latestValuesSentence`),
  // which the controller restates whenever the visible series or the data change.
  const [latestValues, setLatestValues] = useState<string | null>(null);

  // The live controller for the CURRENT mount. Created inside the mount effect
  // (not once per component instance) because `destroy()` is one-way and React
  // StrictMode replays every dev effect as mount, cleanup, remount: a latched
  // controller surviving the replay would refuse all fetch/construct work and
  // every chart would stay blank under `next dev`. Handlers and the store
  // subscriptions reach the current controller through this ref and no-op
  // between teardown and the next mount.
  const controllerRef = useRef<ChartController | null>(null);
  // Cancels a pending deferred dismiss-retry (armed by the error effect below).
  const cleanupRetryRef = useRef<(() => void) | null>(null);

  // Re-apply the layered filter whenever the global filter or this group's
  // state changes (chip clicks anywhere on the page).
  const globalFilter = useSyncExternalStore(
    subscribeGlobalFilter,
    getGlobalFilterSnapshot,
    getGlobalFilterSnapshot,
  );
  // The subscribe callback is memoized on `groupSlug`: a fresh identity per
  // render would make React unsubscribe/re-subscribe the group store on every
  // re-render (loading/error/Y state changes).
  const subscribeToGroup = useCallback(
    (cb: () => void) => (groupSlug ? subscribeGroup(groupSlug, cb) : () => {}),
    [groupSlug],
  );
  const groupState = useSyncExternalStore(
    subscribeToGroup,
    () => (groupSlug ? getGroupSnapshot(groupSlug) : emptyGroupSnapshot()),
    () => emptyGroupSnapshot(),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the filter state is the trigger; `applyFilters` reads the stores itself
  useEffect(() => {
    controllerRef.current?.applyFilters();
  }, [globalFilter, groupState.hiddenSeries, groupState.shownSeries]);

  // Broadcast the per-group Y override to non-sticky charts; `null` (the
  // resting default and the post-Reset state) reverts to linear.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!groupSlug || !controller || controller.yIsSticky()) {
      return;
    }
    controller.applyY(groupState.groupY ?? 'linear', false);
  }, [groupSlug, groupState.groupY]);

  // A chart with no data in the latest-100 window hides by default (the card
  // gets the `hidden` attribute below); the group toolbar's "show empty
  // charts" toggle reveals it.
  const hiddenAsEmpty = groupSlug !== undefined && chartIsHiddenAsEmpty(groupState, slug);
  useEffect(() => {
    // Construct on reveal: `maybeConstruct` bails while the card is hidden as
    // empty (a display:none canvas would build a zero-size chart), so re-enter
    // once React has committed the un-hidden DOM. No-op when no payload is
    // waiting or the chart already exists.
    if (!hiddenAsEmpty) {
      void controllerRef.current?.maybeConstruct();
    }
  }, [hiddenAsEmpty]);

  // Mount wiring: controller construction, payload seeding, the throttled
  // slider listener, group toggle/intent listeners, and (on the permalink
  // page) intersection-based construction.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the island's identity props never change after mount
  useEffect(() => {
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const controller = new ChartController(
      slug,
      groupSlug,
      () => ({
        card: cardRef.current,
        canvas: canvasRef.current,
        tooltipHost: tooltipHostRef.current,
        slider: sliderRef.current,
        badge: badgeRef.current,
        chip: chipRef.current,
        strip: stripRef.current,
        stripWindow: stripWindowRef.current,
      }),
      { setY, setLoading, setError, setRetryable, setConstructed, setLatestValues },
    );
    controllerRef.current = controller;
    if (initialPayload) {
      controller.seedPayload(initialPayload);
    }
    // Replay the group store's current Y override: the store outlives mounts
    // (module scope), the group-Y broadcast effect above may have run while no
    // controller existed, and a remounted island would otherwise construct on
    // the default linear scale despite an active group-level `log` override.
    if (groupSlug) {
      const groupY = getGroupSnapshot(groupSlug).groupY;
      if (groupY !== null) {
        controller.applyY(groupY, false);
      }
    }
    const group = card.closest('.group-details');
    const details = group?.querySelector('details.group-disclosure') as HTMLDetailsElement | null;
    const cleanups: (() => void)[] = [];

    const onCardEnter = (): void => controller.onCardHoverStart();
    const onCardLeave = (): void => controller.onCardHoverEnd();
    card.addEventListener('pointerenter', onCardEnter);
    card.addEventListener('pointerleave', onCardLeave);
    cleanups.push(() => {
      card.removeEventListener('pointerenter', onCardEnter);
      card.removeEventListener('pointerleave', onCardLeave);
    });

    // The scope slider binds a THROTTLED native `input` listener (NOT
    // `change`, which only fires on release) so dragging re-renders
    // continuously.
    const slider = sliderRef.current;
    if (slider) {
      const onInput = throttle(() => {
        controller.applyScope(slider.value);
      }, ZOOM_THROTTLE_MS);
      slider.addEventListener('input', onInput);
      cleanups.push(() => slider.removeEventListener('input', onInput));
    }

    if (details) {
      // Landing page: hydrate each card lazily when it scrolls near the viewport
      // (reusing the permalink page's IntersectionObserver shape), so opening a
      // big group hydrates only the ~visible charts, top-first by visual index,
      // and the rest hydrate on scroll. The island mounts only into an open
      // group (see [`GroupBody`]), so it arms at mount. Closing the group
      // unmounts it: the cleanup below disconnects the observer, `destroy()`
      // aborts its fetches, and GroupBody aborts the bundle. A reopen mounts a
      // fresh island. The `toggle` listener disarms early only if the close
      // reaches it before React unmounts the island.
      // Top cards drain first: priority `0` for the first card, negative `index`
      // for the rest (the queue sorts highest-priority-first). The `index === 0`
      // branch yields `+0` not `-0`; runtime sorting treats them identically, but
      // the visual-order test asserts `Math.max(...).toBe(0)`, and `toBe`'s
      // `Object.is` check distinguishes `-0` from `0`.
      const priority = chartPriority(index);
      // The bundle kick + close abort only run on the landing page, where the
      // island has a group slug; bind a non-null local so the closures below can
      // pass it without re-narrowing.
      const bundleGroupSlug = groupSlug;
      let io: IntersectionObserver | null = null;
      const armHydration = (): void => {
        if (io) {
          // Already armed; do not double-observe.
          return;
        }
        // Start the group's bundle fetch immediately on open so every chart's
        // last-100 data loads eagerly (top-group-first by index priority), even
        // off-screen. Construction stays gated on intersection below. The
        // per-group in-flight dedupe means sibling islands issue only ONE fetch.
        if (bundleGroupSlug !== undefined) {
          void ensureGroupBundle(bundleGroupSlug, priority);
        }
        if (typeof IntersectionObserver === 'undefined') {
          // Graceful degradation for SSR and legacy browsers that lack
          // `IntersectionObserver`: hydrate immediately rather than never.
          controller.onGroupOpen(priority);
          return;
        }
        io = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                io?.disconnect();
                io = null;
                controller.onGroupOpen(priority);
              }
            }
          },
          { rootMargin: LAZY_HYDRATION_ROOT_MARGIN },
        );
        io.observe(card);
      };
      const disarmHydration = (): void => {
        io?.disconnect();
        io = null;
        controller.abortInFlightFetches();
        // Abort the group bundle and drop its in-flight entry so a reopen
        // re-issues a fresh fetch (idempotent; the first island wins, the rest
        // no-op). Mirrors `abortInFlightFetches`'s entry-clearing rationale.
        if (bundleGroupSlug !== undefined) {
          abortGroupBundle(bundleGroupSlug);
        }
      };
      const onToggle = (): void => {
        if (details.open) {
          armHydration();
        } else {
          disarmHydration();
        }
      };
      details.addEventListener('toggle', onToggle);
      cleanups.push(() => details.removeEventListener('toggle', onToggle));
      cleanups.push(() => {
        io?.disconnect();
        io = null;
      });
      if (details.open) {
        armHydration();
      }
    } else {
      // Permalink page: the payload is inlined; construct lazily when the card
      // scrolls near the viewport (v3's IntersectionObserver behavior).
      if (typeof IntersectionObserver === 'undefined') {
        void controller.maybeConstruct();
      } else {
        const io = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                io.disconnect();
                void controller.maybeConstruct();
              }
            }
          },
          { rootMargin: '150px 0px' },
        );
        io.observe(card);
        cleanups.push(() => io.disconnect());
      }
    }

    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
      // Cancel any error-dismiss retry still pending; see the dismiss
      // effect's comment for why the cancel lives here and not there.
      cleanupRetryRef.current?.();
      cleanupRetryRef.current = null;
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      // Re-show the placeholder on the next mount. `constructed` latches true
      // once a chart builds but is never otherwise reset, so a StrictMode dev
      // remount (or any re-mount) would briefly suppress the placeholder until
      // the fresh controller reconstructs.
      setConstructed(false);
      // The canvas label names the chart alone until the next chart has data.
      setLatestValues(null);
    };
  }, []);

  // Auto-dismiss the transient fetch-error indicator, matching v3's 4s timer.
  // The dismiss also retries construction when a payload is waiting and the
  // bounded import budget allows (see `shouldRetryConstruct`), covering charts
  // whose only construction trigger already fired before a transient Chart.js
  // chunk-load failure.
  useEffect(() => {
    // A retryable initial-fetch error owns its own dismissal (the user clicks
    // retry), so the 4s construction-retry auto-dismiss does not apply to it.
    if (error === null || retryable) {
      return;
    }
    const timer = setTimeout(() => {
      setError(null);
      // The retry is deferred one macrotask so the null commit flushes first:
      // an INSTANTLY-rejecting import retry (the module map caches evaluation
      // errors) would otherwise re-set the identical message inside the same
      // React batch, the committed value would never transition, and the
      // dismiss effect would not arm a new timer (stuck toast, dead retry).
      const retry = setTimeout(() => {
        const controller = controllerRef.current;
        if (controller?.shouldRetryConstruct()) {
          void controller.maybeConstruct();
        }
      }, 0);
      cleanupRetryRef.current = () => clearTimeout(retry);
    }, 4000);
    // The cleanup deliberately does NOT cancel the pending retry: this
    // cleanup runs on the error -> null transition (the dismiss itself), and
    // in real browsers React flushes that commit's effects ahead of the 0ms
    // macrotask, so cancelling here would kill every retry the dismiss just
    // armed (act/jsdom test environments invert that ordering and mask it).
    // The retry is cancelled only on unmount, in the mount effect's cleanup;
    // the retry closure is unmount-safe regardless via the `controllerRef`
    // null check and `shouldRetryConstruct`'s disposed check.
    return () => {
      clearTimeout(timer);
    };
  }, [error, retryable]);

  return (
    <section
      className="chart-card"
      data-chart-index={index}
      data-chart-slug={slug}
      hidden={hiddenAsEmpty}
      ref={cardRef}
    >
      <h3 className="chart-card-title">
        <a href={`/chart/${slug}`}>{name}</a>
        <span
          className="chart-badge chart-badge--downsampled"
          data-role="downsample-badge"
          hidden
          ref={badgeRef}
        />
        <button
          type="button"
          className="chart-window-chip"
          data-role="window-chip"
          hidden
          ref={chipRef}
          onClick={() => controllerRef.current?.onWindowChipClick()}
        />
      </h3>
      {/* Without JavaScript nothing draws the chart, so its controls and its
          canvas carry `data-requires-js` and are hidden (globals.css); the
          title link and the page's `<noscript>` note remain. */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: deliberate markup, as bench has always rendered the chart toolbar. */}
      <div className="toolbar toolbar--card" aria-label="Chart controls" data-requires-js>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would change the toolbar's layout. */}
        <div className="toolbar-group" role="group" aria-label="Visible commits">
          <span className="toolbar-label">Show</span>
          {/* `max` and `step` are placeholders; the controller resets them
              after construction so the slider tracks the loaded commit count. */}
          <input
            id={`scope-slider-${index}`}
            className="toolbar-slider"
            type="range"
            min={5}
            max={100}
            step={1}
            defaultValue={100}
            data-role="scope-slider"
            aria-label="Custom commit window"
            ref={sliderRef}
          />
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would change the toolbar's layout. */}
        <div className="toolbar-group" role="group" aria-label="Y-axis scale">
          <span className="toolbar-label">Y</span>
          <button
            className={`toolbar-btn${y === 'linear' ? ' toolbar-btn--active' : ''}`}
            type="button"
            data-y="linear"
            onClick={() => controllerRef.current?.applyY('linear', true)}
          >
            linear
          </button>
          <button
            className={`toolbar-btn${y === 'log' ? ' toolbar-btn--active' : ''}`}
            type="button"
            data-y="log"
            onClick={() => controllerRef.current?.applyY('log', true)}
          >
            log
          </button>
        </div>
      </div>
      <div className="chart-tooltip-host" ref={tooltipHostRef} />
      <div className="chart-wrap" data-requires-js>
        {!constructed && !error && (
          <div className="chart-placeholder" role="status" aria-live="polite">
            <span className="chart-spinner" aria-hidden="true" />
            <span className="chart-placeholder-text">loading…</span>
          </div>
        )}
        {/* An image to assistive technology, named for the chart; once the
            chart has data the name also gives the latest values. */}
        <canvas
          data-chart-index={index}
          role="img"
          aria-label={chartAriaLabel(name, latestValues)}
          ref={canvasRef}
        />
      </div>
      {/* The aria value attributes track the window's left edge as a percent
          of the full history; the strip render keeps aria-valuenow current. */}
      {/* biome-ignore lint/a11y/useFocusableInteractive: the strip is pointer-driven and has no key handling, so a tabIndex would add a dead tab stop. */}
      <div
        className="chart-range-strip"
        data-chart-index={index}
        data-role="range-strip"
        aria-label="Visible commit range"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={100}
        data-requires-js
        ref={stripRef}
      >
        <div className="chart-range-strip-track">
          <div className="chart-range-strip-window" data-role="range-window" ref={stripWindowRef}>
            <span
              className="chart-range-strip-handle chart-range-strip-handle--left"
              data-role="range-handle-left"
              aria-hidden="true"
            />
            <span
              className="chart-range-strip-handle chart-range-strip-handle--right"
              data-role="range-handle-right"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
      {loading && (
        <div className="chart-loading" role="status" aria-live="polite">
          <span className="chart-spinner" aria-hidden="true" />
          <span className="chart-loading-text">loading…</span>
        </div>
      )}
      {error && (
        <div className="chart-error">
          <span>{error}</span>
          {retryable && (
            <button
              type="button"
              className="chart-error-retry"
              data-role="fetch-retry"
              onClick={() => {
                const controller = controllerRef.current;
                if (!controller) {
                  return;
                }
                controller.retryInitialPayload();
              }}
            >
              retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}
