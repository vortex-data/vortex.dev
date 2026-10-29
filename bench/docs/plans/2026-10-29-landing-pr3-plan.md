<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench PR 3: a folded landing page (option B) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bench's landing page shows one row per group with a headline that compares Vortex with Parquet. A group's toolbar and charts mount only while the group is open. The open groups are kept in the URL fragment. Reload and Back return to the same element at the same offset.

**Architecture:** One branch, `claude/bench-landing`, stacked on PR 2's `claude/bench-cleanup`, with one commit per task.
- `details.open` stays the only source of truth for "open", so the chart islands keep their `toggle` contract.
- The fragment mirrors it. A document-level `toggle` listener writes the fragment with `history.replaceState`. A constant inline script placed after the groups' markup reads it and sets `open` before first paint.
- A client `GroupBody` inside each `<details>` mounts `GroupToolbar` and the chart islands only while the group is open.
- A client `LandingState` keeps the fragment in step and scrolls to it on a fresh visit. On Reload or Back it puts the saved element back at its saved offset.

**Tech Stack:** Bun 1.4.3 workspace, Next.js 16.4.1 App Router, React 19.3.1, TypeScript 7, Biome 2.5, Vitest 5 with jsdom 30, Playwright 1.64 (parity and the throwaway measurement), Postgres 16 (Homebrew `postgresql@16`).

**Spec:** `bench/docs/plans/2026-10-29-landing-option-b.md` (the setup step copies it from `.superpowers/sdd/pr3-landing-option-b-design.md`). Its "My calls" are decisions. The style reference is `bench/docs/plans/2026-10-29-cleanup-pr2-plan.md`.

**Starts from:** PR 2's six tasks are pushed on `claude/bench-cleanup`. Paths below are after PR 2's split:
- `ensureGroupBundle`, `abortGroupBundle`, `resetPayloadCache` and `BundleResult` are in `lib/chart-store/bundles.ts`.
- `bundleQueue` is in `lib/chart-store/queues.ts`.
- `initGroupFilter`, `getGroupSnapshot` and `toggleGroupSeries` are in `lib/chart-store/group-store.ts`.
- All of them are imported from `@/lib/chart-store`.
- The `Chart` island and its mount effect stay in `components/Chart.tsx` (before the split, the priority line was around L1924 of the old file).

TypeScript has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (PR 2 Task 5). `BENCH_TEST_DATABASE_URL` runs the integration suite against Homebrew Postgres on port 55433 (`bench/web/README.md`, "Local development").

Setup:
- [ ] Work in a fresh worktree, because another session uses the PR 2 checkout: `git fetch origin && git worktree add -b claude/bench-landing ../bench-landing origin/claude/bench-cleanup`.
- [ ] Copy the design to `bench/docs/plans/2026-10-29-landing-option-b.md` and save this plan as `bench/docs/plans/2026-10-29-landing-pr3-plan.md`. Commit: `Plan bench PR 3: a folded landing page`.
- [ ] Start the test database as the README says and export `BENCH_TEST_DATABASE_URL`. Run `bun run --cwd bench/web build`, then `bun run --cwd bench/web test`. Every file passes and nothing is skipped. Record the count.

## Global Constraints

- "The API responses must not change; the parity harness's API and chart-page comparisons stay at 0 mismatches. Landing-page screenshots change by design."
- "No change to `Cache-Control`." `bench/web/vercel.json` does not change.
- Non-goals: "New API routes, new queries, or changes to the summary math. The headline is derived from the `summary` each group already carries." "Changing the chart page (`/chart/{slug}`), the APIs, caching rules or the loading machinery (`lib/chart-store` queues, bundles, full history)." "Removing the global engine/format filter, the group toolbar or permalinks." "Visual redesign: colors, fonts and layout polish are step 3."
- Anti-goals: "A folded page that hides a result that looks bad for Vortex. The headline shows slower results in words ("4.0× slower"), not only in color." "A flash of folded content before reopening groups on reload or Back." "Breaking existing links: old `#group-anchor` permalinks and `?group=…&hide=…&show=…` URLs keep working."
- "Keep `<details>`/`<summary>` for groups: native keyboard support, and the chart islands' existing `toggle` contract."
- "Accessibility: the headline is text inside the `<summary>`; nothing new is conveyed by color alone; no new focusable element without keyboard support."
- "no WebGL anywhere (charts stay Chart.js on 2D canvas), and the folded page is readable before any client JavaScript runs."
- "The script is the only inline script; it uses no external input other than the fragment, which it matches against known anchors." The layout's theme and font scripts were there before it. It is the only new inline script.
- The supply-chain gates must not get weaker: "the 14-day cooldown, explicit overrides, the lifecycle-script allowlist, SHA-pinned actions, `ubuntu-24.04` runners". This PR adds no dependency.
- The required check is named `Bench: format, lint, build, test`. "Settings changes need Will's confirmation first." Node 24 stays. Vitest stays.
- bench keeps its style: single quotes, trailing commas everywhere, 100 columns, 2-space indent. `useExhaustiveDependencies` is an error in bench, so a deliberate dependency list needs a `biome-ignore` with its reason.
- Every commit uses `git commit -s` and ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Squash merges only.
- New code files under `bench/` start with `// SPDX-License-Identifier: Apache-2.0` and `// SPDX-FileCopyrightText: Copyright the Vortex contributors`. Markdown files use CC-BY-4.0.

## Review Focus

