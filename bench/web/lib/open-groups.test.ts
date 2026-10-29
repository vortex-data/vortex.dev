// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupAnchors } from '@/lib/anchor';
import {
  cancelOpenFragmentSync,
  flushOpenFragmentSync,
  formatOpenFragment,
  type GroupRef,
  listedOpenAnchors,
  OPEN_FRAGMENT_SYNC_DELAY_MS,
  openAndScrollTo,
  openAnchors,
  openGroupSlugs,
  openGroupsFromHash,
  pageGroups,
  parseOpenFragment,
  resetOpenFragmentSync,
  resolveOpenAnchors,
  scheduleOpenFragmentSync,
  scrollToGroup,
  setAllGroupsOpen,
  syncOpenFragment,
  takeOpenGroupsBootstrap,
} from '@/lib/open-groups';

/** Fake the write scheduler's timers and its clock, `performance.now()`. */
function useFakeClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
}

// Three groups in page order, as the landing page renders them.
const GROUPS: GroupRef[] = [
  { anchor: 'tpc-h-nvme-sf-1', slug: 'qm.tpch' },
  { anchor: 'random-access', slug: 'random_access.eyJ' },
  { anchor: 'clickbench', slug: 'qm.click' },
];

function seed(): void {
  document.body.innerHTML =
    '<div id="group-nav-panel"></div>' +
    GROUPS.map(
      ({ anchor, slug }) =>
        `<section class="group-details" id="${anchor}" data-group-slug="${slug}">` +
        `<details class="group-disclosure"><summary>${anchor}</summary></details>` +
        '</section>',
    ).join('');
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

describe('parseOpenFragment', () => {
  it.each([
    ['', []],
    ['#', []],
    ['#a', ['a']],
    ['#b,a,b', ['b', 'a']],
    ['#,a,,', ['a']],
    ['#%E0%A4%A', []],
    ['#%E0%A4%A,a', ['a']],
  ])('reads "%s" as %o', (hash, tokens) => {
    expect(parseOpenFragment(hash)).toEqual(tokens);
  });

  it('round-trips an open set', () => {
    const anchors = groupAnchors(['TPC-H (NVMe) (SF=1)', 'Clickbench', 'Random Access']);
    expect(parseOpenFragment(formatOpenFragment(anchors))).toEqual(anchors);
    expect(formatOpenFragment([])).toBe('');
  });
});

describe('resolveOpenAnchors', () => {
  it('resolves anchors and legacy slugs, drops unknown tokens and keeps fragment order', () => {
    expect(
      resolveOpenAnchors(['clickbench', 'random_access.eyJ', 'nope', 'clickbench'], GROUPS),
    ).toEqual(['clickbench', 'random-access']);
  });
});

describe('the open groups on the page', () => {
  beforeEach(() => {
    seed();
    resetOpenFragmentSync(window);
  });

  afterEach(() => {
    resetOpenFragmentSync(window);
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });

  it('lists the group sections in page order, and nothing else', () => {
    expect(pageGroups(document)).toEqual(GROUPS);
  });

  it('opens the listed groups and ignores non-group ids and malformed tokens', () => {
    expect(
      openGroupsFromHash(document, '#clickbench,group-nav-panel,%E0%A4%A,tpc-h-nvme-sf-1'),
    ).toEqual(['clickbench', 'tpc-h-nvme-sf-1']);
    expect(openAnchors(document)).toEqual(['tpc-h-nvme-sf-1', 'clickbench']);
    expect(openGroupSlugs(document)).toEqual(['qm.tpch', 'qm.click']);
    expect(disclosure('random-access').open).toBe(false);
  });

  it('scrolls only to a group section', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    expect(scrollToGroup(document, 'group-nav-panel')).toBe(false);
    expect(scrollToGroup(document, 'nope')).toBe(false);
    expect(scrollSpy).not.toHaveBeenCalled();

    expect(scrollToGroup(document, 'random-access')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('random-access'));
    // Nobody clicked: a fresh visit, a restore's fallback or a new fragment.
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  it.each([
    [false, 'smooth'],
    [true, 'auto'],
  ])(
    'opens and scrolls to a clicked group smoothly, unless reduced motion is %s',
    (reduce, behavior) => {
      const scrollSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollSpy;
      // jsdom has no `matchMedia`.
      window.matchMedia = vi.fn().mockReturnValue({ matches: reduce });
      try {
        openAndScrollTo(document.getElementById('clickbench') as HTMLElement, document);
      } finally {
        Reflect.deleteProperty(window, 'matchMedia');
      }
      expect(disclosure('clickbench').open).toBe(true);
      expect(scrollSpy.mock.contexts[0]).toBe(document.getElementById('clickbench'));
      expect(scrollSpy).toHaveBeenCalledWith({ behavior, block: 'start' });
    },
  );

  it('lists the groups the fragment names that are open, in fragment order, opening nothing', () => {
    disclosure('clickbench').open = true;
    disclosure('tpc-h-nvme-sf-1').open = true;

    expect(listedOpenAnchors(document, '#random-access,clickbench,nope,tpc-h-nvme-sf-1')).toEqual([
      'clickbench',
      'tpc-h-nvme-sf-1',
    ]);
    expect(disclosure('random-access').open).toBe(false);
  });

  describe('syncOpenFragment', () => {
    it('writes the open set in page order and keeps the query', () => {
      window.history.replaceState(null, '', '/?engine=duckdb');
      disclosure('clickbench').open = true;
      disclosure('tpc-h-nvme-sf-1').open = true;

      expect(syncOpenFragment(window)).toBe(true);
      expect(window.location.href.endsWith('/?engine=duckdb#tpc-h-nvme-sf-1,clickbench')).toBe(
        true,
      );

      disclosure('clickbench').open = false;
      disclosure('tpc-h-nvme-sf-1').open = false;
      expect(syncOpenFragment(window)).toBe(true);
      expect(window.location.href.endsWith('/?engine=duckdb')).toBe(true);
      expect(window.location.href).not.toContain('#');
    });

    it('does not write when nothing changed, or on a page without groups', () => {
      disclosure('clickbench').open = true;
      window.history.replaceState(null, '', '/?engine=duckdb#clickbench');
      const replace = vi.spyOn(window.history, 'replaceState');

      expect(syncOpenFragment(window)).toBe(false);

      document.body.innerHTML = '<div id="group-nav-panel"></div>';
      expect(syncOpenFragment(window)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('#clickbench');
    });

    it('returns false, without throwing, when the browser refuses the write', () => {
      disclosure('clickbench').open = true;
      vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
        throw new DOMException('limit', 'SecurityError');
      });

      expect(syncOpenFragment(window)).toBe(false);
    });
  });

  it('setAllGroupsOpen opens every group and writes the fragment once', () => {
    useFakeClock();
    window.history.replaceState(null, '', '/?engine=duckdb');
    const replace = vi.spyOn(window.history, 'replaceState');

    setAllGroupsOpen(window, true);
    expect(GROUPS.map(({ anchor }) => disclosure(anchor).open)).toEqual([true, true, true]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,random-access,clickbench');
    // The toggles that follow find the fragment current.
    scheduleOpenFragmentSync(window);
    vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
    expect(replace).toHaveBeenCalledTimes(1);

    setAllGroupsOpen(window, false);
    expect(GROUPS.map(({ anchor }) => disclosure(anchor).open)).toEqual([false, false, false]);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe('');
    expect(window.location.href.endsWith('/?engine=duckdb')).toBe(true);
  });

  // Safari refuses a document's 101st `replaceState` in 10 seconds, and Next.js
  // makes a second call for each of ours, so a burst of toggles must become a
  // few writes.
  describe('the fragment write scheduler', () => {
    beforeEach(() => {
      useFakeClock();
    });

    /** Toggle `anchor` and schedule its write, as the page's toggle listener does. */
    function toggle(anchor: string): void {
      const details = disclosure(anchor);
      details.open = !details.open;
      scheduleOpenFragmentSync(window);
    }

    /** Leave a write pending: one toggle writes at once, the next waits. */
    function leavePending(): void {
      toggle('clickbench');
      toggle('random-access');
    }

    it('writes an isolated toggle at once', () => {
      toggle('clickbench');
      expect(window.location.hash).toBe('#clickbench');
    });

    it('coalesces a burst of toggles into two writes: as it starts and once it stops', () => {
      const replace = vi.spyOn(window.history, 'replaceState');
      // 123 toggles, 50 ms apart: six seconds of fast clicking, which leaves
      // each group toggled an odd number of times, so open.
      for (let i = 0; i < 123; i++) {
        toggle(GROUPS[i % 3]!.anchor);
        vi.advanceTimersByTime(50);
      }
      expect(replace).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(replace).toHaveBeenCalledTimes(2);
      expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,random-access,clickbench');
    });

    it.each([50, 150, 290, 301, 450, 1000])(
      'keeps writes at least the delay apart when toggles come every %i ms',
      (interval) => {
        const writes: number[] = [];
        vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
          writes.push(Date.now());
        });
        const start = Date.now();
        for (let i = 0; Date.now() - start < 10_000; i++) {
          toggle(GROUPS[i % 3]!.anchor);
          vi.advanceTimersByTime(interval);
        }
        vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);

        expect(writes.length).toBeGreaterThan(0);
        for (let i = 1; i < writes.length; i++) {
          expect(writes[i]! - writes[i - 1]!).toBeGreaterThanOrEqual(OPEN_FRAGMENT_SYNC_DELAY_MS);
        }
        // At most 34 writes in 10 seconds: with Next.js's extra call per write,
        // 68 calls, below Safari's 100.
        expect(writes.length).toBeLessThanOrEqual(10_000 / OPEN_FRAGMENT_SYNC_DELAY_MS + 1);
      },
    );

    it('waits for the delay after the last toggle of a burst', () => {
      leavePending();
      expect(window.location.hash).toBe('#clickbench');
      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS - 1);
      expect(window.location.hash).toBe('#clickbench');
      vi.advanceTimersByTime(1);
      expect(window.location.hash).toBe('#random-access,clickbench');
    });

    it('flush writes a pending set at once, and only once', () => {
      leavePending();
      const replace = vi.spyOn(window.history, 'replaceState');

      expect(flushOpenFragmentSync(window)).toBe(true);
      expect(window.location.hash).toBe('#random-access,clickbench');
      expect(flushOpenFragmentSync(window)).toBe(false);
      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(replace).toHaveBeenCalledTimes(1);
    });

    it('flush writes nothing when nothing is pending', () => {
      disclosure('clickbench').open = true;
      const replace = vi.spyOn(window.history, 'replaceState');

      expect(flushOpenFragmentSync(window)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('cancel drops a pending write', () => {
      leavePending();
      const replace = vi.spyOn(window.history, 'replaceState');

      cancelOpenFragmentSync(window);
      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(flushOpenFragmentSync(window)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('#clickbench');
    });

    it('never overwrites a fragment that changed after the write was scheduled', () => {
      leavePending();
      // A fragment typed into the address bar, whose hashchange has not run yet.
      window.history.replaceState(null, '', '/#tpc-h-nvme-sf-1');
      const replace = vi.spyOn(window.history, 'replaceState');

      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(replace).not.toHaveBeenCalled();
      expect(window.location.hash).toBe('#tpc-h-nvme-sf-1');
    });

    it('keeps its spacing when the wall clock jumps forward', () => {
      const replace = vi.spyOn(window.history, 'replaceState');
      toggle('clickbench');
      expect(replace).toHaveBeenCalledTimes(1);

      // A clock sync moves `Date` an hour on; no time has passed.
      vi.setSystemTime(Date.now() + 3_600_000);
      toggle('random-access');
      expect(replace).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(replace).toHaveBeenCalledTimes(2);
    });

    it('drops a pending write once the page has left the path it was scheduled on', () => {
      leavePending();
      // A client navigation away whose new URL kept the fragment.
      window.history.replaceState(null, '', '/chart/c1#clickbench');
      const replace = vi.spyOn(window.history, 'replaceState');

      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(flushOpenFragmentSync(window)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/chart/c1');
      expect(window.location.hash).toBe('#clickbench');
    });

    it('a write made at once leaves the pending one nothing to do', () => {
      leavePending();
      const replace = vi.spyOn(window.history, 'replaceState');

      expect(syncOpenFragment(window)).toBe(true);
      expect(flushOpenFragmentSync(window)).toBe(false);
      vi.advanceTimersByTime(OPEN_FRAGMENT_SYNC_DELAY_MS);
      expect(replace).toHaveBeenCalledTimes(1);
    });
  });
});

// What the pre-paint script leaves on its document; `OpenGroupsScript.test.tsx`
// runs the real script against this reader.
describe('takeOpenGroupsBootstrap', () => {
  const KEY = '__benchOpenGroups';
  const holder = document as unknown as Record<string, unknown>;

  afterEach(() => {
    holder[KEY] = undefined;
  });

  it('finds nothing on a document the script never ran in', () => {
    expect(takeOpenGroupsBootstrap(document)).toBeNull();
  });

  it.each([
    [false, { input: false }],
    [true, { input: true }],
  ])('takes the marker once, with the input flag %s, and stops its listeners', (input, taken) => {
    const stop = vi.fn();
    holder[KEY] = { input, stop };

    expect(takeOpenGroupsBootstrap(document)).toEqual(taken);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(takeOpenGroupsBootstrap(document)).toBeNull();
  });

  it.each([
    ['a value that is not an object', 1],
    ['null', null],
  ])('ignores %s', (_case, value) => {
    holder[KEY] = value;
    expect(takeOpenGroupsBootstrap(document)).toBeNull();
  });

  it('reads only a true input flag, and survives a missing or failing stop', () => {
    holder[KEY] = { input: 'yes' };
    expect(takeOpenGroupsBootstrap(document)).toEqual({ input: false });

    holder[KEY] = {
      input: true,
      stop: () => {
        throw new Error('boom');
      },
    };
    expect(takeOpenGroupsBootstrap(document)).toEqual({ input: true });
  });
});
