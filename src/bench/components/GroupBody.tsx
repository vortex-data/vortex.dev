// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Chart } from '@/components/Chart';
import { GroupToolbar } from '@/components/GroupToolbar';
import { chartPriority, type FilterUniverse } from '@/lib/chart-format';
import { abortGroupBundle, ensureGroupBundle } from '@/lib/chart-store';
import { noteGroupBodyClosed, noteGroupBodyOpen, seedGroupFilterOnce } from '@/lib/group-bodies';
import type { ChartLink } from '@/lib/queries';

/** Props for one group's body. */
export interface GroupBodyProps {
  /** The group's API slug (`/api/group/{slug}` and the group store key). */
  groupSlug: string;
  /** The group's charts, in display order. */
  charts: ChartLink[];
  /** Page-wide index of the group's first chart (`data-chart-index`). */
  startIndex: number;
  /** Engine and format values for the toolbar's macro chips. */
  universe: FilterUniverse;
  /** Series the page URL hides in this group (`?group=…&hide=…`). */
  initialHiddenSeries: string[];
  /** Series the page URL shows in this group (`?group=…&show=…`). */
  initialShownSeries: string[];
}

/**
 * The open part of a landing-page group: its [`GroupToolbar`] and its chart
 * grid, one [`Chart`] island per chart. It renders in the group's section,
 * after the `<details class="group-disclosure">` and the summary card, and
 * mounts its content only while that disclosure is open. A collapsed group
 * therefore ships an empty `<div class="group-body">` and hydrates no chart
 * island.
 *
 * Open state stays native `<details>` behavior. The body listens for the
 * disclosure's `toggle` event, which fires for user clicks and for scripted
 * `open` writes (Expand All, the group nav, the fragment). Closing unmounts
 * the toolbar and cards, so per-chart state (zoom, scope, full history) starts
 * fresh on reopen; group state (series filter, group Y) lives in the group
 * store and survives. Bundles fetched in this session stay cached, so a reopen
 * fetches nothing.
 *
 * Each island keeps its own `toggle` listener and the loading machinery in
 * `lib/chart-store` is unchanged: the islands start the group's bundle and arm
 * lazy hydration when they mount into an open group.
 */
export function GroupBody({
  groupSlug,
  charts,
  startIndex,
  universe,
  initialHiddenSeries,
  initialShownSeries,
}: GroupBodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Starts closed, so hydration matches the server's empty body; the layout
  // effect below opens it before paint when the disclosure is already open.
  const [open, setOpen] = useState(false);

  // Restore a shared group permalink's series overrides, once per page load,
  // so a remount never overwrites the user's later changes.
  useEffect(() => {
    seedGroupFilterOnce(groupSlug, initialHiddenSeries, initialShownSeries);
  }, [groupSlug, initialHiddenSeries, initialShownSeries]);

  useLayoutEffect(() => {
    const details = ref.current
      ?.closest('.group-details')
      ?.querySelector<HTMLDetailsElement>('details.group-disclosure');
    if (!details) {
      return;
    }
    // The pre-paint script may already have opened the disclosure.
    setOpen(details.open);
    const onToggle = (): void => {
      if (details.open) {
        setOpen(true);
        return;
      }
      // Abort the bundle here, before the state change. The browser runs
      // microtasks between listeners, so React can unmount the islands and
      // remove their `toggle` listeners before those run; the islands' own
      // close abort would then never happen.
      abortGroupBundle(groupSlug);
      setOpen(false);
    };
    details.addEventListener('toggle', onToggle);
    return () => details.removeEventListener('toggle', onToggle);
  }, [groupSlug]);

  // Tell the scroll restorer the cards are in the DOM, with the bundle they
  // wait for. Child effects run first, so the islands have already started the
  // bundle at this same priority and this call joins it without a request. A
  // group with no charts has no island and no bundle to wait for, so it
  // requests nothing and its wait resolves at once. The cleanup (on close or
  // unmount) only withdraws the note, so a wait that starts later holds for
  // the next mount; it never aborts the bundle, which a StrictMode replay must
  // not do.
  const hasCharts = charts.length > 0;
  useEffect(() => {
    if (!open) {
      return;
    }
    noteGroupBodyOpen(
      groupSlug,
      hasCharts ? ensureGroupBundle(groupSlug, chartPriority(startIndex)) : Promise.resolve(),
    );
    return () => noteGroupBodyClosed(groupSlug);
  }, [open, groupSlug, startIndex, hasCharts]);

  return (
    <div className="group-body" ref={ref}>
      {open && (
        <>
          <GroupToolbar groupSlug={groupSlug} universe={universe} />
          <div className="chart-grid">
            {charts.map((link, i) => (
              <Chart
                key={link.slug}
                slug={link.slug}
                name={link.name}
                index={startIndex + i}
                groupSlug={groupSlug}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
