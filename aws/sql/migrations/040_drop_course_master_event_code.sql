-- ============================================================
-- Migration 040 – Remove code from courses, master_courses, events
-- ============================================================
-- The "code" field is no longer used on courses, master courses, or events.
-- Drop the columns along with their unique constraints/indexes. Idempotent.
--
-- Run order note: this is safe to run after the new API is deployed (the new
-- code neither reads nor writes these columns). Done via RDS Data API on prod.
-- ============================================================

-- courses
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_company_id_code_key;
DROP INDEX IF EXISTS idx_courses_code;
ALTER TABLE courses DROP COLUMN IF EXISTS code;

-- master_courses (unnamed UNIQUE (branch_id, code) → master_courses_branch_id_code_key)
ALTER TABLE master_courses DROP CONSTRAINT IF EXISTS master_courses_branch_id_code_key;
ALTER TABLE master_courses DROP COLUMN IF EXISTS code;

-- events
ALTER TABLE events DROP COLUMN IF EXISTS code;
