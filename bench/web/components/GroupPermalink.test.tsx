// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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
  it('renders a labelled icon button', () => {
    const html = renderToStaticMarkup(
      <GroupPermalink anchor="random-access" groupName="Random Access" groupSlug="random_access" />,
    );
    expect(html).toContain('class="group-permalink"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Copy link to Random Access"');
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (navigator as any).clipboard;
    window.history.replaceState(null, '', '/');
    initGroupFilter('random_access', [], []);
  });

  /** Mount the button inside a real `<details>`/`<summary>` host, as on the
   * landing page, and return the pieces the assertions need. */
  function mount(): { button: HTMLButtonElement; details: HTMLDetailsElement } {
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
    const button = container.querySelector<HTMLButtonElement>('button.group-permalink');
    if (!button) {
      throw new Error('permalink button did not render');
    }
    return { button, details };
  }

  it('copies the permalink, mirrors the fragment, and never toggles the disclosure', () => {
    const { button, details } = mount();

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(click);
    });

    expect(copiedText).toEqual([`${window.location.origin}/#random-access`]);
    expect(window.location.hash).toBe('#random-access');
    // preventDefault suppresses the <summary> activation that would otherwise
    // toggle the group open.
    expect(click.defaultPrevented).toBe(true);
    expect(details.open).toBe(false);
  });

  it('shows the copied state, then reverts after the feedback window', () => {
    const { button } = mount();

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(button.className).toContain('group-permalink--copied');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.className).not.toContain('group-permalink--copied');
  });

  it('copies and mirrors the current group-local series filter', () => {
    const { button } = mount();
    toggleGroupSeries('random_access', 'duckdb:vortex');
    toggleGroupSeries('random_access', 'datafusion parquet');

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(copiedText).toEqual([
      `${window.location.origin}/?group=random-access&hide=datafusion+parquet&hide=duckdb%3Avortex#random-access`,
    ]);
    expect(window.location.search).toBe(
      '?group=random-access&hide=datafusion+parquet&hide=duckdb%3Avortex',
    );
  });

  it('preserves a local override that restores a globally hidden series', () => {
    const { button } = mount();
    initGlobalFilter({ engines: [], formats: ['parquet', 'lance'] }, [], []);
    noteGroupSeries('random_access', { lance: { format: 'lance' } });
    toggleGroupSeries('random_access', 'lance');

    act(() => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(copiedText).toEqual([
      `${window.location.origin}/?group=random-access&show=lance#random-access`,
    ]);
    expect(window.location.search).toBe('?group=random-access&show=lance');
  });
});
