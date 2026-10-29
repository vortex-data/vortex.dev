# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `bun dev` - Start development server with Turbopack
- `bun build` - Build production application
- `bun lint` - Run Biome lint
- `bun start` - Start production server

bench is a member of the root Bun workspace. `bun install` at the root installs both apps; run bench's scripts with `bun run --cwd bench/web <script>`: `dev`, `build`, `lint`, `format`, `format:check`, `test`. `lint` and `format` are Biome, as at the root. The Postgres integration suite needs Docker or a local Postgres named by `BENCH_TEST_DATABASE_URL` (`bench/web/README.md` has the commands), and skips without either, except when `CI=true`, where it fails.

## Repository layout

The repository holds two independent apps:

- **The marketing site** (vortex.dev), at the root. Everything below "Architecture Overview" describes it.
- **bench** (bench.vortex.dev), in `bench/`: the benchmark results site, its Postgres schema (`bench/migrations/`), its AWS provisioning (`bench/infra/`) and `bench/CONTRACT.md`, the ingest contract with the emitter in the `vortex-data/vortex` monorepo. Start with `bench/README.md` and `bench/AGENTS.md`. It came from the archived `vortex-data/benchmarks-website` repository, which keeps its earlier history.

They share one Bun workspace and the CI policy, and deploy separately:

- **Toolchain.** `bench/web` is a member of the root Bun workspace: one `bun.lock`, one `bunfig.toml`, one `bun install` at the root. Bun's isolated linker gives each package its own dependencies; both apps run Next.js 16.4.1, React 19.3 and TypeScript 7. The root `biome.json` lints and formats both apps: a `bench/**` override keeps bench's old Prettier style (single quotes, trailing commas, 100 columns) and sets bench's lint rules (see `bench/AGENTS.md`), and `bun run check:ci` at the root checks all of it. Both `tsconfig.json` files extend the root `tsconfig.base.json`, which holds the compiler options the apps share, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Each app keeps its own target, paths and extra flags (bench's `noFallthroughCasesInSwitch` and `noUncheckedSideEffectImports`). The root `tsconfig.json` excludes `bench/`, and `bench/web/postcss.config.mjs` keeps Next.js from picking up the root's Tailwind config.
- **CI.** `.github/actions/changed-paths` reports which app a change touches. `ci.yml` skips its site jobs on bench-only changes, and `bench-ci.yml` skips on site-only changes. The workspace's root files (`package.json`, `bun.lock`, `bunfig.toml`, `biome.json`, `tsconfig*.json`) count as both. Both gate with `if:`, not `on.paths`, so a skipped required check still passes. Dependency review, the secret scan and REUSE run on every change.
- **Deploys.** The `vortex` Vercel project builds the site through the git integration, and `scripts/vercel-ignore-build.sh` skips bench-only commits. bench deploys to the `benchmarks-website` Vercel project (Root Directory `bench/web`) from `bench-deploy.yml`, with the Vercel CLI, on changes to `bench/` and to the root `package.json`, `bun.lock`, `bunfig.toml` and `tsconfig.base.json`. Schema migrations go through `bench-schema-deploy.yml`, which only runs manually from `main` because the AWS role trusts nothing else.

## Architecture Overview

This is a Next.js 16 marketing website for Vortex, a columnar file format. The site features:

### Core Technologies

- **Next.js 16** with App Router and Turbopack for development
- **React 19** with TypeScript
- **TailwindCSS 4** for styling
- **OGL** (WebGL library) for 3D graphics and ASCII art effect
- **Plausible Analytics** for privacy-focused tracking
- **Vercel Analytics** for performance monitoring

### Visual System

- **3D Logo Animation**: WebGL-rendered GLTF model (`/public/logo.glb`) with ASCII art shader effect
- **Interactive Mouse/Touch Controls**: Model rotates based on user interaction
- **Responsive Design**: Different camera positions and sizing for mobile/desktop
- **Custom Fonts**: Geist Sans, Geist Mono, and Funnel Display

### Component Structure

- `HeroASCII` - Main 3D logo component with WebGL rendering and ASCII conversion
- `Overlay` - Text overlay on top of the 3D scene
- Layout components (`Header`, `Footer`) wrap all pages
- 404 page has its own hero variant (`hero-404`, `overlay-404`)

