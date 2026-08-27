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

`bun audit` is the source of truth for dependency advisories. State as of 2026-08-27 — 4 advisories, all dev-only:

**Resolved by an `overrides` entry:**

- **sharp `<0.35.0`** (GHSA-f88m-g3jw-g9cj, high — inherited libvips CVE-2026-33327 / -33328 / -35590 / -35591). `next@16.3.0` already asks for `sharp@^0.35.3`, but `velite@0.4.0` declares `sharp@^0.34.5`, a range that cannot reach 0.35.x — so the tree carried a vulnerable second copy at 0.34.5. Resolved via `overrides.sharp = "^0.35.3"`, which pulls velite onto the patched line and dedupes to a single copy. Crossing 0.34 → 0.35 is a breaking bump on sharp's 0.x line; verified safe here because velite's image pipeline runs during `bun run build` and the build passes. Drop the override once velite ships a release declaring `sharp@^0.35.0` or later — 0.4.0 did not, so this is likely to persist for a while.

**Accepted — upstream-blocked, every path is via `@lhci/cli@0.15.1`, which is dev-only and runs in CI against its own controlled inputs:**

- **extract-zip `<=2.0.1`** (GHSA-jmr9-qjv8-65gv, high unvalidated symlink path traversal). Path: `@lhci/cli > lighthouse > puppeteer-core > @puppeteer/browsers > extract-zip`. No patched version exists — 2.0.1 is the latest publish, so there is nothing to override to. The archives extracted are Chrome builds fetched by puppeteer from Google's own CDN, not attacker-supplied. Drop this entry when `extract-zip` ships a fix or `lighthouse` moves off it.
- **tmp `<0.2.6`** (GHSA-ph9p-34f9-6g65, high path traversal via unsanitized prefix/postfix) and **tmp `<=0.2.3`** (GHSA-52f5-9888-hmc6, low symlink write via the `dir` param). `@lhci/cli` pulls `tmp@0.1.0` and `tmp@0.0.33`. Overriding to `^0.2.6` crosses tmp's 0.1 → 0.2 API break (the sync/callback surface changed) inside a tool we cannot test beyond running it, so the override is not worth the risk for a CI-only dev dep. Neither traversal scenario applies: nothing passes user input to `tmp`'s prefix, postfix, or `dir`. Drop this entry when `@lhci/cli` ships a release with patched transitives.
- **uuid `<11.1.1`** (GHSA-w5hq-g745-h8pq, moderate missing buffer bounds in v3/v5/v6 when `buf` is provided). Now a single path, `@lhci/cli > uuid@8.3.2` — the former `resend > svix > uuid` path cleared when resend went to 6.19.0, so this is no longer a production concern. The vulnerable code (v3/v5/v6 called with an explicit `buf`) is not reached. Drop this entry when `@lhci/cli` bumps uuid.

**Cleared, for the record:** the `postcss` override (GHSA-qx2v-qp2m-jg93) is gone — `next@16.3.0` pins `postcss@8.5.23` exactly and `@tailwindcss/postcss@4.3.3` resolves `^8.5.16` to 8.5.26, both well past the 8.5.10 floor, so the old `8.5.13` pin had become a *downgrade* of next's own exact pin. Two postcss copies now coexist because next pins exactly; deduping them would mean forcing next off that pin, and postcss is build-time only (never in the client bundle), so the duplicate is left alone. The `mdast-util-to-hast` override (GHSA-4fh9-h7wg-q85m) is also gone — its parents still declare `^13.0.0`, but that range now resolves to 13.2.1 on its own, making the floor guard a no-op.

The `audit` job in `.github/workflows/ci.yml` runs a bare `bun audit` and never fails CI; the advisories above (including the two upstream-blocked ones) show in its job summary until their removal triggers land. Merge blocking on advisories is `dependency-review`'s job.
