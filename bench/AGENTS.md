<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# AGENTS.md - `bench/`

Read [`README.md`](README.md) first for the architecture. Then this file. The web app has its own
deep-dive in [`web/README.md`](web/README.md).

## The legacy generations

The previous site generations (v2 and v3) are documented in [`docs/legacy.md`](docs/legacy.md).
The v3 Rust tree (`server/`, `migrate/`, `ops/`, the Cargo workspace) has been deleted from the
working tree; recover it from git history if ever needed. Do not resurrect it piecemeal — the
rules below are the parts that were worth keeping.

## Load-bearing rules

- **`SCHEMA_VERSION` is a coordinated cross-repo change.**
  [`web/lib/schema-version.ts`](web/lib/schema-version.ts) is the in-repo source of truth; the
  monorepo's `scripts/post-ingest.py` hardcodes the same integer, and its `vortex-bench/src/v3.rs`
  owns the producer wire shape. Bump in lockstep across both repos. The versioned contract lives
  in [`CONTRACT.md`](CONTRACT.md), and
  [`web/lib/schema-version.test.ts`](web/lib/schema-version.test.ts) asserts the in-repo anchors
  agree.
- **`measurement_id` is internal — never on the wire.** It is a deterministic xxhash64 over
  `commit_sha` plus the dim tuple, computed by the monorepo's `scripts/_measurement_id.py` just
  before INSERT and used as the `ON CONFLICT` upsert key. Its output is frozen forever: the
  monorepo's golden-vector test (`scripts/tests/test_measurement_id.py`) pins it, because a
  drifted hash would insert duplicates next to the rows already in production.
