<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# bench PR 1: upgrade and move onto the site's toolchain — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bench builds, tests, lints and deploys with the site's Bun, Biome and TypeScript 7 toolchain on Next.js 16, and nothing a visitor or API client sees changes.

**Architecture:** The repository root becomes a Bun workspace whose members are the site (root) and `bench/web`, with one `bun.lock`. A local parity harness serves `main` and the branch side by side against a restored production dump and diffs every route and screenshot. A submitted dependency snapshot keeps `dependency-review` able to see every package in `bun.lock`.

**Tech Stack:** Bun 1.4.3, Next.js 16.4.1, React 19.3.1, TypeScript 7, Biome 2.5, Vitest 4 (stays), Playwright 1.64, Postgres 16 in Docker, GitHub Actions.

**Spec:** `bench/docs/plans/2026-10-28-toolchain-and-cleanup.md` (read it first; this plan covers its "PR 1").

## Global Constraints

- Behavior is exactly the same: pages, API JSON, response headers, cache rules, URLs. `bench/web/vercel.json` headers and crons do not change.
- Cooldown: `bunfig.toml` `minimumReleaseAge = 1209600` applies to every install. A version still inside the window needs a `minimumReleaseAgeExcludes` entry with an advisory reason and a removal date.
- Root `package.json` `overrides`: keep `"sharp": "^0.35.5"`; add `"zod": "^4.6.7"`; add `"postcss": "^8.5.30"` only if the postcss that Next.js 16.4.1 resolves to is below a patched version for GHSA-6g55-p6wh-862q and GHSA-r28c-9q8g-f849.
- `trustedDependencies` stays `["esbuild", "sharp"]` unless `bun pm untrusted` shows a bench package that must build; justify any addition in the commit message.
- The job name `Bench: format, lint, build, test` does not change (the `main` ruleset requires it).
- Actions are SHA-pinned with a `# vX.Y.Z` comment; runners are `ubuntu-24.04`; Node comes from `.nvmrc` (24). Reuse `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6  # v2.2.0` with `bun-version: 1.4.3`.
- No GitHub, Vercel or AWS **settings** change without asking Will first. Files in the repository (workflows, `vercel.json`) are fine.
- Vitest stays the bench test runner; the Python migration runner and its uv-based tests stay as they are.
- bench's code style stays: single quotes, trailing commas everywhere, 100 columns, 2-space indent.
- Every commit: `git commit -s`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. New code files under `bench/` start with `// SPDX-License-Identifier: Apache-2.0` and `// SPDX-FileCopyrightText: Copyright the Vortex contributors`.
- Root `tsconfig.json` and `biome.json` stop excluding `bench/` only where a task says so.

## Review Focus

1. **A deployed function misses a hoisted package.** With Bun hoisting `pg` and `@vercel/functions` to the root `node_modules`, a preview whose file tracing starts at `bench/web` returns 500 on every API route. Task 3 asserts the traced files include them.
2. **Ingest stops flushing the cache.** Next.js 16 changes `revalidateTag`; the emitter's `POST /api/revalidate` must still expire cached data at once. Task 4 pins the second argument in a test.
3. **The site's deploy gets slower or breaks.** The `vortex` Vercel project runs `bun install --frozen-lockfile` at the root, which now installs bench too. Task 3 times it and checks the site still builds.
4. **Dependency review passes because it saw nothing.** If the snapshot isn't submitted before `dependency-review` reads the pull request, the check passes blind. Task 2 makes it wait, and Task 7 reads its log.
5. **A root-level change skips bench CI.** `changed-paths` treats `package.json` and `bun.lock` as site-only today; after the move they change bench too. Task 3 reclassifies them and checks sample paths.

---

### Task 1: Parity harness

**Files:**
- Create: `bench/scripts/parity/run.sh`
- Create: `bench/scripts/parity/compare-api.ts`
- Create: `bench/scripts/parity/compare-api.test.ts`
- Create: `bench/scripts/parity/screenshots.spec.ts`
- Create: `bench/scripts/parity/playwright.config.ts`
- Create: `bench/scripts/parity/README.md` (CC-BY-4.0 header)

