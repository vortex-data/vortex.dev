# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `bun dev` - Start development server with Turbopack
- `bun build` - Build production application
- `bun lint` - Run ESLint
- `bun start` - Start production server

## Architecture Overview

This is a Next.js 15 marketing website for Vortex, a columnar file format. The site features:

### Core Technologies

- **Next.js 15** with App Router and Turbopack for development
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
- **Blog posts** (`src/content/**.mdx`) and Markdown are CC-BY-4.0 automatically.
- **Images and other assets** are deliberately not covered. Add an annotation for each new one: CC-BY-4.0 if the Vortex contributors made it, or `LicenseRef-Third-Party` with the owner as `SPDX-FileCopyrightText` if someone else owns it (another organization's logo, for example). Never relicense a file the project doesn't own.
- Run `reuse lint` locally after adding files (`pipx install 'reuse[charset-normalizer]'`).

## Supply chain hardening

Defense in depth against the npm-worm class (Shai-Hulud, mini-Shai-Hulud, the May 2026 TanStack incident, etc.). Layers, in order of which one trips first when a bad package surfaces:

1. **`bunfig.toml` → `install.minimumReleaseAge = 1209600`** (14 days). Bun refuses to resolve to a package version younger than 14 days. Applies to every `bun install` / `bun add` / `bun update` (local dev, lockfile regens, and Vercel builds), so we can't accidentally pull a freshly published version that hasn't had time to be observed. If a fresh dep is genuinely needed before the window elapses, allowlist it via `install.minimumReleaseAgeExcludes`.
2. **`renovate.json` → `minimumReleaseAge: "14 days"`** — symmetric with #1, applied at PR-proposal time. Renovate won't open a PR for a version younger than the window, and `bunfig.toml` won't let Bun resolve to one either. Both gates are required: a local `bun add` bypasses Renovate; a Renovate `lockFileMaintenance` cycle would otherwise pull fresh transitives.
3. **`trustedDependencies` in `package.json`** — explicit allowlist for which packages may run lifecycle scripts (`preinstall` / `install` / `postinstall`). Bun's default behavior is name-only trust against a built-in ~366-package allowlist, which lets a transitive named like a popular package hijack scripts (the PackageGate class of attack). Current set: `["esbuild", "sharp"]` — esbuild's `postinstall` builds its native bin (pulled in transitively via velite); sharp's `install` builds libvips for next/image. When adding a top-level dep that ships native bins or needs a build step, audit its lifecycle scripts via `bun pm untrusted`, then extend this list with one-line justification in the commit message.
4. **`bun audit`** runs as its own **non-blocking** CI job (`audit`) on every PR and push to main. It reports the advisory state — the step goes red and the full output posts to the job summary — but the job stays green, so an upstream publish can't block unrelated PRs. Read the summary on every run and act on what it shows; the resolution is one of three:
    - **Direct dep bump** — if the advisory is in a top-level dep with a patched release, bump in `package.json`.
    - **`overrides` entry** — if the advisory is in a transitive dep whose parent hasn't released a fix, force-pin the patched version in `package.json`'s `overrides` block. This is the most common case. Pick the latest patched version that is ≥14 days old (matching the cooldown policy) so a fresh install can't resolve to a too-new version.
    - **Document and accept** — if no upstream fix exists yet, add an entry under "Audit advisories" below with: GHSA ID, vulnerable range, package, why exposure is acceptable (e.g. dev-only, not in client bundle), and a removal trigger. The job carries no `--ignore` flags: with nothing to keep green, suppressing an advisory only hides it, so this file is where an accepted advisory is recorded.
    - When a parent dep eventually patches its own transitive, drop the corresponding `overrides` entry — leaving stale overrides means we keep deduping a fix that was already merged upstream.
5. **`actions/dependency-review-action`** runs on every PR and **hard-fails** the build if the PR introduces a new advisory at severity `high` or above. With `bun audit` informational, this is the only advisory check that blocks merge — deliberately scoped to what the PR itself adds, not the whole pre-existing tree.
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
10. **Renovate auto-merge** is patch + minor only via `:automergeStableNonMajor`. Major bumps stay open for human review. The 14-day cooldown is the first gate; CI (lint, build, typecheck, `dependency-review`, `secret-scan`, `bun run verify`, Playwright, Lighthouse) is the second — note `bun audit` is informational and does not hold an auto-merge.

### Audit advisories

`bun audit` is the source of truth for dependency advisories. State as of 2026-10-28 — 10 advisories, none in the client bundle or server runtime. Nine are dev-only via `@lhci/cli`; one is build-only.

**Resolved by an `overrides` entry:**

- **sharp `<0.35.5`** (GHSA-wq5f-xc86-pv6w, high — librsvg CVE-2026-96889; also GHSA-rgj7-g3m4-5g8c `<0.35.4` and GHSA-f88m-g3jw-g9cj `<0.35.0`). `next@16.4.1` asks for `sharp@^0.35.5`, but `velite@0.4.0` declares `sharp@^0.34.5`, a range that cannot reach 0.35.x, so the tree would carry a vulnerable second copy. `overrides.sharp = "^0.35.5"` pulls velite onto the patched line and dedupes to one copy. Crossing 0.34 → 0.35 is a breaking bump on sharp's 0.x line; verified safe because velite's image pipeline runs during `bun run build` and the build passes. Drop the override once velite ships a release declaring `sharp@^0.35.5` or later — 0.4.0 is still the latest.

**Accepted — fix exists but is inside the 14-day cooldown.** These clear on their own: Renovate's `lockFileMaintenance` (or a manual `bun update`) picks up the patched version once it is 14 days old, because each parent's range already admits it.

- **body-parser `<1.20.9`** (GHSA-27r3-jxmh-p828, high DoS via trailing bytes after a compressed body) and **qs `<=6.16.0`** (GHSA-6pq8-jhm2-2vcw, moderate DoS in `stringify` with `arrayFormat: 'comma'`). Path: `@lhci/cli > express > body-parser > qs`. Express backs `lhci server`, which we never run (`lighthouserc.cjs` uploads to temporary public storage), so no request ever reaches body-parser. 1.20.9 clears the window on 2026-11-06; qs 6.16.2 on 2026-11-11. Drop these entries once `bun audit` stops reporting them.
- **postcss-selector-parser `<6.1.5`** (GHSA-rj75-hqrm-r3gf, moderate quadratic-time parsing). Path: `@tailwindcss/typography > postcss-selector-parser@6.0.10` (an exact pin, so lockfile maintenance cannot fix it). Build-time only: it parses the selectors in our own stylesheets, never user input. Once 6.1.5 is 14 days old (2026-11-03), add `overrides["postcss-selector-parser"] = "^6.1.5"` (same major) unless `@tailwindcss/typography` has shipped a release that bumps it.

**Accepted — upstream-blocked, every path is via `@lhci/cli@0.15.1`, which is dev-only and runs in CI against its own controlled inputs:**

- **extract-zip `<=2.0.1`** (GHSA-jmr9-qjv8-65gv, high unvalidated symlink path traversal; GHSA-7pqw-9j4j-h8q3, high arbitrary file write via symlink entries). Path: `@lhci/cli > lighthouse > puppeteer-core > @puppeteer/browsers > extract-zip`. No patched version exists — 2.0.1 is the latest publish, so there is nothing to override to. The archives extracted are Chrome builds fetched by puppeteer from Google's own CDN, not attacker-supplied. Drop this entry when `extract-zip` ships a fix or `lighthouse` moves off it.
- **zod `<4.6.6`** (GHSA-mrhx-c7xc-m3w5, high memory exhaustion on oversized constrained collections). Path: `@lhci/cli > lighthouse > puppeteer-core > chromium-bidi > zod@3.25.76`. No 3.x fix exists, and chromium-bidi declares `zod@^3.24.1`, so an override would force a 3 → 4 major under a library we do not control. zod only validates protocol messages from the local Chrome that lhci launches. Drop this entry when chromium-bidi moves to zod 4 or a 3.x fix ships.
- **basic-ftp `<=6.2.0`** (GHSA-c475-qrg2-pj4r, high quadratic-time directory-listing parser). Path: `@lhci/cli > proxy-agent > pac-proxy-agent > get-uri > basic-ftp@5.3.1`. Only the 6.x line is patched and get-uri declares `basic-ftp@^5.0.2`, so the fix needs a 5 → 6 major. basic-ftp runs only for `ftp://` proxy or PAC URLs, and CI configures none. Drop this entry when get-uri moves to basic-ftp 6.
- **tmp `<0.2.6`** (GHSA-ph9p-34f9-6g65, high path traversal via unsanitized prefix/postfix) and **tmp `<=0.2.3`** (GHSA-52f5-9888-hmc6, low symlink write via the `dir` param). `@lhci/cli` pulls `tmp@0.1.0` and `tmp@0.0.33`. Overriding to `^0.2.6` crosses tmp's 0.1 → 0.2 API break (the sync/callback surface changed) inside a tool we cannot test beyond running it, so the override is not worth the risk for a CI-only dev dep. Neither traversal scenario applies: nothing passes user input to `tmp`'s prefix, postfix, or `dir`. Drop this entry when `@lhci/cli` ships a release with patched transitives.
- **uuid `<11.1.1`** (GHSA-w5hq-g745-h8pq, moderate missing buffer bounds in v3/v5/v6 when `buf` is provided). Single path, `@lhci/cli > uuid@8.3.2`. The vulnerable code (v3/v5/v6 called with an explicit `buf`) is not reached. Drop this entry when `@lhci/cli` bumps uuid.

**Cooldown exemptions.** `bunfig.toml` → `install.minimumReleaseAgeExcludes` lists `next`, its `@next/*` platform packages, `react` and `react-dom`. Next 16.4.1 fixes two critical RCEs (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr) and a high DoS (GHSA-p3m5-59mp-jv5r), but was 13 days old when adopted. React 19.3.1 hardens the Server Components transport. An exemption covers every future version of the package, not only the one adopted, so remove the whole list after 2026-10-29, when both versions are past the window.

**Held back on purpose:** `@types/node` stays on `^24` to match the deployable runtime (see "Node version"); `renovate.json` caps it with `allowedVersions: "<25"` so Renovate stops opening 25.x / 26.x PRs.

The `audit` job in `.github/workflows/ci.yml` runs a bare `bun audit` and never fails CI; the advisories above show in its job summary until their removal triggers land. Merge blocking on advisories is `dependency-review`'s job.
