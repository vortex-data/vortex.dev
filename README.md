# vortex.dev

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/vortex-data/vortex.dev/badge)](https://scorecard.dev/viewer/?uri=github.com/vortex-data/vortex.dev)

Source for [vortex.dev](https://vortex.dev), the marketing site for [Vortex](https://github.com/vortex-data/vortex) — an extensible, state-of-the-art columnar file format. Vortex is a [Linux Foundation](https://www.linuxfoundation.org/) incubating project, a Series of LF Projects, LLC.

The same Next.js app also serves [bench.vortex.dev](https://bench.vortex.dev), the benchmark results site. Its code is in `src/bench/` and `src/app/(bench)/`, and its docs start at [docs/bench/README.md](docs/bench/README.md).

## Local development

Prerequisites: [Bun](https://bun.sh) 1.4 (the `packageManager` in `package.json`) and Node 26 (`.nvmrc`). Bun is the package manager and script runner; Next.js itself runs on Node.

```bash
git clone git@github.com:vortex-data/vortex.dev.git
cd vortex.dev
bun install
bun dev          # Turbopack dev server on http://localhost:3000
```

bench is at http://localhost:3000/bench. It needs the `BENCH_DB_*` variables for a database ([docs/bench/web.md](docs/bench/web.md)).

## Scripts

| Command | What it does |
| --- | --- |
| `bun dev` | Next.js dev server with Turbopack |
| `bun run build` | Production build. Also runs velite to populate `.velite/` and emits `next-env.d.ts` |
| `bun run start` | Production server (run after `build`) |
| `bun run check` | Biome lint + format + import-organize, with auto-fix |
| `bun run check:ci` | Biome no-write check — what CI runs |
| `bun run typecheck` | `tsc --noEmit`. Must run after `bun run build` because velite populates `.velite/` and Next emits `next-env.d.ts` during build |
| `bun run knip` | Unused files, exports and dependencies. Like `typecheck`, it needs `bun run build` first, for `.velite/` |
| `bun run test` | The marketing site's unit tests (`bun test tests/unit`) |
| `bun run test:bench` | bench's tests on Vitest. Its Postgres integration suite needs Docker or `BENCH_TEST_DATABASE_URL`, and skips without either |
| `bun run verify` | HTTP suite against a running server: sitemap, robots, RSS, OG, canonicals, JSON-LD, theme parity, `/api/subscribe`, internal links |
| `bun run test:e2e` | Playwright browser smoke (Chromium desktop + WebKit iPhone-13). One-time setup: `bun run test:e2e:install` |
| `bun run lighthouse` | Local Lighthouse CI run against a server you started, at `BASE_URL` (default `http://localhost:3000`; bench's pages need its `BENCH_DB_*` variables). Fetches a pinned `@lhci/cli` with `bunx`; it is not a dependency |

CI runs `check:ci → build → typecheck → knip → unit and bench tests → start → verify → playwright` for both sites on every PR via [.github/workflows/ci.yml](.github/workflows/ci.yml), with a non-blocking `bun audit`. [.github/workflows/lighthouse.yml](.github/workflows/lighthouse.yml) runs Lighthouse and axe on both sites on the PR's Vercel preview and posts a sticky score table.

## Contributing

The Developer Certificate of Origin is enforced on every commit. Sign off with:

```bash
git commit -s
```

CI rejects PRs whose commits don't have a `Signed-off-by:` trailer (DCO probot check).

For architectural context — content pipeline, design tokens, audit advisories, deployment quirks — see [CLAUDE.md](CLAUDE.md).

For the Vortex file format itself and its tooling, see [github.com/vortex-data/vortex](https://github.com/vortex-data/vortex).

## License

As the [Vortex Technical Charter](src/assets/charter.pdf) requires, code is licensed under [Apache-2.0](LICENSE), and blog posts and documentation are licensed under [CC-BY-4.0](LICENSES/CC-BY-4.0.txt). The Vortex logo files are also CC-BY-4.0, but the Vortex name and logo are trademarks of LF Projects, LLC. [REUSE.toml](REUSE.toml) records the license of every file, and CI checks it.
