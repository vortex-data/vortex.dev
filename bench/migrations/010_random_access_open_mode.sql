-- SPDX-License-Identifier: Apache-2.0
-- SPDX-FileCopyrightText: Copyright the Vortex contributors

-- Historical random-access rows contain cached-accessor measurements.
ALTER TABLE random_access_times
    ADD COLUMN IF NOT EXISTS open_mode TEXT NOT NULL DEFAULT 'cached';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'random_access_times_open_mode_check'
           AND conrelid = 'random_access_times'::regclass
    ) THEN
        ALTER TABLE random_access_times
            ADD CONSTRAINT random_access_times_open_mode_check
            CHECK (open_mode IN ('cached', 'reopen'));
    END IF;
END
$$;
