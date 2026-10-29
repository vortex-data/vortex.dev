// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { LandingState } from '@/components/LandingState';
import { noteGroupBodyOpen, resetGroupBodies } from '@/lib/group-bodies';
import {
  OPEN_FRAGMENT_SYNC_DELAY_MS,
  resetOpenFragmentSync,
  setAllGroupsOpen,
} from '@/lib/open-groups';
import type { NavigationKind, SavedScroll } from '@/lib/scroll-restore';

// Three groups in page order, as the landing page renders them.
const GROUPS = [
  { anchor: 'tpc-h-nvme-sf-1', slug: 'qm.tpch' },
  { anchor: 'random-access', slug: 'random_access.eyJ' },
  { anchor: 'clickbench', slug: 'qm.click' },
];

// The first group's anchor: the fragment of a page with only it open, and the
// key its saved position lives under.
const FIRST = 'tpc-h-nvme-sf-1';
const FIRST_KEY = `bench-scroll:/#${FIRST}`;
const SAVED: SavedScroll = { kind: 'chart', slug: 'c2', offset: 120 };

/** Let jsdom's queued `toggle` and `hashchange` tasks, and the promise chains
 * after them, run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Run everything pending, then one animation frame past it, so a restore's
 * second pass has had its chance. */
async function nextFrame(): Promise<void> {
  await flush();
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await flush();
}

/** Report this document's navigation as `type`, as the timing entry does,
 * loaded at `name` (the landing page unless a test says otherwise). */
function navigation(type: NavigationKind, name = 'https://bench.vortex.dev/'): void {
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
    { type, name } as unknown as PerformanceEntry,
  ]);
}

function savedAt(key: string): unknown {
  return JSON.parse(sessionStorage.getItem(key) ?? 'null');
}

/** Give `el` a layout: its rect starts `top` px below the viewport top. */
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