### Key Files

- `src/app/page.tsx` - Homepage with metadata for SEO
- `src/components/hero/index.tsx` - Complex WebGL rendering with custom shaders
- `src/app/layout.tsx` - Root layout with analytics providers and font loading
- `next.config.mjs` - Plausible proxy configuration, security headers (CSP, HSTS, Permissions-Policy)

The site is optimized for performance with font optimization, analytics integration, and responsive WebGL rendering.

## Licensing

Section 7 of the Vortex Technical Charter (`src/assets/charter.pdf`) sets the licenses: code is Apache-2.0 and documentation is CC-BY-4.0. `REUSE.toml` maps every file to one of them, and the `reuse` CI job fails on any file it doesn't cover.

- **Code** under `src/`, `scripts/`, `tests/` and `.github/`, plus root config files, is covered by extension. No per-file SPDX header is needed.
- **bench** source files carry their own SPDX headers: Apache-2.0 for code, CC-BY-4.0 for Markdown. A header wins over `REUSE.toml`, so a new bench Markdown file must say CC-BY-4.0. `REUSE.toml` covers bench's JSON, YAML and `.gitignore` files.
- **Blog posts** (`src/content/**.mdx`) and Markdown are CC-BY-4.0 automatically.
- **Images and other assets** are deliberately not covered. Add an annotation for each new one: CC-BY-4.0 if the Vortex contributors made it, or `LicenseRef-Third-Party` with the owner as `SPDX-FileCopyrightText` if someone else owns it (another organization's logo, for example). Never relicense a file the project doesn't own.
- Run `reuse lint` locally after adding files (`pipx install 'reuse[charset-normalizer]'`).

## Supply chain hardening

Defense in depth against the npm-worm class (Shai-Hulud, mini-Shai-Hulud, the May 2026 TanStack incident, etc.). Layers, in order of which one trips first when a bad package surfaces:

1. **`bunfig.toml` → `install.minimumReleaseAge = 604800`** (7 days). Bun refuses to resolve to a package version younger than 7 days. Applies to every `bun install` / `bun add` / `bun update` (local dev, lockfile regens, and Vercel builds), so we can't accidentally pull a freshly published version that hasn't had time to be observed. If a fresh dep is genuinely needed before the window elapses, allowlist it via `install.minimumReleaseAgeExcludes`.
2. **`renovate.json` → `minimumReleaseAge: "7 days"`** — symmetric with #1, applied at PR-proposal time. Renovate won't open a PR for a version younger than the window, and `bunfig.toml` won't let Bun resolve to one either. Both gates are required: a local `bun add` bypasses Renovate; a Renovate `lockFileMaintenance` cycle would otherwise pull fresh transitives.
3. **`trustedDependencies` in `package.json`** — explicit allowlist for which packages may run lifecycle scripts (`preinstall` / `install` / `postinstall`). Bun's default behavior is name-only trust against a built-in ~366-package allowlist, which lets a transitive named like a popular package hijack scripts (the PackageGate class of attack). Current set: `["esbuild", "sharp"]` — esbuild's `postinstall` builds its native bin (pulled in transitively via velite); sharp's `install` builds libvips for next/image. When adding a top-level dep that ships native bins or needs a build step, audit its lifecycle scripts via `bun pm untrusted` (which misses transitive packages under the isolated linker; see "bench/" below), then extend this list with one-line justification in the commit message.
4. **`bun audit`** runs as its own **non-blocking** CI job (`audit`) on every PR and push to main. It reports the advisory state — the step goes red and the full output posts to the job summary — but the job stays green, so an upstream publish can't block unrelated PRs. Read the summary on every run and act on what it shows; the resolution is one of three:
    - **Direct dep bump** — if the advisory is in a top-level dep with a patched release, bump in `package.json`.
    - **`overrides` entry** — if the advisory is in a transitive dep whose parent hasn't released a fix, force-pin the patched version in `package.json`'s `overrides` block. This is the most common case. Pick the latest patched version that is ≥7 days old (matching the cooldown policy) so a fresh install can't resolve to a too-new version.
    - **Document and accept** — if no upstream fix exists yet, add an entry under "Audit advisories" below with: GHSA ID, vulnerable range, package, why exposure is acceptable (e.g. dev-only, not in client bundle), and a removal trigger. The job carries no `--ignore` flags: with nothing to keep green, suppressing an advisory only hides it, so this file is where an accepted advisory is recorded.
    - When a parent dep eventually patches its own transitive, drop the corresponding `overrides` entry — leaving stale overrides means we keep deduping a fix that was already merged upstream.
5. **`actions/dependency-review-action`** runs on every PR and **hard-fails** the build if the PR introduces a new advisory at severity `high` or above in a runtime-scope package. With `bun audit` informational, this is the only advisory check that blocks merge — deliberately scoped to what the PR itself adds, not the whole pre-existing tree.
    - **It sees `bun.lock` through a submitted snapshot.** GitHub's dependency graph does not read `bun.lock`, so `.github/workflows/dependency-snapshot.yml` runs `scripts/dependency-snapshot.ts` on every push to main and on the head commit of every same-repository PR. It posts one manifest per workspace to the Dependency Submission API, listing every package that workspace reaches with a scope: `runtime` if a workspace's `dependencies` or `optionalDependencies` reach it, `development` otherwise. An optional peer, like Next.js's Playwright, does not pull its package into `runtime`.
    - **A guard fails the review when the snapshot is missing.** The action reviews whatever graph it finds, so without the snapshot it would pass without `bun.lock`'s packages. Before the action, the job's "Require the bun.lock snapshot" step waits up to 10 minutes for the snapshot job (`Submit bun.lock`) on the PR's head commit, and fails unless that job succeeded. A fork PR gets no snapshot, because its token cannot write, so the guard fails a fork PR that changes `bun.lock` (make that change from a branch in this repository) and passes one that does not, because it adds no locked package. After the guard, the action still waits up to 300 seconds (`retry-on-snapshot-warnings`) while GitHub processes the snapshot. If you rename the snapshot job, change the guard's `SNAPSHOT_CHECK` with it.
    - **It fails on runtime scope only.** `fail-on-scopes` is left at the action's default, `runtime` (`action.yml` declares no default; the action's schema and README give `runtime`). An advisory in a `development`-scope package does not block merge. That includes bench's development tools (Vitest, testcontainers, jsdom and what they pull in), whose advisories blocked bench PRs under pnpm. `bun audit` is where those advisories show: it reports both apps' whole trees on every run, and the "Audit advisories" list below records the accepted ones. Runtime means reachable from `dependencies`, which includes build-time tools the site lists there (velite, tailwindcss, `@tailwindcss/typography`).
