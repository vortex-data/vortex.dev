<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench: a folded landing page (option B)

Status: design, 2026-10-29. Step 2 of 3 (step 1 is the toolchain move and
cleanup in PRs 1 and 2; step 3 is the cross-site visual redesign).

## Why

bench's landing page (`/`) shows 23 groups and 791 charts. Today every group
starts folded, but the page is still heavy and long:

- each group shows its full summary card while folded, so the folded page is
  23 summary cards tall;
- every one of the 791 chart cards is server-rendered and hydrated at load,
  with its listeners, even though no group is open;
- which groups are open lives only in the DOM, so a reload, Back from a chart
  page or a shared link brings every group back folded.

Will looks at charts on about 20% of visits and thinks most people do too.
Mikhail (a key user) browses with restrictive privacy settings, including no
WebGL, and wants pages to load very fast. Will: a short page of headlines is
acceptable if it loads fast and Back returns to the exact spot. Will chose
this option (B) from three mockups on 2026-10-28 (copy of the mockup:
`bench-landing-options-2026-10-28.html` in the session notes).

## Goals

- The folded page is short: one row per group, with the group's name, chart
  count and a headline that says how Vortex compares to Parquet.
- Nothing chart-related loads or hydrates until a group is opened.
- Opening a group shows its full summary card, its toolbar and its charts in
  place, exactly as today.
- The URL records which groups are open. Reload, Back from a chart page and a
  shared link reopen them before the first paint, and the browser's scroll
  restoration lands on the same spot.
- It works with JavaScript-heavy features limited: no WebGL anywhere (charts
  stay Chart.js on 2D canvas), and the folded page is readable before any
  client JavaScript runs.

## Non-goals

- Visual redesign: colors, fonts and layout polish are step 3.
- New API routes, new queries, or changes to the summary math. The headline is
  derived from the `summary` each group already carries.
- Changing the chart page (`/chart/{slug}`), the APIs, caching rules or the
  loading machinery (`lib/chart-store` queues, bundles, full history).
- Removing the global engine/format filter, the group toolbar or permalinks.

## Anti-goals

- A folded page that hides a result that looks bad for Vortex. The headline
  shows slower results in words ("4.0× slower"), not only in color.
- A flash of folded content before reopening groups on reload or Back.
- Breaking existing links: old `#group-anchor` permalinks and
  `?group=…&hide=…&show=…` URLs keep working.

## Decided by Will

- Option B: one page, every group folded with its headline numbers, opening a
  group loads its charts in place, open groups kept in the URL.
- Fast loads and exact Back behavior matter more than showing every chart at
  once; Mikhail's preferences are a direction, not hard rules.

## My calls (Will was away; each is easy to change)

