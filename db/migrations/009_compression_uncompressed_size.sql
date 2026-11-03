-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- New benchmark runs record the Arrow memory size of each source dataset.
-- Existing rows remain NULL because summaries use new snapshots only.
ALTER TABLE compression_sizes
    ADD COLUMN IF NOT EXISTS uncompressed_bytes BIGINT;
