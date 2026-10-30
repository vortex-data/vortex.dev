// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { effectiveTheme, onThemeChange } from './theme';

/** MutationObserver callbacks run as a microtask after the change. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('effectiveTheme', () => {
  it('prefers the chosen theme, then the system preference, then light', () => {
    expect(effectiveTheme()).toBe('light');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(effectiveTheme()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    expect(effectiveTheme()).toBe('light');
  });
});

describe('onThemeChange', () => {
  it('calls the listener when the theme attribute changes, until the signal aborts', async () => {
    const listener = vi.fn();
    const aborter = new AbortController();
    onThemeChange(listener, aborter.signal);
    document.documentElement.setAttribute('data-theme', 'dark');
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    aborter.abort();
    document.documentElement.setAttribute('data-theme', 'light');
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores a listener whose signal has already aborted', async () => {
    const listener = vi.fn();
    onThemeChange(listener, AbortSignal.abort());
    document.documentElement.setAttribute('data-theme', 'dark');
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