1. **Expand All, Collapse All or fast toggling on the 23-group page.** Browsers rate-limit `history.replaceState`, and Safari throws a `SecurityError` past its limit. One click must write the URL once, and a refused write must never stop groups from opening. Task 3 pins this with `writes the fragment once per Expand All and Collapse All` and `keeps opening groups when the browser refuses a URL write`.
2. **Closing a group while its bundle is loading, in a real browser.** The browser runs microtasks between `toggle` listeners, so React can unmount the chart islands before their own close handler runs. jsdom does not run microtasks there, so the existing suites cannot see this. The request must still be cancelled, and a reopen must issue a fresh one. Task 2 pins this with `closing unmounts the body and aborts the bundle, even when no chart island hears the toggle`.
3. **A browser that blocks storage** (Mikhail's privacy settings), where reading `sessionStorage` throws. The page must work, and Back must fall back to the fragment scroll. Task 4 pins this with `saves and reads nothing, without throwing, when storage is blocked` and `falls back to the fragment scroll on Back when storage is blocked`.
4. **Back when the saved chart is no longer on the page.** The page must land on the first listed group, not stay at the top. Task 4 pins this with `falls back to the fragment scroll when the saved element is gone`.
5. **A browser that refuses the clipboard.** The permalink no longer writes the address bar, so it must not say "Link copied" when nothing was copied. Task 3 pins this with `does not claim a copy the browser refused`.

---

### Task 1: The folded row's headline

**Files:**
- Create: `bench/web/lib/headline.ts`, `bench/web/lib/headline.test.ts`
- Modify: `bench/web/components/GroupSection.tsx` (headline in the summary row), `bench/web/components/GroupSection.test.tsx`, `bench/web/app/globals.css`

**Interfaces:**
- Consumes: `Summary`, `SeriesRanking` from `@/lib/summary` (unchanged); `displayFormat` from `@/lib/chart-format`.
- Produces in `lib/headline.ts`:
  - `export type HeadlineTone = 'better' | 'worse' | 'same' | 'neutral'`
  - `export interface HeadlinePart { text: string; tone: HeadlineTone }`
  - `export interface Headline { parts: HeadlinePart[]; suffix: string | null; partial: boolean }`
  - `export function groupHeadline(summary: Summary | undefined): Headline | null`
  - `export function headlineText(headline: Headline): string`. This joins the parts with `' · '`, appends `' ' + suffix` when there is one, and appends `' (partial)'` when `partial` is true.

- [ ] **Step 1: Write the failing tests** in `lib/headline.test.ts`:

```ts
const VX = 'vortex-file-compressed';
const r = (name: string, score: number, measured = 10, total = 10): SeriesRanking =>
  ({ name, score, totalRuntime: 1, measured, total });
const vx = (engine: string, score = 1, measured = 10) => r(`${engine}:${VX}`, score, measured);
const pq = (engine: string, score: number, measured = 10) => r(`${engine}:parquet`, score, measured);
const query = (...rankings: SeriesRanking[]): Summary =>
  ({ type: 'queryBenchmark', title: 'q', rankings, explanation: 'e' });
const compression = (...rows: [string, 'encode' | 'decode', number][]): Summary => ({
  type: 'compression', title: 'Write Throughput', explanation: 'e',
  rankings: rows.map(([name, operation, ratio]) => ({ name, operation, ratio })),
});
const ra = (hot: SeriesRanking[], cold: SeriesRanking[]): Summary =>
  ({ type: 'randomAccess', hotRankings: hot, coldRankings: cold, explanation: 'e' });
const vs = (...rankings: SeriesRanking[]): Summary =>
  ({ type: 'vectorSearch', title: 'v', rankings, explanation: 'e' });
const line = (s: Summary | undefined) => { const h = groupHeadline(s); return h && headlineText(h); };

it('compares Vortex with Parquet per engine, DuckDB first', () => {
  const s = query(vx('datafusion'), pq('duckdb', 2.5), pq('datafusion', 2.3), vx('duckdb'), r('duckdb:vortex-compact', 0.5));
  expect(line(s)).toBe('DuckDB 2.5× · DataFusion 2.3× faster than Parquet');
  expect(groupHeadline(s)?.parts.map((p) => p.tone)).toEqual(['better', 'better']);
});
it.each([
  [2.5, 'DuckDB 2.5× faster than Parquet'], [0.25, 'DuckDB 4.0× slower than Parquet'],
  [1.05, 'DuckDB ≈ same vs Parquet'], [0.95, 'DuckDB ≈ same vs Parquet'],
  [1.06, 'DuckDB 1.1× faster than Parquet'], [0.94, 'DuckDB 1.1× slower than Parquet'],
  [9.96, 'DuckDB 10× faster than Parquet'], [60.4, 'DuckDB 60× faster than Parquet'],
])('reads a Parquet-to-Vortex score ratio of %s as "%s"', (ratio, expected) => {
  expect(line(query(vx('duckdb'), pq('duckdb', ratio)))).toBe(expected);
});
it('gives each engine its own verdict when they disagree', () => {
  expect(line(query(vx('duckdb'), pq('duckdb', 2.5), vx('datafusion', 2), pq('datafusion', 1))))
    .toBe('DuckDB 2.5× faster · DataFusion 2.0× slower vs Parquet');
});
it('marks partial coverage', () => {
  expect(line(query(vx('duckdb', 1, 9), pq('duckdb', 2.5)))).toBe('DuckDB 2.5× faster than Parquet (partial)');
});
it('reads "Vortex only" when no engine ran Parquet', () => {
  expect(line(query(vx('datafusion'), r('duckdb:vortex-compact', 1)))).toBe('Vortex only');
  expect(line(query(vx('datafusion', 1, 9)))).toBe('Vortex only (partial)');
});
it('leaves out an engine that ran only one side', () => {
  expect(line(query(vx('duckdb'), pq('duckdb', 2.5), vx('datafusion')))).toBe('DuckDB 2.5× faster than Parquet');
});
it.each([
  ['no summary', undefined],
  ['only Parquet', query(pq('duckdb', 1))],
  ['an unmeasured Vortex series', query(vx('duckdb', 1, 0), pq('duckdb', 2))],
  ['a zero score', query(vx('duckdb', 0), pq('duckdb', 2))],
  ['compression without Vortex', compression(['parquet', 'encode', 1])],
  ['ratios that are not positive and finite', compression([VX, 'encode', 0], [VX, 'decode', Number.NaN])],
  ['an empty size summary', { type: 'compressionSize', title: 's', rankings: [], explanation: 'e' }],
  ['empty random-access rankings', ra([], [])],
  ['unmeasured vector-search flavors', vs(r('vortex-turboquant', 1, 0))],
])('shows no headline for %s', (_case, summary) => {
  expect(groupHeadline(summary as Summary | undefined)).toBeNull();
});
it('reads encode and decode throughput against Parquet', () => {
  expect(line(compression([VX, 'encode', 1.6], [VX, 'decode', 5.1], ['parquet', 'encode', 1], ['lance', 'decode', 0.6])))
    .toBe('encode 1.6× · decode 5.1× faster than Parquet');
  expect(line(compression([VX, 'encode', 0.5], [VX, 'decode', 5.1]))).toBe('encode 2.0× slower · decode 5.1× faster vs Parquet');
});
it.each([
  [1.07, '7% larger than Parquet', 'worse'], [0.85, '15% smaller than Parquet', 'better'],
  [1.004, 'same size as Parquet', 'same'], [2.4, '2.4× larger than Parquet', 'worse'],
])('reads a size ratio of %s as "%s"', (ratio, expected, tone) => {
  const h = groupHeadline({ type: 'compressionSize', title: 's', explanation: 'e',
    rankings: [{ name: VX, minRatio: ratio, ratio, maxRatio: ratio, compressionRatio: 5 }] });
  expect(h && headlineText(h)).toBe(expected);
  expect(h?.parts[0]?.tone).toBe(tone);
});
it('reads hot and cold random access against Parquet', () => {
  expect(line(ra([r(VX, 1), r('parquet', 60.4)], [r(VX, 1), r('parquet', 32)]))).toBe('hot 60× · cold 32× faster than Parquet');
  expect(line(ra([r(VX, 1), r('parquet', 60.4, 1, 2)], []))).toBe('hot 60× faster than Parquet (partial)');
});
it('names the fastest measured vector-search flavor', () => {
  expect(line(vs(r('vortex-turboquant', 1), r('vortex-default', 1.4)))).toBe('fastest: vortex-turboquant');
  expect(line(vs(r('vortex-turboquant', 1, 0), r('vortex-default', 1.4)))).toBe('fastest: vortex-default');
  expect(groupHeadline(vs(r('vortex-turboquant', 1)))?.parts[0]?.tone).toBe('neutral');
});
```

- [ ] **Step 2: Run** `bun run --cwd bench/web test lib/headline.test.ts`. Expect FAIL: the module does not exist.
- [ ] **Step 3: Implement** `groupHeadline` and `headlineText`. The rules:
  - A series counts only when `measured > 0`. A part whose ratio is not a positive finite number is dropped. When no parts remain, return `null`. Never return a misleading number.
  - **Ratio `r`, read as "how many times faster Vortex is".**
    - `queryBenchmark`: per engine, `score(engine:parquet) / score(engine:vortex-file-compressed)`.
    - `randomAccess`: the same for `parquet` and `vortex-file-compressed`, once for `hotRankings` (label `hot`) and once for `coldRankings` (label `cold`).
    - `compression`: the `vortex-file-compressed` row's `ratio`, once for encode (label `encode`) and once for decode (label `decode`).
  - **Verdict.** `0.95 <= r <= 1.05` gives `≈ same` (tone `same`). `r > 1.05` gives `<m> faster` (`better`) with `m = r`. `r < 0.95` gives `<m> slower` (`worse`) with `m = 1 / r`. A multiple `m` prints as `${m.toFixed(1)}×` below 9.95, otherwise `${Math.round(m)}×`.
  - **Multi-part families (query, random access, compression).** If every part is `better`, part texts are `label m` and the suffix is `faster than Parquet`. If every part is `worse`, the same with `slower than Parquet`. Otherwise each part is `label verdict` and the suffix is `vs Parquet`.
  - **Query engines.** Labels are `{ duckdb: 'DuckDB', datafusion: 'DataFusion' }`, and an unknown engine falls back to its raw key. Order is `duckdb`, then `datafusion`, then the rest by code-unit order. Only engines with both series measured get a part. If engines have Vortex but none has Parquet, the single part is `Vortex only` (`neutral`, suffix `null`).
  - Random access also reads `Vortex only` when Vortex was measured and Parquet was not.
  - **`compressionSize`.** Use the Vortex row's `ratio` with `pct = Math.round(Math.abs(r - 1) * 100)`, as one part with suffix `null`:
    - `r >= 2`: `<m> larger than Parquet` (`worse`).
    - `pct === 0`: `same size as Parquet` (`same`).
    - `r > 1`: `${pct}% larger than Parquet` (`worse`).
    - otherwise: `${pct}% smaller than Parquet` (`better`).
  - **`vectorSearch`.** The single part is `fastest: ${displayFormat(name)}` (`neutral`), from the measured ranking with the lowest score (first on ties).
  - **Partial.** `partial` is true when any series behind a part has `measured < total`.
- [ ] **Step 4: Run** the file again. Expect PASS.
- [ ] **Step 5: Render the headline.** In `GroupSection`, compute `groupHeadline(group.summary)`. When it is not null, render it as the last child of `.group-summary-row`, after the permalink. The markup is `<span class="group-headline">`, holding one `<span class="group-headline-part" data-tone="…">` per part, separated by the text `" · "`, then the suffix and `" (partial)"` as text. Its text content must equal `headlineText`. Add to `GroupSection.test.tsx`:
  - `renders the headline as text inside the summary row`. Use a `TPCH` fixture: a `queryBenchmark` summary with `duckdb:vortex-file-compressed` score 1 and `duckdb:parquet` score 2.5, both 22 of 22. Take `row = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'))`. It contains `class="group-headline"` and `data-tone="better"`, and `row.replace(/<[^>]+>/g, '')` contains `DuckDB 2.5× faster than Parquet`.
  - `renders no headline when the summary has no Vortex series`. The existing `RANDOM_ACCESS` fixture ranks a series named `vortex`, so its HTML must not contain `group-headline`.
- [ ] **Step 6: Style it.** In `globals.css`, add `flex-wrap: wrap` to `.group-summary-row`. Add `.group-headline { margin-left: auto; color: var(--muted); font-size: 0.85rem; font-variant-numeric: tabular-nums; }`. Inside the existing `@media (max-width: 768px)` block, add `.group-headline { flex-basis: 100%; margin-left: 0; }`. That gives one line on desktop and two on a phone. Tone colors wait for step 3; the words carry the meaning.
- [ ] **Step 7: Verify.** `bun run --cwd bench/web test lib/headline.test.ts components/GroupSection.test.tsx` passes. `bun run --cwd bench/web lint`, `bun run --cwd bench/web format:check` and `bunx tsc --noEmit -p bench/web` are clean.
- [ ] **Step 8: Commit:** `Show a one-line headline on each folded bench group`.

### Task 2: Mount a group's body only while it is open

**Files:**
- Create: `bench/web/lib/group-bodies.ts`, `bench/web/lib/group-bodies.test.ts`, `bench/web/components/GroupBody.tsx`, `bench/web/components/GroupBody.test.tsx`
- Modify: `bench/web/lib/chart-format.ts` and `lib/chart-format.test.ts` (`chartPriority`); `bench/web/components/Chart.tsx` (one line: use `chartPriority`); `components/GroupSection.tsx` and its test; `components/GroupToolbar.tsx` (drop the seeding effect and props); `components/SummaryCard.tsx` (doc comment only); `app/globals.css`
- Modify (setup markup only): `components/Chart.lazy-hydration.test.tsx`, `Chart.loading.test.tsx`, `Chart.lifecycle.test.tsx`, `Chart.empty-window.test.tsx`. Also add one `GroupBody` test to `Chart.lazy-hydration.test.tsx`.
- Modify: `bench/web/lib/server-smoke.test.ts`

**Interfaces:**
- Consumes: from `@/lib/chart-store`, `ensureGroupBundle(groupSlug: string, priority: number): Promise<BundleResult>`, `abortGroupBundle(groupSlug: string): void`, `initGroupFilter(slug, hidden, shown)`, `bundleQueue`, `resetPayloadCache()`. Also `Chart` (`ChartIslandProps`) and Task 1's GroupSection.
- Produces:
  - `lib/chart-format.ts`: `export function chartPriority(index: number): number`, which is `index === 0 ? 0 : -index` (`+0` for the first chart).
  - `lib/group-bodies.ts`:
    - `export interface GroupBodiesReady { mounted: Promise<void>; settled: Promise<void> }`
    - `export function noteGroupBodyOpen(groupSlug: string, bundle: Promise<unknown>): void`
    - `export function groupBodiesReady(groupSlugs: readonly string[]): GroupBodiesReady`. `mounted` resolves once every listed slug has noted. `settled` resolves after that, once each noted bundle has settled; a rejection counts as settled. An empty list resolves at once.
    - `export function seedGroupFilterOnce(groupSlug: string, hiddenSeries: readonly string[], shownSeries: readonly string[]): void`. It calls `initGroupFilter` the first time per slug per page load.
    - `export function resetGroupBodies(): void` (test-only; clears both maps).
  - `components/GroupBody.tsx` (`'use client'`):
    - `export interface GroupBodyProps { groupSlug: string; charts: ChartLink[]; startIndex: number; universe: FilterUniverse; initialHiddenSeries: string[]; initialShownSeries: string[] }`
    - `export function GroupBody(props: GroupBodyProps)`
  - `GroupToolbar` props become `{ groupSlug: string; universe: FilterUniverse }`.
  - DOM contract: `section.group-details > details.group-disclosure > (summary.group-summary, SummaryCard, div.group-body)`. While the group is open, `div.group-body` holds `section.group-toolbar` and `div.chart-grid > section.chart-card*`.

- [ ] **Step 1: Write the failing tests.**
  - In `lib/group-bodies.test.ts`:
    - `resolves mounted once every listed group has noted its body, and settled after their bundles`. Note `a` with a resolved promise: nothing fires. Note `b` with a pending promise: only `mounted` fires. Resolve it: `settled` fires.
    - `treats a failed bundle as settled`.
    - `resolves at once for no groups, and counts notes made before the call`.
    - `seeds a group's filter once per page load`. `seedGroupFilterOnce('g', ['a'], [])` makes `getGroupSnapshot('g').hiddenSeries` equal `['a']`. Then `toggleGroupSeries('g', 'a')` and seed again: still `[]`.
  - In `lib/chart-format.test.ts`: `ranks the first chart at +0 and later charts by their negated index`. `Object.is(chartPriority(0), 0)` is true, and `chartPriority(7)` is `-7`.
  - In `components/GroupBody.test.tsx` (jsdom). Mock `@/components/Chart` with an async factory: `const { createElement } = await import('react')`, and a `Chart` that renders `createElement('section', { className: 'chart-card', 'data-chart-slug': slug, 'data-chart-index': index })`.
    - Render `<GroupBody groupSlug="g" charts={[{name:'q1',slug:'c1'},{name:'q2',slug:'c2'}]} startIndex={5} universe={…} initialHiddenSeries={['duckdb:parquet']} initialShownSeries={[]} />` into a `#body` div inside `<section class="group-details" data-group-slug="g"><details class="group-disclosure"><summary>g</summary>…</details></section>`.
    - Toggle like the existing suites do: set `details.open`, then `dispatchEvent(new Event('toggle'))` inside `act`.
    - Stub `fetch` to record each URL and `init.signal`. Group requests never resolve unless the test resolves them.
    - In `beforeEach`, call `resetPayloadCache()`, `resetGroupBodies()` and `initGroupFilter('g', [], [])`.

```tsx
it('renders an empty body while folded', () => {
  expect(renderToStaticMarkup(<GroupBody {...PROPS} />)).toBe('<div class="group-body"></div>');
});
it('mounts the toolbar and one card per chart, with page-wide indices, when the group opens', …
  expect(body.querySelector('[data-role="group-toolbar"]')).not.toBeNull();
  expect([...body.querySelectorAll<HTMLElement>('.chart-card')].map((c) => c.dataset.chartIndex)).toEqual(['5', '6']);
it('mounts at once when the group is already open at hydration', …   // <details … open> before render
  expect(body.querySelectorAll('.chart-card')).toHaveLength(2);
it("requests the group bundle once, at its first chart's priority", …
  expect(schedule).toHaveBeenCalledTimes(1); expect(schedule.mock.calls[0]?.[1]).toBe(-5);
  expect(urls).toEqual(['/api/group/g?n=100']);
it('closing unmounts the body and aborts the bundle, even when no chart island hears the toggle', …
  expect(body.querySelectorAll('.chart-card')).toHaveLength(0); expect(signals[0]?.aborted).toBe(true);
it('reopening after a successful bundle fetches nothing', …   // resolve with { name: 'g', charts: [] }, close, reopen
  expect(urls).toHaveLength(1);
it("seeds the URL's series overrides once, so a reopen keeps the user's change", …
  expect(getGroupSnapshot('g').hiddenSeries).toEqual(['duckdb:parquet']);
  toggleGroupSeries('g', 'duckdb:parquet'); /* close, reopen */ expect(getGroupSnapshot('g').hiddenSeries).toEqual([]);
it('tells the scroll restorer when its body has mounted and its bundle has settled', …
  // after open: await groupBodiesReady(['g']).mounted resolves; .settled resolves only after the bundle response
```

- [ ] **Step 2: Run** `bun run --cwd bench/web test lib/group-bodies.test.ts lib/chart-format.test.ts components/GroupBody.test.tsx`. Expect FAIL: the modules and exports are missing.
- [ ] **Step 3: Implement `lib/group-bodies.ts` and `chartPriority`.** In `Chart.tsx`'s mount effect, `const priority = chartPriority(index);` replaces the inline expression and keeps its comment.
- [ ] **Step 4: Implement `GroupBody`.**
  - `useState(false)` for `open`, so hydration matches the server's empty `<div className="group-body">`. While open, it renders `<GroupToolbar groupSlug universe />` and `<div className="chart-grid">` with `<Chart key={link.slug} slug={link.slug} name={link.name} index={startIndex + i} groupSlug={groupSlug} />`.
  - Mount effect: `seedGroupFilterOnce(groupSlug, initialHiddenSeries, initialShownSeries)`.
  - Layout effect on mount:
    - Find `ref.current.closest('details.group-disclosure')`. Without one, the body stays closed.
    - Set `open` from `details.open`, because the pre-paint script (Task 3) may already have opened it.
    - Listen for `toggle`. On close, call `abortGroupBundle(groupSlug)` first, then `setOpen(false)`. Comment why: the browser runs microtasks between listeners, so React can unmount the islands and remove their `toggle` listeners before those run. On open, `setOpen(true)`.
  - Effect on `[open, groupSlug, startIndex]`: when open, `noteGroupBodyOpen(groupSlug, ensureGroupBundle(groupSlug, chartPriority(startIndex)))`. It runs after the islands' own mount effects, so it joins their in-flight bundle at the same priority and adds no request. It has no cleanup, because a StrictMode replay must not abort.
- [ ] **Step 5: Restructure `GroupSection`.**
  - Inside `<details className="group-disclosure">`, after the `<summary>`, render `<SummaryCard summary={group.summary} />` and then `<GroupBody groupSlug={group.slug} charts={group.charts} startIndex={startIndex} universe={universe} initialHiddenSeries={…} initialShownSeries={…} />`.
  - Nothing follows the `<details>` inside the section. Rewrite the component's doc comment to match.
  - `GroupToolbar` loses its `initGroupFilter` effect and the two `initial*` props. Its doc comment now says it mounts only while the group is open.
  - `SummaryCard`'s doc comment: the card renders inside the group's `<details>`, so it shows when the group is open, with or without JavaScript.
- [ ] **Step 6: Update the CSS.**
  - Delete `.group-disclosure:not([open]) ~ .chart-grid`, `.group-disclosure:not([open]) ~ .group-toolbar` and the dead `body.bench-prebuilding …` rule.
  - Retarget `.group-details > .chart-grid` (both the desktop and the 768px rule) and `.group-details > .chart-grid .chart-card:last-child` to `.group-body > .chart-grid`.
  - Fix the `.group-toolbar` comment that cites the sibling rule.
  - `grep -nE ':not\(\[open\]\) ~|bench-prebuilding|group-details > \.chart-grid' bench/web/app/globals.css` prints nothing.
- [ ] **Step 7: Update the tests that pin the old shape.**
  - `GroupSection.test.tsx`:
    - Replace `renders the summary card inside the section` with `renders the summary card inside the disclosure, after the summary row`. The index of `benchmark-scores-summary--random-access` lies between `</summary>` and `</details>`.
    - Replace `renders one chart-card shell per chart …` with `renders an empty group body and no chart or toolbar markup while folded`. The HTML contains `<div class="group-body"></div>` and contains neither `class="chart-card"`, `data-role="group-toolbar"` nor `<canvas`.
    - Keep the literal `<details class="group-disclosure">` pin.
  - In the eight setup strings of the four `Chart.*` suites (lazy-hydration ×4, loading, lifecycle ×2, empty-window), move the `.chart-grid` inside the `<details>`, wrapped in `<div class="group-body">`:

```ts
'<details class="group-disclosure" open><summary class="group-summary">g</summary>' +
`<div class="group-body"><div class="chart-grid">${mounts}</div></div></details>`
```

  No assertion changes. Every one still passes, because the island finds its disclosure through `closest('.group-details')`.
  - In the `PR-5.0.97 group-bundle hydration` describe of `Chart.lazy-hydration.test.tsx`, add `GroupBody mounts islands only while open; they share one bundle, and closing aborts it`.
    - Use the real `Chart`, `MockIO`, and the never-resolving, signal-recording fetch from `closing the group aborts the in-flight bundle`.
    - Render `<GroupBody groupSlug="g" charts={3 links} startIndex={0} …/>` inside a closed `<details>`.
    - While closed: 0 `.chart-card` and no fetch. After opening: 3 cards, 3 `MockIO` instances and `fetchCalls` equal to `['/api/group/g?n=100']`. After closing: 0 cards and the bundle signal is aborted.
  - `lib/server-smoke.test.ts`: rename the landing test to `serves the landing page with header chrome and folded group rows, and no chart islands`. Replace the `group-toolbar`, `scope-slider` and `range-strip` expectations with:

```ts
expect(html).toContain('class="group-body"');
expect(html).toContain('class="group-headline"');
expect(html).toContain('faster than Parquet'); // the fixture's compression group
expect(html).not.toContain('class="chart-card"');
expect(html).not.toContain('data-role="group-toolbar"');
```

- [ ] **Step 8: Verify.**
  - Run `bun run --cwd bench/web build`, then the whole suite with `BENCH_TEST_DATABASE_URL` set. Everything passes, nothing is skipped, and `server-smoke` ran.
  - `lint`, `format:check` and `bunx tsc --noEmit -p bench/web` are clean.
- [ ] **Step 9: Commit:** `Mount a bench group's toolbar and charts only while it is open`.

### Task 3: Keep the open groups in the URL fragment

**Files:**
- Create: `bench/web/lib/open-groups.ts`, `lib/open-groups.test.ts`, `components/OpenGroupsScript.tsx`, `components/OpenGroupsScript.test.tsx`, `components/LandingState.tsx`, `components/LandingState.test.tsx`
- Modify: `app/page.tsx`, `components/GroupSection.tsx` (`suppressHydrationWarning`), `components/Header.tsx`, `components/GroupNav.tsx` and its test, `components/GroupPermalink.tsx` and its test, `components/FilterBar.test.tsx`, `lib/server-smoke.test.ts`

**Interfaces:**
- Consumes: Task 2's `groupBodiesReady`, `noteGroupBodyOpen` and `resetGroupBodies`; `groupAnchors` from `lib/anchor.ts`.
- Produces in `lib/open-groups.ts`. No helper may use `instanceof`, because the script test reads a second JSDOM realm.
  - `export interface GroupRef { anchor: string; slug: string }`
  - `export function parseOpenFragment(hash: string): string[]`. It splits on `,` before decoding, decodes each token, drops tokens where `decodeURIComponent` throws and empty tokens, and dedupes keeping first-seen order.
  - `export function formatOpenFragment(anchors: readonly string[]): string`. It returns `''` for none, otherwise `'#' + anchors.join(',')`. Anchors are `[a-z0-9-]` by construction, so they are written as they are.
  - `export function resolveOpenAnchors(tokens: readonly string[], groups: readonly GroupRef[]): string[]`. A token naming an anchor, or a legacy opaque slug, maps to that group's anchor. Unknown tokens drop. Fragment order is kept, without duplicates.
  - `export function pageGroups(doc: Document): GroupRef[]`. These are the `section[data-group-slug][id]` elements in document order.
  - `export function openAnchors(doc: Document): string[]` and `export function openGroupSlugs(doc: Document): string[]`, for the open groups in page order.
  - `export function openGroupsFromHash(doc: Document, hash: string): string[]`. It opens the resolved groups and returns their anchors in fragment order.
  - `export function openAndScrollTo(section: HTMLElement, doc: Document): void`. This moves out of GroupNav's `expandAndScroll`: smooth scrolling unless reduced motion is set, with `block: 'start'`.
  - `export function scrollToGroup(doc: Document, anchor: string): boolean`
  - `export function syncOpenFragment(win: Window): boolean`.
    - The target URL is `pathname + search + formatOpenFragment(openAnchors(doc))`.
    - It calls `history.replaceState(null, '', target)` only when that differs from the current URL.
    - It is a no-op on a page without group sections.
    - It catches a throwing `replaceState`.
    - It returns whether it wrote.
  - `export function setAllGroupsOpen(win: Window, open: boolean): void`. It sets `.open` on every `details.group-disclosure`, then calls `syncOpenFragment` once.
- `components/OpenGroupsScript.tsx`: `export const OPEN_GROUPS_BOOTSTRAP: string` and the server component `OpenGroupsScript()`. The component renders `<script data-role="open-groups-bootstrap" dangerouslySetInnerHTML={{ __html: OPEN_GROUPS_BOOTSTRAP }} />`.
- `components/LandingState.tsx` (`'use client'`, renders `null`): `export function LandingState()`.
- `GroupNavItem` becomes `{ name: string; slug: string }`. `jumpToLocationHash` and GroupNav's hash effect are removed.

- [ ] **Step 1: Write the failing tests** in `lib/open-groups.test.ts` (jsdom). Seed three sections in page order: `tpc-h-nvme-sf-1` (slug `qm.tpch`), `random-access` (`random_access.eyJ`) and `clickbench` (`qm.click`), each with a `details.group-disclosure`. Add a `<div id="group-nav-panel">`.
  - `parseOpenFragment`, as an `it.each`:
    - `''` and `'#'` give `[]`; `'#a'` gives `['a']`; `'#b,a,b'` gives `['b','a']`; `'#,a,,'` gives `['a']`.
    - `'#%E0%A4%A'` gives `[]`, and `'#%E0%A4%A,a'` gives `['a']`.
  - `round-trips an open set`: `parseOpenFragment(formatOpenFragment(groupAnchors(['TPC-H (NVMe) (SF=1)', 'Clickbench', 'Random Access'])))` equals the anchors. `formatOpenFragment([])` is `''`.
  - `resolves anchors and legacy slugs, drops unknown tokens and keeps fragment order`: `['clickbench', 'random_access.eyJ', 'nope', 'clickbench']` gives `['clickbench', 'random-access']`.
  - `opens the listed groups and ignores non-group ids and malformed tokens`. These cases moved from GroupNav's `jumpToLocationHash` tests. `openGroupsFromHash(document, '#clickbench,group-nav-panel,%E0%A4%A,tpc-h-nvme-sf-1')` returns `['clickbench', 'tpc-h-nvme-sf-1']`, and `openAnchors(document)` is `['tpc-h-nvme-sf-1', 'clickbench']`.
  - `syncOpenFragment` cases:
    - `writes the open set in page order and keeps the query`. Start at `/?engine=duckdb`, open clickbench and tpc-h: `location.href` ends with `/?engine=duckdb#tpc-h-nvme-sf-1,clickbench`. Close both: it ends with `/?engine=duckdb` and has no `#`.
    - `does not write when nothing changed, or on a page without groups`: a `replaceState` spy is not called.
  - `setAllGroupsOpen opens every group and writes the fragment once`: every group is open, the spy is called once, and the hash is `#tpc-h-nvme-sf-1,random-access,clickbench`. The `false` call closes them all and clears the hash.
- [ ] **Step 2: Run** the file. Expect FAIL. Then **implement `lib/open-groups.ts`** and run again. Expect PASS.
- [ ] **Step 3: The pre-paint script.**
  - `OPEN_GROUPS_BOOTSTRAP` is a constant ES5 string with no interpolation, wrapped in `(function(){try{…}catch(e){}})();`.
  - It reads only `location.hash` and the DOM. It splits the hash on `,`, decodes each token in its own `try`, and compares each token by string equality with each `section[data-group-slug]`'s `id` or `data-group-slug`. It never builds a selector or HTML from the fragment. On a match it sets `open` on that section's `details.group-disclosure`.
  - The test is `components/OpenGroupsScript.test.tsx` (node environment, its own JSDOM):

```tsx
function load(hash: string) {
  const html = renderToStaticMarkup(
    <main><div id="group-nav-panel" />{SECTIONS /* three <GroupSection/>, as above */}<OpenGroupsScript /></main>,
  );
  const virtualConsole = new VirtualConsole();
  const errors: unknown[] = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, {
    url: `https://bench.vortex.dev/?engine=duckdb${hash}`, runScripts: 'dangerously', virtualConsole,
  });
  return { doc: dom.window.document, errors };
}
it.each(['', '#', '#random-access', '#clickbench,tpc-h-nvme-sf-1', '#random-access,random-access',
  `#${encodeURIComponent('random_access.eyJ')}`, '#unknown', '#group-nav-panel', '#%E0%A4%A',
  '#%E0%A4%A,clickbench', '#,,clickbench,'])(
  'opens, while the page parses, exactly the groups the helpers resolve for "%s"', (hash) => {
    const { doc, errors } = load(hash);
    const listed = resolveOpenAnchors(parseOpenFragment(hash), pageGroups(doc));
    expect(openAnchors(doc)).toEqual(pageGroups(doc).map((g) => g.anchor).filter((a) => listed.includes(a)));
    expect(errors).toEqual([]);
  });
