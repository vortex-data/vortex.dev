// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { FilterBar } from '@/components/FilterBar';
import type { FilterUniverse } from '@/lib/chart-format';
import {
  CollapseAllIcon,
  DarkModeIcon,
  ExpandAllIcon,
  LightModeIcon,
  MenuIcon,
} from '@/components/icons';
import { GitHubIcon } from '@/components/mark-github';
import { setAllGroupsOpen } from '@/lib/open-groups';

/**
 * The sticky site header, the full client port of
 * `server/src/html/render.rs::site_header` plus the section-18 header controls
 * of `chart-init.js`: the hamburger-toggled mobile nav panel (expand/collapse
 * all, the global filter dropdown, and the mobile-only GitHub link), the
 * theme-aware logo, the desktop GitHub link, and the theme toggle.
 *
 * Expand/Collapse All writes `details.open` on every group disclosure
 * directly, then schedules one write of the open set into the URL fragment
 * (`setAllGroupsOpen` in `lib/open-groups.ts`): at once after a quiet spell,
 * otherwise once the clicks stop, because fragment writes are coalesced and
 * kept at least 300 ms apart. The native `toggle` event
 * (which also fires for scripted changes) is how each group body learns its
 * group opened, so no shared React tree is needed between the header and the
 * groups. On a page without groups (the chart page) the buttons do nothing.
 *
 * The filter dropdown renders only when the universe has at least one chip,
 * matching v3's `show_filters` guard. Pages without chart data (or without the
 * universe fetched) pass an empty universe and get the chrome-only header.
 *
 * Theming: the html `data-theme` attribute plus `localStorage["bench-theme"]`
 * are the source of truth (seeded pre-paint by the theme-bootstrap inline
 * script in the root layout). The server renders the v3 default label "Light";
 * the mount effect immediately corrects the label to name the NEXT theme, the
 * exact v3 `updateThemeButtons` sequencing.
 *
 * Without JavaScript none of the buttons can work, so each carries
 * `data-requires-js`, which hides it under the root's `no-js` class
 * (globals.css), as does the filter dropdown ([`FilterBar`]). The mobile nav
 * then shows in the header row instead of behind the hamburger, holding the
 * GitHub link.
 */
export function Header({
  universe,
  initialEngines,
  initialFormats,
}: {
  universe?: FilterUniverse | undefined;
  initialEngines?: string[] | null;
  initialFormats?: string[] | null;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [nextTheme, setNextTheme] = useState<'light' | 'dark'>('light');
  const navRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

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

  // Close the mobile nav panel on outside click and on Escape.
  useEffect(() => {
    if (!navOpen) {
      return;
    }
    const onClick = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (!navRef.current?.contains(target) && !toggleRef.current?.contains(target)) {
        setNavOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setNavOpen(false);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

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
    <header className="sticky-header">
      <div className="header-content">
        <div className="header-left">
          <button
            className="control-btn nav-mobile-toggle"
            type="button"
            data-role="nav-mobile-toggle"
            data-requires-js
            aria-haspopup="true"
            aria-expanded={navOpen}
            aria-controls="bench-nav-controls"
            aria-label="Toggle navigation menu"
            ref={toggleRef}
            onClick={(e) => {
              e.stopPropagation();
              setNavOpen((o) => !o);
            }}
          >
            <MenuIcon size={18} />
          </button>
          <Link className="logo-link" href="/" aria-label="bench.vortex.dev home">
            <img
              className="site-logo logo-light"
              src="/Vortex_Black_NoBG.svg"
              alt="Vortex"
              width={654}
              height={190}
            />
            <img
              className="site-logo logo-dark"
              src="/Vortex_White_NoBG.svg"
              alt="Vortex"
              width={654}
              height={190}
            />
          </Link>
          <h1 className="site-title">Vortex Benchmarks</h1>
        </div>
        <div className="header-center">
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: deliberate markup, as bench has always rendered the nav controls. */}
          <div
            className={`nav-controls${navOpen ? ' nav-controls--open' : ''}`}
            id="bench-nav-controls"
            data-role="nav-controls"
            aria-label="Benchmark group controls"
            ref={navRef}
          >
            <button
              className="control-btn"
              type="button"
              data-action="expand-all"
              data-requires-js
              onClick={() => setAllGroupsOpen(window, true)}
            >
              <ExpandAllIcon />
              <span>Expand All</span>
            </button>
            <button
              className="control-btn"
              type="button"
              data-action="collapse-all"
              data-requires-js
              onClick={() => setAllGroupsOpen(window, false)}
            >
              <CollapseAllIcon />
              <span>Collapse All</span>
            </button>
            {showFilters && (
              <FilterBar
                universe={universe}
                initialEngines={initialEngines ?? null}
                initialFormats={initialFormats ?? null}
              />
            )}
            {/* Mobile-only GitHub link rendered inside the hamburger panel;
                hidden on desktop via CSS, where `.repo-link-desktop` covers the
                wide-viewport case. */}
            <a
              className="repo-link nav-controls-github"
              href="https://github.com/vortex-data/vortex"
              rel="noopener noreferrer"
              target="_blank"
            >
              <GitHubIcon />
              <span>GitHub</span>
            </a>
          </div>
        </div>
        <div className="header-right">
          <a
            className="repo-link repo-link-desktop"
            href="https://github.com/vortex-data/vortex"
            rel="noopener noreferrer"
            target="_blank"
          >
            <GitHubIcon />
            <span>GitHub</span>
          </a>
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
      </div>
    </header>
  );
}

/** The forced or media-derived effective theme (`chart-init.js::effectiveTheme`). */
function effectiveTheme(): 'light' | 'dark' {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') {
    return forced;
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}
