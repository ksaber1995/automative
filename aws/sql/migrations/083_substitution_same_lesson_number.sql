-- =============================================================================
-- 083: a substitution stands in for the SAME numbered lesson, nothing else
--
-- Migration 082 linked a make-up to the lesson it covers in one of two ways:
-- the same `session_number`, or — failing that — any lesson of the student's own
-- class within a week of it. The second rule is wrong, and quietly so.
--
-- A class meeting Saturday and Tuesday runs lesson 1 on Saturday and lesson 3 on
-- the Saturday after: exactly seven days apart. So a student who sat lesson 1
-- with a sibling class had that make-up handed to lesson 3, and lesson 3 read
-- back as "made up elsewhere" on the morning it was taught — before the student
-- had so much as walked in. Nearness in the calendar says nothing about which
-- lesson was taught; only the number does. (And the teaching week here starts on
-- Saturday, so no week-boundary rule would have saved the date match either.)
--
-- From now on the two sessions must carry the same `session_number`. A make-up
-- whose numbered lesson does not exist on the student's own timetable stays
-- unlinked, which is honest: it covers no absence and is listed in its own right.
--
-- This drops the links the old rule made across different lesson numbers, then
-- re-offers those rows their own numbered lesson. Idempotent, and the API
-- applies it at runtime too (ensureSubstitutionLinkSchema).
-- =============================================================================

-- 1. Cut every link between two different lesson numbers.
UPDATE session_attendance sa
   SET substitute_for_session_id = NULL
  FROM sessions ss, sessions hs
 WHERE ss.id = sa.session_id
   AND hs.id = sa.substitute_for_session_id
   AND sa.attendance_type = 'SUBSTITUTION'
   AND hs.session_number IS DISTINCT FROM ss.session_number;

-- 2. Re-link what can be linked: the lesson of the student's own class carrying
--    the same number, that they did not attend themselves and that no other
--    make-up of theirs already covers. Only fills blanks, so re-running is a
--    no-op.
WITH pending AS (
    SELECT sub.id AS attendance_id, sub.student_id, sub.home_class_id,
           ss.start_date, ss.session_number, ss.company_id
    FROM session_attendance sub
    JOIN sessions ss ON ss.id = sub.session_id
    WHERE sub.attendance_type = 'SUBSTITUTION'
      AND sub.substitute_for_session_id IS NULL
      AND sub.home_class_id IS NOT NULL
      -- An unnumbered make-up names no lesson, so it can stand in for none.
      AND ss.session_number IS NOT NULL
),
matched AS (
    SELECT p.attendance_id, p.student_id, home.id AS home_session_id,
           ABS(EXTRACT(EPOCH FROM (home.start_date - p.start_date))) AS distance
    FROM pending p
    JOIN LATERAL (
        SELECT hs.id, hs.start_date
        FROM sessions hs
        WHERE hs.class_id = p.home_class_id
          AND hs.company_id = p.company_id
          AND COALESCE(hs.is_free, false) = false
          -- The same lesson, and only the same lesson, however far apart the two
          -- classes happened to run it.
          AND hs.session_number = p.session_number
          AND NOT EXISTS (
              SELECT 1 FROM session_attendance na
              WHERE na.session_id = hs.id AND na.student_id = p.student_id
                AND na.attendance_type = 'NORMAL'
          )
          -- Skip a lesson another make-up of theirs already covers: two rows with
          -- the same claim would trip 082's unique index and abort the statement.
          AND NOT EXISTS (
              SELECT 1 FROM session_attendance claimed
              WHERE claimed.student_id = p.student_id
                AND claimed.substitute_for_session_id = hs.id
          )
        -- Only a class that ran the same numbered lesson twice reaches this;
        -- take the nearer one.
        ORDER BY ABS(EXTRACT(EPOCH FROM (hs.start_date - p.start_date))) ASC
        LIMIT 1
    ) home ON true
),
winners AS (
    SELECT DISTINCT ON (student_id, home_session_id) attendance_id, home_session_id
    FROM matched
    ORDER BY student_id, home_session_id, distance ASC
)
UPDATE session_attendance sa
   SET substitute_for_session_id = w.home_session_id
  FROM winners w
 WHERE sa.id = w.attendance_id
   AND sa.substitute_for_session_id IS NULL;