```

- [ ] **Step 4: `LandingState`, first part.** In a mount effect:
  - Add a capturing `toggle` listener on `document`. When the event's target matches `details.group-disclosure`, call `syncOpenFragment(window)`.
  - On mount, `const listed = openGroupsFromHash(document, location.hash)`. This is idempotent with the script and covers client navigations, where the script never runs. Then, when `listed[0]` exists, wait for `groupBodiesReady(openGroupSlugs(document)).mounted` and call `scrollToGroup(document, listed[0])`.
  - On `hashchange`, open the listed groups and scroll to the first.
  - The cleanup removes the listeners. Tests go in `LandingState.test.tsx` (jsdom, the same three sections, `resetGroupBodies()` in `beforeEach`, `Element.prototype.scrollIntoView` stubbed):
    - `writes the open groups into the fragment, in page order, on every toggle`.
    - `writes the fragment once per Expand All and Collapse All`. Spy on `history.replaceState`. Call `setAllGroupsOpen(window, true)`, then flush jsdom's own toggle tasks with `await act(async () => { await new Promise((r) => setTimeout(r, 0)); })`. Expect 1 call and the full hash. Then call it with `false`: 2 calls, no `#`, and the query kept.
    - `keeps opening groups when the browser refuses a URL write`. `replaceState` throws `new DOMException('limit', 'SecurityError')`. `setAllGroupsOpen(window, true)` does not throw, every group is open, and a `window` `error` listener is never called.
    - `on a fresh visit, opens every listed group and scrolls to the first listed once the bodies mount`. Start at `/#clickbench,tpc-h-nvme-sf-1`. Both groups are open, and there is no scroll yet. Call `noteGroupBodyOpen('qm.click', Promise.resolve())` and the same for `qm.tpch`, then flush. `scrollIntoView` is called once, and `mock.contexts[0]` is the clickbench section.
    - `opens and scrolls to an old single-anchor permalink`: `#random-access`.
    - `ignores a malformed fragment`: `#%E0%A4%A` opens nothing, does not scroll and does not throw.
    - `opens and scrolls to the group a later hashchange names`.
