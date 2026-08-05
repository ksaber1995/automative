import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { notifySessionAttendance } from './telegram';
import { ensureAutoManageSessionsColumn } from './companies';
import { chargeAbsencesAtSessionEnd } from './session-payments';
import { ensureClassDayTimesSchema } from './classes';
import { claimPendingSubstitutions } from '../db/substitutions';

let sessionSchemaInitPromise: Promise<void> | null = null;
async function ensureSessionRoomNullable(): Promise<void> {
  if (!sessionSchemaInitPromise) {
    sessionSchemaInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ALTER COLUMN room_id DROP NOT NULL`);
      } catch (e) {
        sessionSchemaInitPromise = null;
        throw e;
      }
    })();
  }
  return sessionSchemaInitPromise;
}

// Attendance Magic (migration 030): session numbers + substitution columns.
// Applied idempotently at runtime so the feature works even before the SQL
// migration is run against the target DB.
let attendanceMagicInitPromise: Promise<void> | null = null;
export async function ensureAttendanceMagicColumns(): Promise<void> {
  if (!attendanceMagicInitPromise) {
    attendanceMagicInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_number INTEGER`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sessions_session_number ON sessions(session_number)`);
        await query(
          `ALTER TABLE session_attendance ADD COLUMN IF NOT EXISTS attendance_type VARCHAR(16) NOT NULL DEFAULT 'NORMAL'`
        );
        await query(
          `ALTER TABLE session_attendance ADD COLUMN IF NOT EXISTS home_class_id UUID REFERENCES classes(id) ON DELETE SET NULL`
        );
        await query(
          `CREATE INDEX IF NOT EXISTS idx_session_attendance_home_class ON session_attendance(home_class_id)`
        );
        // One-time backfill: number existing sessions per course chronologically.
        // Idempotent — only touches rows that don't have a number yet, so it's a
        // no-op once done (and safe if two containers run it concurrently).
        await query(
          `WITH numbered AS (
             SELECT s.id,
                    ROW_NUMBER() OVER (PARTITION BY c.course_id
                                       ORDER BY s.start_date, s.created_at) AS rn
             FROM sessions s
             JOIN classes c ON c.id = s.class_id
           )
           UPDATE sessions s
           SET session_number = n.rn
           FROM numbered n
           WHERE n.id = s.id AND s.session_number IS NULL`
        );
      } catch (e) {
        attendanceMagicInitPromise = null;
        throw e;
      }
    })();
  }
  return attendanceMagicInitPromise;
}

// Ensure 'started' column exists (migration 043).
let startedColumnInitPromise: Promise<void> | null = null;
async function ensureStartedColumn(): Promise<void> {
  if (!startedColumnInitPromise) {
    startedColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS started BOOLEAN NOT NULL DEFAULT TRUE`);
      } catch (e) {
        startedColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return startedColumnInitPromise;
}

/**
 * Ensure 'auto_started' exists (migration 064).
 *
 * Marks a session as the AUTOMATION's to close. Without it the auto-end swept up
 * every running session whose class's scheduled end time had passed — including a
 * make-up lesson on an unscheduled day, or a session started after a schedule
 * change — and killed it within one poll (5 minutes), mid-lesson.
 */
let autoStartedColumnInitPromise: Promise<void> | null = null;
async function ensureAutoStartedColumn(): Promise<void> {
  if (!autoStartedColumnInitPromise) {
    autoStartedColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auto_started BOOLEAN NOT NULL DEFAULT FALSE`);
      } catch (e) {
        autoStartedColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return autoStartedColumnInitPromise;
}

/**
 * Ensure 'is_free' and the widened attendance_type CHECK exist (migration 071).
 *
 * A free session bills nobody and admits any active student, enrolled or not.
 * Exported because attendance.ts reads sessions.is_free on every QR check-in.
 */
let freeSessionInitPromise: Promise<void> | null = null;
export async function ensureFreeSessionSchema(): Promise<void> {
  if (!freeSessionInitPromise) {
    freeSessionInitPromise = (async () => {
      try {
        await query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE`);
        await query(`ALTER TABLE session_attendance DROP CONSTRAINT IF EXISTS session_attendance_attendance_type_check`);
        await query(
          `ALTER TABLE session_attendance ADD CONSTRAINT session_attendance_attendance_type_check
           CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION', 'TRIAL'))`
        );
        await query(`CREATE INDEX IF NOT EXISTS idx_sessions_class_is_free ON sessions(class_id, is_free)`);
      } catch (e) {
        freeSessionInitPromise = null;
        throw e;
      }
    })();
  }
  return freeSessionInitPromise;
}

/**
 * How long a running session is allowed to overrun its scheduled end before the
 * automation closes it. A lesson that runs a few minutes over is normal, and
 * attendance scanned during the overrun must still land on the right session.
 */
const AUTO_END_GRACE_MINUTES = 15;

/**
 * Stamped on a session the automation had to close with nobody on record — its
 * class has no instructor assigned, so there is no teacher it could mark present.
 * Better a closed session that says why it has no teacher than one left running.
 */
const AUTO_END_NO_TEACHER_NOTE = 'Auto-closed with no teacher on record: neither the class nor its course has an instructor assigned.';

/** Stamped when a session is ended by hand and nobody could be credited for it. */
const END_NO_TEACHER_NOTE = 'Ended with no teacher on record: neither the class nor its course has an instructor assigned.';

/**
 * Closed after its own day, so its end time is the schedule's, not the clock's —
 * worth saying out loud, or a lesson closed three days late looks like one
 * somebody actually sat through.
 */
const AUTO_END_LATE_NOTE = 'Auto-closed after the fact; stamped with the lesson\'s scheduled end time.';

/** Closed by the backstop below: no schedule row matched the day it started on. */
const AUTO_END_BACKSTOP_NOTE = 'Auto-closed by the stale-session backstop: no timetable entry matched the day it started, so the class\'s usual lesson length was used.';

/**
 * How long an automation-owned session may stay open when its schedule cannot be
 * resolved at all (the class timetable changed after the session opened). Without
 * a bound, such a session is invisible to every rule above and never closes.
 */
const AUTO_END_MAX_OPEN_HOURS = 24;

/**
 * Who a session is credited to by default: the class's own instructor, falling
 * back to the instructor on its course.
 *
 * Most classes are created without an instructor of their own (12 of 13 in one
 * live tenant), which left the session with no teacher on record — and an
 * academy cannot end a teacher-less session, so it stayed open for ever. The
 * course's instructor is the person who actually teaches those classes, so it
 * is the right fallback.
 *
 * NOTE: a PRESENT row is also what accrues per-session teacher pay
 * (expenses.ts getUnpaidSessionIds), so crediting the course instructor here
 * means they are owed for the session too. That is the intended meaning of
 * "this teacher taught it" — but it is a financial side effect, not just a
 * display one.
 */
