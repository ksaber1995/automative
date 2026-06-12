-- ============================================================
-- Migration 030 – Attendance Magic: session numbers & substitution
-- ============================================================
-- Run this file against the target database (dev or prod) via the RDS Query
-- Editor, psql, or any SQL client. All statements are idempotent.
--
-- What this migration does:
--   1. sessions.session_number — a per-Course sequence number (1, 2, 3 …).
--      Session number N is conceptually "the same session" across every class
--      of a course, which is what makes substitution possible.
--   2. session_attendance.attendance_type — NORMAL (enrolled student attended
--      their own class) or SUBSTITUTION (student attended a sibling class of the
--      same course they're not enrolled in).
--   3. session_attendance.home_class_id — for a SUBSTITUTION row, the student's
--      own enrolled class the attendance substitutes for (display only).
--   4. Backfills session_number for existing sessions, numbered per course in
--      chronological order.
-- ============================================================

-- 1) Session number on sessions
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_number INTEGER;
CREATE INDEX IF NOT EXISTS idx_sessions_session_number ON sessions(session_number);

-- 2) Substitution columns on session_attendance
ALTER TABLE session_attendance
  ADD COLUMN IF NOT EXISTS attendance_type VARCHAR(16) NOT NULL DEFAULT 'NORMAL'
    CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION'));

ALTER TABLE session_attendance
  ADD COLUMN IF NOT EXISTS home_class_id UUID REFERENCES classes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_attendance_home_class ON session_attendance(home_class_id);

-- 3) Backfill session_number per course, ordered chronologically. Sessions of
--    every class in a course share one running sequence.
WITH numbered AS (
  SELECT s.id,
         ROW_NUMBER() OVER (PARTITION BY c.course_id
                            ORDER BY s.start_date, s.created_at) AS rn
  FROM sessions s
  JOIN classes c ON c.id = s.class_id
)
UPDATE sessions s
SET session_number = n.rn
FROM numbered n
WHERE n.id = s.id AND s.session_number IS NULL;
