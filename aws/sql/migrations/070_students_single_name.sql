-- 070: collapse students.first_name + last_name into a single students.name.
--
-- Adding a student meant typing four required fields (first name, last name,
-- guardian name, guardian phone). A student has one name; splitting it bought
-- nothing — nothing sorted, searched, or addressed people by surname alone, and
-- staff were already typing full names across the two boxes ("Romisaa" +
-- "Mohamed Hakarish"). So: one `name` field, and the guardian pair becomes
-- optional.
--
-- name = first_name + ' ' + last_name.
--
-- NOT the guardian's name. students.parent_name holds the guardian's OWN full
-- name (given + family), not a middle name — splicing it in produced
-- "خالد فارس سليمان سليمان" (family name twice) and "Hany Ziad Mahmoud Nabil"
-- (father's whole name wedged into the student's), wrong on 14 of 14 sampled
-- rows. parent_name stays its own column: WhatsApp templates address the parent
-- with "عزيزي {parentName}".
--
-- STAGED — this file is only the additive half, and is safe to run against a
-- live system:
--   1. (here) add `name`, backfill it, relax the NOT NULL on first/last
--   2. deploy the API that reads/writes `name`
--   3. re-run the backfill below for rows the old code inserted meanwhile
--   4. deploy the frontend
--   5. only then 071 drops first_name/last_name
-- first_name/last_name are deliberately left in place so `name` can be
-- recomputed with a different rule if the merged result reads wrong.

ALTER TABLE students ADD COLUMN IF NOT EXISTS name TEXT;

-- concat_ws skips NULLs; nullif(trim(x),'') stops an empty half leaving a
-- leading/trailing space; the regexp squeezes doubled spaces that staff typed
-- ("Abeer  Ibrahim Hodhod").
UPDATE students
   SET name = trim(regexp_replace(
         concat_ws(' ', nullif(trim(first_name), ''), nullif(trim(last_name), '')),
         '\s+', ' ', 'g'))
 WHERE name IS NULL;

-- The new API writes `name` only. Until step 5 drops them, these must accept
-- the rows it inserts.
ALTER TABLE students ALTER COLUMN first_name DROP NOT NULL;
ALTER TABLE students ALTER COLUMN last_name  DROP NOT NULL;

-- Deliberately NOT set yet: `name` stays nullable until the API deploy, because
-- the currently-live code still inserts students without it.
-- ALTER TABLE students ALTER COLUMN name SET NOT NULL;
