-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- Record which branch each commit's numbers were measured on. Measurements key
-- to a commit through `commit_sha`, so the branch lives on `commits`, and every
-- fact row inherits it through that join.
--
-- Every row so far was written by the ingest role, whose OIDC trust admits only
-- `develop` pushes, so the default fills the existing rows correctly. It stays
-- the default so the current writer, which does not send a branch, keeps
-- writing `develop` rows. Since PostgreSQL 11 a constant default is stored in the
-- catalog, so this does not rewrite the table.
ALTER TABLE commits
    ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'develop';

-- The read service resolves every chart's x-axis from one branch's commits,
-- newest first; this serves that window the way `idx_commits_timestamp` served
-- the unfiltered one.
CREATE INDEX IF NOT EXISTS idx_commits_branch_timestamp
    ON commits (branch, timestamp DESC, commit_sha DESC);
