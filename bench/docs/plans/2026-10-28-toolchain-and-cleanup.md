<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench: upgrade, share the site's toolchain, clean up

Status: design, 2026-10-28. Step 1 of 3.

## Why

bench (`bench/web`) came from the archived `vortex-data/benchmarks-website`
repository. It runs on a second toolchain beside the marketing site: pnpm,
ESLint, Prettier, TypeScript 5.9 and Next.js 15.5, against the site's Bun,
Biome, TypeScript 7 and Next.js 16. Its packages are behind, and two of its
largest files (`components/Chart.tsx`, 2,200 lines; `lib/chart-store.ts`, 632
lines) are hard to change safely.

The goal is maintainability: one toolchain and one set of supply-chain rules
for both apps, current dependencies, and smaller, clearer code. The two apps
keep separate deployments.

This is the first of three steps:

1. **This document.** Upgrade and clean up bench with no change in behavior.
2. A new landing page: one page, every group folded with its headline numbers,
   and opening a group loads its charts in place.
3. One visual redesign across vortex.dev, bench, explore and docs. Open PR
   vortex-data/vortex.dev#120 is held for that step.

## Goals

- bench and the site share one Bun workspace, one lockfile, one Biome config
  and one TypeScript base config.
- bench is on Next.js 16, React 19.3, TypeScript 7 and current versions of its
  other packages, inside the 14-day cooldown.
- The code is smaller and clearer where that is cheap: dead paths removed, the
  two largest client files split into modules, and a group's charts fetched
  with one query instead of one per chart.
- Behavior is exactly the same, and each PR proves it.

## Non-goals

- Any change a visitor can see. The landing page is step 2; the visual
  redesign is step 3.
- Replacing Vitest. It stays: its 8,000 lines of tests are the main evidence
  that behavior did not change.
- Porting `bench/scripts/migrate-schema.py` to Bun. That comes later and is
  not urgent.
- Database schema, ingest contract (`bench/CONTRACT.md`) or AWS changes.
- Merging the two Vercel projects or changing either app's domain.

## Anti-goals

The work fails, even if it builds, if any of these happen:

- A page, API response, response header, cache rule or URL changes.
- The supply-chain gates get weaker: the 14-day cooldown, explicit overrides,
  the lifecycle-script allowlist, SHA-pinned actions, `ubuntu-24.04` runners.
- The marketing site's build, behavior or deploy changes, beyond installing
  from a shared lockfile.
- The work lands as a long stack of small PRs. Will smoke-tests each PR by hand
  in its Vercel preview, so fewer, larger PRs are better.

## Constraints

- **Order.** vortex-data/vortex.dev#124 (database pool lifecycle) merged on
  2026-10-28; build on it. PR 1 deletes `bench/web/pnpm-workspace.yaml`, so its
  exact-version cooldown exemptions go with it. A version still inside the
  window then needs a `bunfig.toml` exemption, with a removal date.
- **Supply chain.** CLAUDE.md "Supply chain hardening" is the policy. Bun
  enforces the cooldown through `bunfig.toml`, so the pnpm settings move as
  follows:
  - The `overrides` in `bench/web/pnpm-workspace.yaml` (postcss, sharp and
    zod) move to the root `package.json` `overrides`. Each entry keeps its
    advisory and removal trigger. Drop postcss if the version Next.js 16 pins
    is already patched. Bun applies overrides to the whole workspace, so the
    zod override (`^4.6.7`, for `@vercel/functions` > `@vercel/oidc` >
    `@vercel/cli-config`, which pins 4.1.11) also moves Lighthouse CI's
    `chromium-bidi` from zod 3 to zod 4. That reverses a CLAUDE.md decision on
    purpose: the Lighthouse job must still pass, and it also clears the site's
    accepted zod advisory. If Lighthouse CI breaks, drop the override and
    record bench's zod 4.1.11 as an accepted advisory instead (it parses only
    local Vercel CLI config files).
  - GitHub's dependency graph doesn't read `bun.lock`. Once bench leaves
    `pnpm-lock.yaml`, `dependency-review` would no longer see its transitive
    packages; the site already has that gap. A workflow submits a dependency
    snapshot built from `bun.lock` to the Dependency Submission API on pushes
    to `main` and on pull requests, so `dependency-review` sees every resolved
    package for both apps. It must run before `dependency-review` reads the
    pull request's dependencies.
  - `allowBuilds` moves to `trustedDependencies`. Today only `sharp` and
    `unrs-resolver` may build, and `unrs-resolver` goes away with ESLint.
  - The bench parts of CLAUDE.md ("bench/ (pnpm)", "bench advisories") are
    rewritten to match.
- **Required checks.** The `main` ruleset requires a check named
  `Bench: format, lint, build, test`. Keep that job name. Renaming it needs a
  ruleset change.
- **Settings changes need Will's confirmation first.** That covers GitHub,
  Vercel and AWS settings. The `benchmarks-website` Vercel project builds on
  the GitHub runner (`vercel build` in `.github/workflows/bench-deploy.yml`),
  so the install command probably changes only in the workflow. If a project
  setting must change, ask first.
- **The site's Vercel project** (`vortex`) builds through the git
  integration. Adding a workspace must not make it build bench, and must not
  noticeably slow its install. `scripts/vercel-ignore-build.sh` keeps skipping
  bench-only commits.
- **Node 24** stays the runtime (CLAUDE.md "Node version").
- **DCO sign-off** on every commit. Squash merges only.
- **Licensing.** New bench files carry SPDX headers: Apache-2.0 for code,
  CC-BY-4.0 for Markdown.

## Decided by Will

- Share the toolchain and code, and keep separate deployments.
- Fewer, larger PRs, each smoke-tested in its Vercel preview.
- Keep Vitest for now.
- The Python migration runner moves to Bun eventually, not in this work.
- Close the `bun.lock` gap in dependency review with a submitted dependency
  snapshot.