- [ ] **Step 5: Wire the page and every URL writer.**
  - `page.tsx`:
    - Render `<OpenGroupsScript />` right after the last `GroupSection`, inside `<main>` and before the `<noscript>`. That puts it after the groups' markup in whatever chunk streams them, so it runs before they paint.
    - Render `<LandingState />` after `</main>`.
    - Pass `GroupNav` `{ name, slug }` only. Update the page doc comment.
  - `GroupSection`: `<details className="group-disclosure" suppressHydrationWarning>`, with a comment that the pre-paint script may add `open` before hydration.
  - `Header`: Expand All and Collapse All call `setAllGroupsOpen(window, true | false)`. The local `setAllGroups` goes.
  - `GroupNav`:
    - The click runs `jumpToGroup(group.slug)` (now through `openAndScrollTo`) and then `syncOpenFragment(window)`.
    - The hash effect and `jumpToLocationHash` move out: `LandingState` and `openGroupsFromHash` take their place. Update the doc comments.
    - In `GroupNav.test.tsx`, drop `anchor` from `GROUPS` and delete the `jumpToLocationHash` describe (its cases now live in `open-groups.test.ts`).
    - Rename the click test to `opens the group, adds it to the fragment, and closes the panel`; its assertions are unchanged.
    - Add `adds the group to the fragment after groups already open, in page order`. Seed `polarsignals-profiling` as `open`, click Random Access, and expect the hash `#polarsignals-profiling,random-access`.
  - `GroupPermalink`:
    - Delete the `replaceState` mirror. `groupPermalinkUrl` and its three tests are unchanged.
    - Set the copied state only after `navigator.clipboard.writeText(url)` resolves. When the clipboard is missing or rejects, show nothing.
    - In the test file, rename `copies the permalink, mirrors the fragment, and never toggles the disclosure` to `copies a link to this one group and leaves the address bar alone`. Start at `/?engine=duckdb#clickbench,random-access`. The copied text is `${origin}/?engine=duckdb#random-access`, `location.href` is unchanged, `defaultPrevented` is true and `details.open` is false.
    - Drop the address-bar assertion from `copies and mirrors the current group-local series filter` and rename it to `copies the current group-local series filter`.
    - Switch the click helpers to `await act(async () => …)`, because the copied state now waits for the clipboard.
    - Add `it.each(['missing', 'rejected'])('does not claim a copy the browser refused (%s)')`. Afterwards the button has no `group-permalink--copied` class, and the status text is `''`.
  - `FilterBar.test.tsx`: in `preserves none and all formats after reload on %s`, change the starting fragment to `#random-access,tpc-h-nvme-sf-1` and expect that `url.hash`.
  - `server-smoke.test.ts`, in the landing test: `const script = html.indexOf('data-role="open-groups-bootstrap"')`. Expect `html.lastIndexOf('class="group-details"')` to be greater than 0 and `script` to be greater than it.