6. **`trufflesecurity/trufflehog`** secret scan runs on every PR and push to main. Defense-in-depth on top of GitHub's push protection; catches verified secrets that slipped past push protection (low-entropy formats, detector patterns added after the secret was committed, or push-protection bypass).
7. **OpenSSF Scorecard** (`.github/workflows/scorecard.yml`) grades the repo weekly on supply-chain hygiene (pinned actions, branch protection, token permissions, dangerous workflow patterns). SARIF posts to the Security tab; aggregate score publishes to https://scorecard.dev.
8. **All third-party GitHub Actions are SHA-pinned**, not tag-pinned. A tag can be moved to point at a malicious commit (and has been, in prior supply-chain incidents); a SHA can't. Renovate's `helpers:pinGitHubActionDigests` preset enforces this on auto-bump PRs. When bumping an action manually, update both the SHA and the trailing `# vX.Y.Z` comment in the same diff.
9. **`runs-on: ubuntu-24.04`** (not `ubuntu-latest`) so runner-image bumps are deliberate PRs, not silent infrastructure drift. The Node version inside the runner image can still drift; `.nvmrc` pins that separately.

### Node version

Three places must agree, and **Vercel sets the ceiling**: it offers only Node 20.x / 22.x / 24.x, so 24 is the newest deployable major. All three are aligned on it:

