// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Header } from '@/components/Header';

// The logo is a `next/link` to `/`. On `/` a soft navigation to `/` would drop the fragment that
// lists the open groups while the groups stay open, so there the logo scrolls to the top instead.
describe('the header logo', () => {
  let root: Root | null = null;
  let host: HTMLDivElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    root = createRoot(host);
    act(() => {
      root?.render(<Header />);
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host.remove();
    vi.unstubAllGlobals();
    document.documentElement.className = '';
  });

  /** Click the logo the way `init` says; returns whether the click was allowed to navigate. */
  function clickLogo(init: MouseEventInit = {}): boolean {
    const logo = host.querySelector<HTMLAnchorElement>('a.logo-link')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    act(() => {
      logo.dispatchEvent(event);
    });
    return !event.defaultPrevented;
  }

  it('scrolls to the top of `/` in place, keeping the fragment', () => {
    window.history.replaceState(null, '', '/?engine=duckdb#tpc-h-nvme-sf-1,clickbench');
    expect(clickLogo()).toBe(false);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' });
    expect(window.location.hash).toBe('#tpc-h-nvme-sf-1,clickbench');
    expect(window.location.search).toBe('?engine=duckdb');
  });

  it('scrolls at once for a visitor who prefers reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    window.history.replaceState(null, '', '/#clickbench');
    expect(clickLogo()).toBe(false);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'auto' });
  });

  it('treats keyboard activation like a click', () => {
    window.history.replaceState(null, '', '/#clickbench');
    // Enter on a link fires a click with no pointer detail.
    expect(clickLogo({ detail: 0 })).toBe(false);
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it.each([
    ['ctrlKey', { ctrlKey: true }],
    ['metaKey', { metaKey: true }],
    ['shiftKey', { shiftKey: true }],
    ['altKey', { altKey: true }],
    ['middle button', { button: 1 }],
  ])('leaves a modified click (%s) to the browser', (_name, init) => {
    window.history.replaceState(null, '', '/#clickbench');
    expect(clickLogo(init)).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('navigates home from any other page', () => {
    window.history.replaceState(null, '', '/chart/qm.example');
    expect(clickLogo()).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