- [ ] **Step 6: Verify.**
  - Build, then run the whole suite with `BENCH_TEST_DATABASE_URL`. Everything passes and nothing is skipped.
  - `lint`, `format:check` and `tsc` are clean.
  - `grep -rn dangerouslySetInnerHTML bench/web/app bench/web/components` lists only `app/layout.tsx` (twice) and `components/OpenGroupsScript.tsx`.
- [ ] **Step 7: Commit:** `Keep bench's open groups in the URL fragment`.

### Task 4: Restore the landing page's scroll by element

**Files:**
- Create: `bench/web/lib/scroll-restore.ts`, `bench/web/lib/scroll-restore.test.ts`
- Modify: `bench/web/components/LandingState.tsx`, `bench/web/components/LandingState.test.tsx`

**Interfaces:**
- Consumes: Task 2's `GroupBodiesReady` and `groupBodiesReady`; Task 3's `openGroupsFromHash`, `openGroupSlugs` and `scrollToGroup`.
- Produces in `lib/scroll-restore.ts`:
  - `export type NavigationKind = 'navigate' | 'reload' | 'back_forward'`
  - `export interface SavedScroll { kind: 'chart' | 'group'; slug: string; offset: number }`
  - `export type ScrollPlan = { kind: 'restore'; saved: SavedScroll } | { kind: 'fragment' } | { kind: 'none' }`
  - `export function scrollStorageKey(loc: Pick<Location, 'pathname' | 'hash'>): string`, which is `` `bench-scroll:${pathname}${hash}` ``.
  - `export function navigationKind(win: Window): NavigationKind`. It reads `performance.getEntriesByType('navigation')[0]?.type`. A missing entry or any other type counts as `'navigate'`.
  - `export function captureScroll(doc: Document): SavedScroll | null`.
    - `top` is `.sticky-header`'s rect bottom, or 0 without a header.
    - Take the first `.group-details [data-chart-slug]` in document order that has no `hidden` attribute, a non-zero height, `bottom > top` and `top < innerHeight`. Otherwise take the first such `section[data-group-slug]`.
    - `offset` is `Math.round(rect.top)`.
  - `export function saveScroll(win: Window): void` and `export function readSavedScroll(win: Window): SavedScroll | null`. Both never throw. Reading validates `kind`, a non-empty `slug` and a finite `offset`.
  - `export function applySavedScroll(win: Window, saved: SavedScroll): boolean`. It finds the element by string equality on its data attribute, skipping hidden ones. It calls `win.scrollTo({ top: win.scrollY + rect.top - saved.offset, behavior: 'instant' })`. It returns false when no element matches.
  - `export function planScroll(nav: NavigationKind, saved: SavedScroll | null, fragmentNamesGroups: boolean): ScrollPlan`.
    - `restore` when `nav` is `reload` or `back_forward` and something was saved. This is call 8.
    - Otherwise `fragment` when the fragment names groups. This covers call 8's "nothing saved" fallback and call 9's fresh visit, which ignores saved state.
    - Otherwise `none`.
  - `export function restoreScroll(win: Window, saved: SavedScroll, ready: GroupBodiesReady, fallback: () => void): () => void`.
    - After `ready.mounted`: apply. If the element is missing, call `fallback()` and stop.
    - After `ready.settled` and one `requestAnimationFrame`: apply again. Empty-card hiding commits by then.
    - A `wheel`, `touchstart`, `keydown` or `pointerdown` on `win` (capture, passive) stops all later passes. It does not listen for `scroll`, because its own `scrollTo` fires that.
    - It returns `cancel`.