- `.nvmrc` → `24`, which both CI workflows read via `actions/setup-node`'s `node-version-file`.
- `package.json` → `engines.node = ">=24"`. Vercel resolves this range against the versions it actually offers and it **overrides the dashboard setting**, so a range no available version satisfies (e.g. `">=26"`) fails the deploy outright rather than falling back.
- `@types/node` → `^24`, matching the runtime so `tsc` cannot green-light an API that production does not have.

Keep them in lockstep when bumping. Raising `.nvmrc` alone makes CI validate against a runtime newer than production — APIs added after 24 would pass CI and fail in prod. Node 26 is not deployable until Vercel adds 26.x (it reaches LTS in October 2026); check https://vercel.com/docs/functions/runtimes/node-js/node-js-versions before moving.
10. **Renovate auto-merge** is patch + minor only via `:automergeStableNonMajor`. Major bumps stay open for human review. The 7-day cooldown is the first gate; CI (lint, build, typecheck, `dependency-review`, `secret-scan`, `bun run verify`, Playwright, Lighthouse) is the second — note `bun audit` is informational and does not hold an auto-merge.

### bench/ (Bun workspace member)

`bench/web` is a member of the root Bun workspace, so the layers above cover it: the cooldown in `bunfig.toml`, `trustedDependencies` and `overrides` in the root `package.json`, `bun audit`, and the `bun.lock (bench/web)` manifest of the dependency snapshot. What is particular to bench:

- **Install at the root.** `bun install --frozen-lockfile` at the root installs both apps, and `bun run --cwd bench/web <script>` runs bench's scripts; CI and `bench-deploy.yml` do the same, and `bench/web/vercel.json` gives `vercel build` the same install command. A `bun install` in `bench/web` also finds the root's `bunfig.toml`.
- **Linker.** `bunfig.toml` sets `linker = "isolated"`, so every package gets the dependencies it resolved, as pnpm gave bench. That layout keeps one app's tools from loading the other's copy of a package; both apps now resolve the same TypeScript, so that no longer matters for it.
- **Lifecycle scripts.** pnpm's `allowBuilds` let `sharp` build (and `unrs-resolver`, which left with ESLint). `trustedDependencies` already trusts `sharp`, and stays `["esbuild", "sharp"]`. Bun blocks three bench scripts, `protobufjs`, `ssh2` and `cpu-features`, which pnpm blocked too. With the isolated linker, `bun pm untrusted` lists only packages linked at the top of `node_modules`, so it reports none of them; to audit, install once with `bun install --linker hoisted` in a scratch copy and run it there.
- **Deploy CLI:** `bench-deploy.yml` installs an exact Vercel CLI version (`VERCEL_CLI_VERSION`, which Renovate bumps via the `# renovate:` comment), never `vercel@latest`, with `npm install --before` set to 7 days ago, so the whole tree gets the cooldown. That job holds `VERCEL_TOKEN`. It deliberately has no lockfile; see "bench advisories".
- **Renovate** keeps bench's updates in their own `bench-` branches (it matches `bench/web/package.json`; the lockfile they change is the shared `bun.lock`, which lock file maintenance refreshes for both apps at once). They automerge like the site's (patch and minor), because `Bench: format, lint, build, test` is a required check. The exception is the Vercel CLI (`VERCEL_CLI_VERSION`): no required check runs a deploy, so its bumps wait for review.
- **Node:** `bench-ci.yml` and `bench-deploy.yml` read `.nvmrc`. Keep `@types/node` in `bench/web/package.json` and the `benchmarks-website` Vercel project's Node version on the same major.
- **Audit:** `bun audit` at the root covers bench; see "bench advisories" below.

### Audit advisories

`bun audit` is the source of truth for dependency advisories, for both apps. State as of 2026-10-29 — 10 advisories: 8 in the site's tree, listed here, and 2 in bench's, listed under "bench advisories". None is in code that ships to a browser or runs in a deployed server. The dependency snapshot (layer 5) scopes them by reach, not by when the code runs: the site's eight, all via `@lhci/cli`, are `development`. Dependency review blocks only an advisory that a PR introduces, so these accepted ones do not hold a merge.

**Resolved by an `overrides` entry:**

