<!--
SPDX-License-Identifier: Apache-2.0
SPDX-FileCopyrightText: Copyright the Vortex contributors
-->

# Data pipeline

How a benchmark measurement travels from a CI run to a row in the database, and
how the full history was carried across the three storage generations.

See also: the wire contract [`../../CONTRACT.md`](../../CONTRACT.md) and the SQL
schema under [`../../migrations/`](../../migrations/). (The migrator's own
`migrate/README.md` was deleted with the v3 tree; see git history.)

## Producers: the emitters

The benchmark runs themselves live in the [`vortex-data/vortex`](https://github.com/vortex-data/vortex)
monorepo and are **owned by it** — this repo owns the *ingest contract* and the
read services, not the producers. A run does two things:

1. `vortex-bench --gh-json-v3 <path>` writes **JSONL of bare records** — one line
   per measurement, discriminated by a `kind` field.
2. `scripts/post-ingest.py --postgres` builds the commit row (from
   `${{ github.sha }}` and `git show`) and writes the records directly to RDS.

Because every generation's data originates from the same emitter output, the
record shapes are identical across them. That shared shape is what made the
v2→v3→v4 migration a faithful copy rather than a re-derivation.

## The record model

Every measurement is one of **five kinds**, each routed to its own fact table:

| `kind` | Fact table | Dimension tuple (besides `commit_sha`) |
|---|---|---|
| `query_measurement` | `query_measurements` | dataset, dataset_variant, scale_factor, query_idx, storage, engine, format |
| `compression_time` | `compression_times` | dataset, dataset_variant, format, op |
| `compression_size` | `compression_sizes` | dataset, dataset_variant, format |
| `random_access_time` | `random_access_times` | dataset, format |
| `vector_search_run` | `vector_search_runs` | dataset, layout, flavor, threshold |

Plus one **dimension table**, `commits`, keyed by `commit_sha` (40-hex), carrying
the commit timestamp, message, author/committer, tree SHA and URL. The commit row
is upserted (`ON CONFLICT (commit_sha) DO UPDATE`) before any fact rows.

**One fact table per dimension shape** (rather than one wide table) is deliberate:
the families have genuinely different dimensions, so a single table would bloat
every row with NULLs and split a single chart's data across rows that need
re-joining. See [design-decisions.md](design-decisions.md).

### `measurement_id`: the upsert key, never on the wire

Each fact row's primary key is `measurement_id`, a **deterministic hash over
`commit_sha` + the record's dimension tuple**. Its critical properties:

- It is the key for the `ON CONFLICT (measurement_id) DO UPDATE` upsert, so
  re-emitting the same `(commit, dims)` updates the row instead of duplicating it.
  The CI ingest writer computes the hash itself, with no server in the loop
  (the monorepo's `scripts/_measurement_id.py`, originally a byte-for-byte port of
  the retired v3 server's Rust implementation). Its output is frozen by a
  golden-vector contract — see [`CONTRACT.md`](../../CONTRACT.md) and
  [design-decisions.md](design-decisions.md).
- It is **never a wire field.** Emitters do not (and must not) send it — the
  ingest writer computes it just before INSERT. Note that with every production
  row already keyed by it, the byte layout is **frozen**: it can never change
  again without re-keying the whole database.
- The migrator **copied it verbatim** and never recomputed it (see below), so the
  upsert-not-duplicate invariant was preserved bit-for-bit across DB generations.

### `SCHEMA_VERSION`: the cross-repo lockstep

A single integer keeps the producer wire shape and the reader in lockstep. It is
anchored in several places that **must** agree, in one logical change:

| Site | File | Repo |
|---|---|---|
| Source of truth | `web/lib/schema-version.ts` | this repo |
| Producer wire shape | `vortex-bench/src/v3.rs` | monorepo |
| CI ingest writer | `scripts/post-ingest.py` (hardcoded literal) | monorepo |

The in-repo anchor is checked automatically by `web/lib/schema-version.test.ts`,
which reads `CONTRACT.md` and compares its quoted anchor against the TS constant.
The cross-repo sites cannot be verified from here — a bump must be coordinated or
every CI ingest run fails. Full procedure in
[`../../CONTRACT.md`](../../CONTRACT.md).

## The ingest path

`post-ingest.py --postgres` (required in monorepo benchmark CI) writes the
records **directly to RDS** as the least-privilege `bench_ingest` IAM role
(`INSERT … ON CONFLICT (measurement_id) DO UPDATE`), then pings
`POST {BENCH_SITE_BASE_URL}/api/revalidate` to flush the Next.js read cache.
Each JSONL file applies in one transaction. The retired v3 HTTP path
(`POST /api/ingest` into the Rust server) is described in
[`../legacy.md`](../legacy.md).

## Storage by generation

| Gen | Store | Shape |
|---|---|---|
| v2 | Static `data.json.gz` + `commits.json` + `file-sizes-*.json.gz` in the **public** S3 bucket `vortex-ci-benchmark-results` | Loose JSONL; grouping/classification done at read time |
| v3 | A single **DuckDB** file on the EC2 host's local disk | The structured six-table schema; a precomputed read model materialized in memory |
| v4 | **AWS RDS Postgres** (`vortex_bench`, us-east-1) | The same six-table schema, translated to Postgres DDL with read-path indexes |

## The migrator: `vortex-bench-migrate` (historical)

A throwaway Rust binary that bridged the generations. Its job is done: the full
history is in the production Postgres, so the binary was deleted with the v3
tree (see git history). This section records how it worked. It had two jobs.

### Job 1 — `run`: v2 S3 dump → v3 DuckDB

```
vortex-bench-migrate run --output <snapshot.duckdb> [--source public-s3|local]
```

Streams v2's `data.json.gz` / `commits.json` / `file-sizes-*.json.gz`, and for
every loose v2 record runs a **classifier** (`migrate/src/classifier.rs`) that
reproduces v2's old read-time grouping logic (`getGroup`, `formatQuery`,
`normalizeChartName`) — a bug-for-bug port — to map it to one of the six
structured tables. Records accumulate per table, deduplicate by `measurement_id`,
and flush to DuckDB via Arrow appenders.

The classifier existed **only** for v2 data: v3+ emitters already produce
structured records, so the live read path never classifies. It is a one-time
translation that goes away when v3 is decommissioned. The `run` self-gates: it
fails if more than 5% of records are uncategorized, or if a `file-sizes-*` source
fails to download (override with `--allow-missing-file-sizes` — the `*-s3*`
file-size files are not published, since file size is storage-independent).

### Job 2 — `load` + `verify`: v3 DuckDB → v4 RDS Postgres

```
vortex-bench-migrate load   --duckdb <snap.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>] [--replace]
vortex-bench-migrate verify --duckdb <snap.duckdb> --postgres-target <dsn> [--ca-cert <rds-ca.pem>]
```

`load` reads each DuckDB table as Arrow batches and `COPY`s them into Postgres in
**one transaction**:

- `measurement_id` is copied **verbatim** — never recomputed — preserving the
  upsert identity exactly.
- By default `load` only appends (the one-shot empty-seed contract); a duplicate
  `measurement_id` aborts.
- `--replace` issues `TRUNCATE` on all six tables as the first statement *inside*
  the load transaction, making the load an atomic full replace — the data-refresh
  path. Because the TRUNCATE shares the transaction, a mid-load failure rolls back
  to the *original* data, never an empty table. `TRUNCATE` requires table
  ownership, so `--replace` **must connect as the RDS master `postgres`**, not the
  `migrator`/`bench_ingest` roles.
- After the COPYs, it backfills the denormalized `query_measurements.commit_timestamp`
  from `commits` (also inside the transaction).
- `--ca-cert` selects a host-verifying TLS connection (rustls trusting the RDS CA
  bundle, `sslmode=require`); omit it for a plaintext local rehearsal.

`verify` then compares source DuckDB and target Postgres **per `measurement_id`**,
asserting presence (no extras, no missing) and value equality on every non-key
column. Because `measurement_id` is a hash that does *not* include the value
columns, row counts alone cannot prove fidelity — this value check is the real
correctness gate. It exits non-zero on any diff.

A second `verify --against <v2-server-url>` mode does a structural diff of the
migrated v3 DuckDB against the live v2 `/api/metadata` (group/chart structure
only) to catch classifier regressions.

### End-to-end refresh

```
v2 S3 dump ──run──▶ v3 DuckDB ──load --replace──▶ v4 RDS ──verify──▶ ✓
                                  (as master postgres,
                                   atomic TRUNCATE+COPY)
```

This refresh was last run for the 2026-07-07 backfill (with a scoped merge mode
rather than `--replace`); with the migrator deleted, the disaster-recovery story
is now RDS point-in-time recovery (35-day retention) and manual snapshots, not a
rebuild from the v2 dump. The local rehearsal harness
(`migrate/tests/postgres_e2e.rs`, Docker-gated) stood up a throwaway Postgres,
ran `load`+`verify`, and asserted a forced mid-load failure rolls back cleanly.
