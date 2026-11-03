// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeToggle } from '@/bench/components/ThemeToggle';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ThemeToggle', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
  });

  it("renders the end group's button with the v3 server-default label", () => {
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html).toContain('class="control-btn theme-toggle vx-header-spill"');
    expect(html).toContain('data-role="theme-toggle" data-requires-js="true"');
    expect(html).toContain('data-next-theme="light"');
    expect(html).toContain('aria-label="Switch to light mode"');
    expect(html).toContain('<span class="theme-toggle-label">Light</span>');
  });

  // The Menu panel's row, which the system's CSS shows in place of the button on a phone.
  it("renders the Menu panel's row as one of its links, named by its words", () => {
    const html = renderToStaticMarkup(<ThemeToggle row />);
    expect(html).toMatch(/^<button class="vx-label vx-nav-link vx-header-menu-spill theme-toggle"/);
    expect(html).toContain('data-requires-js="true"');
    expect(html).not.toContain('aria-label');
    expect(html).not.toContain('data-role');
    expect(html).toMatch(/>Light theme<\/button>$/);
  });

  it('keeps both copies naming the next theme when either is clicked', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <>
          <ThemeToggle />
          <ThemeToggle row />
        </>,
      );
    });
    const [button, row] = [...host.querySelectorAll('button')];
    expect(button?.dataset.nextTheme).toBe('light');
    expect(row?.textContent).toBe('Light theme');

    await act(async () => {
      row?.click();
      // The theme watch is a MutationObserver, which reports after a microtask.
      await Promise.resolve();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(button?.dataset.nextTheme).toBe('dark');
    expect(button?.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(row?.textContent).toBe('Dark theme');
    await act(async () => root.unmount());
  });
});
