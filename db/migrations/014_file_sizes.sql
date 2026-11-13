-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- The on-disk size of each Vortex file a SQL benchmark writes, per commit.
CREATE TABLE IF NOT EXISTS file_sizes (
    measurement_id   BIGINT      PRIMARY KEY NOT NULL,
    commit_sha       TEXT        NOT NULL,
    benchmark        TEXT        NOT NULL,
    scale_factor     TEXT        NOT NULL,
    format           TEXT        NOT NULL,
    file             TEXT        NOT NULL,
    value_bytes      BIGINT      NOT NULL
);

-- CI reads one commit's files per benchmark scope.
CREATE INDEX IF NOT EXISTS idx_file_sizes_baseline
    ON file_sizes (benchmark, scale_factor, format, commit_sha);
