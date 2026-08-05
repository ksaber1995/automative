-- =============================================================================
-- 082: link a substitution to the lesson it makes up for
--
-- A student enrolled on Sunday who sits Saturday's lesson of the same course is
-- recorded SUBSTITUTION on the Saturday session. Their own Sunday session has no
-- attendance row, and absence is "no row" — so the two records have to be tied
-- together or the student reads as absent on the day they made the lesson up.
--
-- That tie used to be inferred from (course_id, session_number). Session numbers
-- are handed out per CLASS (MAX+1 within the class), so one extra lesson, one
-- cancellation or a later start date makes sibling classes drift apart and the
-- match silently finds nothing. This replaces it with an explicit id.
--
-- The link is set from both ends (see aws/lambda/api/src/db/substitutions.ts):
--   * make-up sat AFTER the missed lesson  → linked at check-in,
--   * make-up sat BEFORE it (the lesson isn't open yet) → left NULL and claimed
--     when that lesson is created.
--
-- Idempotent: safe to run more than once, and the API applies it at runtime too
-- (ensureSubstitutionLinkSchema).
-- =============================================================================

ALTER TABLE session_attendance
    ADD COLUMN IF NOT EXISTS substitute_for_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_session_attendance_substitute_for
    ON session_attendance(substitute_for_session_id);

-- One missed lesson is covered once: a second make-up by the same student stays
-- unlinked and shows on its own instead of excusing the same absence twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_attendance_substitute_claim
    ON session_attendance(student_id, substitute_for_session_id)
    WHERE substitute_for_session_id IS NOT NULL;

-- Backfill: give every substitution already on record the link it never had.
-- For each one, the lesson of the student's own class that they did NOT attend,
-- nearest in time within a week, preferring one carrying the same session number.
-- Only fills blanks, so re-running changes nothing.
WITH pending AS (
    SELECT sub.id AS attendance_id, sub.student_id, sub.home_class_id,
           ss.start_date, ss.session_number, ss.company_id
    FROM session_attendance sub
    JOIN sessions ss ON ss.id = sub.session_id
    WHERE sub.attendance_type = 'SUBSTITUTION'
      AND sub.substitute_for_session_id IS NULL
      AND sub.home_class_id IS NOT NULL
),
matched AS (
    SELECT p.attendance_id, p.student_id, home.id AS home_session_id,
           (home.session_number IS NOT NULL AND home.session_number = p.session_number) AS exact,
           ABS(EXTRACT(EPOCH FROM (home.start_date - p.start_date))) AS distance
    FROM pending p
    JOIN LATERAL (
        SELECT hs.id, hs.start_date, hs.session_number
        FROM sessions hs
        WHERE hs.class_id = p.home_class_id
          AND hs.company_id = p.company_id
          AND COALESCE(hs.is_free, false) = false
          AND ABS(EXTRACT(EPOCH FROM (hs.start_date - p.start_date))) <= 7 * 86400
          AND NOT EXISTS (
              SELECT 1 FROM session_attendance na
              WHERE na.session_id = hs.id AND na.student_id = p.student_id
                AND na.attendance_type = 'NORMAL'
          )
          -- Skip a lesson another make-up of theirs already covers: two rows
          -- with the same claim would trip the unique index above and abort the
          -- whole backfill.
          AND NOT EXISTS (
              SELECT 1 FROM session_attendance claimed
              WHERE claimed.student_id = p.student_id
                AND claimed.substitute_for_session_id = hs.id
          )
        ORDER BY (hs.session_number IS NOT NULL AND hs.session_number = p.session_number) DESC,
                 ABS(EXTRACT(EPOCH FROM (hs.start_date - p.start_date))) ASC
        LIMIT 1
    ) home ON true
),
winners AS (
    SELECT DISTINCT ON (student_id, home_session_id) attendance_id, home_session_id
    FROM matched
    ORDER BY student_id, home_session_id, exact DESC, distance ASC
)
UPDATE session_attendance sa
   SET substitute_for_session_id = w.home_session_id
  FROM winners w
 WHERE sa.id = w.attendance_id
   AND sa.substitute_for_session_id IS NULL;
