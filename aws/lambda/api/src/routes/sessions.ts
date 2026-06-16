import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

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
  };
}

export const sessionsRoutes = {
  start: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureSessionRoomNullable();
      await ensureAttendanceMagicColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // Verify class exists and belongs to company (branch/company come from the linked course)
      const cls = await queryOne(
        `SELECT c.*, co.company_id, co.branch_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [body.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (cls.is_finished) {
        return apiError(400, 'ERRORS.SESSIONS.CLASS_FINISHED', 'This class is finished. Sessions cannot be started.');
      }

      const isOnlineClass = typeof cls.type === 'string' && cls.type.toUpperCase() === 'ONLINE';

      // Verify room only if provided (online classes don't require a room)
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
      } else if (!isOnlineClass) {
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

      // Session number: auto = MAX(session_number)+1 across ALL sessions of any
      // class in the same course, so number N is shared across the course's
      // classes. The teacher may override it (and may reuse a number on purpose).
      let sessionNumber: number;
      if (body.sessionNumber !== undefined && body.sessionNumber !== null && body.sessionNumber !== '') {
        sessionNumber = parseInt(body.sessionNumber, 10);
        if (!Number.isFinite(sessionNumber) || sessionNumber < 1) {
          return apiError(400, 'ERRORS.SESSIONS.INVALID_SESSION_NUMBER', 'Session number must be a positive integer');
        }
      } else {
        const nextRow = await queryOne<any>(
          `SELECT COALESCE(MAX(s.session_number), 0) + 1 AS next
           FROM sessions s
           JOIN classes c ON c.id = s.class_id
           WHERE c.course_id = $1`,
          [cls.course_id]
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

      // A session can't be ended unless at least one teacher was present.
      const presentTeacher = await queryOne(
        `SELECT 1 FROM session_teacher_attendance
         WHERE session_id = $1 AND status = 'PRESENT' LIMIT 1`,
        [params.id]
      );
      if (!presentTeacher) {
        return apiError(400, 'ERRORS.SESSIONS.NO_TEACHER_PRESENT', 'Cannot end the session — no teacher is marked present');
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

      return { status: 200 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('End session error:', error);
      return mapThrownError(error, 'ERRORS.SESSIONS.END_FAILED', 'Failed to end session', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; classId?: string; roomId?: string }; headers: { authorization: string } }) => {
    try {
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
        WHERE s.company_id = $1
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

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND s.class_id = $${params.length}`;
      }

      if (queryParams.roomId) {
        params.push(queryParams.roomId);
        sql += ` AND s.room_id = $${params.length}`;
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
   * Suggested next session number for a class's course (max+1 across the course).
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
        `SELECT COALESCE(MAX(s.session_number), 0) + 1 AS next
         FROM sessions s
         JOIN classes c ON c.id = s.class_id
         WHERE c.course_id = $1`,
        [cls.course_id]
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
