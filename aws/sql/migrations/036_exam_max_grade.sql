-- ============================================================
-- Migration 036 – Exam total marks ("out of")
-- ============================================================
-- Adds exams.max_grade: the total possible marks for the exam, so a recorded
-- grade of "5" can be shown as "5 / 100". Optional (NULL = no denominator,
-- grade shown as-is). Idempotent.
-- ============================================================

ALTER TABLE exams
    ADD COLUMN IF NOT EXISTS max_grade DECIMAL(6, 2);
