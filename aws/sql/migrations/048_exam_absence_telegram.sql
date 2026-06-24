-- ============================================================
-- Migration 048 – Exam absence + Telegram exam-result templates
-- ============================================================
-- 1. exam_results: allow recording that a student was ABSENT for an exam
--    (no grade). grade becomes nullable; is_absent flags the absentees.
-- 2. telegram_templates: allow EXAM_RESULT / EXAM_ABSENT message types so the
--    exam-result Telegram message is editable on the /telegram settings page.
--
-- All statements are idempotent.
-- ============================================================

-- 1) Exam absence
ALTER TABLE exam_results ALTER COLUMN grade DROP NOT NULL;
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS is_absent BOOLEAN NOT NULL DEFAULT false;

-- 2) Telegram exam template types — widen the CHECK constraint.
ALTER TABLE telegram_templates DROP CONSTRAINT IF EXISTS telegram_templates_type_check;
ALTER TABLE telegram_templates ADD CONSTRAINT telegram_templates_type_check
  CHECK (type IN ('PRESENT','ABSENT','LINK_WELCOME','EXAM_RESULT','EXAM_ABSENT'));