**Interfaces:**
- Produces: `bash bench/scripts/parity/run.sh <base-ref> <dump-dir>` — exits 0 when the two builds match, non-zero with a printed diff otherwise. Base is a git ref; head is the current working tree.
- Produces: `diffJson(base: string, head: string): string | null` and `compareApi(baseUrl: string, headUrl: string): Promise<string[]>` in `compare-api.ts` (the array holds one line per mismatch).

- [ ] **Step 1: Write the failing test** in `compare-api.test.ts` (run with `bun test`):

```ts
import { expect, test } from 'bun:test';
import { diffJson } from './compare-api';

test('identical bodies match', () => {
  expect(diffJson('{"a":[1,2]}', '{"a":[1,2]}')).toBeNull();
});
test('a changed value is reported with its path', () => {
  expect(diffJson('{"a":[1,2]}', '{"a":[1,3]}')).toContain('a[1]');
});
test('key order counts, because clients see bytes', () => {
  expect(diffJson('{"a":1,"b":2}', '{"b":2,"a":1}')).not.toBeNull();
});
```

- [ ] **Step 2: Run it:** `bun test bench/scripts/parity/compare-api.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `diffJson`** (byte comparison first; on mismatch, parse both and return the first differing path) and **`compareApi`**. `compareApi` reads `/api/groups` from the base, then requests from both servers: `/api/groups`; `/api/group/{slug}?n=100` and `?n=50` for every group; `/api/chart/{slug}?n=100` for every chart; `/api/chart/{slug}?n=all` for every 25th chart. It compares status, `content-type`, `cache-control` and the body.
- [ ] **Step 4: Run the test again** — expect PASS.
- [ ] **Step 5: Write `screenshots.spec.ts` and its config.** Pages: `/` and `/chart/{slug}` for five slugs taken from `/api/groups` (the first chart of the first five groups). Projects: desktop 1440×900 and phone 390×844, Chromium only. The config reads `BASE_URL` and writes snapshots under `PARITY_OUT`. The run takes baselines from the base server with `--update-snapshots`, then compares the head server with `maxDiffPixels: 0`. How to wait for charts, and what to mask, are the implementer's call.
- [ ] **Step 6: Write `run.sh`.**
  - Start `postgres:16-alpine` (the image the integration suite uses) as container `bench-parity-pg` on port 55432.
  - Restore with `pg_restore --no-owner --no-privileges -j 4` from the dump directory, mounted read-only. Skip the restore if the container already holds the `commits` table.
  - Export the base with `git archive <base-ref> | tar -x -C "$TMPDIR/bench-parity/base"`; no worktree.
  - Build each side with its own toolchain: `pnpm install --frozen-lockfile && pnpm build` when `bench/web/pnpm-lock.yaml` exists, otherwise `bun install --frozen-lockfile` at the root and `bun run --cwd bench/web build`.
  - Serve base on 3101 and head on 3102 with `next start`, with `BENCH_DB_HOST=127.0.0.1`, `BENCH_DB_PORT=55432`, `BENCH_DB_NAME=vortex_bench`, `BENCH_DB_USER=postgres`, `BENCH_DB_PASSWORD=parity` and `BENCH_DB_SSL=disable`.
  - Run `compareApi`, then the screenshots, and stop the servers on exit (`trap`).
- [ ] **Step 7: Prove it reports no difference on equal code:** `bash bench/scripts/parity/run.sh origin/main ~/Backups/vortex-bench/vortex_bench-20261028T171815Z` from a clean checkout of `main`'s tree — expect exit 0 and `0 mismatches`.
- [ ] **Step 8: Prove it catches a difference:** temporarily change one number in a `/api/groups` response (for example, a summary explanation string in `bench/web/lib/summary.ts`), rerun, expect a non-zero exit naming that path; revert.
- [ ] **Step 9: Commit:** `Add a local parity check for bench builds`.

### Task 2: Dependency snapshot from `bun.lock`

**Files:**
- Create: `scripts/dependency-snapshot.ts`
- Create: `scripts/dependency-snapshot.test.ts`
- Create: `.github/workflows/dependency-snapshot.yml`
- Modify: `.github/workflows/ci.yml` (the `dependency-review` job)
- Modify: `CLAUDE.md` (supply-chain layer 5)

**Interfaces:**
- Produces: `parseBunLock(text: string): BunLock`, `buildSnapshot(lock: BunLock, meta: SnapshotMeta): Snapshot`, with `SnapshotMeta = { sha: string; ref: string; correlator: string; jobId: string; scanned: string }`. `Snapshot` follows GitHub's Dependency Submission API (`version: 0`, `detector`, `manifests[*].resolved[purl] = { package_url, relationship, scope, dependencies }`).

- [ ] **Step 1: Write the failing tests.** A fixture lock string with trailing commas holds:
  - root workspace `vortex`: dependency `a`, devDependency `d`;
  - workspace `bench/web`, named `benchmarks-web`: dependency `@s/x`;
  - packages: `a@1.0.0` depends on `b` and `c`; nested `a/c@2.0.0`; `d@1.0.0` depends on `b` and `c`; `b@1.0.0`; `c@1.0.0`; `@s/x@1.0.0`.

  Assertions:

```ts
const snap = buildSnapshot(parseBunLock(FIXTURE), META);
const root = snap.manifests['bun.lock (vortex)'].resolved;
expect(root['pkg:npm/a@1.0.0']).toMatchObject({ relationship: 'direct', scope: 'runtime' });
expect(root['pkg:npm/b@1.0.0'].scope).toBe('runtime');        // reachable from a
expect(root['pkg:npm/c@2.0.0'].scope).toBe('runtime');        // a resolves the nested a/c
expect(root['pkg:npm/c@1.0.0'].scope).toBe('development');    // only d reaches top-level c
expect(root['pkg:npm/a@1.0.0'].dependencies).toEqual(['pkg:npm/b@1.0.0', 'pkg:npm/c@2.0.0']);
const bench = snap.manifests['bun.lock (bench/web)'].resolved;
expect(bench['pkg:npm/%40s/x@1.0.0']).toMatchObject({ relationship: 'direct', scope: 'runtime' });
expect(snap.manifests['bun.lock (bench/web)'].file.source_location).toBe('bun.lock');
```

- [ ] **Step 2: Run:** `bun test scripts/dependency-snapshot.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
  - Parse by removing trailing commas before `}` or `]`, then `JSON.parse`.
  - Resolve dependency `N` of package key `K` by trying `K/N`, then `N` under each shorter ancestor of `K`, then `N`. A key is a chain of package names, where a scoped name is two segments.
  - Resolve a workspace's own dependency `N` by trying `<workspace name>/N`, then `N`.
  - Follow `dependencies`, `optionalDependencies` and `peerDependencies`, and skip names absent from the lock (platform-specific optional packages).
  - A package is `runtime` if a workspace's `dependencies` or `optionalDependencies` reach it, and `development` otherwise. It is `direct` if the workspace lists it.
  - The CLI (`import.meta.main`) reads `bun.lock` and `POST`s to `/repos/$GITHUB_REPOSITORY/dependency-graph/snapshots`, using `GITHUB_TOKEN`, `SNAPSHOT_SHA` and `SNAPSHOT_REF`. Anything but 201 fails.