- [ ] **Step 1: Write the failing tests** in `lib/scroll-restore.test.ts` (jsdom).
  - `place(el, top, height = 420)` spies on `getBoundingClientRect`.
  - The page has `header.sticky-header`, placed at `(0, 64)`; `section.group-details#tpc-h[data-group-slug="tpch"]` with cards `c1`, `c2` and `c3`; and `section.group-details#ra[data-group-slug="ra"]`.
  - Stub `window.scrollTo = vi.fn()`, so `scrollY` stays 0.
  - `saved = { kind: 'chart', slug: 'c2', offset: 120 }`.

```ts
it('captures the first visible chart card whose bottom clears the header', () => {
  place(c1, -400); place(c2, 30); place(c3, 30); place(ra, 900, 60);
  expect(captureScroll(document)).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });
  c2.hidden = true;
  expect(captureScroll(document)).toEqual({ kind: 'chart', slug: 'c3', offset: 30 });
});
it('falls back to the group section when no chart card is in view', …   // cards above the header, ra at 100
  expect(captureScroll(document)).toEqual({ kind: 'group', slug: 'ra', offset: 100 });
it('keys the saved position by path and fragment', () => {
  history.replaceState(null, '', '/?engine=duckdb#tpc-h,ra'); place(c2, 30); saveScroll(window);
  expect(JSON.parse(sessionStorage.getItem('bench-scroll:/#tpc-h,ra') ?? 'null')).toEqual({ kind: 'chart', slug: 'c2', offset: 30 });
  history.replaceState(null, '', '/#tpc-h'); expect(readSavedScroll(window)).toBeNull();
});
it.each(['{', '{"kind":"chart","slug":"","offset":1}', '{"kind":"x","slug":"c","offset":1}', '{"kind":"chart","slug":"c","offset":"1"}'])(
  'ignores a saved value that does not hold a position: %s', …)
it('saves and reads nothing, without throwing, when storage is blocked', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
  expect(() => saveScroll(window)).not.toThrow(); expect(readSavedScroll(window)).toBeNull();
});
it('puts the element back at its saved offset', () => {
  place(c2, 900); expect(applySavedScroll(window, saved)).toBe(true);
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 780, behavior: 'instant' });
});
it.each([['reload', 'reload'], ['back_forward', 'back_forward'], ['navigate', 'navigate'], ['prerender', 'navigate']])(
  'reads a %s navigation as %s', …)   // spy performance.getEntriesByType; [] → 'navigate' too
it.each([
  ['reload', saved, false, 'restore'], ['back_forward', saved, true, 'restore'], ['back_forward', null, true, 'fragment'],
  ['reload', null, false, 'none'], ['navigate', saved, true, 'fragment'], ['navigate', null, false, 'none'],
] as const)('plans %s (saved %o, fragment %s) as %s', (nav, s, fragment, kind) => {
  expect(planScroll(nav, s, fragment).kind).toBe(kind);
});
it('restores after the bodies mount and again after their bundles settle', async () => {
  place(c2, 900); restoreScroll(window, saved, { mounted: mounted.promise, settled: settled.promise }, vi.fn());
  expect(window.scrollTo).not.toHaveBeenCalled();
  mounted.resolve(); await flush();
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 780, behavior: 'instant' });
  place(c2, 500); settled.resolve(); await nextFrame();
  expect(window.scrollTo).toHaveBeenCalledTimes(2);
  expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 380, behavior: 'instant' });
});
it.each(['wheel', 'touchstart', 'keydown', 'pointerdown'])('stops restoring once the user acts (%s)', …
  // after the first pass: window.dispatchEvent(new Event(type)); settle; next frame → scrollTo called once
it('falls back to the fragment scroll when the saved element is gone', …
  // { ...saved, slug: 'gone' }: after mounted, fallback called once and scrollTo never
it('does nothing once cancelled', …)
```