async function resolveDefaultInstructorId(classId: string): Promise<string | null> {
  const row = await queryOne<any>(
    `SELECT COALESCE(c.instructor_id, co.instructor_id) AS instructor_id
       FROM classes c JOIN courses co ON co.id = c.course_id
      WHERE c.id = $1`,
    [classId],
  );
  return row?.instructor_id || null;
}

/** Mark a teacher PRESENT for a session, promoting an existing row if needed. */
async function markTeacherPresent(sessionId: string, employeeId: string): Promise<void> {
  await query(
    `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
     VALUES ($1, $2, 'PRIMARY', 'PRESENT', NULL)
     ON CONFLICT (session_id, employee_id) DO UPDATE SET status = 'PRESENT'`,
    [sessionId, employeeId],
  );
}

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Weekday name (UPPER) for a YYYY-MM-DD local date — matches classes.days_of_week. */
function dayNameForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * A prepared (started=false) session from a previous calendar day. Its class
 * meeting is over — promoting it would attach a new session to an old date, so
 * callers close it instead. UTC day comparison; a few hours of timezone skew
 * around midnight is acceptable for a staleness check.
 */
function isStalePrepared(prepared: { start_date: string | Date }): boolean {
  const startDay = new Date(prepared.start_date).toISOString().split('T')[0];
  const today = new Date().toISOString().split('T')[0];
  return startDay < today;
}

/** Shape a checkin-target row into the response (mirrors ActiveSessionInfo + `upcoming`). */
function mapCheckinTarget(row: any, upcoming: boolean) {
  return {
    sessionId: row.id,
    classId: row.class_id,
    className: row.class_name,
    courseName: row.course_name,
    roomCode: row.room_code ?? null,
    sessionNumber: row.session_number === null || row.session_number === undefined
      ? null
      : parseInt(row.session_number, 10),
    upcoming,
  };
}

function mapSessionFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    roomId: row.room_id,
    classId: row.class_id,
    sessionNumber: row.session_number === null || row.session_number === undefined
      ? null
      : parseInt(row.session_number, 10),
    startDate: row.start_date,
    endDate: row.end_date,
    started: row.started !== false,
    isFree: row.is_free === true,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionWithDetailsFromDB(row: any) {
  const start = row.start_date ? new Date(row.start_date) : null;
  const end = row.end_date ? new Date(row.end_date) : null;
  const durationMinutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;

  return {
    ...mapSessionFromDB(row),
    roomCode: row.room_code,
    roomDescription: row.room_description,
    className: row.class_name,
    courseName: row.course_name,
    branchName: row.branch_name,
    durationMinutes,
    studentPresent: row.student_present === null || row.student_present === undefined ? null : !!row.student_present,
    presentCount: row.present_count === null || row.present_count === undefined ? null : parseInt(row.present_count, 10),
  };
}

