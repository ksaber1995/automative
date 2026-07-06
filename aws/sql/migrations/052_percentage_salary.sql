-- ============================================================
-- Migration 052 – Percentage salary type for teachers
-- ============================================================
-- Adds a third employee salary_type = 'PERCENTAGE': the teacher earns
-- `percentage_rate`% of the money students have actually PAID for the classes
-- they teach (classes.instructor_id = employee). Earnings accrue live as
-- payments arrive and are withdrawable any time (like SESSION_BASED).
--
-- No ledger table is needed: owed = (percentage_rate% of total paid) minus the
-- base salary already withdrawn (expense_payments, category='SALARIES').
--
-- Mirrors ensureSalaryColumns() in aws/lambda/api/src/routes/expenses.ts, which
-- applies the same changes idempotently at runtime. Safe to re-run.
-- ============================================================

ALTER TABLE employees ADD COLUMN IF NOT EXISTS percentage_rate DECIMAL(5, 2);

-- Widen the salary_type CHECK to allow PERCENTAGE (only if not already widened).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_salary_type_check'
      AND pg_get_constraintdef(oid) LIKE '%PERCENTAGE%'
  ) THEN
    ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_salary_type_check;
    ALTER TABLE employees ADD CONSTRAINT employees_salary_type_check
      CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED', 'PERCENTAGE'));
  END IF;
END $$;