function chartCard(slug: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-chart-slug="${slug}"]`);
  if (!el) {
    throw new Error(`no card ${slug}`);
  }
  return el;
}

function disclosure(anchor: string): HTMLDetailsElement {
  const details = document
    .getElementById(anchor)
    ?.querySelector<HTMLDetailsElement>('details.group-disclosure');
  if (!details) {
    throw new Error(`no disclosure for ${anchor}`);
  }
  return details;
}

function openStates(): boolean[] {
  return GROUPS.map(({ anchor }) => disclosure(anchor).open);
}

describe('LandingState', () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let scrollSpy: Mock;
  let scrollTo: Mock;
  let onError: Mock;
  const originalScrollTo = window.scrollTo;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetGroupBodies();
    resetOpenFragmentSync(window);
    sessionStorage.clear();
    window.history.scrollRestoration = 'auto';
    // A fresh visit, unless a test says otherwise.
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([]);
    // jsdom does not implement scrollIntoView; stub it so the call is observable.
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    // A stub, so `scrollY` stays 0 and the restore's target is the card's rect.
    scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    onError = vi.fn();
    window.addEventListener('error', onError);
    // Each group as the landing page renders it; the first has one chart card,
    // as its body mounts it once open.
    document.body.innerHTML =
      '<div id="group-nav-panel"></div>' +
      GROUPS.map(
        ({ anchor, slug }, i) =>
          `<section class="group-details" id="${anchor}" data-group-slug="${slug}">` +
          `<details class="group-disclosure"><summary>${anchor}</summary>` +
          (i === 0
            ? '<div class="group-body"><section class="chart-card" data-chart-slug="c2">' +
              '<h3 class="chart-card-title"><a href="/chart/c2">q2</a></h3></section></div>'
            : '') +
          '</details></section>',
      ).join('');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    resetOpenFragmentSync(window);
    window.removeEventListener('error', onError);
    vi.restoreAllMocks();
    window.scrollTo = originalScrollTo;
    sessionStorage.clear();
    window.history.scrollRestoration = 'auto';
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  async function mount(url: string): Promise<void> {
    window.history.replaceState(null, '', url);
    root = createRoot(container);
    await act(async () => {
      root?.render(<LandingState />);
    });
  }

  it('on a fresh visit, opens every listed group and scrolls to the first listed once the bodies mount', async () => {
    await mount('/#clickbench,tpc-h-nvme-sf-1');
    expect(openStates()).toEqual([true, false, true]);
    await flush();
    expect(scrollSpy).not.toHaveBeenCalled();

    noteGroupBodyOpen('qm.click', Promise.resolve());
    await flush();
    expect(scrollSpy).not.toHaveBeenCalled();

    noteGroupBodyOpen('qm.tpch', Promise.resolve());
    await flush();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('clickbench'));
  });

  it('opens and scrolls to an old single-anchor permalink', async () => {
    await mount('/#random-access');
    expect(openStates()).toEqual([false, true, false]);

    noteGroupBodyOpen('random_access.eyJ', Promise.resolve());
    await flush();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('random-access'));
  });

  it('ignores a malformed fragment', async () => {
    await mount('/#%E0%A4%A');
    await flush();
    expect(openStates()).toEqual([false, false, false]);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('opens and scrolls to the group a later hashchange names', async () => {
    await mount('/');
    await flush();
    expect(openStates()).toEqual([false, false, false]);

    window.location.hash = 'clickbench';
    await flush();
    expect(openStates()).toEqual([false, false, true]);
    expect(scrollSpy).not.toHaveBeenCalled();

    noteGroupBodyOpen('qm.click', Promise.resolve());
    await flush();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('clickbench'));
  });

  // Fragment writes are coalesced (`scheduleOpenFragmentSync`): a toggle after
  // a quiet spell writes at once, and the rest of a burst writes once it stops.
  // A fake `setTimeout` and `Date` run that delay. jsdom queues `toggle` and
  // `hashchange` with `setImmediate`, which stays real.
  describe('fragment writes', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Let jsdom's queued `toggle` and `hashchange` tasks, and the promise
     * chains after them, run. */
    async function tasks(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
      });
    }

    /** Open or close one group the way a summary click does, and let its
     * `toggle` event run. */
    async function toggle(anchor: string, open: boolean): Promise<void> {
      disclosure(anchor).open = open;
      await tasks();
    }

    /** Let the delay pass: a pending write runs, and the page is quiet again. */
    function afterDelay(): void {
      act(() => {
        vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      });
    }

    /** Open `FIRST` (written at once) and then `clickbench` (left pending). */
    async function leavePending(): Promise<void> {
      await toggle(FIRST, true);
      await toggle('clickbench', true);
      expect(window.location.hash).toBe(`#${FIRST}`);
    }

    it('writes the open groups into the fragment, in page order, on every isolated toggle', async () => {
      await mount('/?engine=duckdb');

      await toggle('clickbench', true);
      expect(window.location.href.endsWith('/?engine=duckdb#clickbench')).toBe(true);
      afterDelay();
      await toggle('tpc-h-nvme-sf-1', true);
      expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,clickbench');
      afterDelay();
      await toggle('clickbench', false);
      expect(window.location.hash).toBe('#tpc-h-nvme-sf-1');
      afterDelay();
      await toggle('tpc-h-nvme-sf-1', false);
      expect(window.location.href.endsWith('/?engine=duckdb')).toBe(true);
      expect(window.location.href).not.toContain('#');
    });

    it('coalesces rapid toggles into two writes: as they start and once they stop', async () => {
      await mount('/');
      const replace = vi.spyOn(window.history, 'replaceState');

      // 123 toggles, 50 ms apart, as a visitor holding Enter makes; each group
      // is toggled an odd number of times, so ends open.
      for (let i = 0; i < 123; i++) {
        const { anchor } = GROUPS[i % 3]!;
        await toggle(anchor, !disclosure(anchor).open);
        act(() => {
          vi.advanceTimersByTime(50);
        });
      }
      expect(replace).toHaveBeenCalledTimes(1);

      afterDelay();
      expect(replace).toHaveBeenCalledTimes(2);
      expect(window.location.hash).toBe(`#${GROUPS.map(({ anchor }) => anchor).join(',')}`);
      expect(openStates()).toEqual([true, true, true]);
    });

    it('writes the fragment once per Expand All and Collapse All', async () => {
      await mount('/?engine=duckdb');
      const replace = vi.spyOn(window.history, 'replaceState');

      setAllGroupsOpen(window, true);
      expect(replace).toHaveBeenCalledTimes(1);
      await tasks();
      afterDelay();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,random-access,clickbench');

      setAllGroupsOpen(window, false);
      await tasks();
      afterDelay();
      expect(replace).toHaveBeenCalledTimes(2);
      expect(window.location.href).not.toContain('#');
      expect(window.location.search).toBe('?engine=duckdb');
    });

    it('keeps opening groups when the browser refuses a URL write', async () => {
      await mount('/');
      const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
        throw new DOMException('limit', 'SecurityError');
      });

      expect(() => setAllGroupsOpen(window, true)).not.toThrow();
      await tasks();
      afterDelay();
      expect(replace).toHaveBeenCalled();
      expect(openStates()).toEqual([true, true, true]);
      expect(onError).not.toHaveBeenCalled();
    });

    it('on pagehide, saves under the URL a reload loads, then writes a pending set and saves under it too', async () => {
      await mount('/');
      await leavePending();
      place(chartCard('c2'), 30);
      const replace = vi.spyOn(window.history, 'replaceState');

      window.dispatchEvent(new Event('pagehide'));
      // A reload loads the URL as it was when the reload began.
      expect(savedAt(FIRST_KEY)).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });
      // A traversal away keeps the write, and comes back to it.
      expect(window.location.hash).toBe(`#${FIRST},clickbench`);
      expect(savedAt(`bench-scroll:/#${FIRST},clickbench`)).toEqual({
        kind: 'chart',
        slug: 'c2',
        offset: 30,
      });

      afterDelay();
      expect(replace).toHaveBeenCalledTimes(1);
    });

    it('on pagehide with nothing pending, saves under the current URL only', async () => {
      await mount('/');
      await toggle(FIRST, true);
      place(chartCard('c2'), 30);

      window.dispatchEvent(new Event('pagehide'));
      expect(savedAt(FIRST_KEY)).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });
      expect(sessionStorage.length).toBe(1);
    });

    it('writes a pending set before saving when a chart link is followed', async () => {
      await mount('/');
      await leavePending();
      place(chartCard('c2'), 30);

      // jsdom cannot navigate; stop the link after the page's own listener.
      const stop = (event: Event): void => event.preventDefault();
      document.addEventListener('click', stop);
      chartCard('c2').querySelector('a')?.click();
      document.removeEventListener('click', stop);
      expect(window.location.hash).toBe(`#${FIRST},clickbench`);
      expect(savedAt(`bench-scroll:/#${FIRST},clickbench`)).toEqual({
        kind: 'chart',
        slug: 'c2',
        offset: 30,
      });
    });

    it('reads a typed fragment before a pending write can overwrite it', async () => {
      await mount('/');
      await leavePending();

      // The visitor types a fragment; the pending write comes due before the
      // browser runs the `hashchange` task.
      window.location.hash = 'random-access';
      afterDelay();
      expect(window.location.hash).toBe('#random-access');

      await tasks();
      expect(openStates()).toEqual([true, true, true]);
      expect(window.location.hash).toBe(`#${FIRST},random-access,clickbench`);
    });

    it('writes the whole open set once after a hashchange that follows pending toggles', async () => {
      await mount('/');
      await leavePending();
      const replace = vi.spyOn(window.history, 'replaceState');

      window.location.hash = 'random-access';
      await tasks();
      expect(openStates()).toEqual([true, true, true]);
      expect(window.location.hash).toBe(`#${FIRST},random-access,clickbench`);

      afterDelay();
      expect(replace).toHaveBeenCalledTimes(1);
      expect(window.location.hash).toBe(`#${FIRST},random-access,clickbench`);
    });

    it('rewrites the fragment to the open set after a hashchange that toggles nothing', async () => {
      await mount('/');
      await toggle(FIRST, true);
      afterDelay();
      await toggle('clickbench', true);
      expect(window.location.hash).toBe(`#${FIRST},clickbench`);

      // Already open: no toggle fires, so only the hashchange can fix the URL.
      window.location.hash = 'clickbench';
      await tasks();
      expect(window.location.hash).toBe(`#${FIRST},clickbench`);

      window.location.hash = 'unknown';
      await tasks();
      expect(window.location.hash).toBe(`#${FIRST},clickbench`);
      expect(openStates()).toEqual([true, false, true]);
    });

    it('drops a pending write and stops listening once unmounted', async () => {
      await mount('/');
      await leavePending();
      await act(async () => {
        root?.unmount();
      });
      root = null;
      const replace = vi.spyOn(window.history, 'replaceState');

      afterDelay();
      await toggle('random-access', true);
      afterDelay();
      window.location.hash = 'clickbench';
      await tasks();
      afterDelay();
      expect(replace).not.toHaveBeenCalled();

      place(chartCard('c2'), 30);
      window.dispatchEvent(new Event('pagehide'));
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe('scroll restoration', () => {
    it('switches the page to manual scroll restoration and restores the old mode on unmount', async () => {
      await mount('/');
      expect(window.history.scrollRestoration).toBe('manual');

      await act(async () => {
        root?.unmount();
      });
      root = null;
      expect(window.history.scrollRestoration).toBe('auto');
    });

    it('saves the reading position on pagehide and when a chart link is followed', async () => {
      await mount(`/#${FIRST}`);
      await flush();
      place(chartCard('c2'), 30);

      window.dispatchEvent(new Event('pagehide'));
      expect(JSON.parse(sessionStorage.getItem(FIRST_KEY) ?? 'null')).toEqual({
        kind: 'chart',
        slug: 'c2',
        offset: 30,
      });

      sessionStorage.clear();
      // jsdom cannot navigate; stop the link after the page's own listener.
      const stop = (event: Event): void => event.preventDefault();
      document.addEventListener('click', stop);
      chartCard('c2').querySelector('a')?.click();
      document.removeEventListener('click', stop);
      expect(JSON.parse(sessionStorage.getItem(FIRST_KEY) ?? 'null')).toEqual({
        kind: 'chart',
        slug: 'c2',
        offset: 30,
      });
    });

    it('saves nothing when a click is not on a chart link', async () => {
      await mount(`/#${FIRST}`);
      await flush();
      place(chartCard('c2'), 30);

      disclosure(FIRST).querySelector('summary')?.click();
      expect(sessionStorage.length).toBe(0);
    });

    it.each(['reload', 'back_forward'] as const)(
      'on %s, restores the saved element instead of scrolling to the fragment',
      async (type) => {
        navigation(type);
        sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
        place(chartCard('c2'), 900);
        await mount(`/#${FIRST}`);
        await flush();
        expect(scrollTo).not.toHaveBeenCalled();

        noteGroupBodyOpen('qm.tpch', Promise.resolve());
        await nextFrame();
        expect(scrollTo).toHaveBeenCalledWith({ top: 780, behavior: 'instant' });
        expect(scrollSpy).not.toHaveBeenCalled();
      },
    );

    it('on a fresh visit, scrolls to the fragment and ignores a saved position', async () => {
      navigation('navigate');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById(FIRST));
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('on a client navigation from a reloaded chart page, acts as a fresh visit', async () => {
      // The chart page's logo link renders `/` in the chart page's document,
      // whose navigation entry says `reload`, at the chart's path.
      navigation('reload', 'https://bench.vortex.dev/chart/c2');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('keeps the saved position when the page is left before the restore applies', async () => {
      navigation('reload');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);
      await flush();

      // The bodies have not mounted, so the page still shows the top.
      window.dispatchEvent(new Event('pagehide'));
      expect(savedAt(FIRST_KEY)).toEqual(SAVED);

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollTo).toHaveBeenCalledWith({ top: 780, behavior: 'instant' });
      // Applied: from now on the page saves what it shows. (`scrollTo` is a
      // stub, so move the card where the scroll would have put it.)
      place(chartCard('c2'), 100);
      window.dispatchEvent(new Event('pagehide'));
      expect(savedAt(FIRST_KEY)).toEqual({ kind: 'chart', slug: 'c2', offset: 100 });
    });

    it('saves where the user scrolled once they take over from a pending restore', async () => {
      navigation('back_forward');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);
      await flush();

      window.dispatchEvent(new Event('wheel'));
      place(chartCard('c2'), 40);
      window.dispatchEvent(new Event('pagehide'));
      expect(savedAt(FIRST_KEY)).toEqual({ kind: 'chart', slug: 'c2', offset: 40 });
    });

    it('on reload, falls back to the fragment scroll when the saved element is gone', async () => {
      navigation('reload');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify({ ...SAVED, slug: 'gone' }));
      await mount(`/#${FIRST}`);

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById(FIRST));
      expect(scrollTo).not.toHaveBeenCalled();
    });

    it('falls back to the fragment scroll on Back when storage is blocked', async () => {
      navigation('back_forward');
      vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
      await mount(`/#${FIRST}`);

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollTo).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      expect(onError).not.toHaveBeenCalled();
    });

    it('lets a later hashchange take over from a pending restore', async () => {
      navigation('reload');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);

      window.location.hash = 'clickbench';
      await flush();
      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      noteGroupBodyOpen('qm.click', Promise.resolve());
      await nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('clickbench'));
    });

    it('stops a pending restore once unmounted', async () => {
      navigation('reload');
      sessionStorage.setItem(FIRST_KEY, JSON.stringify(SAVED));
      place(chartCard('c2'), 900);
      await mount(`/#${FIRST}`);
      await act(async () => {
        root?.unmount();
      });
      root = null;

      noteGroupBodyOpen('qm.tpch', Promise.resolve());
      await nextFrame();
      expect(scrollTo).not.toHaveBeenCalled();
      expect(scrollSpy).not.toHaveBeenCalled();
    });
  });
});
