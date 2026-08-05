import { query, queryOne } from './connection';

/**
 * Substitution ↔ missed-lesson linking.
 *
 * A student enrolled on the Sunday class who turns up to the Saturday class of
 * the same course is marked SUBSTITUTION on the Saturday session. Their own
 * Sunday session has no attendance row, and absence is "no row" — so without
 * something tying the two together the student reads as absent on the very day
 * they made the lesson up.
 *
 * That tie used to be inferred: same course + same `session_number`. But session
 * numbers are handed out per CLASS (MAX+1 within the class), so the moment one
 * class holds an extra lesson, cancels one, or simply starts a week earlier, the
 * numbers drift and the match quietly stops finding anything. Hence an explicit
 * id: `session_attendance.substitute_for_session_id` points at the home-class
 * session the substitution stands in for.
 *
 * The link is made from both ends, because a make-up can happen either way round:
 *   - attended AFTER the missed lesson — the home session already exists, so the
 *     check-in links it straight away (linkSubstitution).
 *   - attended BEFORE it — Saturday's lesson taken instead of Sunday's, which has
 *     not been opened yet. The substitution stays pending until the home session
 *     is created, and claimPendingSubstitutions attaches it then.
 *
 * Reads keep the old number-matching as a fallback so attendance recorded before
 * this existed still displays correctly.
 */

/**
 * How far a substitution may reach to cover a lesson of the student's own class.
 *
 * A week. The pairing that actually happens is "I took Sunday's lesson on
 * Saturday" (or Saturday's on Sunday) within the same week; a wider window would
 * let one make-up quietly excuse an absence from a month ago.
 */
export const SUBSTITUTION_WINDOW_DAYS = 7;

let substitutionLinkInitPromise: Promise<void> | null = null;

/**
 * Idempotent DDL for the link column, applied at runtime the same way the rest
 * of the attendance schema is (migration 082).
 *
 * `sessions.is_free` is (re)asserted here rather than imported from the sessions
 * route: every query below excludes free sessions, and reaching into routes/ from
 * db/ would make the import graph circular for one ALTER that is a no-op anyway.
 */
