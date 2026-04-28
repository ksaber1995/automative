import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export const attendanceRoutes = {
  /**
   * GET /api/attendance/session/:sessionId
   * Returns all enrolled students for the session's class with their attendance status.
   */
  getBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'sessions', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      // Verify session belongs to company
      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return { status: 404 as const, body: { message: 'Session not found' } };
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this session' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get attendance' },
      };
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
      if (!checkGranularPermission(context, 'sessions', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return { status: 404 as const, body: { message: 'Session not found' } };
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this session' } };
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
          presentCount: presentIds.length,
        },
      };
    } catch (error) {
      console.error('Save session attendance error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to save attendance' },
      };
    }
  },

  /**
   * GET /api/attendance/student/:studentId
   * Returns attendance history for a student across all their sessions.
   */
  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'sessions', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get student attendance' },
      };
    }
  },

  /**
   * GET /api/attendance/class/:classId
   * Returns per-session attendance summary for a class.
   */
  getByClass: async ({ params, headers }: { params: { classId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'sessions', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const cls = await queryOne(
        'SELECT * FROM classes WHERE id = $1 AND company_id = $2',
        [params.classId, context.companyId]
      );
      if (!cls) {
        return { status: 404 as const, body: { message: 'Class not found' } };
      }
      if (!canAccessBranch(context, cls.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this class' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get class attendance' },
      };
    }
  },
};
