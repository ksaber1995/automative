-- 041_student_qr_activation.sql
-- Paid QR activation for TEACHER-type companies.
--
-- Academies keep free QR (these columns stay at their defaults). For teachers,
-- the QR only works once activated: 1 year (25 EGP) or lifelong (40 EGP).
--   qr_activated  : has the QR been paid-activated
--   qr_expiration : NULL = lifelong (when activated) or not-yet-activated; a date = 1-year plan expiry
--   qr_price      : amount billed for this activation (25 or 40)
--   qr_paid       : owner toggles true once the teacher settles the bill
-- Idempotent — safe to re-run.

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS qr_activated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_expiration DATE,
  ADD COLUMN IF NOT EXISTS qr_price DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS qr_paid BOOLEAN DEFAULT false;

-- Backfill any pre-existing rows so the booleans are never NULL.
UPDATE students SET qr_activated = false WHERE qr_activated IS NULL;
UPDATE students SET qr_paid = false WHERE qr_paid IS NULL;
