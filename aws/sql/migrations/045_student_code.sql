-- ============================================================
-- Migration 045 – Sequential student codes
-- ============================================================
-- Adds students.student_code — a short, human-friendly sequential number
-- (1, 2, 3, …) assigned PER COMPANY. It lets staff record attendance or
-- payments by typing the number when a student forgets their QR code.
--
-- The number is sequential *within* a company, so every academy starts at 1.
-- Codes therefore repeat across companies; uniqueness is (company_id, code).
--
-- All statements are idempotent.
-- ============================================================

-- 1) Add the column (idempotent).
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_code INTEGER;

-- 2) Backfill existing rows with per-company sequential codes, ordered by
--    enrollment/creation order so the earliest student in each company is #1.
--    (Mirrors the per-course ROW_NUMBER() backfill used for session numbers.)
WITH numbered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY company_id
           ORDER BY created_at ASC, id ASC
         ) AS seq
  FROM students
)
UPDATE students s
SET student_code = n.seq
FROM numbered n
WHERE s.id = n.id
  AND s.student_code IS NULL;

-- 3) One code per company. A NULL code never trips the unique index, so this is
--    safe even before every row is backfilled.
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_company_code
  ON students(company_id, student_code);