export const sessionsRoutes = {
  start: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureSessionRoomNullable();
      await ensureAttendanceMagicColumns();
      await ensureStartedColumn();
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // Verify class exists and belongs to company (branch/company come from the linked course)
      const cls = await queryOne<any>(
        `SELECT c.*, co.company_id, co.branch_id, comp.type AS company_type,
                COALESCE(c.instructor_id, co.instructor_id) AS default_instructor_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         INNER JOIN companies comp ON comp.id = co.company_id
         WHERE c.id = $1 AND co.company_id = $2`,
        [body.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (cls.is_finished) {
        return apiError(400, 'ERRORS.SESSIONS.CLASS_FINISHED', 'This class is finished. Sessions cannot be started.');
      }

      const isTeacherCompany = cls.company_type === 'TEACHER';
      const isOnlineClass = typeof cls.type === 'string' && cls.type.toUpperCase() === 'ONLINE';
      const isFree = body.isFree === true;

      // If a prepared (started=false) session already exists for this class,
      // just mark it as started and update with any provided room/notes/teachers.
      let prepared = await queryOne<any>(
        `SELECT * FROM sessions WHERE class_id = $1 AND company_id = $2 AND end_date IS NULL AND started = false`,
        [body.classId, context.companyId]
      );
      // A prepared session left over from a PREVIOUS day is stale — promoting it
      // would graft today's session onto an old date (and old attendance). Close
      // it quietly (it keeps any attendance history) and start fresh below.
      if (prepared && isStalePrepared(prepared)) {
        await update('sessions', prepared.id, { end_date: prepared.start_date });
        prepared = null;
      }
      if (prepared) {
        const updateFields: any = { started: true };
        // Starting it as free is an explicit choice made now — it must survive
        // adoption of a session that was prepared (by pre-attendance or the
        // automation) before anyone decided this lesson would be a trial.
        if (isFree) updateFields.is_free = true;
        if (body.roomId) updateFields.room_id = body.roomId;
        if (body.notes) updateFields.notes = body.notes;
        if (body.sessionNumber !== undefined && body.sessionNumber !== null && body.sessionNumber !== '') {
          updateFields.session_number = parseInt(body.sessionNumber, 10);
        }
        const session = await update('sessions', prepared.id, updateFields);

        // Teacher attendance for the formally-started session. With no explicit
        // list, the default teacher (class's instructor, else the course's) is
        // marked present — so the session always has someone on record and can
        // be ended later.
        const teachers: Array<{ employeeId: string; role?: string; status?: string; notes?: string }> =
          Array.isArray(body.teachers) ? body.teachers : [];
        if (teachers.length === 0 && cls.default_instructor_id) {
          teachers.push({ employeeId: cls.default_instructor_id, role: 'PRIMARY', status: 'PRESENT' });
        }
        for (const t of teachers) {
          if (!t.employeeId) continue;
          await query(
            `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (session_id, employee_id) DO NOTHING`,
            [session.id, t.employeeId, t.role || 'PRIMARY', t.status || 'PRESENT', t.notes || null]
          );
        }

        return { status: 201 as const, body: mapSessionFromDB(session) };
      }

      // Verify room only if provided (online classes & teacher companies don't require a room)
      let room: any = null;
      if (body.roomId) {
        room = await queryOne(
          'SELECT * FROM rooms WHERE id = $1 AND company_id = $2 AND is_active = true',
          [body.roomId, context.companyId]
        );
        if (!room) {
          return apiError(404, 'ERRORS.SESSIONS.ROOM_NOT_FOUND', 'Room not found or inactive');
        }

        // Check if room is already occupied
        const activeSession = await queryOne(
          'SELECT id FROM sessions WHERE room_id = $1 AND end_date IS NULL',
          [body.roomId]
        );
        if (activeSession) {
          return apiError(400, 'ERRORS.SESSIONS.ROOM_OCCUPIED', 'Room is already occupied. End the current session first.');
        }
      } else if (!isOnlineClass && !isTeacherCompany) {
        return apiError(400, 'ERRORS.SESSIONS.ROOM_REQUIRED', 'Room is required for offline classes.');
      }

      // Check if class already has an active session
      const classActiveSession = await queryOne(
        'SELECT id FROM sessions WHERE class_id = $1 AND end_date IS NULL',
        [body.classId]
      );
      if (classActiveSession) {
        return apiError(400, 'ERRORS.SESSIONS.CLASS_HAS_ACTIVE', 'This class already has an active session running.');
      }

      // Session number: auto = MAX(session_number)+1 for THIS class only, so each
      // class keeps its own 1,2,3,… sequence independent of sibling classes in the
      // same course. The teacher may override it (and may reuse a number on purpose).
      let sessionNumber: number;
      if (body.sessionNumber !== undefined && body.sessionNumber !== null && body.sessionNumber !== '') {
        sessionNumber = parseInt(body.sessionNumber, 10);
        if (!Number.isFinite(sessionNumber) || sessionNumber < 1) {
          return apiError(400, 'ERRORS.SESSIONS.INVALID_SESSION_NUMBER', 'Session number must be a positive integer');
        }
      } else {
        const nextRow = await queryOne<any>(
          `SELECT COALESCE(MAX(session_number), 0) + 1 AS next
           FROM sessions
           WHERE class_id = $1`,
          [body.classId]
        );
        sessionNumber = parseInt(nextRow?.next ?? '1', 10);
      }

      const session = await insert('sessions', {
        company_id: context.companyId,
        branch_id: body.branchId || room?.branch_id || cls.branch_id,
        room_id: body.roomId || null,
        class_id: body.classId,
        session_number: sessionNumber,
        start_date: new Date().toISOString(),
        end_date: null,
        started: true,
        is_free: isFree,
        notes: body.notes || null,
      });

      // A student who took this lesson early, in a sibling class, has been
      // waiting for it to exist — attach their make-up to it now. Best-effort:
      // starting the lesson must not fail over attendance bookkeeping.
      try {
        await claimPendingSubstitutions(context.companyId, session.id);
      } catch (subErr) {
        console.error('Substitution claim (start) error:', subErr);
      }

      // Teacher attendance — optional. If the caller provided an explicit list,
      // use it verbatim. Otherwise the default teacher (the class's instructor,
      // else the course's) is marked PRIMARY/PRESENT, so no session is left
      // without a teacher on record.
      const teachers: Array<{ employeeId: string; role?: string; status?: string; notes?: string }> =
        Array.isArray(body.teachers) ? body.teachers : [];

      if (teachers.length === 0 && cls.default_instructor_id) {
        teachers.push({ employeeId: cls.default_instructor_id, role: 'PRIMARY', status: 'PRESENT' });
      }

      for (const t of teachers) {
        if (!t.employeeId) continue;
        await query(
          `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, employee_id) DO NOTHING`,
          [
            session.id,
            t.employeeId,
            t.role || 'PRIMARY',
            t.status || 'PRESENT',
            t.notes || null,
          ]
        );
      }

      return { status: 201 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('Start session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.START_FAILED', 'Failed to start session', 400);
    }
  },

  /**
   * POST /api/sessions/prepare
   * Creates a session with started=false for pre-attendance.
   * No room required. No teacher attendance created.
   */
  prepare: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureSessionRoomNullable();
      await ensureAttendanceMagicColumns();
      await ensureStartedColumn();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const cls = await queryOne<any>(
        `SELECT c.*, co.company_id, co.branch_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [body.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      // If a session (prepared or started) already exists for this class today, return it
      const existing = await queryOne<any>(
        `SELECT * FROM sessions WHERE class_id = $1 AND company_id = $2 AND end_date IS NULL`,
        [body.classId, context.companyId]
      );
      if (existing) {
        // A stale prepared leftover from a previous day is closed, not reused —
        // otherwise today's pre-attendance lands on an old session date.
        if (existing.started === false && isStalePrepared(existing)) {
          await update('sessions', existing.id, { end_date: existing.start_date });
        } else {
          return { status: 200 as const, body: mapSessionFromDB(existing) };
        }
      }

      // Auto session number — per class (each class keeps its own 1,2,3,… sequence).
      const nextRow = await queryOne<any>(
        `SELECT COALESCE(MAX(session_number), 0) + 1 AS next
         FROM sessions
         WHERE class_id = $1`,
        [body.classId]
      );
      const sessionNumber = parseInt(nextRow?.next ?? '1', 10);

      const session = await insert('sessions', {
        company_id: context.companyId,
        branch_id: body.branchId || cls.branch_id,
        room_id: null,
        class_id: body.classId,
        session_number: sessionNumber,
        start_date: new Date().toISOString(),
        end_date: null,
        started: false,
        notes: null,
      });

      // Make-ups taken ahead of this lesson can now point at it (see start).
      try {
        await claimPendingSubstitutions(context.companyId, session.id);
      } catch (subErr) {
        console.error('Substitution claim (prepare) error:', subErr);
      }

      return { status: 201 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('Prepare session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.PREPARE_FAILED', 'Failed to prepare session', 400);
    }
  },

  /**
   * POST /api/sessions/auto-schedule  { localDate, localTime }
   * Opt-in (company setting `auto_manage_sessions`): starts sessions for classes
   * whose weekly schedule says they're in progress right now, and ends running
   * sessions whose scheduled end time has passed today. Idempotent — safe to call
   * repeatedly (e.g. a client polling every few minutes from multiple tabs).
   *
   * localDate / localTime are the CLIENT's local wall-clock (the academy's
   * timezone) so the schedule comparison doesn't depend on the server's UTC.
   */
  autoSchedule: async ({ body, headers }: { body: { localDate?: string; localTime?: string }; headers: { authorization: string } }) => {
    try {
      await ensureSessionRoomNullable();
      await ensureAttendanceMagicColumns();
      await ensureStartedColumn();
      await ensureAutoManageSessionsColumn();
      await ensureAutoStartedColumn();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const localDate = body?.localDate;
      const localTime = body?.localTime;
      if (!localDate || !localTime || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
        return { status: 200 as const, body: { enabled: false, started: 0, ended: 0 } };
      }

      // Gate on the company opt-in setting.
      const comp = await queryOne<any>(
        'SELECT type, auto_manage_sessions FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!comp || comp.auto_manage_sessions !== true) {
        return { status: 200 as const, body: { enabled: false, started: 0, ended: 0 } };
      }
      const isTeacherCompany = (comp.type || '').toUpperCase() === 'TEACHER';
      const dayName = dayNameForDate(localDate);
      await ensureClassDayTimesSchema();

      // ── Auto-start: classes scheduled in-window now with no running session ──
      const startParams: any[] = [context.companyId, dayName, localDate, localTime];
      let startSql = `
        SELECT c.id AS class_id, c.name AS class_name,
               COALESCE(c.instructor_id, co.instructor_id) AS instructor_id, co.branch_id
        FROM classes c
        JOIN courses co ON co.id = c.course_id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND (c.is_finished IS NULL OR c.is_finished = false)
          AND (c.start_date IS NULL OR c.start_date <= $3::date)
          AND (c.end_date IS NULL OR c.end_date >= $3::date)
          AND EXISTS (
            SELECT 1 FROM class_day_times cdt
            WHERE cdt.class_id = c.id AND cdt.day_of_week = $2
              AND cdt.start_time <= $4::time AND cdt.end_time > $4::time
          )
          AND NOT EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.class_id = c.id AND s.company_id = $1 AND s.started = true
              AND (
                -- A session is already running anywhere — never open a second one.
                s.end_date IS NULL
                -- OR this scheduled window ALREADY ran today and was ended (e.g. the
                -- teacher finished a 1-hour lesson after 20 min). Without this, the
                -- class is still inside its window with nothing running, so auto-start
                -- would restart it — the bug.
                --
                -- Judged on when the session ENDED, not when it started. A teacher who
                -- opens the room 20 minutes early still ran THIS window, but their
                -- session starts BEFORE it — so testing start_date declared the window
                -- never run and auto-start reopened it seconds after they ended, over
                -- and over. end_date is never earlier than start_date, so this still
                -- covers every session that both started and ended inside the window,
                -- while a lesson that finished before the window opened (a make-up
                -- slot earlier in the day) correctly does not block it.
                --
                -- The window's start instant is derived in UTC as
                -- NOW() - (localNow - windowStart): both are academy-local times so the
                -- timezone offset cancels, which matters because end_date is UTC while
                -- the schedule/localTime are local.
                OR s.end_date >= NOW() - ($4::time - (
                     SELECT cdt2.start_time FROM class_day_times cdt2
                     WHERE cdt2.class_id = c.id AND cdt2.day_of_week = $2
                       AND cdt2.start_time <= $4::time AND cdt2.end_time > $4::time
                     LIMIT 1
                   ))
              )
          )
      `;
      const startBranch = appendBranchSqlFilter(context, startParams, 'co.branch_id');
      if (startBranch) startSql += ` AND ${startBranch}`;
      const dueClasses = await query<any>(startSql, startParams);

      let started = 0;
      for (const cls of dueClasses) {
        // Promote a prepared (started=false) session if one is open, else insert one.
        let prepared = await queryOne<any>(
          `SELECT * FROM sessions WHERE class_id = $1 AND company_id = $2 AND end_date IS NULL AND started = false`,
          [cls.class_id, context.companyId]
        );
        // Stale leftovers from a previous day are closed, not promoted (see start).
        if (prepared && isStalePrepared(prepared)) {
          await update('sessions', prepared.id, { end_date: prepared.start_date });
          prepared = null;
        }
        let session: any;
        if (prepared) {
          session = await update('sessions', prepared.id, { started: true, auto_started: true });
        } else {
          const nextRow = await queryOne<any>(
            `SELECT COALESCE(MAX(session_number), 0) + 1 AS next FROM sessions WHERE class_id = $1`,
            [cls.class_id]
          );
          session = await insert('sessions', {
            company_id: context.companyId,
            branch_id: cls.branch_id,
            room_id: null,
            class_id: cls.class_id,
            session_number: parseInt(nextRow?.next ?? '1', 10),
            start_date: new Date().toISOString(),
            end_date: null,
            started: true,
            // The automation opened it, so the automation may close it.
            auto_started: true,
            notes: null,
          });
        }
        // Make-ups taken ahead of this lesson can now point at it (see start).
        try {
          await claimPendingSubstitutions(context.companyId, session.id);
        } catch (subErr) {
          console.error('Substitution claim (autoSchedule) error:', subErr);
        }

        // Mark the class instructor present (so the session has a teacher on record
        // and can be auto-ended later for company tenants).
        if (cls.instructor_id) {
          await query(
            `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
             VALUES ($1, $2, 'PRIMARY', 'PRESENT', NULL)
             ON CONFLICT (session_id, employee_id) DO NOTHING`,
            [session.id, cls.instructor_id]
          );
        }
        started++;
      }

      // ── Adopt: a session a human started inside its own scheduled window ─────
      //
      // The common case is the teacher pressing Start at 10:05 for the 10:00 class,
      // because nobody had a tab open for the poll to fire. That session is exactly
      // what the automation would have opened itself, so it takes ownership of it
      // and will close it at the scheduled end like any other.
      //
      // A session started OUTSIDE the window — a make-up day, a rescheduled slot —
      // is never adopted, so auto-end can never touch it. That is the whole fix.
      const adoptParams: any[] = [context.companyId, dayName, localDate, localTime];
      let adoptSql = `
        UPDATE sessions s
           SET auto_started = true, updated_at = NOW()
          FROM classes c
          JOIN courses co ON co.id = c.course_id
         WHERE s.class_id = c.id
           AND s.company_id = $1
           AND co.company_id = $1
           AND s.end_date IS NULL
           AND s.started = true
           AND s.auto_started = false
           AND (c.start_date IS NULL OR c.start_date <= $3::date)
           AND (c.end_date IS NULL OR c.end_date >= $3::date)
           AND EXISTS (
             SELECT 1 FROM class_day_times cdt
             WHERE cdt.class_id = c.id AND cdt.day_of_week = $2
               AND cdt.start_time <= $4::time AND cdt.end_time > $4::time
           )
      `;
      const adoptBranch = appendBranchSqlFilter(context, adoptParams, 's.branch_id');
      if (adoptBranch) adoptSql += ` AND ${adoptBranch}`;
      await query(adoptSql, adoptParams);

      // ── Auto-end: running sessions whose scheduled end has passed ─────────────
      //
      // Every session is judged against ITS OWN start day, not today. The previous
      // version required `start_date::date = today` and looked the schedule up
      // under TODAY's weekday, which meant a session that survived midnight could
      // never be closed by the automation again — a Tuesday lesson stayed open
      // into the following Sunday (121 hours) because the poll only ever runs
      // while a browser tab is open, and nobody has one at 22:00.
      //
      // `off` is the academy's offset from UTC, derived from the clock the client
      // just sent us: start_date is UTC while the schedule and localTime are local
      // wall-clock, so every comparison happens in local terms by adding it.
      const endParams: any[] = [context.companyId, localDate, localTime];
      let endSql = `
        WITH off AS (SELECT (($2::date + $3::time) - NOW()) AS o)
        SELECT s.id, s.notes, COALESCE(c.instructor_id, co.instructor_id) AS instructor_id,
               -- Stamp the moment the lesson was SCHEDULED to end, never NOW():
               -- closing a Tuesday class on Sunday must not log a 121-hour lesson.
               -- GREATEST guards the odd case of a session adopted after its own
               -- end time, which would otherwise end before it started.
               GREATEST(
                 COALESCE(
                   ((s.start_date + off.o)::date + sched.end_time) - off.o,
                   s.start_date + COALESCE(usual.dur, interval '2 hours')
                 ),
                 s.start_date
               ) AS end_at,
               (sched.end_time IS NULL) AS unscheduled,
               ((s.start_date + off.o)::date < $2::date) AS from_earlier_day
        FROM sessions s
        JOIN classes c ON c.id = s.class_id
        JOIN courses co ON co.id = c.course_id
        CROSS JOIN off
        -- The class's schedule for the weekday the session actually started on.
        LEFT JOIN LATERAL (
          SELECT cdt.end_time FROM class_day_times cdt
          WHERE cdt.class_id = c.id
            AND cdt.day_of_week = TRIM(to_char(s.start_date + off.o, 'DAY'))
          ORDER BY cdt.end_time DESC LIMIT 1
        ) sched ON TRUE
        -- Fallback only: this class's usual lesson length, for the backstop below.
        LEFT JOIN LATERAL (
          SELECT (cdt2.end_time - cdt2.start_time) AS dur FROM class_day_times cdt2
          WHERE cdt2.class_id = c.id ORDER BY cdt2.end_time DESC LIMIT 1
        ) usual ON TRUE
        WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
          -- ONLY sessions the automation owns (started or adopted). A session a
          -- human opened outside its schedule is a human's to close.
          AND s.auto_started = true
          AND (
            (sched.end_time IS NOT NULL AND (
              -- Started on an earlier local day: overdue whatever the time is now.
              ((s.start_date + off.o)::date < $2::date)
              -- Started today: past that day's end time, plus a grace period. A
              -- lesson running a few minutes over is normal, and attendance
              -- scanned during the overrun must still land on this session.
              OR ((s.start_date + off.o)::date = $2::date
                  AND EXTRACT(EPOCH FROM ($3::time - sched.end_time)) >= ${AUTO_END_GRACE_MINUTES * 60})
            ))
            -- Backstop: no schedule row matches its start day at all (the class's
            -- timetable changed after it opened), so nothing above can ever judge
            -- it. Left alone it would stay open for ever, which is the one outcome
            -- this automation exists to prevent.
            OR (sched.end_time IS NULL
                AND s.start_date < NOW() - interval '${AUTO_END_MAX_OPEN_HOURS} hours')
          )
      `;
      const endBranch = appendBranchSqlFilter(context, endParams, 's.branch_id');
      if (endBranch) endSql += ` AND ${endBranch}`;
      const overdue = await query<any>(endSql, endParams);

      let ended = 0;
      for (const s of overdue) {
        // An academy records who taught a session, so ending one normally requires a
        // teacher marked present. The automation satisfies that by marking the class
        // instructor present.
        //
        // But a class with NO instructor assigned cannot satisfy it at all, and this
        // used to `continue` — leaving that session running for ever, which is the
        // opposite of what the automation is for. It is now closed anyway, and says
        // in its notes why it has no teacher, so the gap is visible in the record
        // rather than silently absent.
        let noTeacher = false;
        if (!isTeacherCompany) {
          const present = await queryOne(
            `SELECT 1 FROM session_teacher_attendance WHERE session_id = $1 AND status = 'PRESENT' LIMIT 1`,
            [s.id]
          );
          if (!present) {
            if (s.instructor_id) {
              await query(
                `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
                 VALUES ($1, $2, 'PRIMARY', 'PRESENT', NULL)
                 ON CONFLICT (session_id, employee_id) DO UPDATE SET status = 'PRESENT'`,
                [s.id, s.instructor_id]
              );
            } else {
              noTeacher = true;
            }
          }
        }

        // end_at comes from the query: the lesson's own scheduled end, not now.
        const changes: Record<string, any> = { end_date: new Date(s.end_at).toISOString() };
        const extraNotes: string[] = [];
        if (noTeacher) extraNotes.push(AUTO_END_NO_TEACHER_NOTE);
        // Say so whenever the end time was reconstructed rather than observed, so
        // a 3-day-old closure isn't mistaken for a lesson someone sat through.
        if (s.unscheduled) extraNotes.push(AUTO_END_BACKSTOP_NOTE);
        else if (s.from_earlier_day) extraNotes.push(AUTO_END_LATE_NOTE);
        if (extraNotes.length > 0) {
          changes.notes = [s.notes, ...extraNotes].filter(Boolean).join(' ').trim();
        }
        await update('sessions', s.id, changes);
        // Best-effort Telegram present/absent notifications (no-op unless enabled).
        await notifySessionAttendance(context.companyId, s.id);
        ended++;
      }

      return { status: 200 as const, body: { enabled: true, started, ended } };
    } catch (error) {
      console.error('Auto-schedule sessions error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.AUTO_SCHEDULE_FAILED', 'Failed to auto-manage sessions', 400);
    }
  },

  end: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      // The absence-charge guard below reads existing.is_free, and an undefined
      // flag would read as "not free" and bill a trial lesson's no-shows.
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }

      if (existing.end_date) {
        return apiError(400, 'ERRORS.SESSIONS.ALREADY_ENDED', 'Session has already ended');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      // An academy records who taught a session, so ending one wants a teacher
      // marked present — but it must never REFUSE over it. Blocking here is what
      // left classes running for days: nobody could close a session whose class
      // had no instructor, and 12 of 13 classes in one live tenant have none.
      //
      // So: credit the default teacher (the class's instructor, else the
      // course's) and carry on. If neither exists there is nobody to credit, and
      // the session is closed anyway with a note saying so — the gap is visible
      // in the record instead of keeping the class open for ever. Teacher-type
      // companies don't track per-session attendance at all (the owner is the
      // only teacher), so they skip this entirely.
      const comp = await queryOne<any>(
        'SELECT type FROM companies WHERE id = $1',
        [context.companyId]
      );
      const isTeacherCompany = (comp?.type || '').toUpperCase() === 'TEACHER';
      let noTeacherOnRecord = false;
      if (!isTeacherCompany) {
        const presentTeacher = await queryOne(
          `SELECT 1 FROM session_teacher_attendance
           WHERE session_id = $1 AND status = 'PRESENT' LIMIT 1`,
          [params.id]
        );
        if (!presentTeacher) {
          const instructorId = await resolveDefaultInstructorId(existing.class_id);
          if (instructorId) {
            await markTeacherPresent(params.id, instructorId);
          } else {
            noTeacherOnRecord = true;
          }
        }
      }

      // Allow caller to supply a custom end date (e.g. forgot to end session yesterday)
      let endDate: Date;
      if (body?.endDate) {
        endDate = new Date(body.endDate);
        if (isNaN(endDate.getTime())) {
          return apiError(400, 'ERRORS.SESSIONS.INVALID_END_DATE', 'Invalid endDate provided');
        }
        // Validate: endDate must not be before startDate
        const startDate = new Date(existing.start_date);
        if (endDate < startDate) {
          return apiError(400, 'ERRORS.SESSIONS.END_BEFORE_START', 'End date cannot be before start date');
        }
      } else {
        endDate = new Date();
      }

      const updateData: any = {
        end_date: endDate.toISOString(),
      };
      if (body?.notes !== undefined) updateData.notes = body.notes;
      if (noTeacherOnRecord) {
        // Append rather than overwrite: the closer's own note still matters.
        const base = body?.notes !== undefined ? body.notes : existing.notes;
        updateData.notes = [base, END_NO_TEACHER_NOTE].filter(Boolean).join(' ').trim();
      }

      const session = await update('sessions', params.id, updateData);

      // Best-effort Telegram present/absent notifications (no-op unless enabled).
      await notifySessionAttendance(context.companyId, params.id);

      // PER_SESSION courses: bill absent students now that the roster is final
      // (only if the course opted into charging absences). Best-effort.
      try {
        await chargeAbsencesAtSessionEnd(context.companyId, existing);
      } catch (billErr) {
        console.error('Per-session absence charge (session end) error:', billErr);
      }

      return { status: 200 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('End session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.END_FAILED', 'Failed to end session', 400);
    }
  },

  /**
   * PATCH /api/sessions/:id/cancel
   * Undo a session that was started by mistake: delete it outright so it
   * vanishes from the dashboard, as if it had never started. Distinct from
   * `end` (which requires a teacher present and BILLS absent students) — cancel
   * bills nobody.
   *
   * Guardrail: only a session with NO student checked in yet can be cancelled.
   * Once the roster is real, the user must End it instead — deleting it would
   * silently drop attendance the customer took. And because per-session charges
   * are only ever created on check-in, "no attendance" also means "no charges",
   * so the plain DELETE has nothing to refund. FK cascades clear the
   * session_teacher_attendance rows that start writes.
   */
  cancel: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureStartedColumn();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne<any>(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }
      if (existing.end_date) {
        return apiError(400, 'ERRORS.SESSIONS.ALREADY_ENDED', 'Session has already ended');
      }
      if (!existing.started) {
        return apiError(400, 'ERRORS.SESSIONS.NOT_STARTED', 'Session has not been started');
      }

      const attended = await queryOne<any>(
        'SELECT COUNT(*)::int AS n FROM session_attendance WHERE session_id = $1',
        [params.id]
      );
      if (Number(attended?.n ?? 0) > 0) {
        return apiError(
          400,
          'ERRORS.SESSIONS.CANCEL_HAS_ATTENDANCE',
          'Cannot cancel — students are already checked in. End the session instead.'
        );
      }

      await query('DELETE FROM sessions WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { success: true, id: params.id } };
    } catch (error) {
      console.error('Cancel session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.CANCEL_FAILED', 'Failed to cancel session', 400);
    }
  },

  /**
   * DELETE /api/sessions/:id
   * Erase a session from the record — a lesson logged by mistake, a duplicate,
   * a test run. Unlike `cancel` (running sessions with an empty roster only),
   * this deletes a session at ANY stage, taking its attendance with it, so the
   * UI must confirm with the user first.
   *
   * Guardrail: money already collected is never destroyed silently. A session
   * carrying a per-session payment with anything paid on it must be voided or
   * refunded first. Everything else attached (attendance, teacher attendance,
   * unpaid charges, salary rows) is removed by the FK cascades.
   */
  remove: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne<any>(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      // session_payments only exists for PER_SESSION courses — a company that
      // never used them has no such table, and that is not an error here.
      try {
        const paid = await queryOne<any>(
          `SELECT COUNT(*)::int AS n FROM session_payments
           WHERE session_id = $1 AND amount_paid > 0 AND payment_status <> 'REFUNDED'`,
          [params.id]
        );
        if (Number(paid?.n ?? 0) > 0) {
          return apiError(
            400,
            'ERRORS.SESSIONS.DELETE_HAS_PAYMENTS',
            'Cannot delete — this session has collected payments. Void or refund them first.'
          );
        }
      } catch (e: any) {
        if (e?.code !== '42P01') throw e; // 42P01 = undefined_table
      }

      await query('DELETE FROM sessions WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { success: true, id: params.id } };
    } catch (error) {
      console.error('Delete session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.DELETE_FAILED', 'Failed to delete session', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; classId?: string; roomId?: string; courseId?: string; studentId?: string; attendance?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];

      // When filtering by student, expose whether that student was present
      // (has an attendance row) for each session. Reserve the param slot up
      // front so it can be reused in SELECT and WHERE.
      let studentIdx: number | null = null;
      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        studentIdx = params.length;
      }
      const presentExpr = studentIdx
        ? `EXISTS (SELECT 1 FROM session_attendance sa WHERE sa.session_id = s.id AND sa.student_id = $${studentIdx}) AS student_present`
        : `NULL::boolean AS student_present`;

      let sql = `
        SELECT
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          co.name as course_name,
          b.name as branch_name,
          ${presentExpr}
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.company_id = $1
      `;

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 's.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND s.class_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND cl.course_id = $${params.length}`;
      }

      if (queryParams.roomId) {
        params.push(queryParams.roomId);
        sql += ` AND s.room_id = $${params.length}`;
      }

      if (studentIdx) {
        // Sessions of classes the student is enrolled in (direct or via a bundle),
        // so sessions where the student was ABSENT are still included.
        sql += ` AND EXISTS (
            SELECT 1 FROM enrollments en WHERE en.class_id = s.class_id AND en.student_id = $${studentIdx}
            UNION ALL
            SELECT 1 FROM master_class_enrollments mce WHERE mce.class_id = s.class_id AND mce.student_id = $${studentIdx}
          )`;
        // Present/Absent filter for that student.
        if (queryParams.attendance === 'PRESENT') {
          sql += ` AND EXISTS (SELECT 1 FROM session_attendance sa2 WHERE sa2.session_id = s.id AND sa2.student_id = $${studentIdx})`;
        } else if (queryParams.attendance === 'ABSENT') {
          sql += ` AND NOT EXISTS (SELECT 1 FROM session_attendance sa2 WHERE sa2.session_id = s.id AND sa2.student_id = $${studentIdx})`;
        }
      }

      sql += ' ORDER BY s.start_date DESC';

      const sessions = await query(sql, params);
      return { status: 200 as const, body: sessions.map(mapSessionWithDetailsFromDB) };
    } catch (error) {
      console.error('List sessions error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.LIST_FAILED', 'Failed to list sessions');
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureStartedColumn();
      await ensureFreeSessionSchema();   // s.* below carries is_free for the Free badge
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          co.name as course_name,
          b.name as branch_name,
          -- Students checked in so far (an attendance row = present).
          (SELECT COUNT(*) FROM session_attendance sa WHERE sa.session_id = s.id) as present_count
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.company_id = $1 AND s.end_date IS NULL
          -- Only formally-started sessions are "active". Pre-attendance prepares
          -- a session (started=false); taking attendance must NOT start it. Such
          -- prepared sessions stay in the Upcoming tab until the teacher clicks
          -- Start, or auto-start-on-time promotes them.
          AND s.started = true
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 's.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY s.start_date DESC';

      const sessions = await query(sql, params);
      return { status: 200 as const, body: sessions.map(mapSessionWithDetailsFromDB) };
    } catch (error) {
      console.error('List active sessions error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.LIST_FAILED', 'Failed to list active sessions');
    }
  },

  /**
   * GET /api/sessions/active-for-student/:studentId
   * The student's currently-running session (end_date IS NULL AND started),
   * for a class they're enrolled in, scoped to the caller's branches. Returns
   * the session info or null. Used so collecting a monthly payment by scan can
   * offer to mark the student present at the same time.
   */
  activeForStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      await ensureStartedColumn();
      await ensureAttendanceMagicColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const sqlParams: any[] = [context.companyId, params.studentId];
      let sql = `
        SELECT s.id, s.class_id, s.session_number,
               cl.name AS class_name, co.name AS course_name, r.code AS room_code
        FROM sessions s
        JOIN classes cl ON cl.id = s.class_id
        LEFT JOIN courses co ON co.id = cl.course_id
        LEFT JOIN rooms r ON r.id = s.room_id
        WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
          AND s.class_id IN (
            SELECT class_id FROM enrollments
            WHERE company_id = $1 AND student_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT class_id FROM master_class_enrollments
            WHERE company_id = $1 AND student_id = $2 AND status != 'DROPPED'
          )
      `;
      const branchClause = appendBranchSqlFilter(context, sqlParams, 's.branch_id');
      if (branchClause) sql += ` AND ${branchClause}`;
      sql += ' ORDER BY s.start_date DESC LIMIT 1';

      const row = await queryOne<any>(sql, sqlParams);
      if (!row) {
        return { status: 200 as const, body: null };
      }
      return {
        status: 200 as const,
        body: {
          sessionId: row.id,
          classId: row.class_id,
          className: row.class_name,
          courseName: row.course_name,
          roomCode: row.room_code ?? null,
          sessionNumber: row.session_number === null || row.session_number === undefined
            ? null
            : parseInt(row.session_number, 10),
        },
      };
    } catch (error) {
      console.error('Active session for student error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.LIST_FAILED', 'Failed to find active session');
    }
  },

  /**
   * GET /api/sessions/checkin-target/:studentId?localDate=YYYY-MM-DD&localTime=HH:MM&branchId=...
   *
   * Resolves the session a scanned student should be checked into, so a scan
   * from anywhere in the app can take attendance automatically. Returns:
   *   1. their currently-running session (started, not ended), if any; else
   *   2. an "active or imminent" scheduled session — a class they're enrolled
   *      in that, per its weekly schedule, is in progress or starts within the
   *      next 30 minutes. If no session row exists for it yet, one is prepared
   *      (started=false) so the student can be checked in.
   * Returns the session info object, or null when nothing matches.
   *
   * localDate / localTime are the CLIENT's local wall-clock (the academy's
   * timezone), so the schedule comparison doesn't depend on the server's UTC.
   */
  checkinTarget: async ({
    params,
    query: q,
    headers,
  }: {
    params: { studentId: string };
    query: { localDate?: string; localTime?: string; branchId?: string };
    headers: { authorization: string };
  }) => {
    try {
      await ensureStartedColumn();
      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      // May create (prepare) a session, so require write.
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      if (q.branchId && !canAccessBranch(context, q.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const enrolledClassesSubquery = `(
        SELECT class_id FROM enrollments
        WHERE company_id = $1 AND student_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT class_id FROM master_class_enrollments
        WHERE company_id = $1 AND student_id = $2 AND status != 'DROPPED'
      )`;

      // 1) Already-running session for one of the student's classes.
      {
        const sqlParams: any[] = [context.companyId, params.studentId];
        let sql = `
          SELECT s.id, s.class_id, s.session_number,
                 cl.name AS class_name, co.name AS course_name, r.code AS room_code
          FROM sessions s
          JOIN classes cl ON cl.id = s.class_id
          LEFT JOIN courses co ON co.id = cl.course_id
          LEFT JOIN rooms r ON r.id = s.room_id
          WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
            AND s.class_id IN ${enrolledClassesSubquery}
        `;
        const branchClause = appendBranchSqlFilter(context, sqlParams, 's.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
        sql += ' ORDER BY s.start_date DESC LIMIT 1';

        const row = await queryOne<any>(sql, sqlParams);
        if (row) {
          return { status: 200 as const, body: mapCheckinTarget(row, false) };
        }
      }

      // 1b) A free session running right now. Deliberately NOT filtered by
      // enrolment: a free session is open to the whole academy, and the person
      // it exists for is precisely the one with no enrolment to be found by.
      // It ranks below the student's own class (an enrolled student scanning
      // during their real lesson belongs in that lesson, not in the trial) and
      // above the schedule guess below.
      {
        const freeParams: any[] = [context.companyId];
        let freeSql = `
          SELECT s.id, s.class_id, s.session_number,
                 cl.name AS class_name, co.name AS course_name, r.code AS room_code
          FROM sessions s
          JOIN classes cl ON cl.id = s.class_id
          LEFT JOIN courses co ON co.id = cl.course_id
          LEFT JOIN rooms r ON r.id = s.room_id
          WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
            AND s.is_free = TRUE
        `;
        const freeBranchClause = appendBranchSqlFilter(context, freeParams, 's.branch_id');
        if (freeBranchClause) freeSql += ` AND ${freeBranchClause}`;
        freeSql += ' ORDER BY s.start_date DESC LIMIT 1';

        const freeRow = await queryOne<any>(freeSql, freeParams);
        if (freeRow) {
          return { status: 200 as const, body: mapCheckinTarget(freeRow, false) };
        }
      }

      // 2) Active-or-imminent scheduled class (needs the client's local clock).
      if (!q.localDate || !q.localTime || !/^\d{4}-\d{2}-\d{2}$/.test(q.localDate)) {
        return { status: 200 as const, body: null };
      }
      const dayName = dayNameForDate(q.localDate);
      await ensureClassDayTimesSchema();

      const schedParams: any[] = [context.companyId, params.studentId, dayName, q.localDate, q.localTime];
      let schedSql = `
        SELECT c.id AS class_id, c.name AS class_name, co.name AS course_name, co.branch_id
        FROM classes c
        JOIN courses co ON co.id = c.course_id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND (c.start_date IS NULL OR c.start_date <= $4::date)
          AND (c.end_date IS NULL OR c.end_date >= $4::date)
          AND EXISTS (
            SELECT 1 FROM class_day_times cdt
            WHERE cdt.class_id = c.id AND cdt.day_of_week = $3
              AND cdt.start_time <= ($5::time + interval '30 minutes')
              AND cdt.end_time >= $5::time
          )
          AND c.id IN ${enrolledClassesSubquery}
      `;
      const schedBranch = appendBranchSqlFilter(context, schedParams, 'co.branch_id');
      if (schedBranch) schedSql += ` AND ${schedBranch}`;
      schedSql += ' ORDER BY c.start_time ASC LIMIT 1';

      const cls = await queryOne<any>(schedSql, schedParams);
      if (!cls) {
        return { status: 200 as const, body: null };
      }

      // Reuse an open session for this class, or prepare one (started=false).
      let session = await queryOne<any>(
        `SELECT s.*, cl.name AS class_name, co.name AS course_name, r.code AS room_code
         FROM sessions s
         JOIN classes cl ON cl.id = s.class_id
         LEFT JOIN courses co ON co.id = cl.course_id
         LEFT JOIN rooms r ON r.id = s.room_id
         WHERE s.class_id = $1 AND s.company_id = $2 AND s.end_date IS NULL`,
        [cls.class_id, context.companyId]
      );
      // Don't attach today's check-in to a stale prepared session from a previous
      // day — close it and prepare a fresh one (see isStalePrepared).
      if (session && session.started === false && isStalePrepared(session)) {
        await update('sessions', session.id, { end_date: session.start_date });
        session = null;
      }
      if (!session) {
        const nextRow = await queryOne<any>(
          `SELECT COALESCE(MAX(session_number), 0) + 1 AS next FROM sessions WHERE class_id = $1`,
          [cls.class_id]
        );
        const inserted = await insert('sessions', {
          company_id: context.companyId,
          branch_id: cls.branch_id,
          room_id: null,
          class_id: cls.class_id,
          session_number: parseInt(nextRow?.next ?? '1', 10),
          start_date: new Date().toISOString(),
          end_date: null,
          started: false,
          notes: null,
        });
        session = { ...inserted, class_name: cls.class_name, course_name: cls.course_name, room_code: null };
        // Make-ups taken ahead of this lesson can now point at it (see start).
        try {
          await claimPendingSubstitutions(context.companyId, session.id);
        } catch (subErr) {
          console.error('Substitution claim (checkinTarget) error:', subErr);
        }
      }

      return {
        status: 200 as const,
        body: mapCheckinTarget(
          {
            id: session.id,
            class_id: session.class_id,
            session_number: session.session_number,
            class_name: session.class_name,
            course_name: session.course_name,
            room_code: session.room_code,
          },
          true
        ),
      };
    } catch (error) {
      console.error('Checkin target for student error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.LIST_FAILED', 'Failed to find session');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const sql = `
        SELECT
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          co.name as course_name,
          b.name as branch_name
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.id = $1 AND s.company_id = $2
      `;

      const result = await query(sql, [params.id, context.companyId]);

      if (!result || result.length === 0) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      return { status: 200 as const, body: mapSessionWithDetailsFromDB(result[0]) };
    } catch (error) {
      console.error('Get session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found', 404);
    }
  },

  /**
   * GET /api/sessions/free-summary?classId=…
   * Every free (trial) session of a class, with how many students turned up to
   * each — the "did the trial bring anyone in?" view.
   *
   * `trialCount` is the part that matters commercially: attendees who were NOT
   * enrolled in the class, i.e. the prospects the free session was run for.
   * `uniqueTrialStudents` de-duplicates across sessions, so a prospect who
   * sampled three free lessons is one person to follow up with, not three.
   */
  freeSummary: async ({ query: queryParams, headers }: { query: { classId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (!queryParams.classId) {
        return apiError(400, 'ERRORS.SESSIONS.CLASS_ID_REQUIRED', 'classId is required');
      }

      const cls = await queryOne<any>(
        `SELECT c.id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [queryParams.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      const rows = await query<any>(
        `SELECT s.id,
                s.session_number,
                s.start_date,
                s.end_date,
                r.code AS room_code,
                COUNT(sa.id)                                              AS attendee_count,
                COUNT(sa.id) FILTER (WHERE sa.attendance_type = 'TRIAL')  AS trial_count
         FROM sessions s
         LEFT JOIN rooms r ON r.id = s.room_id
         LEFT JOIN session_attendance sa ON sa.session_id = s.id
         WHERE s.class_id = $1 AND s.company_id = $2 AND s.is_free = TRUE
         GROUP BY s.id, s.session_number, s.start_date, s.end_date, r.code
         ORDER BY s.start_date DESC`,
        [cls.id, context.companyId]
      );

      // Distinct people, not distinct attendances — counted in SQL because the
      // rows above are already grouped by session and can no longer tell us
      // whether the same student appears in two of them.
      const uniqueRow = await queryOne<any>(
        `SELECT COUNT(DISTINCT sa.student_id) AS unique_students,
                COUNT(DISTINCT sa.student_id) FILTER (WHERE sa.attendance_type = 'TRIAL') AS unique_trial_students
         FROM sessions s
         JOIN session_attendance sa ON sa.session_id = s.id
         WHERE s.class_id = $1 AND s.company_id = $2 AND s.is_free = TRUE`,
        [cls.id, context.companyId]
      );

      const sessions = rows.map(r => ({
        id: r.id,
        sessionNumber: r.session_number === null || r.session_number === undefined
          ? null
          : parseInt(r.session_number, 10),
        startDate: r.start_date,
        endDate: r.end_date,
        roomCode: r.room_code ?? null,
        attendeeCount: parseInt(r.attendee_count ?? '0', 10),
        trialCount: parseInt(r.trial_count ?? '0', 10),
      }));

      return {
        status: 200 as const,
        body: {
          sessions,
          totalSessions: sessions.length,
          totalAttendances: sessions.reduce((sum, s) => sum + s.attendeeCount, 0),
          uniqueStudents: parseInt(uniqueRow?.unique_students ?? '0', 10),
          uniqueTrialStudents: parseInt(uniqueRow?.unique_trial_students ?? '0', 10),
        },
      };
    } catch (error) {
      console.error('Free session summary error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.FREE_SUMMARY_FAILED', 'Failed to load free sessions');
    }
  },

  /**
   * GET /api/sessions/next-number?classId=…
   * Suggested next session number for a class (max+1 for that class only).
   * Used to prefill the Start dialog; the teacher can still edit it.
   */
  nextNumber: async ({ query: queryParams, headers }: { query: { classId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (!queryParams.classId) {
        return apiError(400, 'ERRORS.SESSIONS.CLASS_ID_REQUIRED', 'classId is required');
      }

      const cls = await queryOne<any>(
        `SELECT c.id, c.course_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [queryParams.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      const nextRow = await queryOne<any>(
        `SELECT COALESCE(MAX(session_number), 0) + 1 AS next
         FROM sessions
         WHERE class_id = $1`,
        [cls.id]
      );

      return { status: 200 as const, body: { sessionNumber: parseInt(nextRow?.next ?? '1', 10) } };
    } catch (error) {
      console.error('Next session number error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.NEXT_NUMBER_FAILED', 'Failed to compute next session number');
    }
  },

  /**
   * PATCH /api/sessions/:id
   * Edit a session's number (and/or notes) after it was started.
   */
  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne<any>(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const updateData: any = {};
      if (body.sessionNumber !== undefined && body.sessionNumber !== null && body.sessionNumber !== '') {
        const n = parseInt(body.sessionNumber, 10);
        if (!Number.isFinite(n) || n < 1) {
          return apiError(400, 'ERRORS.SESSIONS.INVALID_SESSION_NUMBER', 'Session number must be a positive integer');
        }
        updateData.session_number = n;
      }
      if (body.notes !== undefined) updateData.notes = body.notes;

      if (Object.keys(updateData).length === 0) {
        return { status: 200 as const, body: mapSessionFromDB(existing) };
      }

      const session = await update('sessions', params.id, updateData);
      return { status: 200 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('Update session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.UPDATE_FAILED', 'Failed to update session', 400);
    }
  },
};
