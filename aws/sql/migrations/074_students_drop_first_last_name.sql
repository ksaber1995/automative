-- 074: drop students.first_name / students.last_name.
--
-- The closing half of 070, which collapsed the pair into a single students.name
-- and deliberately left the old columns in place so `name` could be recomputed
-- with a different merge rule if the result read wrong. It didn't; the columns
-- go now. (070 called this step "071", but that number went to free_sessions.)
--
-- Run this ONLY after the API and the frontend that read/write `name` are both
-- deployed — the pre-070 code inserts first_name/last_name and would start
-- failing the moment these disappear.

-- Re-backfill first: rows the old code inserted between the 070 run and the API
-- deploy have first/last set and name NULL. Same rule as 070 — concat_ws skips
-- NULLs, nullif stops an empty half leaving a stray space, the regexp squeezes
-- doubled spaces. No-op if the columns are already gone.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'students' AND column_name = 'first_name'
  ) THEN
    EXECUTE $q$
      UPDATE students
         SET name = trim(regexp_replace(
               concat_ws(' ', nullif(trim(first_name), ''), nullif(trim(last_name), '')),
               '\s+', ' ', 'g'))
       WHERE name IS NULL OR trim(name) = ''
    $q$;
  END IF;
END $$;

-- Anything still blank has no salvageable name in either column; NOT NULL below
-- would reject it. Park it rather than fail the migration — staff can fix these
-- from the student list.
UPDATE students SET name = 'Unnamed' WHERE name IS NULL OR trim(name) = '';

ALTER TABLE students DROP COLUMN IF EXISTS first_name;
ALTER TABLE students DROP COLUMN IF EXISTS last_name;

-- Held back in 070 because the then-live code still inserted students without
-- `name`. Both deploys are out, so it can be enforced now.
ALTER TABLE students ALTER COLUMN name SET NOT NULL;
