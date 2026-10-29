// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { LandingState } from '@/components/LandingState';
import { noteGroupBodyOpen, resetGroupBodies } from '@/lib/group-bodies';
import { setAllGroupsOpen } from '@/lib/open-groups';

// Three groups in page order, as the landing page renders them.
const GROUPS = [
  { anchor: 'tpc-h-nvme-sf-1', slug: 'qm.tpch' },
  { anchor: 'random-access', slug: 'random_access.eyJ' },
  { anchor: 'clickbench', slug: 'qm.click' },
];

/** Let jsdom's queued `toggle` and `hashchange` tasks, and the promise chains
 * after them, run. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
  let onError: Mock;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    resetGroupBodies();
    // jsdom does not implement scrollIntoView; stub it so the call is observable.
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    onError = vi.fn();
    window.addEventListener('error', onError);
    document.body.innerHTML =
      '<div id="group-nav-panel"></div>' +
      GROUPS.map(
        ({ anchor, slug }) =>
          `<section class="group-details" id="${anchor}" data-group-slug="${slug}">` +
          `<details class="group-disclosure"><summary>${anchor}</summary></details>` +
          '</section>',
      ).join('');
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    root = null;
    window.removeEventListener('error', onError);
    vi.restoreAllMocks();
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

  /** Open or close one group the way a summary click does, and let its
   * `toggle` event run. */
  async function setOpen(anchor: string, open: boolean): Promise<void> {
    disclosure(anchor).open = open;
    await flush();
  }

  it('writes the open groups into the fragment, in page order, on every toggle', async () => {
    await mount('/?engine=duckdb');

    await setOpen('clickbench', true);
    expect(window.location.href.endsWith('/?engine=duckdb#clickbench')).toBe(true);
    await setOpen('tpc-h-nvme-sf-1', true);
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,clickbench');
    await setOpen('clickbench', false);
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1');
    await setOpen('tpc-h-nvme-sf-1', false);
    expect(window.location.href.endsWith('/?engine=duckdb')).toBe(true);
    expect(window.location.href).not.toContain('#');
  });

  it('writes the fragment once per Expand All and Collapse All', async () => {
    await mount('/?engine=duckdb');
    const replace = vi.spyOn(window.history, 'replaceState');

    setAllGroupsOpen(window, true);
    await flush();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,random-access,clickbench');

    setAllGroupsOpen(window, false);
    await flush();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(window.location.href).not.toContain('#');
    expect(window.location.search).toBe('?engine=duckdb');
  });

  it('keeps opening groups when the browser refuses a URL write', async () => {
    await mount('/');
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new DOMException('limit', 'SecurityError');
    });

    expect(() => setAllGroupsOpen(window, true)).not.toThrow();
    await flush();
    expect(openStates()).toEqual([true, true, true]);
    expect(onError).not.toHaveBeenCalled();
  });

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

  it('stops listening once unmounted', async () => {
    await mount('/');
    await act(async () => {
      root?.unmount();
    });
    root = null;
    const replace = vi.spyOn(window.history, 'replaceState');

    await setOpen('clickbench', true);
    window.location.hash = 'random-access';
    await flush();
    expect(replace).not.toHaveBeenCalled();
    expect(disclosure('random-access').open).toBe(false);
  });
});
