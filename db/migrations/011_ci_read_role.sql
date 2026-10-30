-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- migrate-schema: requires-superuser
-- This migration creates a login role (`CREATE ROLE bench_ci_read`), sets its
-- connection limit, and runs `ALTER DEFAULT PRIVILEGES FOR ROLE migrator` -- all
-- requiring a master-capable executing role, exactly like 004/005. The marker
-- makes `migrate-schema.py` reject a non-master `apply` loudly and early.

-- Create the `bench_ci_read` login role that `vortex-data/vortex` CI uses to read
-- the published benchmark numbers and diff them against the numbers a run just
-- measured. It is read-only by construction, like `bench_read` (005): USAGE on
-- the schema plus SELECT on the six data tables, nothing else.
--
-- It is deliberately SEPARATE from `bench_read`. `bench_read` authenticates with
-- a static password because Vercel has no AWS credentials, and on RDS a member of
-- `rds_iam` cannot use a password. GitHub Actions can mint RDS IAM tokens through
-- OIDC, so this role is IAM-only: it is granted `rds_iam`, has no password, and
-- the OIDC role `GitHubBenchmarkReadRole` (`infra/provision.sh`) scopes
-- `rds-db:connect` to it. That role trusts pull-request runs, which is why this
-- identity can never write.
--
-- Idempotent and substrate-portable, matching 002/004: `CREATE ROLE` is guarded
-- (roles are cluster-global), the `rds_iam` grant is guarded behind an existence
-- check so this also applies on vanilla Postgres, and re-granting an existing
-- privilege is a Postgres no-op.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bench_ci_read') THEN
        CREATE ROLE bench_ci_read WITH LOGIN;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN
        GRANT rds_iam TO bench_ci_read;
    END IF;
END$$;

-- CI runs share the instance with the website's read path, so cap what a
-- runaway diff query or a burst of parallel jobs can take from it. Every
-- transaction is read-only on top of the grants below.
ALTER ROLE bench_ci_read CONNECTION LIMIT 16;
ALTER ROLE bench_ci_read SET statement_timeout = '60s';
ALTER ROLE bench_ci_read SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE bench_ci_read SET default_transaction_read_only = on;

GRANT USAGE ON SCHEMA public TO bench_ci_read;

-- SELECT-only on the six data tables. The `_applied_migrations` ledger is
-- excluded, as for `bench_read`.
GRANT SELECT ON commits TO bench_ci_read;
GRANT SELECT ON query_measurements TO bench_ci_read;
GRANT SELECT ON compression_times TO bench_ci_read;
GRANT SELECT ON compression_sizes TO bench_ci_read;
GRANT SELECT ON random_access_times TO bench_ci_read;
GRANT SELECT ON vector_search_runs TO bench_ci_read;

-- Future `migrator`-created tables grant SELECT automatically, as in 004/005
-- (see 004 for why the executing role may need to self-grant `migrator`).
DO $$
DECLARE
    self_granted boolean := false;
BEGIN
    IF NOT pg_has_role(current_user, 'migrator', 'USAGE') THEN
        GRANT migrator TO CURRENT_USER WITH INHERIT TRUE;
        self_granted := true;
    END IF;

    ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA public
        GRANT SELECT ON TABLES TO bench_ci_read;

    IF self_granted THEN
        REVOKE migrator FROM CURRENT_USER;
    END IF;
END$$;
