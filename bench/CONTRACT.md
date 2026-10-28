<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Benchmark emitter → ingest contract

This document is the versioned contract between the benchmark **emitters** (which run in
the `vortex-data/vortex` monorepo) and the **storage + read service** in this repository. It is
anchored to `SCHEMA_VERSION` (currently **`3`**). The emitters are owned by the monorepo
and are unchanged by this repository; this repo owns the ingest *contract*, the schema, and the
read service.

> **Scope.** There is one ingest path: the monorepo's `scripts/post-ingest.py --postgres` writes
> emitter records directly into the hosted RDS Postgres and then pings this repo's read service
> to flush its cache. The retired v3 HTTP ingest path (`POST /api/ingest` into a Rust server) is
> described in [`docs/legacy.md`](docs/legacy.md); the record shapes on the wire are unchanged
> from that era, which is why the producer flag is still spelled `--gh-json-v3`.

## Versioning: `SCHEMA_VERSION`

`SCHEMA_VERSION` is a single integer that keeps the producer wire shape and the reader in
lockstep. Bumping it is a coordinated, multi-site change.

### In-repo anchor (testable here)

| Anchor | File | Form |
|---|---|---|
| Source of truth | `web/lib/schema-version.ts` | `export const SCHEMA_VERSION = 3;` |

The consistency check in `web/lib/schema-version.test.ts` asserts this file and the anchor
quoted in this document agree automatically.

### Cross-repo sites (documented, NOT testable from this repo)

These live in the `vortex-data/vortex` monorepo and cannot be verified by this repo's CI.
A `SCHEMA_VERSION` bump must be coordinated with them in the same logical change:

| Site | Role |
|---|---|
| `vortex-bench/src/v3.rs` (the `--gh-json-v3` emitter) | Producer-side wire-shape source of truth |
| `scripts/post-ingest.py` | CI ingest writer; hardcodes the version as a Python literal that must equal the value above |

## The wire format: JSONL of bare records

The monorepo emitter `vortex-bench --gh-json-v3 <path>` writes **JSONL of bare records only** —
one JSON object per line, no envelope. `records` are discriminated by a `kind` field
(snake_case). The five kinds and their destination fact tables:

| `kind`               | Destination table     |
|----------------------|-----------------------|
| `query_measurement`  | `query_measurements`  |
| `compression_time`   | `compression_times`   |
| `compression_size`   | `compression_sizes`   |
| `random_access_time` | `random_access_times` |
| `vector_search_run`  | `vector_search_runs`  |

Each record's fields are defined by the producer structs in the monorepo's
`vortex-bench/src/v3.rs` and match the column names of its fact table (see
[`migrations/`](migrations/) for the DDL). `scripts/post-ingest.py` validates and maps them
column-by-column; an unknown `kind` or a missing dimension field fails the ingest run.

`compression_size` records include `uncompressed_bytes`, the Arrow memory size after the
source Parquet file is decoded. The column is nullable so historical rows remain valid.

`random_access_time` records include `open_mode`. The value is `cached` for a reused accessor
or `reopen` when each timed take includes a new accessor. Historical rows use `cached`.
The `reopen` mode does not clear the OS page cache.

> **`measurement_id` is never on the wire.** It is a deterministic hash over `commit_sha` + the
> record's dimension tuple, computed by the ingest writer just before INSERT and used as the
> primary key for the `ON CONFLICT … DO UPDATE` upsert. Emitters do not (and must not) send it.

## The ingest path — direct Postgres write + cache revalidate

The monorepo's `scripts/post-ingest.py --postgres` runs in benchmark CI (required, not
best-effort — a failure fails the bench job and alerts):

1. **Commit upsert:** the writer builds the commit row from `git show` and upserts it
   (`ON CONFLICT (commit_sha) DO UPDATE`) before applying any record.
2. **Direct write:** `INSERT … ON CONFLICT (measurement_id) DO UPDATE` into RDS as the
   least-privilege `bench_ingest` IAM role (IAM auth, `sslmode=verify-full`), against the
   schema in this repo's `migrations/`. Each JSONL file applies in one transaction.
3. **Revalidate ping:** `POST {BENCH_SITE_BASE_URL}/api/revalidate` with
   `Authorization: Bearer $BENCH_REVALIDATE_TOKEN`, to flush the Next.js Data Cache so the
   next read recomputes against freshly written data.

### `measurement_id`: the frozen hash contract

`measurement_id` is an xxhash64 (seed 0) over a canonical byte encoding of the dimension tuple —
per-table tag separators, length-prefixed string framing, optional / `i32` / `f64`-as-bits
encodings, and a signed-`i64` finish. It is implemented once, in the monorepo's
`scripts/_measurement_id.py`. Its output is **frozen forever**: every fact row already in
production is keyed by it, so drift does not error — it yields a *different* key for the same
measurement, which silently duplicates or collides rows instead of upserting.

The freeze is pinned by golden vectors, not by trust. The monorepo's
`scripts/measurement_id_golden.json` holds `(input → hash)` cases covering empty/Unicode
strings, `i32` bounds, and `f64` edges, generated by the original Rust implementation (the
retired v3 server, which wrote the production rows) and **never regenerated**; the monorepo's
`scripts/tests/test_measurement_id.py` asserts every vector byte-for-byte in CI. The golden
vectors ARE the contract.

### `POST /api/revalidate` (`web/app/api/revalidate/route.ts`)

- **Auth:** bearer token compared in constant time against `BENCH_REVALIDATE_TOKEN`.
- **Responses:**
  - `503 { "error": "not_configured" }` if `BENCH_REVALIDATE_TOKEN` is unset/empty
    (fails closed — an unconfigured deployment never silently accepts unauthenticated
    revalidation).
  - `401 { "error": "unauthorized" }` on a missing/incorrect token.
  - `200 { "revalidated": true }` on success — flushes the `BENCH_DATA_TAG` Data Cache
    entries. The response is never CDN-cached.

## Bumping `SCHEMA_VERSION` (procedure)

A version bump or wire-shape change is a coordinated change across BOTH repos in one
logical change:

1. **This repo:** `web/lib/schema-version.ts` (and the schema in `migrations/` if columns
   change).
2. **Monorepo:** `vortex-bench/src/v3.rs` (the producer wire shape) and
   `scripts/post-ingest.py` (the hardcoded literal plus its column mapping).

For wire/record *shape* changes, also update the producer snapshot fixtures in the monorepo in
the same commit.
