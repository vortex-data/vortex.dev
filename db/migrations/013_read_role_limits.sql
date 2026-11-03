-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- migrate-schema: requires-superuser
-- `ALTER ROLE` on another login role needs a master-capable executing role (the
-- RDS master created `bench_read` in 005 and holds ADMIN on it), so the marker
-- makes `migrate-schema.py` reject a non-master `apply` loudly and early.

-- Cap what the `bench_read` login (005) can take from the instance, as 011 does
-- for `bench_ci_read`. `bench_read` authenticates with a static password from
-- the internet-reachable instance, so a leaked password must not be able to
-- open every connection or run unbounded queries.
--
-- Only the connection limit is enforced. The three settings are the role's
-- defaults, which a session can change with `SET`; they bound a plain client
-- that connects with the password, not one that overrides them.
--
-- The limit: `DatabaseConnections` peaked at 93 for all roles together in
-- October 2026, and the `connections-high` alarm fires above 300
-- (`infra/README.md`). Each Vercel instance opens at most `BENCH_DB_POOL_MAX`
-- (default 8) connections, so 200 holds 25 busy instances and leaves room
-- under the alarm for ingest, CI (16) and the operators.
--
-- The read service sets its own `statement_timeout` (`BENCH_DB_STATEMENT_TIMEOUT_MS`,
-- default 30 s), which wins over this default. Its reads are SELECTs and
-- `READ ONLY` transactions, and its cache-fill lock (`pg_try_advisory_lock`)
-- works in a read-only session.
--
-- Idempotent: `ALTER ROLE` sets the same values on every apply.
ALTER ROLE bench_read CONNECTION LIMIT 200;
ALTER ROLE bench_read SET statement_timeout = '30s';
ALTER ROLE bench_read SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE bench_read SET default_transaction_read_only = on;