- **sharp `<0.35.5`** (GHSA-wq5f-xc86-pv6w, high — librsvg CVE-2026-96889; also GHSA-rgj7-g3m4-5g8c `<0.35.4` and GHSA-f88m-g3jw-g9cj `<0.35.0`). `next@16.4.1` asks for `sharp@^0.35.5`, but `velite@0.4.0` declares `sharp@^0.34.5`, a range that cannot reach 0.35.x, so the tree would carry a vulnerable second copy. `overrides.sharp = "^0.35.5"` pulls velite onto the patched line and dedupes to one copy. Crossing 0.34 → 0.35 is a breaking bump on sharp's 0.x line; verified safe because velite's image pipeline runs during `bun run build` and the build passes. Drop the override once velite ships a release declaring `sharp@^0.35.5` or later — 0.4.0 is still the latest.

- **zod `<4.6.6`** (GHSA-mrhx-c7xc-m3w5, high memory exhaustion on oversized constrained collections). Two paths: bench's `@vercel/functions > @vercel/oidc > @vercel/cli-config` pins `zod@4.1.11` exactly, and the site's `@lhci/cli > lighthouse > puppeteer-core > chromium-bidi` declares `zod@^3.24.1`, a line with no fix. `overrides.zod = "^4.6.7"` puts both on 4.6.7. bench only imports `attachDatabasePool`, which does not load the OIDC code that uses zod. For chromium-bidi the override crosses zod 3 → 4 under a library we do not control, on purpose, and the Lighthouse CI job must keep passing. chromium-bidi still parses valid WebDriver BiDi messages under zod 4, but its error path reads zod 3's `errors` field, so an invalid message throws a TypeError instead of a protocol error. puppeteer-core loads chromium-bidi only for the BiDi protocol; lhci drives Chrome over CDP. If it breaks, drop the override, accept bench's zod 4.1.11 (it parses only local Vercel CLI config files), and record it under "Accepted" here. The snapshot scopes bench's zod `runtime`, because `@vercel/functions` is in bench's `dependencies`, so dependency review would block the PR that drops the override: add `allow-ghsas: GHSA-mrhx-c7xc-m3w5` to the Dependency Review step in `ci.yml` in the same PR. Drop the override once `@vercel/cli-config` and chromium-bidi both accept zod 4.6.6 or later.

- **postcss-selector-parser `<6.1.5`** (GHSA-rj75-hqrm-r3gf, moderate quadratic-time parsing). `@tailwindcss/typography@0.5.20`, the latest release, pins `postcss-selector-parser@6.0.10` exactly, so lockfile maintenance cannot reach the fix. `overrides["postcss-selector-parser"] = "^6.1.5"` stays on the same major. The built CSS does not change: with the font URLs normalized, the site's stylesheet is byte-identical with and without the override. Drop the override once `@tailwindcss/typography` ships a release that declares `postcss-selector-parser@^6.1.5` or later.

**Accepted — fix exists but is inside the 7-day cooldown.** These clear on their own: Renovate's `lockFileMaintenance` (or a manual `bun update`) picks up the patched version once it is 7 days old, because each parent's range already admits it.

- **body-parser `<1.20.9`** (GHSA-27r3-jxmh-p828, high DoS via trailing bytes after a compressed body) and **qs `<=6.16.0`** (GHSA-6pq8-jhm2-2vcw, moderate DoS in `stringify` with `arrayFormat: 'comma'`). Path: `@lhci/cli > express > body-parser > qs`. Express backs `lhci server`, which we never run (`lighthouserc.cjs` uploads to temporary public storage), so no request ever reaches body-parser. 1.20.9 clears the window on 2026-10-30; qs 6.16.2 on 2026-11-04. Drop these entries once `bun audit` stops reporting them.

**Accepted — upstream-blocked, every path is via `@lhci/cli@0.15.1`, which is dev-only and runs in CI against its own controlled inputs:**

