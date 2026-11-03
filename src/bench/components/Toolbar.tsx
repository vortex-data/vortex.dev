// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useLayoutEffect } from 'react';

import { FilterBar } from '@/bench/components/FilterBar';
import type { FilterUniverse } from '@/bench/lib/chart-format';
import { CollapseAllIcon, ExpandAllIcon } from '@/bench/components/icons';
import { setAllGroupsOpen } from '@/bench/lib/open-groups';

/** What a page passes for the filter dropdown. */
export type ToolbarProps = {
  universe?: FilterUniverse | undefined;
  initialEngines?: string[] | null;
  initialFormats?: string[] | null;
};

/**
 * bench's controls, on the site header's row ([`BenchHeader`]): those of
 * section 18 of v3's `chart-init.js` (expand and collapse all, and the global
 * filter dropdown), drawn as the system's secondary mono buttons, as the
 * header's GitHub and Menu buttons are. The header holds the wordmark, the page's title, the theme
 * toggle ([`ThemeToggle`]), the GitHub button and the Menu.
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
 * universe fetched) pass an empty universe and get the two buttons.
 *
 * Without JavaScript none of the buttons can work, so each carries
 * `data-requires-js`, which hides it under the root's `no-js` class
 * (globals.css), as does the filter dropdown ([`FilterBar`]).
 */
export function Toolbar({ universe, initialEngines, initialFormats }: ToolbarProps) {
  // The pre-paint script has swapped `no-js` for `js` already. If React ever
  // renders the root `<html>` afresh (a root-level hydration failure does), it
  // puts the server's `no-js` back, which would hide every control that needs
  // JavaScript; swap it again, before the browser paints.
  useLayoutEffect(() => {
    document.documentElement.classList.replace('no-js', 'js');
  }, []);

  const showFilters =
    universe !== undefined && (universe.engines.length > 0 || universe.formats.length > 0);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: deliberate markup, as bench has always rendered the group controls.
    <div className="bench-toolbar-controls" aria-label="Benchmark group controls">
      <button
        className="vx-btn vx-btn-secondary is-mono"
        type="button"
        data-action="expand-all"
        data-requires-js
        onClick={() => setAllGroupsOpen(window, true)}
      >
        <ExpandAllIcon />
        <span>Expand all</span>
      </button>
      <button
        className="vx-btn vx-btn-secondary is-mono"
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
  );
}
