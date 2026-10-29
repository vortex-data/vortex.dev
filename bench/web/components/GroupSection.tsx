// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright the Vortex contributors

import { Fragment } from 'react';

import { GroupBody } from '@/components/GroupBody';
import { GroupDocsLink } from '@/components/GroupDocsLink';
import { GroupPermalink } from '@/components/GroupPermalink';
import { SummaryCard } from '@/components/SummaryCard';
import { groupDocUrl } from '@/lib/benchmark-docs';
import type { FilterUniverse } from '@/lib/chart-format';
import { groupHeadline } from '@/lib/headline';
import type { Group } from '@/lib/queries';

const NO_INITIAL_HIDDEN_SERIES: string[] = [];
const NO_INITIAL_SHOWN_SERIES: string[] = [];

/**
 * One group's landing-page section, the server-component port of
 * `server/src/html/landing.rs`'s per-group markup.
 *
 * Everything lives inside one native `<details class="group-disclosure">`,
 * folded by default: the `<summary>` row, then the group's [`SummaryCard`],
 * then its [`GroupBody`]. Nothing follows the `<details>` inside the section.
 * While folded, the browser itself hides everything but the summary row, so
 * this holds before hydration too. The summary card is server-rendered, so an
 * open group shows its rankings before hydration. (With JavaScript off, the
 * page shows no group at all: the groups stream inside the landing page's
 * Suspense boundary, whose hidden segment only React's inline script reveals;
 * see `app/page.tsx`.)
 *
 * [`GroupBody`] is a client component. It server-renders as an empty
 * `<div class="group-body">` and mounts the group toolbar (group Y override,
 * series filter, empty-charts toggle, reset) and the chart grid only while the
 * disclosure is open, unmounting them on close. A folded group therefore ships
 * no chart markup and hydrates no chart island. Each chart is a [`Chart`]
 * island carrying `data-chart-slug` and a page-unique `data-chart-index`; the
 * island lazily loads its data through the group's bundle when it mounts into
 * an open group, and keeps listening for the disclosure's native `toggle`
 * event.
 *
 * The summary row ends with the group's headline (`lib/headline.ts`): one line
 * of text saying how Vortex compares with Parquet, so a folded group still
 * says something. It is plain text inside the `<summary>`; the tone on each
 * part only styles it, and a slower result reads in words, never by color
 * alone. A group whose summary has nothing honest to say shows no headline.
 *
 * The group title carries two affordances beyond the disclosure itself: the ⓘ
 * tooltip with the editorial one-liner from `lib/descriptions.ts`, and a
 * [`GroupDocsLink`] to the benchmark's explainer doc in the monorepo, which
 * `lib/benchmark-docs.ts` derives from the group slug's dataset name.
 *
 * `startIndex` is the running page-wide chart index of this group's first
 * chart, so `data-chart-index` is unique across every chart on the page and
 * load priority keeps its page-wide order.
 *
 * The section carries `id={anchor}` — the human-readable anchor the page
 * derives from the group name via `lib/anchor.ts` (`#tpc-h-nvme-sf-1`, not the
 * opaque API slug) — so each group has a stable, legible URL fragment: the
 * summary row's [`GroupPermalink`] button copies `/#<anchor>`, which names a
 * real element on the page. The page's fragment lists every open group's
 * anchor (`lib/open-groups.ts`); the pre-paint script ([`OpenGroupsScript`])
 * opens those groups before the first paint, and [`LandingState`] keeps the
 * fragment in step with every toggle.
 */
export function GroupSection({
  group,
  anchor,
  startIndex,
  universe,
  initialHiddenSeries = NO_INITIAL_HIDDEN_SERIES,
  initialShownSeries = NO_INITIAL_SHOWN_SERIES,
}: {
  group: Group;
  anchor: string;
  startIndex: number;
  universe: FilterUniverse;
  initialHiddenSeries?: string[];
  initialShownSeries?: string[];
}) {
  const chartCount = group.charts.length;
  // The ⓘ blurb's long form: the benchmark's explainer doc in the monorepo,
  // selected by the dataset name inside the group's slug (`null` if the slug
  // does not parse or no matching explainer exists).
  const docUrl = groupDocUrl(group.slug);
  const headline = groupHeadline(group.summary);
  return (
    <section
      className="group-details"
      id={anchor}
      data-group-name={group.name}
      data-group-slug={group.slug}
    >
      {/* The pre-paint script (`OpenGroupsScript`) may add `open` to this
          element before hydration, when the URL fragment lists the group. */}
      <details className="group-disclosure" suppressHydrationWarning>
        <summary className="group-summary">
          <span className="group-summary-row">
            <span className="group-name">{group.name}</span>
            {group.description !== undefined && (
              <span
                className="group-info-icon"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: the icon takes focus so its tooltip shows for keyboard users.
                tabIndex={0}
                role="note"
                aria-label={group.description}
                data-tooltip={group.description}
              >
                ⓘ
              </span>
            )}
            {docUrl !== null && <GroupDocsLink href={docUrl} groupName={group.name} />}
            <span className="group-count">
              {chartCount} chart{chartCount !== 1 ? 's' : ''}
            </span>
            <GroupPermalink anchor={anchor} groupName={group.name} groupSlug={group.slug} />
            {headline !== null && (
              <span className="group-headline">
                {headline.parts.map((part, i) => (
                  <Fragment key={part.text}>
                    {i > 0 && ' · '}
                    <span className="group-headline-part" data-tone={part.tone}>
                      {part.text}
                    </span>
                  </Fragment>
                ))}
                {headline.suffix !== null && ` ${headline.suffix}`}
                {headline.partial && ' (partial)'}
              </span>
            )}
          </span>
        </summary>
        <SummaryCard summary={group.summary} />
        <GroupBody
          groupSlug={group.slug}
          charts={group.charts}
          startIndex={startIndex}
          universe={universe}
          initialHiddenSeries={initialHiddenSeries}
          initialShownSeries={initialShownSeries}
        />
      </details>
    </section>
  );
}
