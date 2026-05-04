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
- `next.config.ts` - Plausible proxy configuration

The site is optimized for performance with font optimization, analytics integration, and responsive WebGL rendering.

## Audit advisories

`bun audit` is the source of truth for dependency advisories. State as of 2026-05-04:

- **postcss `<8.5.10`** (GHSA-qx2v-qp2m-jg93, moderate XSS in CSS stringify). Multiple transitive resolutions — `next@16.2.4` pins `postcss@8.4.31` exactly, and `@tailwindcss/postcss@4.2.3` brings in `postcss@^8.5.6`. Resolved via `overrides.postcss = "8.5.10"` in `package.json`, which dedupes all transitives to the patched version. Drop the override after `next` and `@tailwindcss/postcss` ship releases that pull their transitives to ≥ 8.5.10.
- **mdast-util-to-hast `<13.2.1`** (GHSA-4fh9-h7wg-q85m, moderate XSS via unsanitized class attribute). Pulled in by three independent paths (shiki/rehype-pretty-code, react-markdown, velite/@mdx-js/mdx) — all parents accept `^13.0.0`, so the lockfile resolved to 13.2.0 (pre-fix). Resolved via `overrides.mdast-util-to-hast = "^13.2.1"`. Drop the override after parents ship releases that pull a patched version directly; verify with `bun pm ls --all | grep mdast-util-to-hast` showing only ≥ 13.2.1.
- **uuid `<14.0.0`** (GHSA-w5hq-g745-h8pq, moderate missing buffer bounds in v3/v5/v6 when `buf` provided). **Upstream-blocked.** Comes exclusively from `resend@6.12.2 → svix@1.90.0 → uuid@^10.0.0`. svix's declared range `^10.0.0` doesn't admit a 14.x override without risking the parent's CJS imports. Exposure is theoretical: `/api/subscribe` invokes Resend's send-email endpoint, which doesn't exercise svix's webhook-signing path, and the vulnerable code (v3/v5/v6 with explicit `buf`) isn't called. Remove the `--ignore` when `svix` (or `resend`) ships a release that bumps uuid to `^14.0.0`.

CI hard-gates on `bun audit` (`.github/workflows/ci.yml`) with `--ignore=GHSA-w5hq-g745-h8pq` for the upstream-blocked uuid advisory. Any new advisory fails the job. The `dependency-review-action` PR job is a separate gate (license/severity-focused) that remains `continue-on-error: true` while a baseline of acceptable findings is established.
