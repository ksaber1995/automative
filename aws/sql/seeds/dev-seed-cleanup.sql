-- =============================================================================
-- DEV SEED CLEANUP: removes everything inserted by dev-seed.sql.
-- Identifies seeded rows by notes containing '[seed]' (or by notes = '[seed]'
-- depending on the table — match the seed file's exact tag).
-- Order matters: enrollments → classes → courses → students.
-- =============================================================================
DO $$
DECLARE
  v_company_id UUID := '7c1df4c0-c0f0-4dd3-9b31-80b98098f785';
BEGIN
  DELETE FROM enrollments
  WHERE company_id = v_company_id AND notes = '[seed]';

  DELETE FROM classes
  WHERE company_id = v_company_id AND notes = '[seed]';

  DELETE FROM courses
  WHERE company_id = v_company_id AND name LIKE '[seed]%';

  DELETE FROM students
  WHERE company_id = v_company_id AND notes = '[seed]';
END $$;
