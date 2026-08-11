-- =============================================================================
-- 088 — A per-month master course can have its fee overridden for one month
--
-- Courses have had this since migration 042: charge a different price for one
-- named month (a short month, a holiday, a promotion) without touching the
-- course's standing price, with each student's bill scaled by whatever discount
-- they were given. A master course sold per month is billed the same way and
-- wants the same lever.
--
-- Same shape as the bill subject in 087: the override belongs to a course OR to
-- a master course, never both. Existing rows keep their course_id and are
-- untouched.
-- =============================================================================

ALTER TABLE course_monthly_price_overrides
  ADD COLUMN IF NOT EXISTS master_course_id UUID
  REFERENCES master_courses(id) ON DELETE CASCADE;

ALTER TABLE course_monthly_price_overrides ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE course_monthly_price_overrides
  DROP CONSTRAINT IF EXISTS cmpo_one_subject;
ALTER TABLE course_monthly_price_overrides
  ADD CONSTRAINT cmpo_one_subject
  CHECK (num_nonnulls(course_id, master_course_id) = 1);

-- One override per master course per month, the mirror of the course unique.
-- The existing UNIQUE (course_id, billing_year, billing_month) still covers
-- course rows: NULLs are not equal, so master rows never collide with it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmpo_master_month
  ON course_monthly_price_overrides(master_course_id, billing_year, billing_month)
  WHERE master_course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cmpo_master_course
  ON course_monthly_price_overrides(master_course_id);