- [ ] **Step 2: Run** `bun run --cwd bench/web test lib/scroll-restore.test.ts`. Expect FAIL. **Implement** `lib/scroll-restore.ts`, then run again. Expect PASS.
- [ ] **Step 3: Wire it into `LandingState`.** In its mount effect:
  - Save `history.scrollRestoration`, set it to `'manual'`, and put it back on unmount.
  - Add a `pagehide` listener on `window` and a capturing `click` listener on `document`. The click listener acts when `(e.target as Element).closest?.('a[href^="/chart/"]')` matches. Both call `saveScroll(window)`.
  - Replace Task 3's unconditional fragment scroll with this sequence:
    - `listed = openGroupsFromHash(…)`
    - `ready = groupBodiesReady(openGroupSlugs(document))`
    - `fragmentScroll = () => { if (listed[0]) void ready.mounted.then(() => scrollToGroup(document, listed[0])) }`
    - Then `planScroll(navigationKind(window), readSavedScroll(window), listed.length > 0)`. For `restore`, call `cancel = restoreScroll(window, plan.saved, ready, fragmentScroll)`. For `fragment`, call `fragmentScroll()`.
  - The cleanup calls `cancel` and removes the listeners.
- [ ] **Step 4: Add to `LandingState.test.tsx`.** Stub `performance.getEntriesByType` per test. Place `c2` inside the `tpc-h` section at 900, and set the URL to `/#tpc-h-nvme-sf-1`.
  - `switches the page to manual scroll restoration and restores the old mode on unmount`.
  - `saves the reading position on pagehide and when a chart link is followed`. Dispatch `pagehide` on `window`, then a click on `c2`'s `<a href="/chart/c2">`. Each time, `sessionStorage` holds `bench-scroll:/#tpc-h-nvme-sf-1`.
  - `it.each(['reload', 'back_forward'])('on %s, restores the saved element instead of scrolling to the fragment')`. Seed `{kind:'chart',slug:'c2',offset:120}` and call `noteGroupBodyOpen('qm.tpch', Promise.resolve())`. `scrollTo` is called with `{ top: 780, behavior: 'instant' }`, and `scrollIntoView` is never called.
  - `on a fresh visit, scrolls to the fragment and ignores a saved position`. `scrollIntoView` is called once and `scrollTo` never.
  - `falls back to the fragment scroll on Back when storage is blocked`. `back_forward`, with the `sessionStorage` getter throwing: `scrollIntoView` is called once, and no `error` event fires.
- [ ] **Step 5: Verify** the two files, then the whole suite, `lint`, `format:check` and `tsc`. **Commit:** `Restore bench's landing scroll by element on reload and Back`.

### Task 5: Verify and measure

**Files:**
- Modify: `bench/scripts/parity/screenshots.spec.ts` (one wait), `bench/docs/architecture/performance.md`
- Throwaway, never committed: `bench/scripts/parity/measure-landing.ts`

- [ ] **Step 1: Run the local gates.**
  - Build, then run the whole suite with `BENCH_TEST_DATABASE_URL` set. Everything passes and nothing is skipped. Record the count against the setup count.
  - `bun run check:ci`, `bunx tsc --noEmit -p bench/web`, `bun run typecheck`, `bun run --cwd bench/web build`, `bun run build` and `uvx reuse lint` pass.
  - `git diff --exit-code origin/claude/bench-cleanup -- bench/web/vercel.json bench/web/app/api bench/web/app/chart` exits 0.
- [ ] **Step 2: Fix the parity spec's wait.** `landing page with the first group open` counts `.chart-card`s right after clicking the summary. Under option B they mount a moment later. After the click, add `await expect(section.locator('.chart-card').first()).toBeVisible();`. That also holds on the base build. **Commit:** `Wait for a group's charts to mount in the parity check`.
- [ ] **Step 3: Run parity once.** `bash bench/scripts/parity/run.sh origin/claude/bench-cleanup ~/Backups/vortex-bench/vortex_bench-20261028T171815Z`.
  - If PR 2 has merged by then, merge `origin/main` into this branch (never rebase) and use `origin/main` as the base.
  - The run exits 1 by design. It must print `parity: HTTP: … 0 mismatches; …`, `parity: 28 screenshots, 8 differ` and `parity: FAILED (response mismatches: 0, screenshots that differ: 8)`.
  - The folders it lists must all belong to the two landing tests, `landing-page` and `landing-page-with-the-first-group-open`, across the four projects. No `chart-page` folder may appear.
  - Anything else is a regression: fix it, then rerun.
  - Copy `$TMPDIR/bench-parity/out/results`, `out/snapshots` and `out/api.log` to `~/Backups/vortex-bench/pr3-parity-2026-10-29/`. The `-actual.png` images are the new landing baselines for the PR.
- [ ] **Step 4: Serve both builds for measurement.** `run.sh` stops its servers, but leaves the base build in `$TMPDIR/bench-parity/base` and the head build in `bench/web/.next`.

```bash
PG=/opt/homebrew/opt/postgresql@16/bin
$PG/pg_ctl -D "$TMPDIR/bench-parity/pgdata" -l "$TMPDIR/bench-parity/postgres.log" -w start \
  -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories="
