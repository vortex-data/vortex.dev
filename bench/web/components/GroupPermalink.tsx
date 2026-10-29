// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useRef, useState } from 'react';

import { getGroupSnapshot } from '@/lib/chart-store';
import { GROUP_FILTER_PARAM, HIDDEN_SERIES_PARAM, SHOWN_SERIES_PARAM } from '@/lib/group-filter';
import { CheckIcon, LinkIcon } from '@/components/icons';

/** How long the copied-confirmation state stays visible, in milliseconds. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * Build the shareable URL for a group: the landing page with the group's
 * human-readable anchor (see `lib/anchor.ts`) as the fragment, so the link
 * opens that one group whatever else is open now. When the group has local
 * series overrides, repeated `hide` and `show` parameters preserve them and a
 * `group` parameter carries the same readable anchor. Other query parameters,
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
  hiddenSeries: readonly string[],
  shownSeries: readonly string[],
  loc: Pick<Location, 'origin' | 'pathname' | 'search'>,
): string {
  const url = new URL(`${loc.origin}${loc.pathname}${loc.search}`);
  url.searchParams.delete(GROUP_FILTER_PARAM);
  url.searchParams.delete(HIDDEN_SERIES_PARAM);
  url.searchParams.delete(SHOWN_SERIES_PARAM);
  if (hiddenSeries.length > 0 || shownSeries.length > 0) {
    url.searchParams.set(GROUP_FILTER_PARAM, anchor);
    for (const label of [...new Set(hiddenSeries)].sort()) {
      url.searchParams.append(HIDDEN_SERIES_PARAM, label);
    }
    for (const label of [...new Set(shownSeries)].sort()) {
      url.searchParams.append(SHOWN_SERIES_PARAM, label);
    }
  }
  return `${url.origin}${url.pathname}${url.search}#${encodeURIComponent(anchor)}`;
}

/**
 * The copy-link control in a group's summary header: a real link to the group
 * (`/#<anchor>`). Without JavaScript it is a plain link, which a reader can
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
    const snapshot = getGroupSnapshot(groupSlug);
    const url = groupPermalinkUrl(
      anchor,
      snapshot.hiddenSeries,
      snapshot.shownSeries,
      window.location,
    );
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
      href={`/#${encodeURIComponent(anchor)}`}
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
      <span className="visually-hidden" role="status">
        {copied ? 'Link copied' : ''}
      </span>
    </a>
  );
}
