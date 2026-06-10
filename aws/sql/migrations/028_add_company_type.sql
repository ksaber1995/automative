-- ============================================================
-- Migration 028 – Add companies.type
-- ============================================================
-- Run this file against the target database (dev or prod) via
-- the RDS Query Editor, psql, or any SQL client.
--
-- What this migration does:
--   1. Adds companies.type (e.g. ACADEMY)
--   2. Backfills existing rows to 'ACADEMY'
--   3. Sets DEFAULT 'ACADEMY' and NOT NULL so future inserts always have a value
--
-- All statements are idempotent.
-- ============================================================

-- 1) Add the column (idempotent)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS type VARCHAR(20);

-- 2) Backfill existing rows before enforcing NOT NULL
UPDATE companies SET type = 'ACADEMY' WHERE type IS NULL;

-- 3) Default + NOT NULL so future inserts always have a value
ALTER TABLE companies ALTER COLUMN type SET DEFAULT 'ACADEMY';
ALTER TABLE companies ALTER COLUMN type SET NOT NULL;