- [ ] **Step 4: Run the tests** — expect PASS. Then run against the real lock without submitting (`DRY_RUN=1 bun scripts/dependency-snapshot.ts | head`) and check that `lighthouse`, `puppeteer-core` and `chromium-bidi` appear with scope `development`, and `next` with scope `runtime`.
- [ ] **Step 5: Write the workflow.**
  - Triggers: `push` to `main`, and `pull_request` from the same repository only. Fork PRs have no write token.
  - `permissions: contents: write`.
  - Steps: checkout (`persist-credentials: false`), setup-bun, run the tests, then submit.
  - `SNAPSHOT_SHA` and `SNAPSHOT_REF` are `github.sha` and `github.ref` on push, and `github.event.pull_request.head.sha` and `refs/heads/${{ github.head_ref }}` on pull requests.
- [ ] **Step 6: Make `dependency-review` wait for the snapshot:** add `retry-on-snapshot-warnings: true` and `retry-on-snapshot-warnings-timeout: 300` to its `with:`. Leave `fail-on-severity: high` and the default `fail-on-scopes` (runtime) as they are.
- [ ] **Step 7: Update CLAUDE.md** layer 5: dependency review now sees `bun.lock` through the submitted snapshot. It fails on runtime-scope advisories, and dev-only advisories stay in `bun audit` and the "Audit advisories" list. Rewrite the "bench advisories" sentence about pnpm lockfiles to match.
- [ ] **Step 8: Commit:** `Submit bun.lock to the dependency graph`.

