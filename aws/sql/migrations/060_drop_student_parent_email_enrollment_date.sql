-- 060: Drop students.parent_email and students.enrollment_date.
--
-- Both were optional-in-spirit fields on the add-student form that nobody filled
-- in meaningfully. They are gone from the form, the API contract and the DB.
--
-- IMPORTANT — enrollment_date also exists on `enrollments` and `master_enrollments`.
-- Those are DIFFERENT columns (the date a student joined a *course*) and drive
-- billing, revenue and the monthly-subscription generator. They are NOT touched here.
-- Only the students-table column is dropped.
--
-- Reports that used to read students.enrollment_date as the "join date"
-- (studentsOverTime, studentChurn, profitByBranch) now use students.created_at
-- instead. For students whose record was created on the day they joined the two
-- are identical; for back-dated imports the historical month buckets shift to the
-- import date. Deploy the API BEFORE running this, so no live code selects the
-- dropped columns.
--
-- Dropping a column drops its index too, so idx_students_enrollment_date goes
-- with it; the explicit DROP INDEX below is belt-and-braces for older snapshots.

ALTER TABLE students DROP COLUMN IF EXISTS parent_email;

DROP INDEX IF EXISTS idx_students_enrollment_date;

ALTER TABLE students DROP COLUMN IF EXISTS enrollment_date;
