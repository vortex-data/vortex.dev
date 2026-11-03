// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useState } from 'react';

import { DarkModeIcon, LightModeIcon } from '@/bench/components/icons';
import { effectiveTheme, onThemeChange } from '@/bench/lib/theme';

/**
 * bench's theme toggle, in the site header's end group, or with `row` as its
 * twin row in the header's Menu panel, which the system's CSS shows instead
 * on a phone (`vx-header-spill`, `vx-header-menu-spill`).
 *
 * The html `data-theme` attribute plus `localStorage["bench-theme"]` are the
 * source of truth (seeded pre-paint by the theme-bootstrap inline script in
 * the root layout). The server renders the v3 default label "Light"; the
 * mount effect corrects it to name the NEXT theme, the exact v3
 * `updateThemeButtons` sequencing. Each copy follows the attribute
 * (`onThemeChange`), so a click on one updates the other.
 *
 * Without JavaScript the toggle cannot work, so it carries `data-requires-js`,
 * which hides it under the root's `no-js` class (globals.css).
 */
export function ThemeToggle({ row = false }: { row?: boolean }) {
  const [nextTheme, setNextTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const sync = () => setNextTheme(effectiveTheme() === 'light' ? 'dark' : 'light');
    sync();
    const stop = new AbortController();
    onThemeChange(sync, stop.signal);
    return () => stop.abort();
  }, []);

  const onClick = (): void => {
    const next = effectiveTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('bench-theme', next);
    } catch {
      // Private browsing modes may reject storage writes; the in-page theme
      // still applies for this visit.
    }
    setNextTheme(next === 'light' ? 'dark' : 'light');
  };

  const word = nextTheme === 'dark' ? 'Dark' : 'Light';
  const icons = (
    <>
      <LightModeIcon className="btn-icon theme-icon theme-icon-light" />
      <DarkModeIcon className="btn-icon theme-icon theme-icon-dark" />
    </>
  );

  if (row) {
    return (
      <button
        className="vx-label vx-nav-link vx-header-menu-spill theme-toggle"
        type="button"
        data-requires-js
        data-next-theme={nextTheme}
        onClick={onClick}
      >
        {icons}
        {`${word} theme`}
      </button>
    );
  }
  return (
    <button
      className="control-btn theme-toggle vx-header-spill"
      type="button"
      data-role="theme-toggle"
      data-requires-js
      data-next-theme={nextTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      onClick={onClick}
    >
      {icons}
      <span className="theme-toggle-label">{word}</span>
    </button>
  );
}
