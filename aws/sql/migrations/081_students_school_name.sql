-- ============================================================
-- Migration 081 – the school a student attends
-- ============================================================
-- Academies run classes for children who come from a dozen different schools,
-- and staff kept writing it into `notes` — where nothing can filter, group or
-- report on it. Its own column so that stops being a free-text guess.
--
-- Optional on purpose: a teacher tenant coaching adults has no school to record,
-- and every row written before this column existed genuinely has no answer.
-- NULL reads as "not recorded", never as "no school".
--
-- Idempotent, and applied at runtime as well — ensureStudentSchoolColumn() in
-- aws/lambda/api/src/routes/students.ts carries the same ALTER, so a deploy is
-- enough and this file is here for fresh installs and reference.
-- ============================================================

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS school_name VARCHAR(200);
