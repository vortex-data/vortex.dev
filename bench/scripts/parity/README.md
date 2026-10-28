<!--
SPDX-License-Identifier: CC-BY-4.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Parity check

This check shows that two builds of bench behave the same. It builds a base git ref and the
working tree, serves both with `next start` against one restored production database, and compares
what they send: the API responses, and screenshots of the pages. Use it before you merge a change
that must not alter what visitors or API clients see, such as a toolchain or framework upgrade.

```bash
bash bench/scripts/parity/run.sh origin/main ~/Backups/vortex-bench/vortex_bench-20261028T171815Z
```

The script exits 0 and prints `parity: 0 mismatches` when nothing differs. Otherwise it exits 1.
It reports every difference it can see and leaves a person to judge whether it matters. API bodies
must match byte for byte. Screenshots use Playwright's comparison with `maxDiffPixels: 0` and
`threshold: 0`: every pixel it counts as different fails the run, but its comparator ignores pixels
it classes as anti-aliasing. That fits a bar of no human-perceptible difference, and a real layout
shift of 1 px or more still fails.

## Why two local servers

A Vercel preview cannot serve as the second build. The Data Cache (`unstable_cache`) serves old
payloads until production flushes it, so a preview lags production after an ingest. Two local
servers start with empty caches and read the same frozen data, so any difference comes from the
code. The check needs no token and changes no Vercel setting.

## What you need

- Postgres 16 binaries: `initdb`, `pg_ctl` and `psql`. The default is Homebrew's keg-only
  `postgresql@16` in `/opt/homebrew/opt/postgresql@16/bin`. Set `PG_BIN` to another directory, for
  example `/usr/lib/postgresql/16/bin` on Debian. There is no Docker container.
- A `pg_restore` that can read the dump. A dump from `pg_dump` 17 or later needs a `pg_restore` at
  least as new, which Postgres 16 does not have. The script uses the first of `PG_RESTORE`, the
  Postgres 16 one, Homebrew's `libpq` and the one in `PATH` that can read the archive.
- A directory-format `pg_dump`, given as the directory itself or as a directory that holds it in
  `vortex_bench.dir`. The script only reads it.
- `git`, `node`, `bun`, `curl` and `tar`, `pnpm` while a side still has `bench/web/pnpm-lock.yaml`,
  and Playwright's Chromium (`bun install` at the repository root, then
  `bunx playwright install chromium` if the browser is missing).
- About 12 GB of disk for the database, in `$TMPDIR/bench-parity`.

## What it does

1. Starts a throwaway Postgres on `127.0.0.1:55432`, in `${PARITY_PGDATA:-$TMPDIR/bench-parity/pgdata}`,
   with `initdb -A trust`. It listens on loopback only, and with `fsync` off to speed up the
   restore. It stops the server when the script ends.
2. Restores the dump into database `vortex_bench` with `pg_restore --no-owner --no-privileges -j 4`.
   It writes the dump's name on the database after a complete restore, so reruns with the same
   dump skip the restore, and a different dump, or an interrupted restore, starts again. It prints
   each table's row count. The first restore takes about 15 minutes; later runs take about
   90 seconds. A `pg_restore` from Postgres 17 or later also sets `transaction_timeout`, which
   Postgres 16 rejects. The script ignores that one error and stops on any other.
3. Exports the base ref with `git archive` into `$TMPDIR/bench-parity/base`. There is no worktree.
4. Builds each side with its own toolchain: `pnpm install --frozen-lockfile && pnpm build` in
   `bench/web` when `bench/web/pnpm-lock.yaml` exists, otherwise `bun install --frozen-lockfile` at
   the root and `bun run --cwd bench/web build`.
5. Serves the base on port 3101 and the head on port 3102, both on `127.0.0.1`, with the same
   `BENCH_DB_*` variables. It refuses to start when either port is taken, because a stale server
   would answer in place of the build. It first deletes the whole `.next/cache` of each side, after
   the builds. The Data Cache keeps its payloads there, and the head's `.next` belongs to your
   working tree, so without this a payload that an earlier run made from older code could answer in
   place of the current code. The next `next build` in your working tree starts without its build
   cache and takes longer.
