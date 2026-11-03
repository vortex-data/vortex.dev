# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `bun run dev` - Start development server with Turbopack
- `bun run build` - Build production application (a bare `bun build` runs Bun's bundler, not this script)
- `bun run lint` - Run Biome lint
- `bun run start` - Start production server

- `bun run test` - The site's unit tests (`bun test tests/unit`)
- `bun run test:bench` - bench's tests (Vitest; `test:bench:watch` reruns them)

bench is at http://localhost:3000/bench under `bun run dev`, and needs the `BENCH_DB_*` variables for a database (`docs/bench/web.md`). bench's Postgres integration suite needs Docker or a local Postgres named by `BENCH_TEST_DATABASE_URL` (`docs/bench/web.md` has the commands), and skips without either, except when `CI=true`, where it fails.

## Repository layout

The repository holds one Next.js app that serves two sites:

- **The marketing site** (vortex.dev): its routes and root layout in `src/app/(site)/`, and the rest of `src/` outside `src/bench/`. Everything below "Architecture Overview" describes it.
- **bench** (bench.vortex.dev), the benchmark results site: its routes and its own root layout in `src/app/(bench)/bench/`; its components, library and stylesheets in `src/bench/`; its public files in `public/bench/`; its Postgres schema and migration runner in `db/`; its AWS provisioning in `infra/`; its docs in `docs/bench/`, with `docs/bench/CONTRACT.md`, the ingest contract with the emitter in the `vortex-data/vortex` monorepo. Start with `docs/bench/README.md` and the "bench" section below. It came from the archived `vortex-data/benchmarks-website` repository, which keeps its earlier history.

How the two sites share the app:

- **Hosts.** bench's routes are under `/bench`. `next.config.mjs` rewrites every path on bench.vortex.dev onto `/bench`, before the filesystem, so bench's public URLs are the root paths they always were (`/`, `/chart/{slug}`, `/api/…`). Previews, local dev and a deployment's own URL serve bench at `/bench`. vortex.dev and www.vortex.dev do not: `/bench` 404s there, except `/bench/api/health`, which the Vercel cron may call on any of the deployment's hosts. bench builds every root-relative link and fetch with `benchPath()` (`src/bench/lib/base-path.ts`): bench's root layout reads the request's host and hands the base to client components (`src/bench/components/BenchBase.tsx`).
- **Root layouts.** Each site has its own, so Next.js has none to draw an unmatched URL's 404 in. `src/app/global-not-found.tsx` (`experimental.globalNotFound`) is the site's 404, in the site's layout, prerendered for every unmatched URL; a catch-all route (`src/app/(bench)/bench/[...notFound]`) keeps bench's unmatched paths in bench's own layout. `robots.ts` stays at the app root, where Next.js reads it; the favicon is `public/favicon.ico`, named in the site's metadata, because the `app/favicon.ico` convention would also put it on bench's pages. Next.js serves a metadata image route inside a route group with a hash suffix (`/opengraph-image-12o0cb`), and the og:image tags name that URL; rewrites in `next.config.mjs` keep the plain `/opengraph-image` URLs (which the posts' JSON-LD names) serving the same images.
- **Headers.** The CSP and the other security headers in `next.config.mjs` cover both sites; bench's CSP adds Google Fonts, which bench's pages load. bench now sends the site's security headers, including `X-Frame-Options: DENY` and `frame-ancestors 'none'`, so no other site can embed bench's pages in a frame. `vercel.json` holds bench's cron (`/bench/api/health`) and bench's CDN rule for its landing and chart pages on bench.vortex.dev (header rules match the path as requested, before the rewrites). bench's HTML differs between its two URL forms, so the `/bench` form gets the CDN rule only outside production (`benchPrefixCdnRules` in `next.config.mjs`): a cached `/bench` page must never answer for bench.vortex.dev.
- **Toolchain.** One package: one `package.json`, one `bun.lock`, one `bunfig.toml`, one `tsconfig.json`. Next.js 16.4.1, React 19.3 and TypeScript 7. `tsconfig.json` has every strict flag either app had, including bench's `noFallthroughCasesInSwitch` and `noUncheckedSideEffectImports`; `src/css.d.ts` types the CSS side-effect imports. The root `biome.json` lints and formats both sites: an override keeps bench's files (`src/bench`, `src/app/(bench)`, the parity and deploy checks, `vitest.config.ts`) in bench's old Prettier style (single quotes, trailing commas, 100 columns) with bench's lint rules (see "bench" below), and `bun run check:ci` checks all of it. bench's tests run on Vitest from the root `vitest.config.ts`, scoped to bench's files; the site's run on `bun test`. bench's PostCSS config sits beside its stylesheets (`src/bench/styles/postcss.config.mjs`), and Turbopack applies it to those alone: with no config at the root, the site's CSS gets Turbopack's defaults.
- **CI.** Every check covers both sites and runs on every change; nothing is split by which site a change touches. `ci.yml`'s `Lint, build, verify` runs Biome on the whole repository, one build, the typecheck, the site's unit tests, bench's Vitest suite with its Postgres integration tests (testcontainers, so the runner needs Docker), the migration-runner (`db/tests`), infrastructure (`infra/tests`), parity and deploy-check tests, `bun run verify`, and the Playwright smoke specs. Dependency review, the secret scan, REUSE and the non-blocking `bun audit` run beside it.
- **Lighthouse and axe.** `lighthouse.yml` audits both sites on the pull request's Vercel preview, because bench renders from its database and only a deployment has one. Its jobs run in parallel, each on its own runner, since a second audit or browser on the same CPU would skew Lighthouse's timings. Each one waits for the preview (Vercel's GitHub deployment in the `Preview` environment, through the `.github/actions/preview-proxy` action) and requests its page once to get past the cold start. Five Lighthouse jobs each audit one page, named by `LHCI_PAGE`: `/`, `/blog`, the newest post, `/bench` and one bench chart page (`lighthouserc.cjs` holds the pages, the thresholds and their rationale). The `axe` job runs `tests/a11y.spec.ts` (`--grep @axe`: WCAG 2.1 A and AA, and a serious or critical violation fails). The `report` job, the required check `Lighthouse and axe`, posts one score table on the PR from the Lighthouse jobs' reports and fails unless every job passed. The preview is reached through `scripts/preview-proxy.mjs`, which adds the `VERCEL_AUTOMATION_BYPASS_SECRET` header only to requests for the preview, so no other origin a page loads from sees it. Fork and Dependabot PRs get no secrets, so the jobs are skipped for them, which counts as passing. The smoke run in `ci.yml` leaves the axe specs out (`--grep-invert @axe`). To run axe yourself: `BASE_URL=https://vortex.dev BENCH_URL=https://bench.vortex.dev bunx playwright test --grep @axe`.
- **Deploys.** The `vortex` Vercel project builds and deploys the app, both sites, through the git integration, on every commit. `bench-verify-deploy.yml` runs `scripts/verify-web-deploy.mjs` on each production deployment Vercel reports, against bench under `/bench` on the deployment's own URL. Schema migrations go through `bench-schema-deploy.yml`, which only runs manually from `main` because the AWS role trusts nothing else.

## Architecture Overview

This is a Next.js 16 marketing website for Vortex, a columnar file format, drawn with the Vortex design system. The site features:

### Core Technologies

- **Next.js 16** with App Router and Turbopack
- **React 19** with TypeScript
- **The design system's CSS** (`src/styles/`), `globals.css` and CSS modules for styling, with no CSS framework
- **three.js** (WebGL) for the design system's ASCII mark, loaded once the page is idle
- **Plausible Analytics** for privacy-focused tracking
- **Vercel Analytics** for performance monitoring

### Visual System

- **Design system**: `src/styles/vortex-tokens.css` and `src/styles/vortex.css` are copies of the Vortex design system's styles (change the system, not the copies), and the markup uses its `vx-` classes
- **ASCII mark**: `src/components/ascii-mark` mounts the system's renderer (`src/vendor/vortex-design/`) on the homepage and the 404, with the static symbol as its fallback
- **Themes**: Dark only, except the blog, which carries the ThemeSwitch (`src/lib/theme.ts`)
- **Custom Fonts**: Geist, Geist Mono and Funnel Display, self-hosted through `next/font`

### Component Structure

- Layout components (`Header`, `Footer`) wrap all pages
- The homepage composes the hero (`InstallTabs`, `AsciiMark`), `BenchmarkCard` and `LogoBanner`
- The 404 and error pages (`not-found.tsx`, `error.tsx`) share the hero's layout in `src/app/(site)/status.module.css`

### Key Files

- `src/app/(site)/page.tsx` - Homepage with metadata for SEO
- `src/app/(site)/layout.tsx` - The site's root layout with analytics providers and font loading
- `src/app/(site)/globals.css` - The page frame, and the site's rules on top of the design system
- `next.config.mjs` - Plausible proxy configuration, security headers (CSP, HSTS, Permissions-Policy, COOP, CORP)

The site is optimized for performance with font optimization, analytics integration, and an ASCII mark that loads only once the page is idle.

## bench

Read [`docs/bench/README.md`](docs/bench/README.md) first for the architecture, then this section. The web app has its own deep-dive in [`docs/bench/web.md`](docs/bench/web.md).

### The legacy generations

The previous site generations (v2 and v3) are documented in [`docs/bench/legacy.md`](docs/bench/legacy.md). The v3 Rust tree (`server/`, `migrate/`, `ops/`, the Cargo workspace) has been deleted from the working tree; recover it from git history if ever needed. Do not resurrect it piecemeal — the rules below are the parts that were worth keeping.

### Load-bearing rules

- **`SCHEMA_VERSION` is a coordinated cross-repo change.** [`src/bench/lib/schema-version.ts`](src/bench/lib/schema-version.ts) is the in-repo source of truth; the monorepo's `scripts/post-ingest.py` hardcodes the same integer, and its `vortex-bench/src/v3.rs` owns the producer wire shape. Bump in lockstep across both repos. The versioned contract lives in [`docs/bench/CONTRACT.md`](docs/bench/CONTRACT.md), and [`src/bench/lib/schema-version.test.ts`](src/bench/lib/schema-version.test.ts) asserts the in-repo anchors agree.
- **`measurement_id` is internal — never on the wire.** It is a deterministic xxhash64 over `commit_sha` plus the dim tuple, computed by the monorepo's `scripts/_measurement_id.py` just before INSERT and used as the `ON CONFLICT` upsert key. Its output is frozen forever: the monorepo's golden-vector test (`scripts/tests/test_measurement_id.py`) pins it, because a drifted hash would insert duplicates next to the rows already in production.
- **Numeric `?n=` is clamped to 1000; `?n=all` is the uncapped escape hatch.** Pages hydrate from the materialized latest-100 shard artifact by default; `?n=all` is an explicit opt-in (the chart's full-history zoom-out hop uses it once, and curl power users can request it). The numeric path is bounded by `MAX_NUMERIC_COMMIT_WINDOW` in [`src/bench/lib/window.ts`](src/bench/lib/window.ts) as a DoS-protection floor against `?n=99999999`. Do NOT raise the numeric cap or remove it without thinking about the DoS surface, and do NOT re-introduce a server-side commit cap on `?n=all` — visual downsampling happens client-side via LTTB on the visible commit range only. Only the default window is in the Data Cache, so every other window is a direct query that only the CDN shields. The read APIs and the chart page redirect (308) a non-default window to its one URL, with `n` spelled canonically and only the parameters the route reads (`canonicalWindowQuery` in `window.ts`), so adding a parameter or respelling `n` cannot get a request past the CDN. They also redirect every other spelling of a slug to the canonical one (`chartKeyToSlug`, `groupKeyToSlug`), since the CDN keys on the spelling, and the chart page cuts `engine` and `format` to the values bench knows, sorted.
- **Don't refetch on every scope change.** Once a chart's payload is in memory, pan/zoom/slider/range-strip all rebuild in place via the in-memory LTTB pass on the cached payload ([`src/bench/components/chart/controller.ts`](src/bench/components/chart/controller.ts)). The single exception is the latest-100 to full-history zoom-out path: when the user first zooms past the materialized window, the chart lazy-fetches `?n=all` once and replaces the payload in place.
- **Group docs links mirror the monorepo's `Benchmark::doc_path`.** [`src/bench/lib/benchmark-docs.ts`](src/bench/lib/benchmark-docs.ts) maps each SQL dataset name to the benchmark's explainer doc in `vortex-data/vortex`, which is the same path that the monorepo's PR benchmark comment uses. The producer does not put `doc_path` on the wire, and upstream does not enforce a path convention, so update the explicit mapping when a suite is added or its doc moves. Groups without a matching explainer render no docs link. Do not guess a path or link to an unrelated general guide.
- **Every group kind has a summary, by default.** [`src/bench/lib/summary.ts`](src/bench/lib/summary.ts) has no allowlist gate: a suite that lands in one of the five fact tables gets a rollup card from its first ingest. The three timing families (query, random access, vector search) rank through one `rankSeries` model, so a new suite in any of them needs no summary code at all. `collectGroupSummary`'s exhaustive switch makes a missing arm for a sixth fact table a compile error rather than a silently blank card. Do NOT reintroduce a per-dataset allowlist; the v2-era one is what left `spatialbench`, `fineweb`, `gharchive`, `appian`, `public-bi`, `clickbench-sorted`, and every vector-search group with no card.
- **A summary ranks the whole group, never one chart.** Random access is the cautionary case: the producer emits `dataset` as `{dataset}/{pattern}`, so the group holds ~nine charts, and the old summary published the alphabetically first chart's raw times under the group-wide title "Random Access Performance" — reporting `lance` at 352us when it is over 1ms on most of the other charts. Sum chart medians by dataset, then rank the dataset totals. Include the legacy taxi chart in the taxi total. Apply a penalty when a series lacks one dataset total. Report dataset coverage through `measured`/`total`. The secondary runtime is the arithmetic mean of complete dataset totals.
- **Don't write a server-side classifier for live ingest.** The emitter produces structured records directly. Classifying loose name strings at read time was the v2-era weakness every later generation existed to escape; it belongs nowhere in the live pipeline.
- **Every root-relative bench URL goes through `benchPath()`.** A link, a fetch, an icon or a selector that names one of bench's paths must work on bench.vortex.dev (from the root) and everywhere else (under `/bench`); see "Repository layout". A path read from `location.pathname` already carries the base.

### Footguns we have already hit

All in the chart island, [`src/bench/components/Chart.tsx`](src/bench/components/Chart.tsx) and the modules in [`src/bench/components/chart/`](src/bench/components/chart/):

- **Reverse predecessor walk in the tooltip.** `payload.commits[]` is sorted oldest-first by SQL - `commits[0]` is the oldest, `commits[N-1]` is the newest. For per-row delta the predecessor of `commits[idx]` is at `idx - 1`. We caught a regression where a "fix" flipped this to `idx + 1`; the original walk-backward direction is right.
- **`pointer-events: auto` on the tooltip host.** The tooltip is positioned at the cursor; making it pointer-interactive causes a flicker loop. Keep it `pointer-events: none` and offset via `transform: translate(12px, 12px)`.
- **`change` events on the slider.** Use `input` events with a small throttle; `change` only fires on release and feels broken.

### Local dev

```bash
# The app needs BENCH_DB_* env vars for bench's database — see docs/bench/web.md.
bun install && bun run dev   # bench is at http://localhost:3000/bench

bun run test:bench           # vitest
bun run build                # deliberately works without a database, so CI needs no secrets
bun run check:ci             # biome format and lint, both sites
```

To see bench as bench.vortex.dev serves it, send its host: `curl -H 'Host: bench.vortex.dev' http://localhost:3000/`. A browser cannot reach `bench.vortex.dev` over plain HTTP (the `.dev` domain is on the HSTS preload list), so the parity check (`scripts/parity/`) puts a small proxy in front that sets the host.

### Lint and format

bench uses Biome, not ESLint or Prettier. The bench override in the root `biome.json` keeps the style bench had under Prettier (single quotes, trailing commas, 100 columns, 2-space indent) for bench's files, and `bun run check:ci` checks bench along with the site. `biome.json` cannot hold comments, so the reasons for each difference from the site's rules are here:

- `correctness/useExhaustiveDependencies` is on (the site has it off). It replaces ESLint's `react-hooks/exhaustive-deps`. An effect that omits dependencies on purpose carries a `biome-ignore` comment that says why.
- The site's `a11y` rules apply to bench unchanged. Seven places in existing markup break one of them on purpose, and each carries an inline `biome-ignore` comment that says why: `useAriaPropsSupportedByRole` for `aria-label` on a plain `div` (the header nav controls, the chart toolbar), `useSemanticElements` for `role="group"` on a `div` in the toolbars (a `fieldset` would change their layout), `useFocusableInteractive` for the pointer-driven range strip, and `noNoninteractiveTabindex` for the group info icon, which takes focus so its tooltip shows for keyboard users. New markup follows the rules, or carries its own `biome-ignore` with a reason.
- `complexity/noImportantStyles` is off: `!important` overrides Chart.js's inline canvas size and the offscreen prebuild layout in `src/bench/styles/globals.css`.
- `organizeImports` is off: Prettier never sorted bench's imports, and reordering them would rewrite 27 files and could change the order CSS loads in.

Next.js's `core-web-vitals` lint rules have no Biome equivalent; the site accepts that too. The site's config also turns off `suspicious/noExplicitAny`, so bench's old typescript-eslint `no-explicit-any` check is gone too.

## Licensing

Section 7 of the Vortex Technical Charter (`src/assets/charter.pdf`) sets the licenses: code is Apache-2.0 and documentation is CC-BY-4.0. `REUSE.toml` maps every file to one of them, and the `reuse` CI job fails on any file it doesn't cover.

- **Code** under `src/`, `scripts/`, `tests/` and `.github/`, plus root config files, is covered by extension. No per-file SPDX header is needed.
- **bench**'s files (`src/bench/`, `src/app/(bench)/`, `db/`, `infra/`, `docs/bench/`, `scripts/parity/`, `scripts/verify-web-deploy*`) carry their own SPDX headers: Apache-2.0 for code, CC-BY-4.0 for Markdown. A header wins over `REUSE.toml`, so a new bench Markdown file must say CC-BY-4.0.
- **Blog posts** (`src/content/**.mdx`) and Markdown are CC-BY-4.0 automatically.
- **Images and other assets** are deliberately not covered. Add an annotation for each new one: CC-BY-4.0 if the Vortex contributors made it, or `LicenseRef-Third-Party` with the owner as `SPDX-FileCopyrightText` if someone else owns it (another organization's logo, for example). Never relicense a file the project doesn't own.
- Run `reuse lint` locally after adding files (`pipx install 'reuse[charset-normalizer]'`).

## Supply chain hardening

Defense in depth against the npm-worm class (Shai-Hulud, mini-Shai-Hulud, the May 2026 TanStack incident, etc.). Layers, in order of which one trips first when a bad package surfaces:

1. **`bunfig.toml` → `install.minimumReleaseAge = 604800`** (7 days). Bun refuses to resolve to a package version younger than 7 days. Applies to every `bun install` / `bun add` / `bun update` (local dev, lockfile regens, and Vercel builds), so we can't accidentally pull a freshly published version that hasn't had time to be observed. If a fresh dep is genuinely needed before the window elapses, allowlist it via `install.minimumReleaseAgeExcludes`.
2. **`renovate.json` → `minimumReleaseAge: "7 days"`** — symmetric with #1, applied at PR-proposal time. Renovate won't open a PR for a version younger than the window, and `bunfig.toml` won't let Bun resolve to one either. Both gates are required: a local `bun add` bypasses Renovate; a Renovate `lockFileMaintenance` cycle would otherwise pull fresh transitives.
3. **`trustedDependencies` in `package.json`** — explicit allowlist for which packages may run lifecycle scripts (`preinstall` / `install` / `postinstall`). Bun's default behavior is name-only trust against a built-in ~366-package allowlist, which lets a transitive named like a popular package hijack scripts (the PackageGate class of attack). Current set: `["esbuild", "sharp"]` — esbuild's `postinstall` builds its native bin (pulled in transitively via velite); sharp's `install` builds libvips for next/image. When adding a top-level dep that ships native bins or needs a build step, audit its lifecycle scripts via `bun pm untrusted` (which misses transitive packages under the isolated linker; see "Linker and lifecycle scripts" below), then extend this list with one-line justification in the commit message.
4. **`bun audit`** runs as its own **non-blocking** CI job (`audit`) on every PR and push to main. It reports the advisory state — the step goes red and the full output posts to the job summary — but the job stays green, so an upstream publish can't block unrelated PRs. Read the summary on every run and act on what it shows; the resolution is one of three:
    - **Direct dep bump** — if the advisory is in a top-level dep with a patched release, bump in `package.json`.
    - **`overrides` entry** — if the advisory is in a transitive dep whose parent hasn't released a fix, force-pin the patched version in `package.json`'s `overrides` block. This is the most common case. Pick the latest patched version that is ≥7 days old (matching the cooldown policy) so a fresh install can't resolve to a too-new version.
    - **Document and accept** — if no upstream fix exists yet, add an entry under "Audit advisories" below with: GHSA ID, vulnerable range, package, why exposure is acceptable (e.g. dev-only, not in client bundle), and a removal trigger. The job carries no `--ignore` flags: with nothing to keep green, suppressing an advisory only hides it, so this file is where an accepted advisory is recorded.
    - When a parent dep eventually patches its own transitive, drop the corresponding `overrides` entry — leaving stale overrides means we keep deduping a fix that was already merged upstream.
5. **`actions/dependency-review-action`** runs on every PR and **hard-fails** the build if the PR introduces a new advisory at severity `high` or above in a runtime-scope package. With `bun audit` informational, this is the only advisory check that blocks merge — deliberately scoped to what the PR itself adds, not the whole pre-existing tree.
    - **It sees `bun.lock` through a submitted snapshot.** GitHub's dependency graph does not read `bun.lock`, so `.github/workflows/dependency-snapshot.yml` runs `scripts/dependency-snapshot.ts` on every push to main and on the head commit of every same-repository PR. It posts one manifest per workspace (one, `bun.lock (vortex)`, since bench joined the root package) to the Dependency Submission API, listing every package that workspace reaches with a scope: `runtime` if a workspace's `dependencies` or `optionalDependencies` reach it, `development` otherwise. An optional peer, like Next.js's Playwright, does not pull its package into `runtime`.
    - **A guard fails the review when the snapshot is missing.** The action reviews whatever graph it finds, so without the snapshot it would pass without `bun.lock`'s packages. Before the action, the job's "Require the bun.lock snapshot" step waits up to 10 minutes for the snapshot job (`Submit bun.lock`) on the PR's head commit, and fails unless that job succeeded. A fork PR gets no snapshot, because its token cannot write, so the guard fails a fork PR that changes `bun.lock` (make that change from a branch in this repository) and passes one that does not, because it adds no locked package. After the guard, the action still waits up to 300 seconds (`retry-on-snapshot-warnings`) while GitHub processes the snapshot. If you rename the snapshot job, change the guard's `SNAPSHOT_CHECK` with it.
    - **It fails on runtime scope only.** `fail-on-scopes` is left at the action's default, `runtime` (`action.yml` declares no default; the action's schema and README give `runtime`). An advisory in a `development`-scope package does not block merge. That includes bench's development tools (Vitest, testcontainers, jsdom and what they pull in), whose advisories blocked bench PRs under pnpm. `bun audit` is where those advisories show: it reports the whole tree on every run, and the "Audit advisories" list below records the accepted ones. Runtime means reachable from `dependencies`, which includes build-time tools the site lists there (velite, tailwindcss, `@tailwindcss/typography`).
6. **`trufflesecurity/trufflehog`** secret scan runs on every PR and push to main. Defense-in-depth on top of GitHub's push protection; catches verified secrets that slipped past push protection (low-entropy formats, detector patterns added after the secret was committed, or push-protection bypass).
7. **OpenSSF Scorecard** (`.github/workflows/scorecard.yml`) grades the repo weekly on supply-chain hygiene (pinned actions, branch protection, token permissions, dangerous workflow patterns). SARIF posts to the Security tab; aggregate score publishes to https://scorecard.dev.
8. **All third-party GitHub Actions are SHA-pinned**, not tag-pinned. A tag can be moved to point at a malicious commit (and has been, in prior supply-chain incidents); a SHA can't. Renovate's `helpers:pinGitHubActionDigests` preset enforces this on auto-bump PRs. When bumping an action manually, update both the SHA and the trailing `# vX.Y.Z` comment in the same diff.
9. **Pinned runner images** (never `ubuntu-latest`), so runner-image bumps are deliberate PRs, not silent infrastructure drift. The checks (`ci.yml`, `lighthouse.yml`) and the repository-wide workflows (`dependency-snapshot.yml`, `scorecard.yml`, `claude.yml`) run on `ubuntu-26.04`, including bench's Docker (testcontainers) Postgres suite. bench's operational workflows run on `ubuntu-24.04`: `bench-verify-deploy.yml`, `bench-keep-warm.yml` and `bench-schema-deploy.yml`. Move them to 26.04 in a PR of their own. The Node version inside the runner image can still drift; `.nvmrc` pins that separately.

### Node version

Three places must agree with each other and with what Vercel runs. Vercel offers Node 22.x, 24.x and 26.x, with 26 the default, and all three are aligned on 26:

- `.nvmrc` → `26`, which the CI workflows read via `actions/setup-node`'s `node-version-file`.
- `package.json` → `engines.node = "26.x"`. Vercel resolves this range against the versions it offers, and it **overrides the dashboard setting**. An open range such as `">=24"` silently moves production to each new major Vercel adds, ahead of CI: that is how production reached 26 while CI still ran 24. A range no offered version satisfies fails the deploy outright. The `vortex` Vercel project is also set to 26.x, so the setting and the range agree.
- `@types/node` → `^26`, matching the runtime so `tsc` cannot green-light an API that production does not have.

Keep them in lockstep when bumping, and move to a new major only after Vercel offers it; check https://vercel.com/docs/functions/runtimes/node-js/node-js-versions first.
10. **Renovate auto-merge** is patch + minor only via `:automergeStableNonMajor`. Major bumps stay open for human review. The 7-day cooldown is the first gate, and the required checks on `main` are the second. Renovate merges through GitHub's auto-merge, which waits only for required checks: `Lint, build, verify` (lint, build, typecheck, both sites' tests, `bun run verify` and Playwright), `dependency-review`, `secret-scan`, `DCO`, `REUSE compliance`, `Submit bun.lock`, `Lighthouse and axe` and `Vercel`, plus a CodeQL code scanning rule. The `Vercel` check is the `vortex` project's preview deployment, which now builds bench too. `bun audit` is not required, so it doesn't hold an auto-merge. Lighthouse takes the best of three runs per URL, so one slow shared runner doesn't fail it. A Renovate PR runs `Lighthouse and axe` like any same-repository PR; a Dependabot PR skips it. Lock file maintenance automerges too. Renovate cannot apply `minimumReleaseAge` to a Bun lock refresh, so `renovate.json` turns it off for that update type; `bunfig.toml` enforces the same wait while Bun regenerates `bun.lock`. `biome.json` takes its `$schema` from the installed `@biomejs/biome` package rather than a versioned URL, so a Biome update can't fail on a schema version mismatch, and it leaves Markdown and YAML alone, as Biome 2.5 did.

### Linker and lifecycle scripts

bench's dependencies are in the root `package.json`, so the layers above cover them. Two settings came with bench from pnpm:

- **Linker.** `bunfig.toml` sets `linker = "isolated"`, so every package gets the dependencies it resolved, as pnpm gave bench: no code can load a transitive dependency that its own package does not declare.
- **Lifecycle scripts.** `trustedDependencies` trusts `sharp`, which pnpm's `allowBuilds` let build for bench, and stays `["esbuild", "sharp"]`. Bun blocks three scripts in bench's test tools, `protobufjs`, `ssh2` and `cpu-features`, which pnpm blocked too. With the isolated linker, `bun pm untrusted` lists only packages linked at the top of `node_modules`, so it reports none of them; to audit, install once with `bun install --linker hoisted` in a scratch copy and run it there.
- **Renovate** keeps the updates of the packages only bench uses (`pg`, Chart.js, `@vercel/functions`, Vitest and its test tools), and of bench's workflows, in their own `bench-` branches. They automerge like the site's (patch and minor).

### Audit advisories

`bun audit` is the source of truth for dependency advisories, for both sites. State as of 2026-10-29: none. Removing `@lhci/cli` (below) cleared the site's eight, and a lockfile refresh cleared bench's two. Dependency review blocks only an advisory that a PR introduces, so a newly published one never holds an unrelated merge.

**Resolved by an `overrides` entry:**

- **sharp `<0.35.5`** (GHSA-wq5f-xc86-pv6w, high — librsvg CVE-2026-96889; also GHSA-rgj7-g3m4-5g8c `<0.35.4` and GHSA-f88m-g3jw-g9cj `<0.35.0`). `next@16.4.1` asks for `sharp@^0.35.5`, but `velite@0.4.0` declares `sharp@^0.34.5`, a range that cannot reach 0.35.x, so the tree would carry a vulnerable second copy. `overrides.sharp = "^0.35.5"` pulls velite onto the patched line and dedupes to one copy. Crossing 0.34 → 0.35 is a breaking bump on sharp's 0.x line; verified safe because velite's image pipeline runs during `bun run build` and the build passes. Drop the override once velite ships a release declaring `sharp@^0.35.5` or later — 0.4.0 is still the latest.

- **zod `<4.6.6`** (GHSA-mrhx-c7xc-m3w5, high memory exhaustion on oversized constrained collections). Path: bench's `@vercel/functions > @vercel/oidc > @vercel/cli-config` pins `zod@4.1.11` exactly. `overrides.zod = "^4.6.7"` puts it on 4.6.7. bench only imports `attachDatabasePool`, which does not load the OIDC code that uses zod. The snapshot scopes bench's zod `runtime`, because `@vercel/functions` is in bench's `dependencies`, so dependency review would block a PR that drops the override without `allow-ghsas: GHSA-mrhx-c7xc-m3w5` on the Dependency Review step in `ci.yml`. Drop the override once `@vercel/cli-config` accepts zod 4.6.6 or later.

**Removed: `@lhci/cli`.** It brought eight advisories into `bun.lock`: extract-zip (two, with no fixed release), basic-ftp, body-parser, qs, tmp (two) and uuid. CI never used it, because the Lighthouse workflow runs `treosh/lighthouse-ci-action`, which ships its own copy. `bun run lighthouse` now fetches a pinned `@lhci/cli@0.15.1` with `bunx` when you run it. Do not add it back as a dependency.

**Cleared, for the record:** postcss-selector-parser `<6.1.5` (GHSA-rj75-hqrm-r3gf) went with `@tailwindcss/typography`, its only parent, when the blog moved to the design system's prose styles and dropped the plugin.

**Held back on purpose:** `@types/node` stays on `^26` to match the runtime (see "Node version"); `renovate.json` caps it with `allowedVersions: "<27"` so Renovate does not open 27.x / 28.x PRs ahead of the runtime.

The `audit` job in `.github/workflows/ci.yml` runs a bare `bun audit` and never fails CI; any advisory it finds shows in its job summary, and is recorded here with how it is handled. Merge blocking on advisories is `dependency-review`'s job.

#### bench advisories

`bun audit` reports bench's advisories with the site's. Dependency review sees bench's packages in the snapshot's one manifest, scoped like the site's (layer 5), so an advisory in one of bench's development tools does not block a PR. State as of 2026-10-29: `bun audit` reports none for bench. bench's move to Next.js 16.4.1 (postcss 8.5.23) and vitest 5.0.4 cleared six, and a lockfile refresh cleared protobufjs.

- **Resolved by `overrides` in the root `package.json`:** zod (see "Audit advisories"). sharp needs no override for bench: next 16.4.1 asks for `^0.35.5` itself.
- **Resolved in the lockfile:** @grpc/grpc-js, brace-expansion, js-yaml, protobufjs (7.6.5, for GHSA-f38q-mgvj-vph7 and GHSA-j3f2-48v5-ccww) and source-map-js, by refreshing within their parents' ranges. vite is a direct dev dependency (`^8.3.4`), because it is vitest's peer: as a direct dependency its range sets the version the lockfile holds, so the vulnerable 8.0.16 cannot come back. (Under pnpm, an override alone left 8.0.16 locked.)
- **Gone with bench's own deploy:** the Vercel CLI that `bench-deploy.yml` installed from `.github/vercel-cli`, with the `overrides` that patched its pinned dependencies. bench now deploys with the site through the `vortex` project's git integration, so no workflow installs the CLI.