### Task 3: One Bun workspace for the site and bench

**Files:**
- Modify: `package.json` (`workspaces: ["bench/web"]`, `overrides`), `bun.lock` (regenerated)
- Delete: `bench/web/pnpm-lock.yaml`, `bench/web/pnpm-workspace.yaml`
- Modify: `bench/web/package.json` (drop `packageManager`; scripts call Bun-installed binaries)
- Modify: `bench/web/next.config.js` (`outputFileTracingRoot`)
- Modify: `.github/actions/bench-checks/action.yml`, `.github/workflows/bench-ci.yml`, `.github/workflows/bench-deploy.yml`, `.github/actions/changed-paths/action.yml`, `renovate.json`
- Modify: `CLAUDE.md` ("bench/ (pnpm)" → Bun; "bench advisories"; "Repository layout" toolchain line), `bench/web/README.md`, `bench/AGENTS.md`, `bench/docs/architecture/deploy-and-infra.md`

**Interfaces:**
- Produces: `bun install --frozen-lockfile` at the root installs both apps; `bun run --cwd bench/web <script>` runs bench scripts. Later tasks use these commands.

- [ ] **Step 1: Record the baseline.** On `main`, time a clean root install: `rm -rf node_modules && time bun install --frozen-lockfile`. Note the seconds.
- [ ] **Step 2: Create the workspace.**
  - Add `"workspaces": ["bench/web"]`, and add `"zod": "^4.6.7"` to `overrides`. postcss follows the Global Constraints rule.
  - Delete both pnpm files and run `bun install`.
  - If the cooldown refuses a version that pnpm had locked, add a dated `bunfig.toml` exemption. Use the reasons from the deleted `pnpm-workspace.yaml`, and drop each one once it is past the window.
  - Check `bun pm untrusted` against `trustedDependencies`.
- [ ] **Step 3: Fix tracing.** Set `outputFileTracingRoot: path.join(__dirname, '../..')`.
- [ ] **Step 4: Check tracing.** Run `bun run --cwd bench/web build`, then assert the trace of a route that queries the database lists the hoisted packages:

```bash
grep -c 'node_modules/pg/' bench/web/.next/server/app/api/groups/route.js.nft.json   # ≥ 1
grep -c 'node_modules/@vercel/functions/' bench/web/.next/server/app/api/groups/route.js.nft.json   # ≥ 1
```

