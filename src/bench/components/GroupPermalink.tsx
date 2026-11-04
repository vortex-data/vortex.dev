// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useBenchPath } from '@/bench/components/BenchBase';
import { getGroupSnapshot } from '@/bench/lib/chart-store';
import {
  GROUP_FILTER_PARAM,
  type GroupFilterChoices,
  HIDDEN_ENGINE_PARAM,
  HIDDEN_FORMAT_PARAM,
  HIDDEN_SERIES_PARAM,
  SHOWN_ENGINE_PARAM,
  SHOWN_FORMAT_PARAM,
  SHOWN_SERIES_PARAM,
} from '@/bench/lib/group-filter';
import { CheckIcon, LinkIcon } from '@/bench/components/icons';

/** How long the copied-confirmation state stays visible, in milliseconds. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * Build the shareable URL for a group: the landing page with the group's
 * human-readable anchor (see `lib/anchor.ts`) as the fragment, so the link
 * opens that one group whatever else is open now. When the group's filter has
 * choices, repeated `hide`, `show`, `hide-engine`, `hide-format`,
 * `show-engine` and `show-format` parameters preserve each row's, and a `group` parameter carries the same readable
 * anchor. The Engine and Format rows go as engines and formats, not as the
 * series they hide now, so they also hide the series of charts that have not
 * loaded yet. Other query parameters,
 * such as the global engine and format filters, stay unchanged.
 * [`GroupSection`] stamps the anchor as the section's `id`, so the fragment
 * names a real element on the page. On load, the pre-paint script
 * ([`OpenGroupsScript`]) opens the group before it paints ([`LandingState`]
 * does after a client navigation), and on a fresh visit `LandingState` scrolls
 * to it, unless the reader moved before hydration.
 *
 * Anchors are already fragment-safe (`[a-z0-9-]`), but the fragment is
 * percent-encoded anyway so a future anchor shape cannot silently produce an
 * invalid URL; the fragment reader (`parseOpenFragment`) decodes each token.
 *
 * Exported so the URL shape is unit-testable without a clipboard.
 */
export function groupPermalinkUrl(
  anchor: string,
  choices: GroupFilterChoices,
  loc: Pick<Location, 'origin' | 'pathname' | 'search'>,
): string {
  const url = new URL(`${loc.origin}${loc.pathname}${loc.search}`);
  const params: [string, readonly string[]][] = [
    [HIDDEN_SERIES_PARAM, choices.hiddenSeries],
    [SHOWN_SERIES_PARAM, choices.shownSeries],
    [HIDDEN_ENGINE_PARAM, choices.hiddenEngines],
    [HIDDEN_FORMAT_PARAM, choices.hiddenFormats],
    [SHOWN_ENGINE_PARAM, choices.shownEngines],
    [SHOWN_FORMAT_PARAM, choices.shownFormats],
  ];
  url.searchParams.delete(GROUP_FILTER_PARAM);
  for (const [name] of params) {
    url.searchParams.delete(name);
  }
  if (params.some(([, values]) => values.length > 0)) {
    url.searchParams.set(GROUP_FILTER_PARAM, anchor);
    for (const [name, values] of params) {
      for (const value of [...new Set(values)].sort()) {
        url.searchParams.append(name, value);
      }
    }
  }
  return `${url.origin}${url.pathname}${url.search}#${encodeURIComponent(anchor)}`;
}

/**
 * The copy-link control in a group's summary header: a real link to the group
 * (`/#<anchor>`, and once mounted the full permalink with the page's filters). Without JavaScript it is a plain link, which a reader can
 * follow or copy, named "Link to <group>". Once it has mounted, its name and
 * title say "Copy link", and a plain click (or Enter, or Space as on the
 * button it used to be) copies the group's permalink (see
 * [`groupPermalinkUrl`]) to the clipboard instead, including its current
 * series overrides, and once the copy has succeeded swaps the link glyph for
 * a checkmark for a moment as confirmation. A click with a modifier key stays
 * a link click, so opening the group in a new tab or window still works (a
 * middle click arrives as `auxclick`, which this never handles). The server
 * and the first client render both carry the link wording, so hydration
 * matches.
 *
 * It leaves the address bar alone: the fragment there holds the page's open
 * groups (`lib/open-groups.ts`), not a single group's link. Where the browser
 * has no Clipboard API (plain-HTTP hosts) or refuses the write, nothing was
 * copied, so the control claims nothing.
 *
 * The link lives inside the disclosure's `<summary>`. `preventDefault` stops
 * the navigation, so copying a link never leaves or scrolls the page, and
 * `stopPropagation` keeps the click from the summary, so it never collapses
 * the group.
 */
export function GroupPermalink({
  anchor,
  groupName,
  groupSlug,
}: {
  anchor: string;
  groupName: string;
  groupSlug: string;
}) {
  const [copied, setCopied] = useState(false);
  // False on the server and in the first client render, so both name a plain
  // link; true once mounted, when a click copies.
  const [copies, setCopies] = useState(false);
  // The server and first render link to `/#<anchor>` (`/bench#<anchor>` away from
  // bench's own host). Once mounted, the href
  // is the permalink a copy writes (global filters and this group's series),
  // so a modified or middle click opens what a plain click would copy.
  const path = useBenchPath();
  const [href, setHref] = useState(path(`/#${encodeURIComponent(anchor)}`));
  const permalink = useCallback((): string => {
    return groupPermalinkUrl(anchor, getGroupSnapshot(groupSlug), window.location);
  }, [anchor, groupSlug]);
  const refreshHref = useCallback((): void => {
    setHref(permalink().slice(window.location.origin.length));
  }, [permalink]);
  useEffect(() => {
    refreshHref();
  }, [refreshHref]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);

  // Switch to the copy wording, cancel a pending feedback reset on unmount so
  // it never fires after the island is gone, and note the unmount so a copy
  // that settles later shows nothing.
  useEffect(() => {
    mountedRef.current = true;
    setCopies(true);
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const showCopied = (): void => {
    if (!mountedRef.current) {
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setCopied(false);
      timerRef.current = null;
    }, COPIED_FEEDBACK_MS);
  };

  const copy = (): void => {
    const url = permalink();
    // Older browsers and plain-HTTP hosts have no Clipboard API.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      return;
    }
    void clipboard.writeText(url).then(showCopied, () => {
      // The browser refused the write: nothing was copied, so the control
      // does not say otherwise.
    });
  };

  return (
    <a
      className={`group-permalink${copied ? ' group-permalink--copied' : ''}`}
      href={href}
      onPointerDown={refreshHref}
      onFocus={refreshHref}
      title={copies ? 'Copy link to this group' : 'Link to this group'}
      aria-label={`${copies ? 'Copy link' : 'Link'} to ${groupName}`}
      onClick={(e) => {
        // A modified click opens the link as the reader asked (a new tab or
        // window).
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
          return;
        }
        // Copy instead of following the link, and keep the click from the
        // <summary>, which would toggle the group.
        e.preventDefault();
        e.stopPropagation();
        copy();
      }}
      onKeyDown={(e) => {
        // A link activates on Enter alone; Space also activated the button
        // this control was. preventDefault stops Space scrolling the page.
        if (e.key === ' ') {
          e.preventDefault();
          copy();
        }
      }}
    >
      {copied ? <CheckIcon /> : <LinkIcon />}
      <span className="vx-sr-only" role="status">
        {copied ? 'Link copied' : ''}
      </span>
    </a>
  );
}
