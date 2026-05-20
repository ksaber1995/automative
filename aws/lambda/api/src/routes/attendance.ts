import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

export const attendanceRoutes = {
  /**
   * GET /api/attendance/session/:sessionId
   * Returns all enrolled students for the session's class with their attendance status.
   */
  getBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Verify session belongs to company
      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      // Get all enrolled students for this class (both direct and bundle enrollments)
      const students = await query(
        `SELECT
          s.id AS student_id,
          s.first_name AS student_first_name,
          s.last_name AS student_last_name,
          sa.id AS attendance_id
        FROM (
          SELECT student_id FROM enrollments
          WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
          UNION
          SELECT student_id FROM master_class_enrollments
          WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
        ) enrolled
        JOIN students s ON s.id = enrolled.student_id
        LEFT JOIN session_attendance sa ON sa.session_id = $3 AND sa.student_id = s.id
        ORDER BY s.first_name, s.last_name`,
        [session.class_id, context.companyId, params.sessionId]
      );

      return {
        status: 200 as const,
        body: students.map((row: any) => ({
          studentId: row.student_id,
          studentFirstName: row.student_first_name,
          studentLastName: row.student_last_name,
          isPresent: row.attendance_id !== null,
          attendanceId: row.attendance_id || null,
        })),
      };
    } catch (error) {
      console.error('Get session attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.GET_FAILED', 'Failed to get attendance');
    }
  },

  /**
   * POST /api/attendance/session/:sessionId
   * Bulk save attendance: insert records for present students, delete for absent ones.
   * Body: { presentStudentIds: string[] }
   */
  saveForSession: async ({ params, body, headers }: { params: { sessionId: string }; body: { presentStudentIds: string[] }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const presentIds: string[] = body.presentStudentIds || [];

      // Delete all existing attendance records for this session
      await query(
        'DELETE FROM session_attendance WHERE session_id = $1',
        [params.sessionId]
      );

      // Insert records for present students
      if (presentIds.length > 0) {
        const valuePlaceholders = presentIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await query(
          `INSERT INTO session_attendance (session_id, student_id) VALUES ${valuePlaceholders}
           ON CONFLICT (session_id, student_id) DO NOTHING`,
          [params.sessionId, ...presentIds]
        );
      }

      return {
        status: 200 as const,
        body: {
          message: 'Attendance saved successfully',
          code: 'ATTENDANCE.SAVED',
          presentCount: presentIds.length,
        },
      };
    } catch (error) {
      console.error('Save session attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.SAVE_FAILED', 'Failed to save attendance');
    }
  },

  /**
   * GET /api/attendance/student/:studentId
   * Returns attendance history for a student across all their sessions.
   */
  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Get all sessions for classes the student is enrolled in
      const records = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          cl.id AS class_id,
          cl.name AS class_name,
          cl.code AS class_code,
          r.code AS room_code,
          CASE WHEN sa.id IS NOT NULL THEN true ELSE false END AS is_present
        FROM sessions s
        JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa ON sa.session_id = s.id AND sa.student_id = $1
        WHERE s.company_id = $2
          AND s.class_id IN (
            SELECT class_id FROM enrollments
            WHERE student_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT class_id FROM master_class_enrollments
            WHERE student_id = $1 AND company_id = $2 AND status != 'DROPPED'
          )
        ORDER BY s.start_date DESC`,
        [params.studentId, context.companyId]
      );

      return {
        status: 200 as const,
        body: records.map((row: any) => ({
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          classId: row.class_id,
          className: row.class_name,
          classCode: row.class_code,
          roomCode: row.room_code,
          isPresent: row.is_present,
        })),
      };
    } catch (error) {
      console.error('Get student attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.STUDENT_FAILED', 'Failed to get student attendance');
    }
  },

  /**
   * GET /api/attendance/class/:classId
   * Returns per-session attendance summary for a class.
   */
  getByClass: async ({ params, headers }: { params: { classId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const cls = await queryOne(
        `SELECT c.*, co.company_id, co.branch_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [params.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }
      if (!canAccessBranch(context, cls.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED', 'Access denied to this class');
      }

      // Total enrolled students for this class
      const totalResult = await queryOne(
        `SELECT COUNT(*) AS total FROM (
          SELECT student_id FROM enrollments
          WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
          UNION
          SELECT student_id FROM master_class_enrollments
          WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
        ) enrolled`,
        [params.classId, context.companyId]
      );
      const totalStudents = parseInt(totalResult?.total ?? '0', 10);

      const sessions = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          r.code AS room_code,
          COUNT(sa.id) AS present_count
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa ON sa.session_id = s.id
        WHERE s.class_id = $1 AND s.company_id = $2
        GROUP BY s.id, s.start_date, s.end_date, r.code
        ORDER BY s.start_date DESC`,
        [params.classId, context.companyId]
      );

      return {
        status: 200 as const,
        body: sessions.map((row: any) => ({
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          roomCode: row.room_code,
          totalStudents,
          presentCount: parseInt(row.present_count, 10),
          absentCount: Math.max(0, totalStudents - parseInt(row.present_count, 10)),
        })),
      };
    } catch (error) {
      console.error('Get class attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.CLASS_FAILED', 'Failed to get class attendance');
    }
  },

  // ============================================================
  // Teacher attendance — who taught (or was supposed to teach) a session
  // ============================================================

  /**
   * GET /api/attendance/teachers/session/:sessionId
   * Returns the teacher roster for a single session.
   */
  getTeachersBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const rows = await query(
        `SELECT
           sta.id,
           sta.session_id,
           sta.employee_id,
           sta.role,
           sta.status,
           sta.notes,
           sta.created_at,
           e.first_name,
           e.last_name,
           e.position
         FROM session_teacher_attendance sta
         JOIN employees e ON e.id = sta.employee_id
         WHERE sta.session_id = $1
         ORDER BY sta.role ASC, e.first_name ASC, e.last_name ASC`,
        [params.sessionId]
      );

      return {
        status: 200 as const,
        body: rows.map((row: any) => ({
          id: row.id,
          sessionId: row.session_id,
          employeeId: row.employee_id,
          employeeFirstName: row.first_name,
          employeeLastName: row.last_name,
          employeePosition: row.position,
          role: row.role,
          status: row.status,
          notes: row.notes,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('Get session teacher attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_GET_FAILED', 'Failed to get teacher attendance');
    }
  },

  /**
   * POST /api/attendance/teachers/session/:sessionId
   * Replaces the teacher roster for a session.
   * Body: { teachers: [{ employeeId, role, status, notes? }] }
   */
  saveTeachersForSession: async ({ params, body, headers }: { params: { sessionId: string }; body: { teachers: Array<{ employeeId: string; role: string; status: string; notes?: string | null }> }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const teachers = Array.isArray(body?.teachers) ? body.teachers : [];

      await query('DELETE FROM session_teacher_attendance WHERE session_id = $1', [params.sessionId]);

      for (const t of teachers) {
        if (!t.employeeId) continue;
        await query(
          `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, employee_id) DO NOTHING`,
          [
            params.sessionId,
            t.employeeId,
            t.role || 'PRIMARY',
            t.status || 'PRESENT',
            t.notes || null,
          ]
        );
      }

      return { status: 200 as const, body: { message: 'Teacher attendance saved', code: 'ATTENDANCE.TEACHER_SAVED', count: teachers.length } };
    } catch (error) {
      console.error('Save teacher attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_SAVE_FAILED', 'Failed to save teacher attendance');
    }
  },

  /**
   * GET /api/attendance/teachers
   * Cross-employee teacher attendance log with filters.
   */
  getTeachersHistory: async ({ query: queryParams, headers }: { query: { branchId?: string; employeeId?: string; classId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];
      let sql = `
        SELECT
          sta.id,
          sta.session_id,
          sta.employee_id,
          sta.role,
          sta.status,
          sta.notes,
          sta.created_at,
          e.first_name,
          e.last_name,
          e.position,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.branch_id,
          s.class_id,
          cl.name AS class_name,
          cl.code AS class_code,
          co.name AS course_name,
          b.name AS branch_name,
          r.code AS room_code
        FROM session_teacher_attendance sta
        JOIN sessions s ON s.id = sta.session_id
        JOIN employees e ON e.id = sta.employee_id
        LEFT JOIN classes cl ON cl.id = s.class_id
        LEFT JOIN courses co ON co.id = cl.course_id
        LEFT JOIN branches b ON b.id = s.branch_id
        LEFT JOIN rooms r ON r.id = s.room_id
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

      if (queryParams.employeeId) {
        params.push(queryParams.employeeId);
        sql += ` AND sta.employee_id = $${params.length}`;
      }

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND s.class_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND s.start_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND s.start_date <= $${params.length}`;
      }

      sql += ' ORDER BY s.start_date DESC, e.first_name ASC';

      const rows = await query(sql, params);
      return {
        status: 200 as const,
        body: rows.map((row: any) => {
          const start = row.session_start_date ? new Date(row.session_start_date) : null;
          const end = row.session_end_date ? new Date(row.session_end_date) : null;
          const durationMinutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
          return {
            id: row.id,
            sessionId: row.session_id,
            employeeId: row.employee_id,
            employeeFirstName: row.first_name,
            employeeLastName: row.last_name,
            employeePosition: row.position,
            role: row.role,
            status: row.status,
            notes: row.notes,
            sessionStartDate: row.session_start_date,
            sessionEndDate: row.session_end_date,
            durationMinutes,
            branchId: row.branch_id,
            branchName: row.branch_name,
            classId: row.class_id,
            className: row.class_name,
            classCode: row.class_code,
            courseName: row.course_name,
            roomCode: row.room_code,
          };
        }),
      };
    } catch (error) {
      console.error('Get teacher attendance history error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_HISTORY_FAILED', 'Failed to get teacher attendance history');
    }
  },
};
