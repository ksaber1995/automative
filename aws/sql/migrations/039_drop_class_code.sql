-- ============================================================
-- Migration 039 – Remove classes.code
-- ============================================================
-- The per-class "code" field is no longer used. Drop the column along with the
-- legacy unique constraint/index that referenced it. Idempotent.
--
-- Note: the API self-applies this at runtime via ensureClassStatusColumns()
-- in routes/classes.ts; this file documents the change for schema parity and
-- direct DB runs.
-- ============================================================

ALTER TABLE classes DROP CONSTRAINT IF EXISTS unique_class_code;
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_company_id_code_key;
DROP INDEX IF EXISTS idx_classes_code;
ALTER TABLE classes DROP COLUMN IF EXISTS code;
