-- =============================================================================
-- 090 — A per-course arrangement can change the METHOD, not just the rate
--
-- 089 let a teacher take a different percentage of different courses. The same
-- teacher may also be paid a different WAY for different courses: a percentage
-- of one, a fee per session on another. That is one arrangement per course, so
-- it belongs on the same row rather than in a second table.
--
-- employees.salary_type remains the default for every course without a row.
-- A row overrides it completely — method and number.
-- =============================================================================

ALTER TABLE employee_course_percentages
  ADD COLUMN IF NOT EXISTS pay_type VARCHAR(20) NOT NULL DEFAULT 'PERCENTAGE';

ALTER TABLE employee_course_percentages
  DROP CONSTRAINT IF EXISTS ecp_pay_type_check;
ALTER TABLE employee_course_percentages
  ADD CONSTRAINT ecp_pay_type_check CHECK (pay_type IN ('PERCENTAGE', 'SESSION_BASED'));

ALTER TABLE employee_course_percentages
  ADD COLUMN IF NOT EXISTS session_rate DECIMAL(10, 2);

-- percentage_rate was NOT NULL when every row meant a percentage. A session row
-- has no percentage to give, so the requirement moves into the check below.
ALTER TABLE employee_course_percentages ALTER COLUMN percentage_rate DROP NOT NULL;

-- Whichever method the row names, the number that method needs must be there.
-- Without this a row can say SESSION_BASED and carry no rate, which would pay a
-- teacher nothing for every session of that course and look like a policy
-- decision rather than a missing field.
ALTER TABLE employee_course_percentages
  DROP CONSTRAINT IF EXISTS ecp_rate_matches_type;
ALTER TABLE employee_course_percentages
  ADD CONSTRAINT ecp_rate_matches_type CHECK (
    (pay_type = 'PERCENTAGE'    AND percentage_rate IS NOT NULL AND session_rate IS NULL)
    OR
    (pay_type = 'SESSION_BASED' AND session_rate    IS NOT NULL AND percentage_rate IS NULL)
  );
