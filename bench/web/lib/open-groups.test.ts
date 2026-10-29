// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupAnchors } from '@/lib/anchor';
import {
  formatOpenFragment,
  type GroupRef,
  openAnchors,
  openGroupSlugs,
  openGroupsFromHash,
  pageGroups,
  parseOpenFragment,
  resolveOpenAnchors,
  scrollToGroup,
  setAllGroupsOpen,
  syncOpenFragment,
} from '@/lib/open-groups';

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
  beforeEach(seed);

  afterEach(() => {
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
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
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
    window.history.replaceState(null, '', '/?engine=duckdb');
    const replace = vi.spyOn(window.history, 'replaceState');

    setAllGroupsOpen(window, true);
    expect(GROUPS.map(({ anchor }) => disclosure(anchor).open)).toEqual([true, true, true]);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,random-access,clickbench');

    setAllGroupsOpen(window, false);
    expect(GROUPS.map(({ anchor }) => disclosure(anchor).open)).toEqual([false, false, false]);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe('');
    expect(window.location.href.endsWith('/?engine=duckdb')).toBe(true);
  });
});