1. **Headline content**, computed by a pure server-side function from
   `Group.summary`:
   - `queryBenchmark`: per engine that ran both, `score(engine:parquet) /
     score(engine:vortex-file-compressed)`, shown as "DuckDB 2.5× faster ·
     DataFusion 2.3× faster". Within ±5% it reads "≈ same"; below 1 it reads
     "N× slower". Groups without a Parquet run read "Vortex only".
   - `compression`: "encode 1.6× · decode 5.1× faster than Parquet" from the
     `vortex-file-compressed` ratios.
   - `compressionSize`: "7% larger than Parquet" (or "smaller") from `ratio`.
   - `randomAccess`: "hot 60× · cold 32× faster than Parquet" from the hot and
     cold scores.
   - `vectorSearch`: no Parquet series; show the fastest flavor ("fastest:
     vortex-turboquant").
   - Partial coverage (`measured < total` for either side) adds "(partial)".
   - If a summary is missing or the needed series are absent, the row shows no
     headline rather than a misleading number.
2. **The full summary card moves inside the open body**, above the group
   toolbar, so the folded row is one line on desktop (two on a phone).
3. **Chart cards render only for open groups.** The group body is a client
   component that mounts `GroupToolbar` and the chart grid when its group is
   open and unmounts them on close (today's close already aborts fetches).
   Bundles fetched in this session stay cached, so reopening is instant. The
   page-wide chart index used for loading priority keeps today's numbering.
4. **URL state in the fragment, not the query.** `#tpc-h-nvme-sf-10` (one
   group) or `#tpc-h-nvme-sf-10,clickbench` (several), using the existing
   anchors from `lib/anchor.ts`. A fragment never reaches the CDN, so `/` keeps
   one cache entry. Every open or close updates the fragment with
   `history.replaceState` (no history entry per click). Expand All writes every
   anchor; Collapse All clears the fragment. An old single-anchor permalink
   still opens and scrolls to that group.
5. **Open before first paint.** A small inline script right after the groups'
   markup reads the fragment and sets `open` on the matching `<details>` before
   the browser paints, so reload and Back show open groups immediately and the
   browser's own scroll restoration lands correctly. The React side reads the
   same state on hydration. The script is the only inline script; it uses no
   external input other than the fragment, which it matches against known
   anchors.
6. **Back from a chart page.** Chart titles stay plain links (a full
   navigation). Back reloads `/` from the CDN with the fragment, and step 5
   restores the open groups. Fixed-height chart placeholders (already 420/450
   px) keep positions stable while charts load. Cards classified empty after
   the bundle arrives are hidden today, which can shift content below them;
   keep that behavior, but measure it (see Proof).
7. **No change to `Cache-Control`.** The page keeps `no-store` for browsers and
   `Vercel-CDN-Cache-Control` for the CDN. Whether Chrome's back/forward cache
   applies is measured, not assumed; call 8 makes Back correct either way.
8. **The page restores scroll itself, by element, not by pixel.** The server
   can't see the fragment, so an open group's body (toolbar and chart cards,
   with their fixed-height placeholders) exists only after hydration; the
   browser's own restoration would land against a shorter page. On `/`, set
   `history.scrollRestoration = 'manual'`. On `pagehide`, and before following a
   chart link, save to `sessionStorage` (keyed by path and fragment) the element
   nearest the top of the viewport — a chart card (`data-chart-slug`) or else a
   group section (`data-group-slug`) — and its offset from the viewport top.
   On reload or Back (`navigation.type` is `reload` or `back_forward`), restore
   by scrolling that element to the saved offset once the open groups' bodies
   have mounted, and once more after their bundles settle (empty-card hiding
   can shift content), unless the user scrolled in between. "Same spot" means
   the same element at the same offset within a few pixels, not an identical
   `scrollY`. Layout shift is measured and reported, not a gate. If nothing was
   saved, fall back to the fragment scroll in call 9.
9. **When the page scrolls to the fragment.** Only on a fresh visit
   (`navigation.type === 'navigate'` and nothing saved): open every listed
   group and scroll to the first one, as today's `jumpToLocationHash` does for
   a single anchor. Reload and Back never fragment-scroll; call 8 owns them. A
   malformed fragment is ignored (today's `decodeURIComponent` can throw).
10. **What survives close and reopen.** Closing unmounts the group's chart
    cards, so per-chart zoom, the scope slider and a loaded full history are
    lost; reopening starts those charts fresh (the session's bundle cache makes
    it instant). Group-level state survives: the series filter and group Y live
    in the group store, and `initGroupFilter` seeds from the URL only once per
    group per page load, so a remount does not overwrite the user's overrides.
11. **Summary card placement.** `SummaryCard` stays a server component,
    rendered inside the `<details>` (hidden natively while folded, shown when
    open, and readable without JavaScript). Smaller landing HTML is a side
    effect of dropping 791 chart shells, not a success criterion.
12. **Group nav and permalinks.** A group-nav click adds that group to the open
    set (opens it, scrolls to it, updates the fragment). A permalink copies a
    link to that one group (its anchor plus its own `group`/`hide`/`show`
    overrides, as today) and no longer rewrites the address bar, which now
    holds the open set. Tests that pin the old outputs are rewritten.

## Constraints

- Global constraints from the PR series (`bench/docs/plans/
  2026-10-28-toolchain-and-cleanup.md`): supply-chain gates, Biome style for
  bench, SPDX headers, DCO sign-off, no settings changes without Will.
- The API responses must not change; the parity harness's API and chart-page
  comparisons stay at 0 mismatches. Landing-page screenshots change by design.
- Keep `<details>`/`<summary>` for groups: native keyboard support, and the
  chart islands' existing `toggle` contract.
- Accessibility: the headline is text inside the `<summary>`; nothing new is
  conveyed by color alone; no new focusable element without keyboard support.

## Proof

1. Unit tests for the headline function on every summary variant, including
   slower, ≈ same, partial coverage, missing series and Vortex-only.
2. Component tests: folded rows render no chart markup; opening mounts the
   grid and fetches one bundle; closing unmounts and aborts; the fragment
   updates on open, close, Expand All and Collapse All; an old single-anchor
   permalink still opens and scrolls.
3. Parity harness: 0 API and chart-page mismatches against PR 2's head. New
   landing screenshots replace the old baselines; record them in the PR.
4. Measured with the parity servers and Playwright, before and after (a
   throwaway script on the local production dump; numbers go in the PR body):
   landing HTML bytes, JavaScript executed, number of hydrated islands, first
   contentful paint, Total Blocking Time (as the proxy for time to
   interactive), and layout shift when opening a group and when coming Back
   with two groups open; plus whether Back restored the same element at the
   same offset. PR 3 is stacked on PR 2's branch (`claude/bench-cleanup`), and
   parity's base is that branch's head.
5. Will's smoke test in the preview: reload and Back from a chart page land
   on the same spot with the same groups open.

## Left to the builder

- Component boundaries for the group body and the URL-state helper.
- The exact headline wording within the rules above.
- How Expand All behaves with 23 groups (it may open them all at once, as
  today, through the existing bundle queue).
