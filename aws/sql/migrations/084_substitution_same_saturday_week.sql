-- =============================================================================
-- 084: a substitution must also fall in the SAME WEEK, and the week opens
--      on SATURDAY
--
-- 083 made the lesson NUMBER the only thing that could link a make-up to the
-- lesson it covers, deliberately with no bound on how far apart the two classes
-- ran it. That is too loose: a lesson 3 sat with a class running a month behind
-- would silently excuse an absence a month old.
--
-- So both tests now apply, and neither replaces the other. The number says WHICH
-- LESSON was taught, which is the thing being made up. The week says the make-up
-- belongs to the same teaching cycle. Sibling classes of one course normally
-- teach the same numbered lesson in the same week, so in ordinary use the two
-- agree; they disagree exactly when the classes have drifted apart, and then no
-- link is the right answer.
--
-- THE WEEK RUNS SATURDAY → FRIDAY. These are Egyptian academies; the teaching
-- week opens on Saturday, and the frontend timetable has always drawn it that
-- way (WEEK_START_DOW = 6). Postgres cannot express it: date_trunc('week', …) is
-- ISO and always lands on Monday, which would put a Saturday lesson in the week
-- BEFORE the Sunday and Tuesday lessons it was taught alongside — the very split
-- this rule exists to prevent. EXTRACT(DOW) numbers Sunday 0 … Saturday 6, so
-- (dow + 1) % 7 is how many days back the opening Saturday sits.
--
-- The timezone is not decoration: start_date is UTC, and an evening lesson in a
-- negative-offset academy has already rolled over to the next UTC day — read in
-- UTC, a Friday lesson would open the following week.
--
-- Idempotent, and the API applies it at runtime too
-- (ensureSubstitutionLinkSchema → unlinkMismatchedSubstitutions + backfill).
-- =============================================================================

-- 1. Cut every link that fails either test: a different lesson number, or the
--    same number taught in a different Saturday-to-Friday week.
UPDATE session_attendance sa
   SET substitute_for_session_id = NULL
  FROM sessions ss, sessions hs
 WHERE ss.id = sa.session_id
   AND hs.id = sa.substitute_for_session_id
   AND sa.attendance_type = 'SUBSTITUTION'
   AND (
       hs.session_number IS DISTINCT FROM ss.session_number
       OR (((hs.start_date) AT TIME ZONE COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ss.company_id), 'UTC'))::date
           - ((EXTRACT(DOW FROM ((hs.start_date) AT TIME ZONE COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ss.company_id), 'UTC')))::int + 1) % 7))
          <>
          (((ss.start_date) AT TIME ZONE COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ss.company_id), 'UTC'))::date
           - ((EXTRACT(DOW FROM ((ss.start_date) AT TIME ZONE COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ss.company_id), 'UTC')))::int + 1) % 7))
   );

-- 2. Re-link what passes both tests: the lesson of the student's own class
--    carrying the same number in the same week, that they did not attend
--    themselves and that no other make-up of theirs already covers. Only fills
--    blanks, so re-running is a no-op.
WITH pending AS (
    SELECT sub.id AS attendance_id, sub.student_id, sub.home_class_id,
           ss.start_date, ss.session_number, ss.company_id,
           COALESCE((SELECT c.timezone FROM companies c WHERE c.id = ss.company_id), 'UTC') AS tz
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
          -- The same lesson, taught in the same Saturday-to-Friday week.
          AND hs.session_number = p.session_number
          AND (((hs.start_date) AT TIME ZONE p.tz)::date
               - ((EXTRACT(DOW FROM ((hs.start_date) AT TIME ZONE p.tz))::int + 1) % 7))
              =
              (((p.start_date) AT TIME ZONE p.tz)::date
               - ((EXTRACT(DOW FROM ((p.start_date) AT TIME ZONE p.tz))::int + 1) % 7))
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
        -- Only a class that ran the same numbered lesson twice in one week
        -- reaches this; take the nearer one.
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