- Force zod 4 across the workspace and let Lighthouse CI prove it still works.

## The work: two PRs

### PR 1: upgrade bench and move it onto the site's toolchain

Mechanical changes only. Commits are ordered so a reviewer can read each one
alone.

1. **Parity check first.** Add the parity script (see "Proving nothing
   changed") and run it with `main` on both sides, to show it reports no
   difference. Later commits must keep it clean.
2. **Bun workspace.** The root `package.json` lists `bench/web` as a workspace.
   One `bun.lock` replaces `bench/web/pnpm-lock.yaml`. `pnpm-workspace.yaml`
   goes, and its settings move as described under Constraints.
   `.github/workflows/bench-ci.yml`, `bench-deploy.yml`, the
   `.github/actions/bench-checks` composite and Renovate's bench rule switch
   from pnpm to Bun. The dependency-snapshot workflow lands in the same
   commit, so `dependency-review` never loses sight of bench's packages.
3. **Output file tracing.** `bench/web/next.config.js` sets
   `outputFileTracingRoot: __dirname`. Bun hoists workspace packages to the
   root `node_modules`, so tracing must start at the repository root, or the
   deployed functions can miss dependencies. Check the traced files of a
   preview function, not only the build log.
4. **Next.js 16 and React 19.3**, with the other dependency updates
   (`pg`, `chart.js`, `jsdom` 30, `@types/*`). Read the Next.js 16 upgrade
   guide against bench's use of `unstable_cache`, `revalidateTag`,
   `force-dynamic` pages, route handlers and `vercel.json` headers. Turbopack
   becomes the default builder.
5. **Biome replaces ESLint and Prettier.** One root `biome.json` covers both
   apps: remove the `!bench` exclusion. An `overrides` entry for `bench/**`
   keeps bench's current Prettier style (single quotes, trailing commas,
   100 columns), so the switch reformats almost nothing. One style for both
   apps can come later; `main` takes squash merges only, so a mass reformat
   can't be hidden from `git blame` without also hiding the real changes in
   the same squashed commit. ESLint's `next/core-web-vitals` rules have no
   Biome equivalent; the site already accepts that. Map any rule bench relies
   on, such as the React hooks rules, to its Biome counterpart.
6. **TypeScript 7.** bench's `tsconfig.json` extends a base shared with the
   site and keeps its current strictness. Stricter flags wait for PR 2.

### PR 2: clean up bench's code

Logic stays the same. The parity check and the tests prove it.

- **Remove the IAM sign-in path.** Production signs in with the `bench_read`
  password; IAM auth is not available for that role as shipped (see
  `bench/web/README.md`). Remove `@aws-sdk/rds-signer`, `BENCH_DB_REGION` and
  the signer code, and make `BENCH_DB_PASSWORD` required. Update the README
  and runbooks.
- **One query per group.** `collectGroupCharts` now runs two queries for each
  chart (a seed window and the data), about 200 for a TPC-DS group of 99
  charts. Fetch a group's rows in one or two queries, keeping each chart's own
  last-N-commits window (for example, with a window function partitioned by
  chart). The JSON must stay byte-identical. This removes the fan-out that
  `QUERY_CONCURRENCY` and the pool-wait discussion on #124 exist for. Keep the
  concurrency limit unless the new code no longer needs it.
- **Split `components/Chart.tsx` and `lib/chart-store.ts`** into smaller
  modules along their existing seams (fetching, formatting, zoom, the loading
  queues). Move code; don't rewrite it.
- **Adopt the site's stricter TypeScript flags**
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), with the code
  changes they need.
- Remove dead code that the stricter flags and Biome expose.

## Proving nothing changed

Each PR passes these checks, in order:

1. **CI**: `Bench: format, lint, build, test`, including the Postgres
   integration suite.
2. **Parity, run locally.** Restore a production `pg_dump` into a local
   Postgres container. Build `main` and the PR branch, serve both with
   `next start` on two ports against that one database, and compare:
   - JSON from `/api/groups`, `/api/group/{slug}` for every group at `n=100`
     and one other window, and `/api/chart/{slug}` for every chart at `n=100`
     and a sample at `n=all`. The bodies must match exactly.
   - The response headers the app sets: status, `content-type`,
     `cache-control`.
   - The `/` and `/chart/{slug}` pages: screenshots after the charts load, at
     desktop and phone widths, compared pixel by pixel with Playwright (already
     a dev dependency of the site).

   Comparing against production or a Vercel preview doesn't work: the Data
   Cache (`unstable_cache`, with a 24-hour backstop, flushed only by
   production's `/api/revalidate`) makes a preview's cached routes lag
   production after any ingest, and a shared preview cache could serve
   payloads built by older code. Two local servers start with empty caches
   and read the same frozen data, so any difference comes from the code.
   This needs no token and no Vercel setting. Will's Mac holds a dump from
   2026-10-28 in `~/Backups/vortex-bench/`.
3. **The deployed preview.** `bench-deploy.yml` already runs
   `bench/scripts/verify-web-deploy.mjs` against each preview's public read
   paths. It catches what only a Vercel build shows, such as file tracing.
   `vercel.json`, which carries the CDN cache headers, must not change.
4. **Will's smoke test** in the preview.

## Left to the builder

- The parity script's exact sample, and how it waits for charts before a
  screenshot.
- The Biome rule mapping, and how to apply the site's style.
- Whether TypeScript 7 or Next.js 16 needs code changes, and what they are.
- The module boundaries for the `Chart.tsx` and `chart-store.ts` split.
- The SQL for the group query, as long as the output is byte-identical.
- Whether to install the whole workspace or only one app in each workflow.