serve() { (cd "$1/bench/web" && exec env NODE_ENV=production BENCH_DB_HOST=127.0.0.1 BENCH_DB_PORT=55432 \
  BENCH_DB_NAME=vortex_bench BENCH_DB_USER=postgres BENCH_DB_PASSWORD=parity BENCH_DB_SSL=disable \
  node "$(node -p "require.resolve('next/dist/bin/next')")" start -H 127.0.0.1 -p "$2") >"$TMPDIR/measure-$2.log" 2>&1 & }
serve "$TMPDIR/bench-parity/base" 3101; serve "$PWD" 3102
```

  Wait for `/api/health` on both. Then warm `/` on 3101 and then on 3102, one at a time: both fills take the same advisory lock.
- [ ] **Step 5: Measure with a throwaway script.** Write `bench/scripts/parity/measure-landing.ts` (untracked) and run `bun bench/scripts/parity/measure-landing.ts http://127.0.0.1:3101 http://127.0.0.1:3102 | tee "$TMPDIR/landing-measure.md"`. It uses `chromium` from `@playwright/test`, blocks Google Fonts like `screenshots.spec.ts` does, and prints a Markdown table of metric, base (PR 2) and head (PR 3).
  - **Load.** Desktop 1440×900, CPU throttled 4× with CDP `Emulation.setCPUThrottlingRate`, median of 5 runs. Load `/`, wait for `networkidle`, then 1 s. Record:
    - `encodedBodySize` and `decodedBodySize` of the navigation entry;
    - the summed `encodedBodySize` of `.js` resources, and CDP `Performance.getMetrics` `ScriptDuration`;
    - the counts of `.chart-card` and `[data-role="group-toolbar"]` (the hydrated islands);
    - `first-contentful-paint`;
    - Total Blocking Time, as Σ max(0, d − 50) over `longtask` entries after FCP, observed by an `addInitScript` `PerformanceObserver` with `buffered: true`.
  - **Opening a group.** Click the first group's `summary.group-summary` and wait for its `/api/group/` response, then 1 s. Record Σ `layout-shift` after the click, for all entries and for `hadRecentInput === false`.
  - **Back and Reload with two groups open.** Desktop and phone (390×844), 3 runs each, Playwright's default launch (the back/forward cache is off).
    - Open the 1st and 3rd groups and wait for both bundles.
    - Scroll so the 4th card of the 3rd group sits 300 px below the header, and wait 1 s.
    - Record the anchor as `captureScroll` defines it (slug and `top`) and `location.hash`.
    - Click the anchor card's title link, wait for the chart page's `load`, then `page.goBack()`. Wait for both bundles, then 1 s.
    - Record: the hash is unchanged; both groups are open; `|top − saved top|`; Σ layout shift since the Back; `navigation.type`.
    - Repeat with `page.reload()` in place of the chart round trip.
  - **Back/forward cache.** Do one Back in a second launch with `ignoreDefaultArgs: ['--disable-back-forward-cache']`. Record `pageshow.persisted` (an init-script flag) and any CDP `Page.backForwardCacheNotUsed` reasons.
  - **No JavaScript.** In a context with `javaScriptEnabled: false`: the number of `summary.group-summary` equals the number of groups, `.group-headline` is present, and clicking a summary shows its `.benchmark-scores-summary`.
  - **What passes for head:**
    - 0 chart cards and 0 toolbars on the folded page;
    - every Back and Reload run keeps the hash, reopens both groups and puts the anchor within 3 px of its saved top;
    - the no-JS checks hold.
  - Timings and layout shift are reported, not gated. Base's Back closes every group, which is the comparison.
  - Afterwards, stop both servers and run `pg_ctl -D "$TMPDIR/bench-parity/pgdata" -m fast stop`. Delete `measure-landing.ts`; `git status --porcelain` must print nothing.
- [ ] **Step 6: Document.** In `performance.md`, add `### A folded landing page` after "Fast Expand All", in about 10 lines:
  - group bodies mount only while open;
  - the open set lives in the fragment, which the CDN never sees;
  - the pre-paint script;
  - element-based restore, and why it is not by pixel;
  - the Step 5 table's headline numbers.

  In "Lazy hydration, top first", say that a folded group has no islands. **Commit:** `Document bench's folded landing page`.

### Task 6: Push, open the draft PR and deploy a preview

- [ ] **Step 1: Push** with `git push -u origin claude/bench-landing`.
- [ ] **Step 2: Write the PR body** with the spiral:pr-and-issue-voice skill, about 150 words in Simplified Technical English, in `$TMPDIR/pr3-body.md`. It covers:
  - what a visitor sees now;
  - parity: 0 API and chart-page mismatches, and 8 landing screenshots that differ by design, kept in `~/Backups/vortex-bench/pr3-parity-2026-10-29/` for Will to attach;
  - the Task 5 table and the Back and Reload result;
  - the decisions: headline wording; the island code still ships with the page; the permalink shows "copied" only after a real copy;
  - Will's smoke test (Step 5);
  - a link to `bench/docs/plans/2026-10-29-landing-option-b.md`.

  It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. **Show the body in the session before creating the PR.**
- [ ] **Step 3: Open it.** `gh pr create --draft --base claude/bench-cleanup --head claude/bench-landing --title "bench: fold the landing page to one row per group" --body-file "$TMPDIR/pr3-body.md"`.
- [ ] **Step 4: Deploy a preview.** A stacked PR gets no automatic preview, because `bench-deploy.yml` previews only pull requests into `main`.
  - Run `gh workflow run bench-deploy.yml --ref claude/bench-landing -f environment=preview`.
  - Find the run with `gh run list --workflow bench-deploy.yml --branch claude/bench-landing --event workflow_dispatch --limit 1 --json databaseId,url`.
  - `gh run watch <id> --exit-status` passes, including `verify-web-deploy.mjs … preview`.
  - Take the preview URL from `gh run view <id> --log`.
  - If PR 2 merges first, merge `origin/main` in and run `gh pr edit --base main`. The `pull_request` preview then runs on its own.
- [ ] **Step 5: Check CI and hand off.** `gh pr checks` shows `Bench: format, lint, build, test` passing, and its log shows the database suites ran. Give Will the preview URL in the session (do not post it) and his smoke test:
  - Open two groups and scroll into the second.
  - Open a chart page, then press Back. Then Reload. Both must land on the same chart with the same groups open.
  - Use Expand All, then Collapse All, and watch the URL.
  - Copy a group's permalink and open it in a new tab.
  - Open `/#%E0%A4%A`.

### Critical Files for Implementation
- /Users/will/git/vortex.dev/.claude/worktrees/optimistic-mclean-ef8f04/bench/web/components/GroupSection.tsx
- /Users/will/git/vortex.dev/.claude/worktrees/optimistic-mclean-ef8f04/bench/web/app/page.tsx
- /Users/will/git/vortex.dev/.claude/worktrees/optimistic-mclean-ef8f04/bench/web/components/Chart.tsx (mount effect; `components/chart/*` after PR 2's split)
- /Users/will/git/vortex.dev/.claude/worktrees/optimistic-mclean-ef8f04/bench/web/components/GroupNav.tsx
- /Users/will/git/vortex.dev/.claude/worktrees/optimistic-mclean-ef8f04/bench/web/lib/chart-store.ts (`lib/chart-store/{bundles,group-store}.ts` after PR 2)