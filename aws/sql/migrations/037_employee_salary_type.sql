-- ============================================================
-- Migration 037 – Employee salary type (monthly vs session-based)
-- ============================================================
-- Adds:
--   employees.salary_type  MONTHLY (default) | SESSION_BASED
--   employees.session_rate DECIMAL — pay per taught session (when SESSION_BASED)
-- For SESSION_BASED staff the monthly amount = (PRESENT sessions in month) ×
-- session_rate, computed at payroll time. Idempotent.
-- ============================================================

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS salary_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'employees' AND constraint_name = 'employees_salary_type_check'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_salary_type_check CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED'));
  END IF;
END$$;

ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS session_rate DECIMAL(10, 2);
