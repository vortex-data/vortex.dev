// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useRef, useState } from 'react';

import { getGroupSnapshot } from '@/lib/chart-store';
import { GROUP_FILTER_PARAM, HIDDEN_SERIES_PARAM, SHOWN_SERIES_PARAM } from '@/lib/group-filter';

/** How long the copied-confirmation state stays visible, in milliseconds. */
const COPIED_FEEDBACK_MS = 1500;

/**
 * Build the shareable URL for a group: the landing page with the group's
 * human-readable anchor (see `lib/anchor.ts`) as the fragment. When the group
 * has local series overrides, repeated `hide` and `show` parameters preserve
 * them and a `group` parameter carries the same readable anchor. Other query
 * parameters, such as the global engine and format filters, stay unchanged.
 * [`GroupSection`] stamps the anchor as the section's `id`, so the fragment is
 * a real anchor even without JavaScript; with JavaScript, [`GroupNav`]'s
 * hash-jump effect also expands the group's disclosure on load.
 *
 * Anchors are already fragment-safe (`[a-z0-9-]`), but the fragment is
 * percent-encoded anyway so a future anchor shape cannot silently produce an
 * invalid URL; the hash-jump effect decodes symmetrically.
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
 * The copy-link button in a group's summary header. Clicking it copies the
 * group's permalink (see [`groupPermalinkUrl`]) to the clipboard, including
 * its current series overrides. It mirrors the URL into the address bar
 * via `history.replaceState` (so the URL is shareable even where the Clipboard
 * API is unavailable, e.g. plain-HTTP dev hosts), and swaps the link glyph for
 * a checkmark for a moment as confirmation.
 *
 * The button lives inside the disclosure's `<summary>`, where any unhandled
 * click toggles the group open/closed; `preventDefault` suppresses that
 * native toggle so copying a link never collapses the group.
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending feedback reset on unmount so it never fires after the
  // island is gone.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <button
      className={`group-permalink${copied ? ' group-permalink--copied' : ''}`}
      type="button"
      title="Copy link to this group"
      aria-label={`Copy link to ${groupName}`}
      onClick={(e) => {
        // A <summary> toggles its <details> on any unhandled click;
        // preventDefault keeps the copy action from also collapsing the group.
        e.preventDefault();
        e.stopPropagation();
        const snapshot = getGroupSnapshot(groupSlug);
        const url = groupPermalinkUrl(
          anchor,
          snapshot.hiddenSeries,
          snapshot.shownSeries,
          window.location,
        );
        // Reflect the URL in the address bar first: it is the no-clipboard
        // fallback, and replaceState does not navigate, so the page stays put.
        const next = new URL(url);
        window.history.replaceState(null, '', `${next.pathname}${next.search}${next.hash}`);
        void navigator.clipboard?.writeText(url).catch(() => {
          // Clipboard denied or unavailable: the address bar already carries
          // the fragment, so there is nothing further to do.
        });
        setCopied(true);
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, COPIED_FEEDBACK_MS);
      }}
    >
      {copied ? <CheckIcon /> : <LinkIcon />}
      <span className="visually-hidden" role="status">
        {copied ? 'Link copied' : ''}
      </span>
    </button>
  );
}

/** A chain-link glyph, matching the header icons' stroke style. */
function LinkIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

/** The copied-confirmation checkmark. */
function CheckIcon() {
  return (
    <svg
      className="btn-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
