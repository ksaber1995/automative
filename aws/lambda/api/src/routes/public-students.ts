import { query, queryOne } from '../db/connection';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError } from '../utils/api-error';

type AuthHeaders = { authorization?: string };

/**
 * Public, UNAUTHENTICATED student profile resolved by QR token.
 *
 * Reached by scanning a student's QR code with any phone camera (the QR
 * encodes a URL ending in this token). Deliberately does NOT call
 * extractTenantContext — the opaque token is the only credential, and it
 * scopes the result to exactly one student. Tenant (company/branch) is read
 * FROM the resolved student, never from a JWT.
 *
 * PRIVACY: this page has no login, so it exposes only low-sensitivity data —
 * name, branch/academy, course list with high-level status, and an
 * attendance summary. It intentionally omits contact info, address, notes,
 * and all financial amounts. Payment is surfaced as a coarse status label
 * only. If full financials are ever wanted here, gate them behind an
 * additional check (e.g. date of birth) — do not just add the columns.
 */
export const publicStudentsRoutes = {
  profile: async ({ params }: { params: { qrToken: string }; headers: AuthHeaders }) => {
    // Rate-limit by IP so the token space can't be brute-forced.
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      const token = (params.qrToken || '').trim();
      // Cheap shape check before hitting the DB; tokens are 32 hex chars.
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Not found');
      }

      const student = await queryOne<any>(
        `SELECT s.id, s.first_name, s.last_name, s.company_id, s.branch_id,
                b.name AS branch_name, co.name AS academy_name
         FROM students s
         JOIN branches b ON b.id = s.branch_id
         JOIN companies co ON co.id = s.company_id
         WHERE s.qr_token = $1 AND s.is_active = true`,
        [token]
      );

      // Generic 404 — never reveal whether a token is unknown vs inactive.
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Not found');
      }

      // Courses the student is enrolled in (regular enrollments). Coarse
      // status only — no prices, no payment amounts.
      const courses = await query<any>(
        `SELECT c.name AS course_name,
                cl.name AS class_name,
                e.status AS status,
                e.payment_status AS payment_status,
                e.enrollment_date AS enrollment_date
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE e.student_id = $1 AND e.company_id = $2
         ORDER BY e.enrollment_date DESC`,
        [student.id, student.company_id]
      );

      // Attendance across all sessions for the student's enrolled classes.
      // Mirrors attendance.getByStudent, scoped by the resolved company.
      const attendance = await query<any>(
        `SELECT
            s.start_date AS session_start_date,
            cl.name AS class_name,
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
        [student.id, student.company_id]
      );

      const totalSessions = attendance.length;
      const presentCount = attendance.filter((a) => a.is_present === true).length;
      const absentCount = totalSessions - presentCount;
      const attendanceRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

      return {
        status: 200 as const,
        body: {
          student: {
            firstName: student.first_name,
            lastName: student.last_name,
            branchName: student.branch_name,
            academyName: student.academy_name,
          },
          courses: courses.map((row) => ({
            courseName: row.course_name,
            className: row.class_name,
            status: row.status,
            paymentStatus: row.payment_status,
            enrollmentDate: row.enrollment_date,
          })),
          attendance: {
            totalSessions,
            presentCount,
            absentCount,
            attendanceRate,
            recent: attendance.slice(0, 10).map((row) => ({
              sessionStartDate: row.session_start_date,
              className: row.class_name,
              roomCode: row.room_code,
              isPresent: row.is_present,
            })),
          },
        },
      };
    } catch (error) {
      console.error('Public student profile error:', error);
      return apiError(500, 'ERRORS.STUDENTS.PROFILE_FAILED', 'Failed to load profile');
    }
  },
};
