import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { notifySessionAttendance } from './telegram';
import { ensureAutoManageSessionsColumn } from './companies';
import { chargeAbsencesAtSessionEnd } from './session-payments';

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

const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/** Weekday name (UPPER) for a YYYY-MM-DD local date — matches classes.days_of_week. */
function dayNameForDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
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
  };
}

export const sessionsRoutes = {
  start: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
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

      // Verify class exists and belongs to company (branch/company come from the linked course)
      const cls = await queryOne<any>(
        `SELECT c.*, co.company_id, co.branch_id, comp.type AS company_type
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

      // If a prepared (started=false) session already exists for this class,
      // just mark it as started and update with any provided room/notes/teachers.
      const prepared = await queryOne<any>(
        `SELECT * FROM sessions WHERE class_id = $1 AND company_id = $2 AND end_date IS NULL AND started = false`,
        [body.classId, context.companyId]
      );
      if (prepared) {
        const updateFields: any = { started: true };
        if (body.roomId) updateFields.room_id = body.roomId;
        if (body.notes) updateFields.notes = body.notes;
        if (body.sessionNumber !== undefined && body.sessionNumber !== null && body.sessionNumber !== '') {
          updateFields.session_number = parseInt(body.sessionNumber, 10);
        }
        const session = await update('sessions', prepared.id, updateFields);

        // Teacher attendance for the formally-started session
        const teachers: Array<{ employeeId: string; role?: string; status?: string; notes?: string }> =
          Array.isArray(body.teachers) ? body.teachers : [];
        if (teachers.length === 0 && cls.instructor_id) {
          teachers.push({ employeeId: cls.instructor_id, role: 'PRIMARY', status: 'PRESENT' });
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
        notes: body.notes || null,
      });

      // Teacher attendance — optional. If the caller provided an explicit list,
      // use it verbatim. Otherwise fall back to the class's assigned instructor
      // as PRIMARY/PRESENT (if any).
      const teachers: Array<{ employeeId: string; role?: string; status?: string; notes?: string }> =
        Array.isArray(body.teachers) ? body.teachers : [];

      if (teachers.length === 0 && cls.instructor_id) {
        teachers.push({ employeeId: cls.instructor_id, role: 'PRIMARY', status: 'PRESENT' });
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
        return { status: 200 as const, body: mapSessionFromDB(existing) };
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

      // ── Auto-start: classes scheduled in-window now with no running session ──
      const startParams: any[] = [context.companyId, dayName, localDate, localTime];
      let startSql = `
        SELECT c.id AS class_id, c.name AS class_name, c.instructor_id, co.branch_id
        FROM classes c
        JOIN courses co ON co.id = c.course_id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND (c.is_finished IS NULL OR c.is_finished = false)
          AND c.start_time IS NOT NULL AND c.end_time IS NOT NULL
          AND c.days_of_week IS NOT NULL AND c.days_of_week <> ''
          AND POSITION($2 IN UPPER(c.days_of_week)) > 0
          AND (c.start_date IS NULL OR c.start_date <= $3::date)
          AND (c.end_date IS NULL OR c.end_date >= $3::date)
          AND c.start_time <= $4::time
          AND c.end_time > $4::time
          AND NOT EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.class_id = c.id AND s.company_id = $1 AND s.end_date IS NULL AND s.started = true
          )
      `;
      const startBranch = appendBranchSqlFilter(context, startParams, 'co.branch_id');
      if (startBranch) startSql += ` AND ${startBranch}`;
      const dueClasses = await query<any>(startSql, startParams);

      let started = 0;
      for (const cls of dueClasses) {
        // Promote a prepared (started=false) session if one is open, else insert one.
        const prepared = await queryOne<any>(
          `SELECT * FROM sessions WHERE class_id = $1 AND company_id = $2 AND end_date IS NULL AND started = false`,
          [cls.class_id, context.companyId]
        );
        let session: any;
        if (prepared) {
          session = await update('sessions', prepared.id, { started: true });
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
            notes: null,
          });
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

      // ── Auto-end: running sessions whose scheduled end time has passed today ──
      const endParams: any[] = [context.companyId, localDate, localTime];
      let endSql = `
        SELECT s.id, c.instructor_id
        FROM sessions s
        JOIN classes c ON c.id = s.class_id
        JOIN courses co ON co.id = c.course_id
        WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
          AND s.start_date::date = $2::date
          AND c.end_time IS NOT NULL AND c.end_time <= $3::time
      `;
      const endBranch = appendBranchSqlFilter(context, endParams, 's.branch_id');
      if (endBranch) endSql += ` AND ${endBranch}`;
      const overdue = await query<any>(endSql, endParams);

      let ended = 0;
      for (const s of overdue) {
        // Company tenants require a present teacher to end. Ensure the instructor
        // is recorded present; if none can be, skip and leave it for a manual end.
        if (!isTeacherCompany) {
          const present = await queryOne(
            `SELECT 1 FROM session_teacher_attendance WHERE session_id = $1 AND status = 'PRESENT' LIMIT 1`,
            [s.id]
          );
          if (!present) {
            if (!s.instructor_id) continue;
            await query(
              `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
               VALUES ($1, $2, 'PRIMARY', 'PRESENT', NULL)
               ON CONFLICT (session_id, employee_id) DO UPDATE SET status = 'PRESENT'`,
              [s.id, s.instructor_id]
            );
          }
        }
        await update('sessions', s.id, { end_date: new Date().toISOString() });
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

      // A session can't be ended unless at least one teacher was present — but
      // only for "company" tenants. Teacher-type companies don't track per-session
      // teacher attendance (the owner is the only teacher), so skip the check.
      const comp = await queryOne<any>(
        'SELECT type FROM companies WHERE id = $1',
        [context.companyId]
      );
      const isTeacherCompany = (comp?.type || '').toUpperCase() === 'TEACHER';
      if (!isTeacherCompany) {
        const presentTeacher = await queryOne(
          `SELECT 1 FROM session_teacher_attendance
           WHERE session_id = $1 AND status = 'PRESENT' LIMIT 1`,
          [params.id]
        );
        if (!presentTeacher) {
          return apiError(400, 'ERRORS.SESSIONS.NO_TEACHER_PRESENT', 'Cannot end the session — no teacher is marked present');
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
          b.name as branch_name
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

      // 2) Active-or-imminent scheduled class (needs the client's local clock).
      if (!q.localDate || !q.localTime || !/^\d{4}-\d{2}-\d{2}$/.test(q.localDate)) {
        return { status: 200 as const, body: null };
      }
      const dayName = dayNameForDate(q.localDate);

      const schedParams: any[] = [context.companyId, params.studentId, dayName, q.localDate, q.localTime];
      let schedSql = `
        SELECT c.id AS class_id, c.name AS class_name, co.name AS course_name, co.branch_id
        FROM classes c
        JOIN courses co ON co.id = c.course_id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND c.start_time IS NOT NULL AND c.end_time IS NOT NULL
          AND c.days_of_week IS NOT NULL AND c.days_of_week <> ''
          AND POSITION($3 IN UPPER(c.days_of_week)) > 0
          AND (c.start_date IS NULL OR c.start_date <= $4::date)
          AND (c.end_date IS NULL OR c.end_date >= $4::date)
          AND c.start_time <= ($5::time + interval '30 minutes')
          AND c.end_time >= $5::time
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
