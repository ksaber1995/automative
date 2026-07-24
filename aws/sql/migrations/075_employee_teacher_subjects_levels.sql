-- 075: employees can be flagged as teachers, with optional subjects + levels.
--
-- "Add Employee" became two buttons — Add Employee and Add Teacher — both
-- writing to `employees`. A teacher IS an employee with is_teacher = true, not a
-- separate table: teachers are paid, terminated, assigned to classes and
-- revenue-shared exactly like any other employee, and a second table would fork
-- every one of those paths.
--
-- Subjects and levels are many-to-many and optional on both sides. Shape copied
-- from course_subjects / course_levels (migration 065) rather than inventing a
-- new one, so the API helpers read the same.
--
-- Idempotent — matches ensureTeacherSchema() in
-- aws/lambda/api/src/routes/employees.ts, which self-applies the same DDL at
-- runtime (house style, same as ensureSalaryColumns).

ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_teacher BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS employee_subjects (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    subject_id  UUID NOT NULL REFERENCES subjects(id)  ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_subjects_employee ON employee_subjects(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_subjects_subject  ON employee_subjects(subject_id);

CREATE TABLE IF NOT EXISTS employee_levels (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    level_id    UUID NOT NULL REFERENCES levels(id)    ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, level_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_levels_employee ON employee_levels(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_levels_level    ON employee_levels(level_id);

-- Backfill: anyone already assigned as the instructor on a class is a teacher in
-- practice, so flag them. Without this every existing teacher lands on the
-- "Employees" side of the new filter and staff would re-tag them by hand.
--
-- One-way (never sets false), but NOT a no-op on re-run: an employee who still
-- instructs a class and was deliberately un-flagged afterwards would be
-- re-flagged. Treat this as a one-time backfill, not something to replay.
UPDATE employees e
   SET is_teacher = true
 WHERE e.is_teacher = false
   AND EXISTS (
     SELECT 1 FROM classes c
      JOIN courses co ON co.id = c.course_id
     WHERE c.instructor_id = e.id
       AND co.company_id = e.company_id
   );
