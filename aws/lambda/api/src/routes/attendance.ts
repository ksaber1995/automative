import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureAttendanceMagicColumns } from './sessions';
import { notifyCheckin } from './telegram';
import { chargeSessionAttendance, chargeSingleCheckin, reverseUnattendedCharges, reverseStudentCharge, ensurePerSessionSchema } from './session-payments';

export const attendanceRoutes = {
  /**
   * GET /api/attendance/session/:sessionId
   * Returns all enrolled students for the session's class with their attendance status.
   */
  getBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
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

      // Enrolled roster (direct + bundle) plus any SUBSTITUTION attendees who are
      // NOT enrolled in this class. Substitution rows are surfaced so the editor
      // can show "<name> · Substitution (from A_1)".
      const students = await query(
        `SELECT
            s.id AS student_id,
            s.first_name AS student_first_name,
            s.last_name AS student_last_name,
            s.student_code AS student_code,
            s.parent_name AS parent_name,
            s.parent_phone AS parent_phone,
            s.phone AS student_phone,
            sa.id AS attendance_id,
            sa.attendance_type AS attendance_type,
            hc.name AS home_class_name,
            true AS is_enrolled
         FROM (
            SELECT student_id FROM enrollments
            WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT student_id FROM master_class_enrollments
            WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
         ) enrolled
         JOIN students s ON s.id = enrolled.student_id
         LEFT JOIN session_attendance sa ON sa.session_id = $3 AND sa.student_id = s.id
         LEFT JOIN classes hc ON hc.id = sa.home_class_id

         UNION ALL

         SELECT
            s.id AS student_id,
            s.first_name AS student_first_name,
            s.last_name AS student_last_name,
            s.student_code AS student_code,
            s.parent_name AS parent_name,
            s.parent_phone AS parent_phone,
            s.phone AS student_phone,
            sa.id AS attendance_id,
            sa.attendance_type AS attendance_type,
            hc.name AS home_class_name,
            false AS is_enrolled
         FROM session_attendance sa
         JOIN students s ON s.id = sa.student_id
         LEFT JOIN classes hc ON hc.id = sa.home_class_id
         WHERE sa.session_id = $3 AND sa.attendance_type = 'SUBSTITUTION'
           AND sa.student_id NOT IN (
             SELECT student_id FROM enrollments
             WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
             UNION
             SELECT student_id FROM master_class_enrollments
             WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
           )
         ORDER BY student_first_name, student_last_name`,
        [session.class_id, context.companyId, params.sessionId]
      );

      // PER_SESSION courses: attach each student's existing session charge so the
      // UI can warn (and show paid amount) before un-checking deletes it.
      const chargeByStudent = new Map<string, { status: string; amountDue: number; amountPaid: number }>();
      const courseType = await queryOne<any>(
        `SELECT co.payment_type FROM classes cl JOIN courses co ON cl.course_id = co.id WHERE cl.id = $1`,
        [session.class_id]
      );
      if (courseType?.payment_type === 'PER_SESSION') {
        await ensurePerSessionSchema();
        const charges = await query<any>(
          `SELECT student_id, payment_status, amount_due, amount_paid
           FROM session_payments WHERE session_id = $1 AND company_id = $2`,
          [params.sessionId, context.companyId]
        );
        for (const c of charges) {
          chargeByStudent.set(c.student_id, {
            status: c.payment_status,
            amountDue: parseFloat(c.amount_due || 0),
            amountPaid: parseFloat(c.amount_paid || 0),
          });
        }
      }

      return {
        status: 200 as const,
        body: students.map((row: any) => ({
          studentId: row.student_id,
          studentFirstName: row.student_first_name,
          studentLastName: row.student_last_name,
          studentCode: row.student_code ?? null,
          parentName: row.parent_name || null,
          parentPhone: row.parent_phone || null,
          studentPhone: row.student_phone || null,
          isPresent: row.attendance_id !== null,
          attendanceId: row.attendance_id || null,
          attendanceType: row.attendance_type || null,
          homeClassName: row.home_class_name || null,
          isEnrolled: row.is_enrolled === true,
          charge: chargeByStudent.get(row.student_id) || null,
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
      await ensureAttendanceMagicColumns();
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

      // Only NORMAL (enrolled-roster) rows are managed by the checkbox editor.
      // SUBSTITUTION rows come from QR check-in and must survive a bulk save.
      await query(
        `DELETE FROM session_attendance WHERE session_id = $1 AND attendance_type = 'NORMAL'`,
        [params.sessionId]
      );

      // Insert records for present students
      if (presentIds.length > 0) {
        const valuePlaceholders = presentIds.map((_, i) => `($1, $${i + 2}, 'NORMAL')`).join(', ');
        await query(
          `INSERT INTO session_attendance (session_id, student_id, attendance_type) VALUES ${valuePlaceholders}
           ON CONFLICT (session_id, student_id) DO NOTHING`,
          [params.sessionId, ...presentIds]
        );
      }

      // PER_SESSION courses: create/consume per-session charges for this save.
      // Returns the newly-created PENDING charges that still need collection.
      // Best-effort: a billing hiccup must never fail the attendance save itself.
      let sessionCharges: any[] = [];
      try {
        sessionCharges = await chargeSessionAttendance(context.companyId, session, presentIds);
      } catch (billErr) {
        console.error('Per-session charge (saveForSession) error:', billErr);
      }
      // Un-checked students: drop the per-session charge created when they were
      // marked present (and refund any package credit). Best-effort.
      try {
        await reverseUnattendedCharges(context.companyId, session, presentIds);
      } catch (revErr) {
        console.error('Per-session reverse (saveForSession) error:', revErr);
      }

      return {
        status: 200 as const,
        body: {
          message: 'Attendance saved successfully',
          code: 'ATTENDANCE.SAVED',
          presentCount: presentIds.length,
          sessionCharges,
        },
      };
    } catch (error) {
      console.error('Save session attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.SAVE_FAILED', 'Failed to save attendance');
    }
  },

  /**
   * DELETE /api/attendance/session/:sessionId/student/:studentId
   * Remove a single attendance record (any type) — used to undo a wrong QR
   * check-in, including SUBSTITUTION attendees the checkbox editor can't manage.
   */
  removeAttendee: async ({ params, headers }: { params: { sessionId: string; studentId: string }; headers: { authorization: string } }) => {
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
      await query(
        'DELETE FROM session_attendance WHERE session_id = $1 AND student_id = $2',
        [params.sessionId, params.studentId]
      );
      // Un-checking a student drops the per-session charge raised for their
      // attendance (and restores any package credit). Best-effort.
      try {
        await reverseStudentCharge(context.companyId, session, params.studentId);
      } catch (revErr) {
        console.error('Per-session reverse (removeAttendee) error:', revErr);
      }
      return { status: 200 as const, body: { message: 'Attendee removed', code: 'ATTENDANCE.REMOVED' } };
    } catch (error) {
      console.error('Remove attendee error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.REMOVE_FAILED', 'Failed to remove attendee');
    }
  },

  /**
   * POST /api/attendance/session/:sessionId/checkin
   * Mark a single student present by scanning their QR token. Idempotent —
   * re-scanning an already-present student is a no-op (returns alreadyPresent).
   * Body: { qrToken: string }
   */
  checkinByQr: async ({ params, body, headers }: { params: { sessionId: string }; body: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
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

      const token = (body?.qrToken || '').trim();
      if (!token) {
        return apiError(400, 'ERRORS.ATTENDANCE.QR_TOKEN_REQUIRED', 'QR token is required');
      }

      // Resolve the student by token, scoped to this tenant — a token from
      // another company must not be accepted. Every student's QR works by
      // default (no activation gate).
      const student = await queryOne<any>(
        `SELECT s.id, s.first_name, s.last_name
         FROM students s
         WHERE s.qr_token = $1 AND s.company_id = $2 AND s.is_active = true`,
        [token, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.ATTENDANCE.QR_STUDENT_NOT_FOUND', 'No active student matches this QR code');
      }

      // Is the student enrolled in THIS session's class?
      const enrolled = await queryOne<any>(
        `SELECT 1 FROM (
            SELECT student_id FROM enrollments
            WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT student_id FROM master_class_enrollments
            WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
         ) enrolled
         WHERE student_id = $3`,
        [session.class_id, context.companyId, student.id]
      );

      if (enrolled) {
        // NORMAL check-in. Idempotent: RETURNING only yields a row when a NEW
        // record was inserted; an ON CONFLICT no-op returns nothing — that's how
        // we tell a fresh check-in from a re-scan of an already-present student.
        const inserted = await query(
          `INSERT INTO session_attendance (session_id, student_id, attendance_type)
           VALUES ($1, $2, 'NORMAL')
           ON CONFLICT (session_id, student_id) DO NOTHING
           RETURNING id`,
          [params.sessionId, student.id]
        );
        const alreadyPresent = inserted.length === 0;

        // Best-effort Telegram present notification (no-op unless enabled).
        await notifyCheckin(context.companyId, params.sessionId, student.id);

        // PER_SESSION courses: create/consume the charge for this check-in.
        // Best-effort — billing must never fail the check-in itself.
        let sessionCharge: any = null;
        try {
          sessionCharge = await chargeSingleCheckin(context.companyId, session, student.id);
        } catch (billErr) {
          console.error('Per-session charge (checkinByQr) error:', billErr);
        }

        return {
          status: 200 as const,
          body: {
            studentId: student.id,
            studentFirstName: student.first_name,
            studentLastName: student.last_name,
            attendanceType: 'NORMAL' as const,
            homeClassName: null,
            sessionNumber: session.session_number ?? null,
            alreadyPresent,
            code: alreadyPresent ? 'ATTENDANCE.ALREADY_PRESENT' : 'ATTENDANCE.CHECKED_IN',
            message: alreadyPresent ? 'Student was already marked present' : 'Student marked present',
            sessionCharge,
          },
        };
      }

      // Not enrolled in this class → try SUBSTITUTION. The student qualifies if
      // they're enrolled in a sibling class of the SAME course. Being a member of
      // the Course is enough — the sessions can be on different days/classes.
      const course = await queryOne<any>(
        `SELECT c.course_id
         FROM classes c
         WHERE c.id = $1`,
        [session.class_id]
      );
      const siblingClass = course?.course_id
        ? await queryOne<any>(
            `SELECT cl.id, cl.name
             FROM classes cl
             WHERE cl.course_id = $1
               AND cl.id <> $2
               AND cl.id IN (
                 SELECT class_id FROM enrollments
                 WHERE company_id = $3 AND student_id = $4 AND status NOT IN ('DROPPED', 'CANCELLED')
                 UNION
                 SELECT class_id FROM master_class_enrollments
                 WHERE company_id = $3 AND student_id = $4 AND status != 'DROPPED'
               )
             ORDER BY cl.created_at ASC
             LIMIT 1`,
            [course.course_id, session.class_id, context.companyId, student.id]
          )
        : null;

      if (!siblingClass) {
        // Not in this class and not in any sibling class of the course.
        return apiError(409, 'ERRORS.ATTENDANCE.STUDENT_NOT_IN_CLASS', 'This student is not enrolled in this class');
      }

      const insertedSub = await query(
        `INSERT INTO session_attendance (session_id, student_id, attendance_type, home_class_id)
         VALUES ($1, $2, 'SUBSTITUTION', $3)
         ON CONFLICT (session_id, student_id) DO NOTHING
         RETURNING id`,
        [params.sessionId, student.id, siblingClass.id]
      );
      const alreadyPresentSub = insertedSub.length === 0;

      // Best-effort Telegram present notification (no-op unless enabled).
      await notifyCheckin(context.companyId, params.sessionId, student.id);

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
          attendanceType: 'SUBSTITUTION' as const,
          homeClassName: siblingClass.name,
          sessionNumber: session.session_number ?? null,
          alreadyPresent: alreadyPresentSub,
          code: alreadyPresentSub ? 'ATTENDANCE.ALREADY_PRESENT_SUB' : 'ATTENDANCE.CHECKED_IN_SUB',
          message: alreadyPresentSub
            ? 'Student was already marked as substitution'
            : 'Student marked present by substitution',
        },
      };
    } catch (error) {
      console.error('QR check-in error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.CHECKIN_FAILED', 'Failed to check in student');
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

      await ensureAttendanceMagicColumns();

      // For each session of the student's enrolled classes, derive a status:
      //   PRESENT     — a NORMAL attendance row exists for this session.
      //   SUBSTITUTED — no NORMAL row, but the student has a SUBSTITUTION row on a
      //                 session of the SAME course with the SAME session_number.
      //   ABSENT      — neither.
      // SUBSTITUTED counts as present for the attendance rate.
      const records = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.session_number AS session_number,
          cl.id AS class_id,
          cl.name AS class_name,
          r.code AS room_code,
          CASE WHEN sa.id IS NOT NULL THEN true ELSE false END AS is_present_normal,
          sub.sub_class_name AS substituted_in_class_name
        FROM sessions s
        JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa
          ON sa.session_id = s.id AND sa.student_id = $1 AND sa.attendance_type = 'NORMAL'
        LEFT JOIN LATERAL (
          SELECT c2.name AS sub_class_name
          FROM session_attendance sub2
          JOIN sessions s2 ON s2.id = sub2.session_id
          JOIN classes c2 ON c2.id = s2.class_id
          WHERE sub2.student_id = $1
            AND sub2.attendance_type = 'SUBSTITUTION'
            AND c2.course_id = cl.course_id
            AND s2.session_number = s.session_number
            AND s.session_number IS NOT NULL
          LIMIT 1
        ) sub ON true
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

      // Substitutions the student made into a class they're NOT enrolled in, where
      // no enrolled-class session of the same (course, session_number) exists yet
      // to carry the SUBSTITUTED status above. Without this, a substitution made
      // before the home session is started would never appear on the student page.
      const orphanSubs = await query(
        `SELECT
          s2.id AS session_id,
          s2.start_date AS session_start_date,
          s2.end_date AS session_end_date,
          s2.session_number AS session_number,
          c2.id AS class_id,
          c2.name AS class_name,
          r2.code AS room_code,
          hc.name AS home_class_name
        FROM session_attendance sub
        JOIN sessions s2 ON s2.id = sub.session_id
        JOIN classes c2 ON c2.id = s2.class_id
        LEFT JOIN rooms r2 ON r2.id = s2.room_id
        LEFT JOIN classes hc ON hc.id = sub.home_class_id
        WHERE sub.student_id = $1
          AND sub.attendance_type = 'SUBSTITUTION'
          AND s2.company_id = $2
          AND NOT EXISTS (
            SELECT 1 FROM sessions hs
            JOIN classes hcc ON hcc.id = hs.class_id
            WHERE hcc.course_id = c2.course_id
              AND hs.session_number = s2.session_number
              AND s2.session_number IS NOT NULL
              AND hs.class_id IN (
                SELECT class_id FROM enrollments
                WHERE student_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
                UNION
                SELECT class_id FROM master_class_enrollments
                WHERE student_id = $1 AND company_id = $2 AND status != 'DROPPED'
              )
          )
        ORDER BY s2.start_date DESC`,
        [params.studentId, context.companyId]
      );

      const enrolledBody = records.map((row: any) => {
        const status: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED' =
          row.is_present_normal ? 'PRESENT'
          : row.substituted_in_class_name ? 'SUBSTITUTED'
          : 'ABSENT';
        return {
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          sessionNumber: row.session_number === null || row.session_number === undefined
            ? null
            : parseInt(row.session_number, 10),
          classId: row.class_id,
          className: row.class_name,
          roomCode: row.room_code,
          status,
          substitutedInClassName: row.substituted_in_class_name || null,
          // Backward-compatible: present OR substituted.
          isPresent: status !== 'ABSENT',
        };
      });

      const orphanBody = orphanSubs.map((row: any) => ({
        sessionId: row.session_id,
        sessionStartDate: row.session_start_date,
        sessionEndDate: row.session_end_date,
        sessionNumber: row.session_number === null || row.session_number === undefined
          ? null
          : parseInt(row.session_number, 10),
        classId: row.class_id,
        // The class the student physically attended as a substitute.
        className: row.class_name,
        roomCode: row.room_code,
        status: 'SUBSTITUTED' as const,
        substitutedInClassName: row.class_name,
        isPresent: true,
      }));

      const body = [...enrolledBody, ...orphanBody].sort((a, b) =>
        new Date(b.sessionStartDate).getTime() - new Date(a.sessionStartDate).getTime()
      );

      return { status: 200 as const, body };
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
      await ensureAttendanceMagicColumns();
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
          s.session_number AS session_number,
          r.code AS room_code,
          COUNT(sa.id) AS present_count
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa
          ON sa.session_id = s.id AND sa.attendance_type = 'NORMAL'
        WHERE s.class_id = $1 AND s.company_id = $2
        GROUP BY s.id, s.start_date, s.end_date, s.session_number, r.code
        ORDER BY s.start_date DESC`,
        [params.classId, context.companyId]
      );

      return {
        status: 200 as const,
        body: sessions.map((row: any) => ({
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          sessionNumber: row.session_number === null || row.session_number === undefined
            ? null
            : parseInt(row.session_number, 10),
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
          co.name AS course_name,
          b.name AS branch_name,
          r.code AS room_code,
          EXISTS (
            SELECT 1 FROM session_salary_payments ssp
            WHERE ssp.session_id = sta.session_id AND ssp.employee_id = sta.employee_id
          ) AS paid
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
            courseName: row.course_name,
            roomCode: row.room_code,
            paid: row.paid === true,
          };
        }),
      };
    } catch (error) {
      console.error('Get teacher attendance history error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_HISTORY_FAILED', 'Failed to get teacher attendance history');
    }
  },
};
