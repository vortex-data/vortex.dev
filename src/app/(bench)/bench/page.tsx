// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Suspense } from 'react';

import { Footer } from '@/components/Footer';
import { GroupNav } from '@/components/GroupNav';
import { GroupSection } from '@/components/GroupSection';
import { Header } from '@/components/Header';
import { HomeLoading } from '@/components/HomeLoading';
import { LandingState } from '@/components/LandingState';
import { OpenGroupsScript } from '@/components/OpenGroupsScript';
import { groupAnchors } from '@/lib/anchor';
import { type FilterUniverse, parseFilterCsv, singleSearchParam } from '@/lib/chart-format';
import { cachedFilterUniverse, cachedGroups } from '@/lib/data-cache';
import { parseGroupFilter } from '@/lib/group-filter';
import type { Group } from '@/lib/queries';
import { settlesWithin } from '@/lib/settles-within';

// Rendered per request, with CDN caching layered on by `vercel.json`: each
// render reads every group from Postgres via `collectGroups()`, and Vercel's
// CDN caches the response for five minutes via a `Vercel-CDN-Cache-Control`
// header rule on `/`, matching the `/api/*` routes' `READ_API_CACHE_CONTROL`
// cadence. A plain `Cache-Control` rule cannot express this: Next.js emits
// `Cache-Control: no-store` in the function response for `force-dynamic`
// pages, and function-emitted `Cache-Control` takes precedence over header
// rules from config files. `Vercel-CDN-Cache-Control` is consumed (and
// stripped) by Vercel's CDN alone at the highest precedence, so the config
// rule drives CDN caching while browsers still revalidate on every load.
// `force-dynamic` keeps `next build` independent of a live database.
export const dynamic = 'force-dynamic';

/**
 * The landing page: a server-rendered section per group in canonical
 * `GROUP_ORDER`, each collapsed to its header row (with the headline) and its
 * summary card, and opening to its per-group toolbar and a grid of chart-card
 * client islands (mounted only while the group is open). `data-chart-index` is assigned page-wide so
 * each chart's index is unique across every group (matching v3's
 * `landing_body` counter).
 *
 * `?engine=` / `?format=` are the global filter's URL allowlists (CSV). A
 * readable `?group=` anchor plus repeated `?hide=` / `?show=` values restores
 * the target group's local series overrides.
 *
 * The URL fragment lists the open groups' anchors (`#tpc-h-nvme-sf-1,clickbench`,
 * see `lib/open-groups.ts`). The server never sees it, so `/` stays one CDN
 * cache entry. [`OpenGroupsScript`], whose scripts sit before the first group
 * and after the last, opens each listed group before it paints, even while
 * the page is still arriving; [`LandingState`] opens them after a client
 * navigation (after a full load it keeps what the reader opened or closed
 * before hydration), writes the fragment after opens and closes (coalescing a
 * burst of toggles into two writes), and owns the scroll: a reload or Back
 * restores the element that was at the top of the viewport
 * (`lib/scroll-restore.ts`), and a fresh visit scrolls to the first listed
 * group. Neither moves a reader who scrolled, touched, clicked or pressed a
 * key before hydration.
 *
 * Each request decides how to send the groups. It starts reading the data and
 * waits up to [`LOADING_VIEW_AFTER_MS`] for it:
 *
 * - If the read settles in time (a Data Cache hit, nearly every request), the
 *   page renders the groups directly, with no Suspense boundary: ordinary,
 *   visible HTML, so a reader without JavaScript sees every group's header row
 *   and summary table. A read that fails in time fails the render: a real 500.
 * - Otherwise (a miss: a cold database read) it renders a Suspense boundary
 *   whose fallback is the loading view ([`HomeLoading`]), around a component
 *   that awaits the same read. The loading view streams at once and the groups
 *   follow into a hidden segment that React's inline script reveals. A client
 *   navigation to `/` shows the loading view the same way. Without JavaScript
 *   the reveal never runs, so the loading view says to reload.
 *
 * See `docs/architecture/performance.md` for the measured cost of each path.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const data: Promise<LandingData> = Promise.all([
    searchParams,
    cachedGroups(),
    cachedFilterUniverse(),
  ]);
  if (await settlesWithin(data, LOADING_VIEW_AFTER_MS)) {
    return <HomeContent data={await data} />;
  }
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeStreamed data={data} />
    </Suspense>
  );
}

/**
 * How long the landing page waits for its data before it streams the loading
 * view instead. A Data Cache hit reads in a few milliseconds, well inside it,
 * so the common case stays plain HTML; a miss reads the database, about half a
 * second locally and seconds in production after an idle gap. Long enough that
 * a busy server's hit still lands inside it, short enough that a reader on a
 * miss sees the loading view almost at once.
 */
const LOADING_VIEW_AFTER_MS = 150;

type SearchParams = Record<string, string | string[] | undefined>;
type LandingData = [SearchParams, Group[], FilterUniverse];

/** The groups once a slow read finishes, streamed behind the loading view. */
async function HomeStreamed({ data }: { data: Promise<LandingData> }) {
  return <HomeContent data={await data} />;
}

/** The landing page's header, groups and footer, from data already read. */
function HomeContent({ data: [params, groups, universe] }: { data: LandingData }) {
  const initialEngines = parseFilterCsv(singleSearchParam(params.engine));
  const initialFormats = parseFilterCsv(singleSearchParam(params.format));
  const initialGroupFilter = parseGroupFilter(params);
  // Human-readable permalink anchors, one per section in render order (see
  // lib/anchor.ts for why these are not the opaque API slugs).
  const anchors = groupAnchors(groups.map((group) => group.name));
  let nextIndex = 0;
  return (
    <>
      <Header universe={universe} initialEngines={initialEngines} initialFormats={initialFormats} />
      <GroupNav groups={groups.map((group) => ({ name: group.name, slug: group.slug }))} />
      <main>
        {groups.length === 0 ? (
          <p className="empty">No data ingested yet.</p>
        ) : (
          <>
            {/* Shown only with JavaScript off, above the groups. */}
            <noscript>
              <p className="no-script no-script--lead">
                These summaries are complete without JavaScript. The charts need it.
              </p>
            </noscript>
            {/* Its scripts sit before the first group and after the last, so
                it opens each of the fragment's groups before it paints. */}
            <OpenGroupsScript>
              {groups.map((group, i) => {
                const startIndex = nextIndex;
                nextIndex += group.charts.length;
                // Accept opaque values copied by the first permalink version,
                // but generate readable anchors for every new link.
                const ownsInitialFilter =
                  initialGroupFilter?.groupAnchor === anchors[i] ||
                  initialGroupFilter?.groupAnchor === group.slug;
                return (
                  <GroupSection
                    key={group.slug}
                    group={group}
                    anchor={anchors[i]!}
                    startIndex={startIndex}
                    universe={universe}
                    initialHiddenSeries={
                      ownsInitialFilter ? (initialGroupFilter?.hiddenSeries ?? []) : []
                    }
                    initialShownSeries={
                      ownsInitialFilter ? (initialGroupFilter?.shownSeries ?? []) : []
                    }
                  />
                );
              })}
            </OpenGroupsScript>
          </>
        )}
      </main>
      <LandingState />
      <Footer />
    </>
  );
}
