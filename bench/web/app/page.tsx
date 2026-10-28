// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Suspense } from 'react';

import { Footer } from '@/components/Footer';
import { GroupNav } from '@/components/GroupNav';
import { GroupSection } from '@/components/GroupSection';
import { Header } from '@/components/Header';
import { HomeLoading } from '@/components/HomeLoading';
import { groupAnchors } from '@/lib/anchor';
import { parseFilterCsv, singleSearchParam } from '@/lib/chart-format';
import { cachedFilterUniverse, cachedGroups } from '@/lib/data-cache';
import { parseGroupFilter, type GroupFilter } from '@/lib/group-filter';

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
 * `GROUP_ORDER`, each with its summary card, per-group toolbar, and a grid of
 * chart-card client islands. `data-chart-index` is assigned page-wide so each
 * chart's index is unique across every group (matching v3's `landing_body`
 * counter).
 *
 * `?engine=` / `?format=` are the global filter's URL allowlists (CSV). A
 * A readable `?group=` anchor plus repeated `?hide=` / `?show=` values restores
 * the target group's local series overrides.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const initialEngines = parseFilterCsv(singleSearchParam(params.engine));
  const initialFormats = parseFilterCsv(singleSearchParam(params.format));
  const initialGroupFilter = parseGroupFilter(params);

  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent
        initialEngines={initialEngines}
        initialFormats={initialFormats}
        initialGroupFilter={initialGroupFilter}
      />
    </Suspense>
  );
}

async function HomeContent({
  initialEngines,
  initialFormats,
  initialGroupFilter,
}: {
  initialEngines: string[] | null;
  initialFormats: string[] | null;
  initialGroupFilter: GroupFilter | null;
}) {
  const [groups, universe] = await Promise.all([cachedGroups(), cachedFilterUniverse()]);
  // Human-readable permalink anchors, one per section in render order (see
  // lib/anchor.ts for why these are not the opaque API slugs).
  const anchors = groupAnchors(groups.map((group) => group.name));
  let nextIndex = 0;
  return (
    <>
      <Header universe={universe} initialEngines={initialEngines} initialFormats={initialFormats} />
      <GroupNav
        groups={groups.map((group, i) => ({
          name: group.name,
          slug: group.slug,
          anchor: anchors[i],
        }))}
      />
      <main>
        {groups.length === 0 ? (
          <p className="empty">No data ingested yet.</p>
        ) : (
          <>
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
                  anchor={anchors[i]}
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
            {/* v3's landing_body early-returns on an empty database, so the
                no-JS hint only renders alongside actual chart shells. */}
            <noscript>
              <p className="no-script">JavaScript is required to render the charts.</p>
            </noscript>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
