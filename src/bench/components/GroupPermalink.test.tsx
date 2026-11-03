// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupPermalink, groupPermalinkUrl } from '@/components/GroupPermalink';
import {
  initGlobalFilter,
  initGroupFilter,
  noteGroupSeries,
  toggleGroupSeries,
} from '@/lib/chart-store';

describe('groupPermalinkUrl', () => {
  it('joins origin, pathname, and the readable anchor fragment', () => {
    const loc = { origin: 'https://bench.vortex.dev', pathname: '/' };
    expect(groupPermalinkUrl('random-access', [], [], { ...loc, search: '' })).toBe(
      'https://bench.vortex.dev/#random-access',
    );
  });

  it('percent-encodes fragment-hostile anchor characters defensively', () => {
    const loc = { origin: 'https://bench.vortex.dev', pathname: '/' };
    expect(groupPermalinkUrl('a#b c', [], [], { ...loc, search: '' })).toBe(
      'https://bench.vortex.dev/#a%23b%20c',
    );
  });

  it('preserves global filters and replaces stale group-local filters', () => {
    const loc = {
      origin: 'https://bench.vortex.dev',
      pathname: '/',
      search: '?engine=duckdb&group=old&hide=old-series&show=old-shown',
    };
    expect(groupPermalinkUrl('random-access', ['z series', 'a'], ['lance'], loc)).toBe(
      'https://bench.vortex.dev/?engine=duckdb&group=random-access&hide=a&hide=z+series&show=lance#random-access',
    );
  });
});

describe('GroupPermalink markup', () => {
  it('renders a labelled icon link to the group, which works without JavaScript', () => {
    const html = renderToStaticMarkup(
      <GroupPermalink anchor="random-access" groupName="Random Access" groupSlug="random_access" />,
    );
    expect(html).toMatch(/^<a class="group-permalink" href="\/#random-access"/);
    // Named as the plain link it is until JavaScript can copy it.
    expect(html).toContain('title="Link to this group"');
    expect(html).toContain('aria-label="Link to Random Access"');
    expect(html).not.toContain('<button');
    // The resting state carries no copied styling.
    expect(html).not.toContain('group-permalink--copied');
  });
});

describe('GroupPermalink click behavior', () => {
  let container: HTMLElement;
  let root: Root | null = null;
  let copiedText: string[];

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    copiedText = [];
    // jsdom has no Clipboard API; install a capturing stub.
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          copiedText.push(text);
          return Promise.resolve();
        },
      },
      configurable: true,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.useRealTimers();
    delete (navigator as any).clipboard;
    window.history.replaceState(null, '', '/');
    initGroupFilter('random_access', [], []);
  });

  /** Mount the link inside a real `<details>`/`<summary>` host, as on the
   * landing page, and return the pieces the assertions need. */
  function mount(): { link: HTMLAnchorElement; details: HTMLDetailsElement } {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    details.appendChild(summary);
    container.appendChild(details);
    root = createRoot(summary);
    act(() => {
      root?.render(
        <GroupPermalink
          anchor="random-access"
          groupName="Random Access"
          groupSlug="random_access"
        />,
      );
    });
    const link = container.querySelector<HTMLAnchorElement>('a.group-permalink');
    if (!link) {
      throw new Error('permalink link did not render');
    }
    return { link, details };
  }

  /** Click the link and let the clipboard write settle. */
  async function click(link: HTMLAnchorElement): Promise<MouseEvent> {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => {
      link.dispatchEvent(event);
    });
    return event;
  }

  it('copies a link to this one group and leaves the address bar alone', async () => {
    window.history.replaceState(null, '', '/?engine=duckdb#clickbench,random-access');
    const before = window.location.href;
    const { link, details } = mount();

    const event = await click(link);

    expect(copiedText).toEqual([`${window.location.origin}/?engine=duckdb#random-access`]);
    expect(window.location.href).toBe(before);
    // preventDefault stops the link's navigation, and the <summary>
    // activation that would otherwise toggle the group open.
    expect(event.defaultPrevented).toBe(true);
    expect(details.open).toBe(false);
  });

  // A modified or middle click follows the link, so once mounted its href is
  // the same permalink a copy writes: global filters and series included.
  it('keeps global filters in the href once mounted, and the series as the pointer goes down', () => {
    window.history.replaceState(null, '', '/?engine=duckdb');
    const { link } = mount();
    expect(link.getAttribute('href')).toBe('/?engine=duckdb#random-access');
    toggleGroupSeries('random_access', 'duckdb:vortex');
    act(() => {
      link.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(link.getAttribute('href')).toBe(
      '/?engine=duckdb&group=random-access&hide=duckdb%3Avortex#random-access',
    );
  });

  it('takes the copy wording once mounted', () => {
    const { link } = mount();
    expect(link.getAttribute('aria-label')).toBe('Copy link to Random Access');
    expect(link.getAttribute('title')).toBe('Copy link to this group');
  });

  it('hydrates its server markup with no mismatch, then takes the copy wording', async () => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <GroupPermalink anchor="random-access" groupName="Random Access" groupSlug="random_access" />,
    );
    container.appendChild(host);
    const consoleError = vi.spyOn(console, 'error');
    const recoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(
        host,
        <GroupPermalink
          anchor="random-access"
          groupName="Random Access"
          groupSlug="random_access"
        />,
        { onRecoverableError: recoverableError },
      );
    });
    expect(recoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(host.querySelector('a')?.getAttribute('aria-label')).toBe('Copy link to Random Access');
  });

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
  ])('leaves a %s click to the browser, so the link opens as asked', async (_, init) => {
    const { link, details } = mount();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });

    await act(async () => {
      link.dispatchEvent(event);
    });

    expect(copiedText).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
    expect(details.open).toBe(false);
  });

  it('copies on Space, as the button it replaced did, without scrolling the page', async () => {
    const { link } = mount();
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });

    await act(async () => {
      link.dispatchEvent(event);
    });

    expect(copiedText).toEqual([`${window.location.origin}/#random-access`]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows the copied state, then reverts after the feedback window', async () => {
    const { link } = mount();

    await click(link);
    expect(link.className).toContain('group-permalink--copied');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(link.className).not.toContain('group-permalink--copied');
  });

  it.each(['missing', 'rejected'])(
    'does not claim a copy the browser refused (%s)',
    async (clipboard) => {
      Object.defineProperty(navigator, 'clipboard', {
        value:
          clipboard === 'missing'
            ? undefined
            : {
                writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
              },
        configurable: true,
      });
      const { link } = mount();

      await click(link);

      expect(link.className).not.toContain('group-permalink--copied');
      expect(link.querySelector('[role="status"]')?.textContent).toBe('');
    },
  );

  it('copies the current group-local series filter', async () => {
    const { link } = mount();
    toggleGroupSeries('random_access', 'duckdb:vortex');
    toggleGroupSeries('random_access', 'datafusion parquet');

    await click(link);

    expect(copiedText).toEqual([
      `${window.location.origin}/?group=random-access&hide=datafusion+parquet&hide=duckdb%3Avortex#random-access`,
    ]);
  });

  it('preserves a local override that restores a globally hidden series', async () => {
    const { link } = mount();
    initGlobalFilter({ engines: [], formats: ['parquet', 'lance'] }, [], []);
    noteGroupSeries('random_access', { lance: { format: 'lance' } });
    toggleGroupSeries('random_access', 'lance');

    await click(link);

    expect(copiedText).toEqual([
      `${window.location.origin}/?group=random-access&show=lance#random-access`,
    ]);
  });
});
