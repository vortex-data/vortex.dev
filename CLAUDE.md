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
4. **`bun audit`** is the CI hard gate on every PR and push to main. When a new advisory surfaces, the resolution is one of three:
    - **Direct dep bump** — if the advisory is in a top-level dep with a patched release, bump in `package.json`.
    - **`overrides` entry** — if the advisory is in a transitive dep whose parent hasn't released a fix, force-pin the patched version in `package.json`'s `overrides` block. This is the most common case. Pick the latest patched version that is ≥14 days old (matching the cooldown policy) so a fresh install can't resolve to a too-new version.
    - **Document and ignore** — if no upstream fix exists yet, append `--ignore=GHSA-...` to the `Dependency audit` step in `.github/workflows/ci.yml` and add an entry under "Audit advisories" below with: GHSA ID, vulnerable range, package, why exposure is acceptable (e.g. dev-only, not in client bundle), and a removal trigger.
    - When a parent dep eventually patches its own transitive, drop the corresponding `overrides` entry — leaving stale overrides means we keep deduping a fix that was already merged upstream.
5. **`actions/dependency-review-action`** runs on every PR — hard-fails the build if a PR introduces a new advisory at severity `high` or above. Catches what `bun audit` would catch on the merge commit, but earlier in the review loop.
6. **`trufflesecurity/trufflehog`** secret scan runs on every PR and push to main. Defense-in-depth on top of GitHub's push protection; catches verified secrets that slipped past push protection (low-entropy formats, detector patterns added after the secret was committed, or push-protection bypass).
7. **OpenSSF Scorecard** (`.github/workflows/scorecard.yml`) grades the repo weekly on supply-chain hygiene (pinned actions, branch protection, token permissions, dangerous workflow patterns). SARIF posts to the Security tab; aggregate score publishes to https://scorecard.dev.
8. **All third-party GitHub Actions are SHA-pinned**, not tag-pinned. A tag can be moved to point at a malicious commit (and has been, in prior supply-chain incidents); a SHA can't. Renovate's `helpers:pinGitHubActionDigests` preset enforces this on auto-bump PRs. When bumping an action manually, update both the SHA and the trailing `# vX.Y.Z` comment in the same diff.
9. **`runs-on: ubuntu-24.04`** (not `ubuntu-latest`) so runner-image bumps are deliberate PRs, not silent infrastructure drift. The Node version inside the runner image can still drift; `.nvmrc` pins that separately.
10. **Renovate auto-merge** is patch + minor only via `:automergeStableNonMajor`. Major bumps stay open for human review. The 14-day cooldown is the first gate; CI (lint, build, typecheck, `bun audit`, `dependency-review`, `secret-scan`, `bun run verify`, Playwright, Lighthouse) is the second.

### Audit advisories

`bun audit` is the source of truth for dependency advisories. State as of 2026-05-04:

- **postcss `<8.5.10`** (GHSA-qx2v-qp2m-jg93, moderate XSS in CSS stringify). Multiple transitive resolutions — `next@16.2.4` pins `postcss@8.4.31` exactly, and `@tailwindcss/postcss@4.2.3` brings in `postcss@^8.5.6`. Resolved via `overrides.postcss = "8.5.10"` in `package.json`, which dedupes all transitives to the patched version. Drop the override after `next` and `@tailwindcss/postcss` ship releases that pull their transitives to ≥ 8.5.10.
- **mdast-util-to-hast `<13.2.1`** (GHSA-4fh9-h7wg-q85m, moderate XSS via unsanitized class attribute). Pulled in by two independent paths (shiki/rehype-pretty-code, velite/@mdx-js/mdx) — both parents accept `^13.0.0`, so the lockfile resolved to 13.2.0 (pre-fix). Resolved via `overrides.mdast-util-to-hast = "^13.2.1"`. Drop the override after parents ship releases that pull a patched version directly; verify with `bun pm ls --all | grep mdast-util-to-hast` showing only ≥ 13.2.1.
- **uuid `<14.0.0`** (GHSA-w5hq-g745-h8pq, moderate missing buffer bounds in v3/v5/v6 when `buf` provided). **Upstream-blocked.** Two parent paths: `resend@6.12.2 → svix@1.90.0 → uuid@^10.0.0` and `@lhci/cli@0.15.1 → uuid@8.3.2`. Neither parent admits a 14.x override without risking CJS imports. Exposure is theoretical on both: `/api/subscribe` uses Resend's send-email endpoint (not svix's webhook-signing path), `@lhci/cli` is dev-only and runs in CI on its own controlled inputs, and the vulnerable code (v3/v5/v6 with explicit `buf`) isn't called by either. Remove the `--ignore` when both parents ship releases bumping uuid to `^14.0.0`.
- **tmp `<=0.2.3`** (GHSA-52f5-9888-hmc6, low symbolic-link path traversal in `dir` param). **Upstream-blocked.** Pulled exclusively by `@lhci/cli@0.15.1` (dev-only, runs in CI on controlled inputs). The symlink-traversal scenario doesn't apply. Remove the `--ignore` when `@lhci/cli` ships a release with patched transitives.

CI hard-gates on `bun audit` (`.github/workflows/ci.yml`) with `--ignore=GHSA-w5hq-g745-h8pq` and `--ignore=GHSA-52f5-9888-hmc6` for the upstream-blocked advisories. Any new advisory fails the job.
