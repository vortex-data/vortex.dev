# vortex.dev

Source for [vortex.dev](https://vortex.dev), the marketing site for [Vortex](https://github.com/vortex-data/vortex) — an extensible, state-of-the-art columnar file format. Vortex is a [Linux Foundation](https://www.linuxfoundation.org/) incubating project, a Series of LF Projects, LLC.

## Local development

Prerequisites: [Bun](https://bun.sh) ≥ 1.3.13 and Node ≥ 22. Bun is the package manager and script runner; Next.js itself runs on Node.

```bash
git clone git@github.com:vortex-data/vortex.dev.git
cd vortex.dev
bun install
bun dev          # Turbopack dev server on http://localhost:3000
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Next.js dev server with Turbopack |
| `bun run build` | Production build. Also runs velite to populate `.velite/` and emits `next-env.d.ts` |
| `bun run start` | Production server (run after `build`) |
| `bun run check` | Biome lint + format + import-organize, with auto-fix |
| `bun run check:ci` | Biome no-write check — what CI runs |
| `bun run typecheck` | `tsc --noEmit`. Must run after `bun run build` because velite populates `.velite/` and Next emits `next-env.d.ts` during build |
| `bun run verify` | HTTP suite against a running server: sitemap, robots, RSS, OG, canonicals, JSON-LD, theme parity, `/api/subscribe`, internal links |
| `bun run test:e2e` | Playwright browser smoke (Chromium desktop + WebKit iPhone-13). One-time setup: `bun run test:e2e:install` |
| `bun run lighthouse` | Local Lighthouse CI run against `bun run start` |

CI runs `check:ci → build → typecheck → start → verify → audit → playwright` on every PR via [.github/workflows/ci.yml](.github/workflows/ci.yml), plus an independent Lighthouse audit via [.github/workflows/lighthouse.yml](.github/workflows/lighthouse.yml) that posts a sticky score table.

## Contributing

The Developer Certificate of Origin is enforced on every commit. Sign off with:

```bash
git commit -s
```

CI rejects PRs whose commits don't have a `Signed-off-by:` trailer (DCO probot check).

For architectural context — content pipeline, design tokens, audit advisories, deployment quirks — see [CLAUDE.md](CLAUDE.md).

For the Vortex file format itself and its tooling, see [github.com/vortex-data/vortex](https://github.com/vortex-data/vortex).
