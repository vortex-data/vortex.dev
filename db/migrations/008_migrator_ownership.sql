-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- migrate-schema: requires-superuser
-- Transfer the bootstrap objects to the steady-state migration role. This is
-- the final master-run migration. Later migrations can alter existing objects
-- through the least-privilege schema deployment workflow.

DO $$
BEGIN
    IF NOT pg_has_role(current_user, 'migrator', 'SET') THEN
        GRANT migrator TO CURRENT_USER WITH SET TRUE;
    END IF;
END$$;

ALTER TABLE public._applied_migrations OWNER TO migrator;
ALTER TABLE public.commits OWNER TO migrator;
ALTER TABLE public.query_measurements OWNER TO migrator;
ALTER TABLE public.compression_times OWNER TO migrator;
ALTER TABLE public.compression_sizes OWNER TO migrator;
ALTER TABLE public.random_access_times OWNER TO migrator;
ALTER TABLE public.vector_search_runs OWNER TO migrator;