- **extract-zip `<=2.0.1`** (GHSA-jmr9-qjv8-65gv, high unvalidated symlink path traversal; GHSA-7pqw-9j4j-h8q3, high arbitrary file write via symlink entries). Path: `@lhci/cli > lighthouse > puppeteer-core > @puppeteer/browsers > extract-zip`. No patched version exists — 2.0.1 is the latest publish, so there is nothing to override to. The archives extracted are Chrome builds fetched by puppeteer from Google's own CDN, not attacker-supplied. Drop this entry when `extract-zip` ships a fix or `lighthouse` moves off it.
- **basic-ftp `<=6.2.0`** (GHSA-c475-qrg2-pj4r, high quadratic-time directory-listing parser). Path: `@lhci/cli > proxy-agent > pac-proxy-agent > get-uri > basic-ftp@5.3.1`. Only the 6.x line is patched and get-uri declares `basic-ftp@^5.0.2`, so the fix needs a 5 → 6 major. basic-ftp runs only for `ftp://` proxy or PAC URLs, and CI configures none. Drop this entry when get-uri moves to basic-ftp 6.
- **tmp `<0.2.6`** (GHSA-ph9p-34f9-6g65, high path traversal via unsanitized prefix/postfix) and **tmp `<=0.2.3`** (GHSA-52f5-9888-hmc6, low symlink write via the `dir` param). `@lhci/cli` pulls `tmp@0.1.0` and `tmp@0.0.33`. Overriding to `^0.2.6` crosses tmp's 0.1 → 0.2 API break (the sync/callback surface changed) inside a tool we cannot test beyond running it, so the override is not worth the risk for a CI-only dev dep. Neither traversal scenario applies: nothing passes user input to `tmp`'s prefix, postfix, or `dir`. Drop this entry when `@lhci/cli` ships a release with patched transitives.
- **uuid `<11.1.1`** (GHSA-w5hq-g745-h8pq, moderate missing buffer bounds in v3/v5/v6 when `buf` is provided). Single path, `@lhci/cli > uuid@8.3.2`. The vulnerable code (v3/v5/v6 called with an explicit `buf`) is not reached. Drop this entry when `@lhci/cli` bumps uuid.

**Held back on purpose:** `@types/node` stays on `^24` to match the deployable runtime (see "Node version"); `renovate.json` caps it with `allowedVersions: "<25"` so Renovate stops opening 25.x / 26.x PRs.

The `audit` job in `.github/workflows/ci.yml` runs a bare `bun audit` and never fails CI; the advisories above show in its job summary until their removal triggers land. Merge blocking on advisories is `dependency-review`'s job.

#### bench advisories

`bun audit` at the root reports bench's advisories with the site's. Dependency review sees bench's packages through the snapshot's `bun.lock (bench/web)` manifest, scoped like the site's (layer 5), so an advisory in one of bench's development tools no longer blocks a PR. State as of 2026-10-28: `bun audit` reports two for bench, both moderate. bench's move to Next.js 16.4.1 (postcss 8.5.23) and vitest 5.0.4 cleared the other six.

- **Accepted, dev-only — protobufjs 7.6.2** (GHSA-f38q-mgvj-vph7, fixed in 7.6.3, and GHSA-j3f2-48v5-ccww, fixed in 7.6.5; both moderate; via testcontainers > dockerode > @grpc/proto-loader). The move to Bun kept pnpm's version. It runs only in bench's tests. Drop this entry when a lockfile refresh reaches protobufjs 7.6.5.
- **Resolved by `overrides` in the root `package.json`:** zod (see "Audit advisories"). sharp needs no override for bench: next 16.4.1 asks for `^0.35.5` itself.
- **Resolved in the lockfile:** @grpc/grpc-js, brace-expansion, js-yaml and source-map-js, by refreshing within their parents' ranges. vite is a direct dev dependency of bench (`^8.3.4`), because it is vitest's peer: as a direct dependency its range sets the version the lockfile holds, so the vulnerable 8.0.16 cannot come back. (Under pnpm, an override alone left 8.0.16 locked.)
- **Accepted, the Vercel CLI (64.0.2) in `bench-deploy.yml`:** tar (one critical), undici, path-to-regexp, minimatch, js-yaml, smol-toml, zod and @fastify/busboy. The CLI and its framework builders pin these exactly; fixing undici alone means a 5 → 6 major inside the CLI's HTTP client. It runs only in CI, on our own build output. It is installed without a lockfile, so dependency review never sees it, and these advisories live only here. Re-audit when Renovate bumps `VERCEL_CLI_VERSION`: install it with `npm install --package-lock-only vercel@<version>` in a scratch directory and run `npm audit`.