- **Numeric `?n=` is clamped to 1000; `?n=all` is the uncapped escape hatch.** Pages hydrate from
  the materialized latest-100 shard artifact by default; `?n=all` is an explicit opt-in (the
  chart's full-history zoom-out hop uses it once, and curl power users can request it). The
  numeric path is bounded by `MAX_NUMERIC_COMMIT_WINDOW` in
  [`web/lib/window.ts`](web/lib/window.ts) as a DoS-protection floor against `?n=99999999`. Do
  NOT raise the numeric cap or remove it without thinking about the DoS surface, and do NOT
  re-introduce a server-side commit cap on `?n=all` — visual downsampling happens client-side via
  LTTB on the visible commit range only.
- **Don't refetch on every scope change.** Once a chart's payload is in memory,
  pan/zoom/slider/range-strip all rebuild in place via the in-memory LTTB pass on the cached
  payload ([`web/components/chart/controller.ts`](web/components/chart/controller.ts)). The single
  exception is the latest-100 to full-history zoom-out path: when the user first zooms past the
  materialized window, the chart lazy-fetches `?n=all` once and replaces the payload in place.
- **Group docs links mirror the monorepo's `Benchmark::doc_path`.**
  [`web/lib/benchmark-docs.ts`](web/lib/benchmark-docs.ts) maps each SQL dataset name to the
  benchmark's explainer doc in `vortex-data/vortex`, which is the same path that the monorepo's PR
  benchmark comment uses. The producer does not put `doc_path` on the wire, and upstream does not
  enforce a path convention, so update the explicit mapping when a suite is added or its doc moves.
  Groups without a matching explainer render no docs link. Do not guess a path or link to an
  unrelated general guide.
- **Every group kind has a summary, by default.** [`web/lib/summary.ts`](web/lib/summary.ts)
  has no allowlist gate: a suite that lands in one of the five fact tables gets a rollup card
  from its first ingest. The three timing families (query, random access, vector search) rank
  through one `rankSeries` model, so a new suite in any of them needs no summary code at all.
  `collectGroupSummary`'s exhaustive switch makes a missing arm for a sixth fact table a compile
  error rather than a silently blank card. Do NOT reintroduce a per-dataset allowlist; the v2-era
  one is what left `spatialbench`, `fineweb`, `gharchive`, `appian`, `public-bi`,
  `clickbench-sorted`, and every vector-search group with no card.
- **A summary ranks the whole group, never one chart.** Random access is the cautionary case:
  the producer emits `dataset` as `{dataset}/{pattern}`, so the group holds ~nine charts, and the
  old summary published the alphabetically first chart's raw times under the group-wide title
  "Random Access Performance" — reporting `lance` at 352us when it is over 1ms on most of the
  other charts. Sum chart medians by dataset, then rank the dataset totals. Include the legacy taxi
  chart in the taxi total. Apply a penalty when a series lacks one dataset total. Report dataset
  coverage through `measured`/`total`. The secondary runtime is the arithmetic mean of complete
  dataset totals.
- **Don't write a server-side classifier for live ingest.** The emitter produces structured
  records directly. Classifying loose name strings at read time was the v2-era weakness every
  later generation existed to escape; it belongs nowhere in the live pipeline.

## Footguns we have already hit

All in the chart island, [`web/components/Chart.tsx`](web/components/Chart.tsx) and the modules in
[`web/components/chart/`](web/components/chart/):

- **Reverse predecessor walk in the tooltip.** `payload.commits[]` is
  sorted oldest-first by SQL - `commits[0]` is the oldest, `commits[N-1]`
  is the newest. For per-row delta the predecessor of `commits[idx]` is
  at `idx - 1`. We caught a regression where a "fix" flipped this to
  `idx + 1`; the original walk-backward direction is right.
- **`pointer-events: auto` on the tooltip host.** The tooltip is
  positioned at the cursor; making it pointer-interactive causes a
  flicker loop. Keep it `pointer-events: none` and offset via
  `transform: translate(12px, 12px)`.
- **`change` events on the slider.** Use `input` events with a small
  throttle; `change` only fires on release and feels broken.

## Local dev

```bash
# From the repository root: bench/web is a member of the root Bun workspace.
# The web app needs BENCH_DB_* env vars for a real database — see web/README.md.
bun install && bun run --cwd bench/web dev

bun run --cwd bench/web test          # vitest unit tests
bun run --cwd bench/web build         # deliberately works without a database, so CI needs no secrets
bun run --cwd bench/web lint          # biome lint
bun run --cwd bench/web format:check  # biome format (`format` rewrites)
```

For the full env-var contract see [`web/README.md`](web/README.md).

## Lint and format

bench uses Biome, not ESLint or Prettier. The `bench/**` override in the root `biome.json` keeps the
style bench had under Prettier (single quotes, trailing commas, 100 columns, 2-space indent), and
`bun run check:ci` at the root checks bench along with the site. bench CI runs
`bun run biome ci bench` instead, so `bench/scripts` is checked on bench-only changes too.
`biome.json` cannot hold comments, so the reasons for each difference from the site's rules are
here:

- `correctness/useExhaustiveDependencies` is on (the site has it off). It replaces ESLint's
  `react-hooks/exhaustive-deps`. An effect that omits dependencies on purpose carries a
  `biome-ignore` comment that says why.
- The site's `a11y` rules apply to bench unchanged. Seven places in existing markup break one of
  them on purpose, and each carries an inline `biome-ignore` comment that says why:
  `useAriaPropsSupportedByRole` for `aria-label` on a plain `div` (the header nav controls, the
  chart toolbar), `useSemanticElements` for `role="group"` on a `div` in the toolbars (a `fieldset`
  would change their layout), `useFocusableInteractive` for the pointer-driven range strip, and
  `noNoninteractiveTabindex` for the group info icon, which takes focus so its tooltip shows for
  keyboard users. New markup follows the rules, or carries its own `biome-ignore` with a reason.
- `complexity/noImportantStyles` is off: `!important` overrides Chart.js's inline canvas size and the
  offscreen prebuild layout in `app/globals.css`.
- `organizeImports` is off: Prettier never sorted bench's imports, and reordering them would rewrite
  27 files (25 in `bench/web`, 2 in `bench/scripts`) and could change the order CSS loads in.

Next.js's `core-web-vitals` lint rules have no Biome equivalent; the site accepts that too. The
site's config also turns off `suspicious/noExplicitAny`, so bench's old typescript-eslint
`no-explicit-any` check is gone too.
