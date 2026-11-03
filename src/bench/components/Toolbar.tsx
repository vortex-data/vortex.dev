// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useLayoutEffect, useState } from 'react';

import { FilterBar } from '@/bench/components/FilterBar';
import type { FilterUniverse } from '@/bench/lib/chart-format';
import {
  CollapseAllIcon,
  DarkModeIcon,
  ExpandAllIcon,
  LightModeIcon,
} from '@/bench/components/icons';
import { setAllGroupsOpen } from '@/bench/lib/open-groups';
import { effectiveTheme } from '@/bench/lib/theme';

/**
 * bench's sticky toolbar, under the site's header (the root layout): the
 * page's title, the controls of section 18 of v3's `chart-init.js` (expand
 * and collapse all, and the global filter dropdown), and the theme toggle.
 * The site's header holds the wordmark, the links and the GitHub button.
 *
 * Expand/Collapse All writes `details.open` on every group disclosure
 * directly, then schedules one write of the open set into the URL fragment
 * (`setAllGroupsOpen` in `lib/open-groups.ts`): at once after a quiet spell,
 * otherwise once the clicks stop, because fragment writes are coalesced and
 * kept at least 300 ms apart. The native `toggle` event
 * (which also fires for scripted changes) is how each group body learns its
 * group opened, so no shared React tree is needed between the toolbar and the
 * groups. On a page without groups (the chart page) the buttons do nothing.
 *
 * The filter dropdown renders only when the universe has at least one chip,
 * matching v3's `show_filters` guard. Pages without chart data (or without the
 * universe fetched) pass an empty universe and get the title and the toggles.
 *
 * Theming: the html `data-theme` attribute plus `localStorage["bench-theme"]`
 * are the source of truth (seeded pre-paint by the theme-bootstrap inline
 * script in the root layout). The server renders the v3 default label "Light";
 * the mount effect immediately corrects the label to name the NEXT theme, the
 * exact v3 `updateThemeButtons` sequencing.
 *
 * Without JavaScript none of the buttons can work, so each carries
 * `data-requires-js`, which hides it under the root's `no-js` class
 * (globals.css), as does the filter dropdown ([`FilterBar`]). The title stays.
 */
export function Toolbar({
  universe,
  initialEngines,
  initialFormats,
}: {
  universe?: FilterUniverse | undefined;
  initialEngines?: string[] | null;
  initialFormats?: string[] | null;
}) {
  const [nextTheme, setNextTheme] = useState<'light' | 'dark'>('light');

  // Label/attribute sync on mount (the bootstrap script may have set a stored
  // theme before hydration) and on every toggle.
  useEffect(() => {
    setNextTheme(effectiveTheme() === 'light' ? 'dark' : 'light');
  }, []);

  // The pre-paint script has swapped `no-js` for `js` already. If React ever
  // renders the root `<html>` afresh (a root-level hydration failure does), it
  // puts the server's `no-js` back, which would hide every control that needs
  // JavaScript; swap it again, before the browser paints.
  useLayoutEffect(() => {
    document.documentElement.classList.replace('no-js', 'js');
  }, []);

  const showFilters =
    universe !== undefined && (universe.engines.length > 0 || universe.formats.length > 0);

  const onThemeToggle = (): void => {
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

  return (
    <div className="bench-toolbar">
      <h1 className="bench-title">Benchmarks</h1>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: deliberate markup, as bench has always rendered the group controls. */}
      <div className="bench-toolbar-controls" aria-label="Benchmark group controls">
        <button
          className="control-btn"
          type="button"
          data-action="expand-all"
          data-requires-js
          onClick={() => setAllGroupsOpen(window, true)}
        >
          <ExpandAllIcon />
          <span>Expand all</span>
        </button>
        <button
          className="control-btn"
          type="button"
          data-action="collapse-all"
          data-requires-js
          onClick={() => setAllGroupsOpen(window, false)}
        >
          <CollapseAllIcon />
          <span>Collapse all</span>
        </button>
        {showFilters && (
          <FilterBar
            universe={universe}
            initialEngines={initialEngines ?? null}
            initialFormats={initialFormats ?? null}
          />
        )}
      </div>
      <button
        className="control-btn theme-toggle"
        type="button"
        data-role="theme-toggle"
        data-requires-js
        data-next-theme={nextTheme}
        aria-label={`Switch to ${nextTheme} mode`}
        onClick={onThemeToggle}
      >
        <LightModeIcon className="btn-icon theme-icon theme-icon-light" />
        <DarkModeIcon className="btn-icon theme-icon theme-icon-dark" />
        <span className="theme-toggle-label">{nextTheme === 'dark' ? 'Dark' : 'Light'}</span>
      </button>
    </div>
  );
}
