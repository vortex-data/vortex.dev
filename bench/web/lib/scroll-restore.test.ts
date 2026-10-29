// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import {
  applySavedScroll,
  captureScroll,
  type NavigationKind,
  navigationKind,
  planScroll,
  readSavedScroll,
  restoreScroll,
  type SavedScroll,
  saveScroll,
  scrollStorageKey,
} from './scroll-restore';

/** Give `el` a layout: its rect starts at `top` (from the viewport top) and is
 * `height` tall. jsdom lays nothing out, so every other element measures 0. */
function place(el: Element, top: number, height = 420): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 800,
    bottom: top + height,
    width: 800,
    height,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Drain every pending promise chain. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Let pending promise chains run, then wait one animation frame past any
 * frame they requested. */
async function nextFrame(): Promise<void> {
  await flush();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await flush();
}

/** A promise with its resolver, for driving `GroupBodiesReady` by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`no element #${id}`);
  }
  return el;
}

function card(slug: string): string {
  return (
    `<section class="chart-card" id="${slug}" data-chart-slug="${slug}">` +
    `<h3><a href="/chart/${slug}">${slug}</a></h3></section>`
  );
}

describe('scroll restore', () => {
  let header: HTMLElement;
  let c1: HTMLElement;
  let c2: HTMLElement;
  let c3: HTMLElement;
  let ra: HTMLElement;
  let scrollTo: Mock;
  const originalScrollTo = window.scrollTo;
  const saved: SavedScroll = { kind: 'chart', slug: 'c2', offset: 120 };

  beforeEach(() => {
    document.body.innerHTML =
      '<header class="sticky-header"></header>' +
      '<section class="group-details" id="tpc-h" data-group-slug="tpch">' +
      '<details class="group-disclosure" open><summary>TPC-H</summary>' +
      `<div class="chart-grid">${card('c1')}${card('c2')}${card('c3')}</div>` +
      '</details></section>' +
      '<section class="group-details" id="ra" data-group-slug="ra">' +
      '<details class="group-disclosure"><summary>Random Access</summary></details>' +
      '</section>';
    header = document.querySelector('header.sticky-header') as HTMLElement;
    c1 = byId('c1');
    c2 = byId('c2');
    c3 = byId('c3');
    ra = byId('ra');
    place(header, 0, 64);
    // A stub, so `scrollY` stays 0 and every target is the element's rect.
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  describe('captureScroll', () => {
    it('captures the first visible chart card whose bottom clears the header', () => {
      place(c1, -400);
      place(c2, 30);
      place(c3, 30);
      place(ra, 900, 60);
      expect(captureScroll(document)).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });

      c2.hidden = true;
      expect(captureScroll(document)).toEqual({ kind: 'chart', slug: 'c3', offset: 30 });
    });

    it('falls back to the group section when no chart card is in view', () => {
      place(c1, -900);
      place(c2, -900);
      place(c3, -500);
      place(ra, 100);
      expect(captureScroll(document)).toEqual({ kind: 'group', slug: 'ra', offset: 100 });
    });

    it('skips a card below the viewport and measures from the top without a header', () => {
      header.remove();
      place(c1, -430);
      place(c2, window.innerHeight + 5);
      place(byId('tpc-h'), -10.6, 2000);
      expect(captureScroll(document)).toEqual({ kind: 'group', slug: 'tpch', offset: -11 });
    });

    it('captures nothing when no card or group is in view', () => {
      place(ra, -500, 60);
      expect(captureScroll(document)).toBeNull();
    });
  });

  describe('saveScroll and readSavedScroll', () => {
    it('keys the saved position by path and fragment', () => {
      expect(scrollStorageKey({ pathname: '/', hash: '#a,b' })).toBe('bench-scroll:/#a,b');

      window.history.replaceState(null, '', '/?engine=duckdb#tpc-h,ra');
      place(c2, 30);
      saveScroll(window);
      expect(JSON.parse(sessionStorage.getItem('bench-scroll:/#tpc-h,ra') ?? 'null')).toEqual({
        kind: 'chart',
        slug: 'c2',
        offset: 30,
      });
      expect(readSavedScroll(window)).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });

      window.history.replaceState(null, '', '/#tpc-h');
      expect(readSavedScroll(window)).toBeNull();
    });

    it('saves a given position instead of the current one', () => {
      window.history.replaceState(null, '', '/#tpc-h');
      place(c2, 30);
      saveScroll(window, saved);
      expect(readSavedScroll(window)).toEqual(saved);
    });

    it('forgets an earlier position when nothing is in view to save', () => {
      sessionStorage.setItem('bench-scroll:/', JSON.stringify(saved));
      saveScroll(window);
      expect(sessionStorage.getItem('bench-scroll:/')).toBeNull();
    });

    it.each([
      '{',
      'null',
      '[]',
      '{"kind":"chart","slug":"","offset":1}',
      '{"kind":"x","slug":"c","offset":1}',
      '{"kind":"chart","slug":"c","offset":"1"}',
      '{"kind":"chart","slug":"c","offset":1e999}',
      '{"kind":"group","slug":7,"offset":1}',
    ])('ignores a saved value that does not hold a position: %s', (raw) => {
      sessionStorage.setItem('bench-scroll:/', raw);
      expect(readSavedScroll(window)).toBeNull();
    });

    it('reads back only the three fields of a position', () => {
      sessionStorage.setItem(
        'bench-scroll:/',
        '{"kind":"group","slug":"ra","offset":-12,"extra":"<b>"}',
      );
      expect(readSavedScroll(window)).toEqual({ kind: 'group', slug: 'ra', offset: -12 });
    });

    it('saves and reads nothing, without throwing, when storage is blocked', () => {
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      place(c2, 30);
      expect(() => saveScroll(window)).not.toThrow();
      expect(readSavedScroll(window)).toBeNull();
    });

    it('saves nothing, without throwing, when storage is full', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      place(c2, 30);
      expect(() => saveScroll(window)).not.toThrow();
      expect(readSavedScroll(window)).toBeNull();
    });
  });

  describe('applySavedScroll', () => {
    it('puts the element back at its saved offset', () => {
      place(c2, 900);
      expect(applySavedScroll(window, saved)).toBe(true);
      expect(scrollTo).toHaveBeenCalledWith({ top: 780, behavior: 'instant' });
    });

    it('finds a group section by its slug', () => {
      place(ra, 300);
      expect(applySavedScroll(window, { kind: 'group', slug: 'ra', offset: 100 })).toBe(true);
      expect(scrollTo).toHaveBeenCalledWith({ top: 200, behavior: 'instant' });
    });

    it('finds nothing for a hidden card, a missing slug, or a slug that only looks like one', () => {
      c2.hidden = true;
      expect(applySavedScroll(window, saved)).toBe(false);
      expect(applySavedScroll(window, { kind: 'chart', slug: 'gone', offset: 0 })).toBe(false);
      expect(applySavedScroll(window, { kind: 'chart', slug: 'c"]', offset: 0 })).toBe(false);
      expect(applySavedScroll(window, { kind: 'group', slug: 'c1', offset: 0 })).toBe(false);
      expect(scrollTo).not.toHaveBeenCalled();
    });
  });

  describe('navigationKind', () => {
    it.each([
      ['reload', 'reload'],
      ['back_forward', 'back_forward'],
      ['navigate', 'navigate'],
      ['prerender', 'navigate'],
    ])('reads a %s navigation as %s', (type, kind) => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { type, name: 'https://bench.vortex.dev/' } as unknown as PerformanceEntry,
      ]);
      expect(navigationKind(window)).toBe(kind);
    });

    it('reads a missing navigation entry as navigate', () => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
      expect(navigationKind(window)).toBe('navigate');
    });

    it.each([
      ['another path', 'https://bench.vortex.dev/chart/c'],
      ['no address', undefined],
      ['an address that does not parse', 'http://['],
    ])('reads a reload of %s as navigate: a client navigation into this page', (_, name) => {
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { type: 'reload', name } as unknown as PerformanceEntry,
      ]);
      expect(navigationKind(window)).toBe('navigate');
    });

    it('compares only the path, not the query or the fragment', () => {
      window.history.replaceState(null, '', '/?engine=duckdb#tpc-h');
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        {
          type: 'back_forward',
          name: 'https://bench.vortex.dev/#ra',
        } as unknown as PerformanceEntry,
      ]);
      expect(navigationKind(window)).toBe('back_forward');
    });
  });

  describe('planScroll', () => {
    it.each([
      ['reload', saved, false, 'restore'],
      ['back_forward', saved, true, 'restore'],
      ['back_forward', null, true, 'fragment'],
      ['reload', null, false, 'none'],
      ['navigate', saved, true, 'fragment'],
      ['navigate', null, false, 'none'],
    ] as const)('plans %s (saved %o, fragment %s) as %s', (nav, s, fragment, kind) => {
      expect(planScroll(nav as NavigationKind, s, fragment).kind).toBe(kind);
    });

    it('carries the saved position into a restore plan', () => {
      expect(planScroll('reload', saved, true)).toEqual({ kind: 'restore', saved });
    });
  });

  describe('restoreScroll', () => {
    it('restores after the bodies mount and again after their bundles settle', async () => {
      const mounted = deferred();
      const settled = deferred();
      place(c2, 900);
      restoreScroll(window, saved, { mounted: mounted.promise, settled: settled.promise }, vi.fn());
      await flush();
      expect(scrollTo).not.toHaveBeenCalled();

      mounted.resolve();
      await flush();
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 780, behavior: 'instant' });

      place(c2, 500);
      settled.resolve();
      await nextFrame();
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 380, behavior: 'instant' });
    });

    it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])(
      'stops restoring once the user acts (%s)',
      async (type) => {
        const mounted = deferred();
        const settled = deferred();
        place(c2, 900);
        restoreScroll(
          window,
          saved,
          { mounted: mounted.promise, settled: settled.promise },
          vi.fn(),
        );
        mounted.resolve();
        await flush();
        expect(scrollTo).toHaveBeenCalledTimes(1);

        window.dispatchEvent(new Event(type));
        settled.resolve();
        await nextFrame();
        expect(scrollTo).toHaveBeenCalledTimes(1);
      },
    );

    it('does not stop for a scroll event, which its own scrollTo fires', async () => {
      const mounted = deferred();
      const settled = deferred();
      place(c2, 900);
      restoreScroll(window, saved, { mounted: mounted.promise, settled: settled.promise }, vi.fn());
      mounted.resolve();
      await flush();
      window.dispatchEvent(new Event('scroll'));
      settled.resolve();
      await nextFrame();
      expect(scrollTo).toHaveBeenCalledTimes(2);
    });

    it('falls back to the fragment scroll when the saved element is gone', async () => {
      const settled = deferred();
      const fallback = vi.fn();
      restoreScroll(
        window,
        { ...saved, slug: 'gone' },
        { mounted: Promise.resolve(), settled: settled.promise },
        fallback,
      );
      await flush();
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();

      settled.resolve();
      await nextFrame();
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('does nothing once cancelled', async () => {
      const mounted = deferred();
      const settled = deferred();
      const fallback = vi.fn();
      place(c2, 900);
      const cancel = restoreScroll(
        window,
        saved,
        { mounted: mounted.promise, settled: settled.promise },
        fallback,
      );
      cancel();
      mounted.resolve();
      settled.resolve();
      await nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    });

    it('ends its pending position once the first pass applies', async () => {
      const mounted = deferred();
      const onPendingEnd = vi.fn();
      place(c2, 900);
      restoreScroll(
        window,
        saved,
        { mounted: mounted.promise, settled: new Promise(() => {}) },
        vi.fn(),
        onPendingEnd,
      );
      await flush();
      expect(onPendingEnd).not.toHaveBeenCalled();

      mounted.resolve();
      await flush();
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(onPendingEnd).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['the user acts', () => window.dispatchEvent(new Event('wheel'))],
      ['it is cancelled', (cancel: () => void) => cancel()],
    ])('ends its pending position, once, when %s before the first pass', async (_, stop) => {
      const mounted = deferred();
      const onPendingEnd = vi.fn();
      place(c2, 900);
      const cancel = restoreScroll(
        window,
        saved,
        { mounted: mounted.promise, settled: Promise.resolve() },
        vi.fn(),
        onPendingEnd,
      );
      stop(cancel);
      expect(onPendingEnd).toHaveBeenCalledTimes(1);

      cancel();
      mounted.resolve();
      await nextFrame();
      expect(onPendingEnd).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('ends its pending position before it falls back', async () => {
      const calls: string[] = [];
      restoreScroll(
        window,
        { ...saved, slug: 'gone' },
        { mounted: Promise.resolve(), settled: Promise.resolve() },
        () => calls.push('fallback'),
        () => calls.push('pending end'),
      );
      await nextFrame();
      expect(calls).toEqual(['pending end', 'fallback']);
    });

    it('removes its listeners once it is done', async () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      place(c2, 900);
      restoreScroll(
        window,
        saved,
        { mounted: Promise.resolve(), settled: Promise.resolve() },
        vi.fn(),
      );
      expect(add.mock.calls.map(([type]) => type).sort()).toEqual([
        'keydown',
        'pointerdown',
        'touchstart',
        'wheel',
      ]);
      await nextFrame();
      expect(scrollTo).toHaveBeenCalledTimes(2);
      expect(remove.mock.calls.map(([type, , options]) => [type, options])).toEqual(
        add.mock.calls.map(([type, , options]) => [type, options]),
      );
    });
  });
});