- [ ] **Step 5: Run bench's suite under the new install.** `bun run --cwd bench/web test` should report the same pass count as on `main` (401 passed at #124's merge). Also run `bun run --cwd bench/web lint` and `format:check`, which still use ESLint and Prettier until Task 5.
- [ ] **Step 6: Check the site still installs and builds.** Run `rm -rf node_modules && time bun install --frozen-lockfile` and `bun run build`. If the install is more than 15 s slower than the baseline, set `installCommand` in the root `vercel.json` to `bun install --frozen-lockfile --filter vortex`. Then repeat both commands.
- [ ] **Step 7: Switch CI and deploy to Bun.**
  - **`bench-checks`:** replace the pnpm install and `setup-node`'s pnpm cache with setup-bun, `setup-node` (`.nvmrc`, no cache) and `bun install --frozen-lockfile` at the root. Every `pnpm X` step becomes `bun run --cwd bench/web X`. Delete the `pnpm-version` input, and drop `PNPM_VERSION` from both callers.
  - **`bench-deploy.yml`:** `vercel build` must find Bun and the root lockfile. Install with setup-bun and `bun install --frozen-lockfile` before `vercel pull`. If `vercel build` still tries pnpm, set `installCommand` in `bench/web/vercel.json` (a repository file; headers and crons untouched). If neither works, stop and ask Will about the project setting.
- [ ] **Step 8: Reclassify shared root files** in `changed-paths`. Add `package.json | bun.lock | bunfig.toml | biome.json | tsconfig*.json) site=true; bench=true ;;` before the catch-all. Check it by running the classify script with each sample path set in `files`:

```
bench/web/lib/db.ts → site=false bench=true
bun.lock            → site=true  bench=true
src/app/page.tsx    → site=true  bench=false
```

- [ ] **Step 9: Update Renovate and the docs.** In `renovate.json`, the bench rule keeps `matchFileNames: ["bench/**", ".github/workflows/bench-*.yml"]`; drop any pnpm-specific option. Rewrite the bench parts of `CLAUDE.md`: the cooldown is now `bunfig.toml`, overrides live in the root `package.json`, `pnpm audit` becomes `bun audit`, and the zod override note goes in "Audit advisories". Rewrite the bench README, `AGENTS.md` and deploy doc commands from `pnpm` to `bun`.
- [ ] **Step 10: Commit:** `Make bench a member of the site's Bun workspace`. Run the parity harness first (`run.sh origin/main <dump>`); it must report 0 mismatches.

### Task 4: Next.js 16, React 19.3 and the other updates

**Files:**
- Modify: `bench/web/package.json`, `bun.lock`, `bench/web/app/api/revalidate/route.ts:29`, `bench/web/app/api/revalidate/route.test.ts`, plus whatever the upgrade guide requires
- Reference: `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`

**Interfaces:**
- Consumes: Task 3's commands.

- [ ] **Step 1: Write the failing test.** In `route.test.ts`, mock `revalidateTag` with both arguments (`(tag: string, profile: unknown) => revalidateTag(tag, profile)`) and assert `expect(revalidateTag).toHaveBeenCalledWith(BENCH_DATA_TAG, { expire: 0 })` for an authorized POST.
- [ ] **Step 2: Run:** `bun run --cwd bench/web test app/api/revalidate` — expect FAIL.
- [ ] **Step 3: Upgrade.** Set `next` to `16.4.1` and `react` and `react-dom` to `^19.3.1`, matching the site. Bump `jsdom` to `^30`, the `@types/*` packages to the site's versions (`@types/node` stays `^24`), `pg`, `chart.js`, `@vercel/functions` and `vitest` to their newest versions that the cooldown allows. Then call `revalidateTag(BENCH_DATA_TAG, { expire: 0 })`. That is the old one-argument behavior; `'max'` would serve stale data after an ingest.
- [ ] **Step 4: Work through the v16 guide** for bench's surface: Turbopack builds, async request APIs, `next lint` removal (Task 5 replaces it), scroll behavior (bench sets no smooth scrolling) and `next/image` (unused). bench has no `middleware`, so there's nothing to rename.
- [ ] **Step 5: Run the suite, lint, build and parity.** The tests report the same pass count plus the new test. The build succeeds. Parity reports 0 mismatches.
- [ ] **Step 6: Commit:** `Upgrade bench to Next.js 16 and React 19.3`.

### Task 5: Biome replaces ESLint and Prettier