6. Compares the API (`compare-api.ts`), then takes baseline screenshots from the base and compares
   the head with them (`screenshots.spec.ts`). Both comparisons always run, so one run shows all
   the differences.

## What it compares

**API.** `compare-api.ts` reads `/api/groups` from the base, then requests from both servers:

- `/api/groups`;
- `/api/group/{slug}?n=100` and `?n=50` for every group;
- `/api/chart/{slug}?n=100` for every chart;
- `/api/chart/{slug}?n=all` for every 25th chart.

For each URL it compares the status, `content-type`, `cache-control` and the body. The body must
match byte for byte, because clients receive bytes: key order counts. Every URL comes from the
base's own `/api/groups`, so each must answer 200 with a body on both servers. Anything else (a 404,
a 500, a redirect, an empty body) is reported as `nothing was compared for this route`, even when
both servers agree on it, because two equal failures would otherwise pass. The slugs are
percent-encoded in the URLs. The summary line tallies the statuses and the body bytes that were
compared, so you can see that real payloads were read.

Requests that fill the group cache (`/api/groups` and `/api/group/{slug}?n=100`) run one at a time,
base then head. Each fill takes one advisory lock in the shared database, and a fill that finds it
taken fails with a 500 after a few retries. Two fills at once, even on different servers, would
fail for that reason and not because the code differs. All other requests run four at a time. Run
`bun test bench/scripts/parity/compare-api.test.ts` to test the comparison itself. Use that path:
a bare `bun test` also finds bench's Vitest files.

A mismatch is one line with the route and what differs. For a body it names the first differing
JSON path with both values:

```text
/api/group/{slug}?n=50: body differs $.charts[3].series["datafusion:parquet"][41]: 1.25 != 1.26
/api/chart/{slug}?n=100: cache-control "public, s-maxage=300, stale-while-revalidate=3600" != "no-store"
```

When two bodies parse to the same JSON but differ in bytes, the line gives the byte offset and the
text around it. The full output is also in `$TMPDIR/bench-parity/out/api.log`.

**Pages.** `screenshots.spec.ts` captures, in Chromium at 1440×900 (`desktop`) and 390×844
(`phone`):

- `/`, collapsed as it loads;
- `/` with the first group open, after every chart in it has drawn;
- `/chart/{slug}` for the first chart of each of the first five groups.

Charts draw only when they scroll near the viewport, so the test visits each chart of the open
group first, and the page counts as ready when no chart shows its loading state. A chart that fails
to load fails the test. Playwright then compares each screenshot with `maxDiffPixels: 0` and
`threshold: 0`. Its comparator, pixelmatch, is left with `includeAA` false, so it ignores pixels it
classes as anti-aliasing: a change in how an edge is smoothed does not fail, but any other
differing pixel does, and so does a real layout shift of 1 px or more. That matches a bar of no
human-perceptible difference. Playwright also retakes a screenshot until two in a row agree, which
covers a late redraw.

Where a screenshot differs, Playwright keeps three images in
`$TMPDIR/bench-parity/out/results/`: the expected one (from the base), the actual one (from the
head) and the diff. The script prints that path. The baselines are in
`$TMPDIR/bench-parity/out/snapshots/`.

## What it does not compare

- `/api/health`. It reports the database and the build identity, not benchmark data.
- `/api/revalidate`. It writes to the cache.
- The HTML of the pages. Only the pixels are compared.
- Anything that varies with time. Nothing needed masking: the pages and the API bodies of a frozen
  database do not depend on the time. The check makes these things fixed instead: Google Fonts
  requests are blocked, so both runs draw the fallback font and a slow network cannot split them;
  the color scheme is light, the time zone UTC, the device scale 1 and motion reduced; and the
  pointer is moved off the charts before each screenshot. The dark theme and the `?engine=` and
  `?format=` filters are not covered.

## Reading a failure

- A line with `instead of 200` or `request failed` means a server did not give the expected answer,
  not that the data differs. Read `$TMPDIR/bench-parity/base.log` and `head.log`, the logs of the
  two servers.
- Run `run.sh` twice when a result looks odd. The same two builds must give the same answer, and
  a difference that comes and goes is a problem in the check.
- To start the restore from nothing, stop the script and delete `$TMPDIR/bench-parity/pgdata`.