export async function ensureSubstitutionLinkSchema(): Promise<void> {
  if (!substitutionLinkInitPromise) {
    substitutionLinkInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE`);
        await query(
          `ALTER TABLE session_attendance
             ADD COLUMN IF NOT EXISTS substitute_for_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL`
        );
        await query(
          `CREATE INDEX IF NOT EXISTS idx_session_attendance_substitute_for
             ON session_attendance(substitute_for_session_id)`
        );
        // One missed lesson is covered once: two make-ups by the same student
        // cannot both claim the same home session (the second stays pending and
        // shows on its own).
        await query(
          `CREATE UNIQUE INDEX IF NOT EXISTS uq_session_attendance_substitute_claim
             ON session_attendance(student_id, substitute_for_session_id)
           WHERE substitute_for_session_id IS NOT NULL`
        );
        await backfillSubstitutionLinks();
      } catch (e) {
        substitutionLinkInitPromise = null;
        throw e;
      }
    })();
  }
  return substitutionLinkInitPromise;
}

/**
 * Give every already-recorded substitution the link it was missing.
 *
 * Only fills blanks, so it is a no-op once done and safe to run repeatedly (and
 * concurrently, from two Lambda containers). DISTINCT ON keeps one substitution
 * per (student, home session) — the unique index would reject the rest anyway.
 */
async function backfillSubstitutionLinks(): Promise<void> {
  await query(
    `WITH pending AS (
       SELECT sub.id AS attendance_id, sub.student_id, ss.start_date, ss.session_number, ss.company_id,
              sub.home_class_id
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
           AND ABS(EXTRACT(EPOCH FROM (hs.start_date - p.start_date))) <= ${SUBSTITUTION_WINDOW_DAYS} * 86400
           AND NOT EXISTS (
             SELECT 1 FROM session_attendance na
             WHERE na.session_id = hs.id AND na.student_id = p.student_id
               AND na.attendance_type = 'NORMAL'
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
        AND sa.substitute_for_session_id IS NULL`
  );
}

/**
 * Attach one substitution row to the home-class session it makes up for.
 *
 * Picks the session of the student's own class that they did NOT attend, nearest
 * in time to the make-up and inside the window — preferring one that carries the
 * same session number, which is the strongest statement that it is "the same
 * lesson". Returns the session it linked to, or null when there is nothing to
 * link yet (the home lesson has not been opened — the pending case).
 */
export async function linkSubstitution(companyId: string, attendanceId: string): Promise<string | null> {
  await ensureSubstitutionLinkSchema();

  const sub = await queryOne<any>(
    `SELECT sa.id, sa.student_id, sa.home_class_id, ss.id AS sub_session_id,
            ss.start_date, ss.session_number
       FROM session_attendance sa
       JOIN sessions ss ON ss.id = sa.session_id
      WHERE sa.id = $1 AND ss.company_id = $2 AND sa.attendance_type = 'SUBSTITUTION'`,
    [attendanceId, companyId]
  );
  if (!sub || !sub.home_class_id) return null;

  const home = await queryOne<any>(
    `SELECT hs.id
       FROM sessions hs
      WHERE hs.class_id = $1
        AND hs.company_id = $2
        AND hs.id <> $3
        AND COALESCE(hs.is_free, false) = false
        AND ABS(EXTRACT(EPOCH FROM (hs.start_date - $4::timestamptz))) <= $5 * 86400
        AND NOT EXISTS (
          SELECT 1 FROM session_attendance na
          WHERE na.session_id = hs.id AND na.student_id = $6 AND na.attendance_type = 'NORMAL'
        )
        AND NOT EXISTS (
          SELECT 1 FROM session_attendance claimed
          WHERE claimed.student_id = $6 AND claimed.substitute_for_session_id = hs.id
            AND claimed.id <> $7
        )
      ORDER BY (hs.session_number IS NOT NULL AND hs.session_number = $8::int) DESC,
               ABS(EXTRACT(EPOCH FROM (hs.start_date - $4::timestamptz))) ASC
      LIMIT 1`,
    [sub.home_class_id, companyId, sub.sub_session_id, sub.start_date, SUBSTITUTION_WINDOW_DAYS,
     sub.student_id, sub.id, sub.session_number ?? null]
  );
  if (!home) return null;

  await query(
    `UPDATE session_attendance SET substitute_for_session_id = $1 WHERE id = $2`,
    [home.id, attendanceId]
  );
  return home.id as string;
}

/**
 * The other direction: a session has just been created for a class, so any
 * make-up taken in advance of it can now say what it was making up for.
 *
 * This is the "I attended Saturday for Sunday's lesson" case — at check-in time
 * there was no Sunday session to point at. Returns how many pending
 * substitutions were attached.
 */
export async function claimPendingSubstitutions(companyId: string, sessionId: string): Promise<number> {
  await ensureSubstitutionLinkSchema();

  const rows = await query<any>(
    `WITH target AS (
       SELECT s.id, s.class_id, s.start_date, s.session_number
       FROM sessions s
       WHERE s.id = $1 AND s.company_id = $2 AND COALESCE(s.is_free, false) = false
     ),
     pending AS (
       SELECT DISTINCT ON (sub.student_id) sub.id AS attendance_id
       FROM session_attendance sub
       JOIN sessions ss ON ss.id = sub.session_id
       CROSS JOIN target t
       WHERE sub.attendance_type = 'SUBSTITUTION'
         AND sub.substitute_for_session_id IS NULL
         AND sub.home_class_id = t.class_id
         AND ss.company_id = $2
         AND ss.id <> t.id
         AND ABS(EXTRACT(EPOCH FROM (ss.start_date - t.start_date))) <= $3 * 86400
         AND NOT EXISTS (
           SELECT 1 FROM session_attendance na
           WHERE na.session_id = t.id AND na.student_id = sub.student_id
             AND na.attendance_type = 'NORMAL'
         )
         AND NOT EXISTS (
           SELECT 1 FROM session_attendance claimed
           WHERE claimed.student_id = sub.student_id AND claimed.substitute_for_session_id = t.id
         )
       ORDER BY sub.student_id,
                (ss.session_number IS NOT NULL AND ss.session_number = t.session_number) DESC,
                ABS(EXTRACT(EPOCH FROM (ss.start_date - t.start_date))) ASC
     )
     UPDATE session_attendance sa
        SET substitute_for_session_id = (SELECT id FROM target)
       FROM pending p
      WHERE sa.id = p.attendance_id
      RETURNING sa.id`,
    [sessionId, companyId, SUBSTITUTION_WINDOW_DAYS]
  );
  return rows.length;
}

/**
 * The student turned up to their own lesson after all, so the make-up that was
 * covering it is covering nothing. Release those claims and let each one look
 * for another missed lesson — a substitution with nowhere to point still shows
 * on the student's page in its own right.
 */
export async function releaseSubstitutionClaims(
  companyId: string,
  sessionId: string,
  studentIds: string[]
): Promise<void> {
  if (studentIds.length === 0) return;
  await ensureSubstitutionLinkSchema();

  const released = await query<any>(
    `UPDATE session_attendance sa
        SET substitute_for_session_id = NULL
       FROM sessions ss
      WHERE sa.session_id = ss.id
        AND ss.company_id = $1
        AND sa.substitute_for_session_id = $2
        AND sa.student_id = ANY($3::uuid[])
      RETURNING sa.id`,
    [companyId, sessionId, studentIds]
  );
  for (const row of released) {
    await linkSubstitution(companyId, row.id);
  }
}

// ── Read-side SQL ────────────────────────────────────────────────────────────

interface SubstitutionMatchExprs {
  /** SQL expression for the student id to match. */
  student: string;
  /** SQL expression for the home session's id. */
  sessionId: string;
  /** SQL expression for the home session's course id. */
  courseId: string;
  /** SQL expression for the home session's session_number. */
  sessionNumber: string;
}

/**
 * Where-clause shared by every "was this absence actually made up?" read.
 *
 * The explicit link is authoritative. The legacy (same course, same session
 * number) rule is kept for substitutions recorded before the link column, and is
 * applied ONLY to still-unlinked rows so a make-up that points at Sunday cannot
 * also excuse some other class's lesson that happens to share a number.
 */
function coversClause(e: SubstitutionMatchExprs): string {
  return `sub.attendance_type = 'SUBSTITUTION'
      AND sub.student_id = ${e.student}
      AND (
        sub.substitute_for_session_id = ${e.sessionId}
        OR (
          sub.substitute_for_session_id IS NULL
          AND sub_class.course_id = ${e.courseId}
          AND ${e.sessionNumber} IS NOT NULL
          AND sub_session.session_number = ${e.sessionNumber}
        )
      )`;
}

/** `EXISTS (…)` — did a substitution cover this session for this student? */
export function substitutionCoversExists(e: SubstitutionMatchExprs): string {
  return `EXISTS (
    SELECT 1
    FROM session_attendance sub
    JOIN sessions sub_session ON sub_session.id = sub.session_id
    JOIN classes sub_class ON sub_class.id = sub_session.class_id
    WHERE ${coversClause(e)}
  )`;
}

/**
 * Body of a LATERAL that names the make-up covering this session: which class it
 * was taken in, when it was, and when the student was marked in. A linked row
 * wins over a legacy number match when both somehow apply.
 */
export function substitutionCoversLateral(e: SubstitutionMatchExprs): string {
  return `SELECT sub_class.name AS sub_class_name,
                 sub_session.id AS sub_session_id,
                 sub_session.start_date AS sub_session_date,
                 sub.created_at AS sub_checked_in_at
          FROM session_attendance sub
          JOIN sessions sub_session ON sub_session.id = sub.session_id
          JOIN classes sub_class ON sub_class.id = sub_session.class_id
          WHERE ${coversClause(e)}
          ORDER BY (sub.substitute_for_session_id IS NOT NULL) DESC, sub_session.start_date ASC
          LIMIT 1`;
}

/**
 * `NOT EXISTS (…)` for the reverse question, asked of a substitution row aliased
 * `sub` with its session `sub_session` and class `sub_class`: is this make-up
 * covering nothing the student's own classes can display? Those are the ones the
 * student page has to list on their own, or a make-up taken before its lesson
 * was opened would be invisible.
 */
export function substitutionIsOrphanClause(studentExpr: string, companyExpr: string): string {
  return `sub.substitute_for_session_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sessions home_s
        JOIN classes home_c ON home_c.id = home_s.class_id
        WHERE home_c.course_id = sub_class.course_id
          AND home_s.session_number = sub_session.session_number
          AND sub_session.session_number IS NOT NULL
          AND home_s.class_id IN (
            SELECT class_id FROM enrollments
            WHERE student_id = ${studentExpr} AND company_id = ${companyExpr}
              AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT class_id FROM master_class_enrollments
            WHERE student_id = ${studentExpr} AND company_id = ${companyExpr}
              AND status != 'DROPPED'
          )
      )`;
}
