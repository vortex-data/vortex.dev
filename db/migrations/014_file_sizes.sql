-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- On-disk size of each Vortex file a SQL benchmark writes, captured by the monorepo's
-- `scripts/capture-file-sizes.py` after the run. PR benchmark runs read these rows back as the
-- develop baseline for the file-size section of the PR comment. One-shot (no per-iteration
-- data). Natural key: `(commit_sha, benchmark, scale_factor, format, file)`, where `benchmark`
-- is the `vx-bench` subcommand (`tpch`, `clickbench`, ...), `format` is the format directory
-- (`vortex-file-compressed`, `vortex-compact`), and `file` is the path below it.
--
-- The `ALTER DEFAULT PRIVILEGES` rules in 004, 005 and 011 grant `bench_ingest`, `bench_read`
-- and `bench_ci_read` their access when `migrator` creates this table, so it needs no grants.
CREATE TABLE IF NOT EXISTS file_sizes (
    measurement_id   BIGINT      PRIMARY KEY NOT NULL,
    commit_sha       TEXT        NOT NULL,
    benchmark        TEXT        NOT NULL,
    scale_factor     TEXT        NOT NULL,
    format           TEXT        NOT NULL,
    file             TEXT        NOT NULL,
    value_bytes      BIGINT      NOT NULL
);

-- CI reads one commit's files for a (benchmark, scale_factor, format) scope, so the index ends in
-- `commit_sha` rather than `file`: the lookup is a range scan of that commit's rows alone. The
-- baseline commit itself is chosen from the query measurements written beside these rows.
CREATE INDEX IF NOT EXISTS idx_file_sizes_baseline
    ON file_sizes (benchmark, scale_factor, format, commit_sha);
