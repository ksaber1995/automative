-- ============================================================
-- Migration 029 – Student QR tokens
-- ============================================================
-- Run this file against the target database (dev or prod) via
-- the RDS Query Editor, psql, or any SQL client.
--
-- What this migration does:
--   1. Adds students.qr_token — a random, unguessable token encoded into
--      each student's QR code. Used for (a) public read-only profile pages
--      and (b) QR-based attendance check-in. NOT the student UUID, so the
--      unauthenticated profile page can't be enumerated, and a leaked code
--      can be rotated without touching the student record.
--   2. Backfills existing students with a random 32-char hex token.
--   3. Adds a UNIQUE index so a token resolves to exactly one student.
--
-- All statements are idempotent.
-- ============================================================

-- 1) Add the column (idempotent)
ALTER TABLE students ADD COLUMN IF NOT EXISTS qr_token VARCHAR(32);

-- 2) Backfill existing rows with a random token (uuid-ossp is already enabled
--    in this schema; strip dashes to get a 32-char hex string).
UPDATE students
SET qr_token = REPLACE(uuid_generate_v4()::text, '-', '')
WHERE qr_token IS NULL;

-- 3) Enforce uniqueness so a scanned token maps to a single student.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_qr_token ON students(qr_token);