**Files:**
- Modify: `biome.json` (drop `!bench`; add a `bench/**` override; ignore `bench/web/.next`, `bench/web/next-env.d.ts`)
- Modify: `bench/web/package.json` (`lint: biome lint .`, `format: biome format --write .`, `format:check: biome format .`; remove `eslint`, `eslint-config-next`, `@eslint/eslintrc`, `prettier`)
- Delete: `bench/web/eslint.config.mjs`, `bench/web/.prettierrc.json`

- [ ] **Step 1: Add the override.** It sets `javascript.formatter.quoteStyle: "single"`, `jsxQuoteStyle: "double"`, `trailingCommas: "all"` and `formatter.lineWidth: 100` for `bench/**`.
- [ ] **Step 2: Measure the reformat.** Run `bunx biome format --write bench` and `git diff --stat`. Expect a small diff, not a rewrite. If more than about 50 lines change, adjust the override until Biome's output matches the existing files.
- [ ] **Step 3: Lint.** Run `bunx biome lint bench` and fix what it reports without changing behavior. The site's rule configuration applies. Where a site rule fires on a deliberate bench pattern, disable it in the `bench/**` override with a one-line reason. Keep `correctness/useExhaustiveDependencies` and `correctness/useHookAtTopLevel` on, since they replace ESLint's React hooks rules.
- [ ] **Step 4: Run** `bun run check:ci` at the root, the bench suite and parity. All pass, with 0 mismatches.
- [ ] **Step 5: Commit:** `Lint and format bench with Biome`. Update CLAUDE.md "Toolchain" and the bench README's command list in the same commit.

### Task 6: TypeScript 7 with a shared base config

**Files:**
- Create: `tsconfig.base.json`
- Modify: `tsconfig.json`, `bench/web/tsconfig.json`, `bench/web/package.json` (`typescript: ^7.0.2`, as at the root)

- [ ] **Step 1: Write the base.** It holds the options both configs share today:
  - `strict`, `noEmit`, `esModuleInterop`, `module: "esnext"`, `moduleResolution: "bundler"`;
  - `resolveJsonModule`, `isolatedModules`, `skipLibCheck`, `allowJs`, `incremental`;
  - `noUnusedLocals`, `noUnusedParameters`, `lib: ["dom", "dom.iterable", "esnext"]`, and the `next` plugin.

  Both configs `extend` it and keep their own options: the site its `paths`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and the rest; bench its `paths`, `noFallthroughCasesInSwitch` and `noUncheckedSideEffectImports`.
- [ ] **Step 2: Type-check.** Run `bunx tsc --noEmit -p bench/web` and the root `bun run typecheck`, and fix only what TypeScript 7 reports. The stricter flags are not adopted here; they belong to PR 2.
- [ ] **Step 3: Run** the bench suite, both builds and parity. All pass, with 0 mismatches.
- [ ] **Step 4: Commit:** `Type-check bench with TypeScript 7 and a shared base config`.

### Task 7: Verify, push and open the draft PR

- [ ] **Step 1: Run the final parity check.** `bash bench/scripts/parity/run.sh origin/main ~/Backups/vortex-bench/vortex_bench-20261028T171815Z` must report 0 mismatches across the API and screenshots. Keep its summary for the PR. Then run `reuse lint`; every new file must be covered.
- [ ] **Step 2: Push** with `git push -u origin claude/bench-toolchain`.
- [ ] **Step 3: Open a draft PR.**
  - The body is about 100 words in Simplified Technical English. It names the parity result, links the design doc, and keeps the details in the linked issue: #113 or a new one.
  - Before posting, show Will the body.
  - End it with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4: Check the CI evidence:**
  - `Bench: format, lint, build, test` passes.
  - Lighthouse passes, which proves the zod 4 override doesn't break lhci. If it fails on zod, drop the override and record bench's zod as accepted (spec, Constraints).
  - The `dependency-review` log shows it read the submitted snapshot, not "no snapshot".
  - `Bench Deploy` builds the preview, and `verify-web-deploy.mjs` passes on it.
- [ ] **Step 5: Hand to Will** for the smoke test in the preview.
