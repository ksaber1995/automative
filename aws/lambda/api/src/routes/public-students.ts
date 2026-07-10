import { query, queryOne } from '../db/connection';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError } from '../utils/api-error';
import { ensureAttendanceMagicColumns } from './sessions';

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
      await ensureAttendanceMagicColumns();
      const token = (params.qrToken || '').trim();
      // Cheap shape check before hitting the DB; tokens are 32 hex chars.
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Not found');
      }

      const student = await queryOne<any>(
        `SELECT s.id, s.first_name, s.last_name, s.company_id, s.branch_id,
                b.name AS branch_name, co.name AS academy_name, co.type AS company_type
         FROM students s
         JOIN branches b ON b.id = s.branch_id
         JOIN companies co ON co.id = s.company_id
         WHERE s.qr_token = $1 AND s.is_active = true`,
        [token]
      );

      // Generic 404 — never reveal whether a token is unknown vs inactive.
      // Every student's QR works by default (no activation gate).
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
            s.session_number AS session_number,
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
        [student.id, student.company_id]
      );

      // Substitutions into a non-enrolled class with no matching home-class session
      // yet — surfaced so they show even before the home session is started.
      const orphanSubs = await query<any>(
        `SELECT
            s2.start_date AS session_start_date,
            s2.session_number AS session_number,
            c2.name AS class_name,
            r2.code AS room_code,
            false AS is_present_normal,
            c2.name AS substituted_in_class_name
         FROM session_attendance sub
         JOIN sessions s2 ON s2.id = sub.session_id
         JOIN classes c2 ON c2.id = s2.class_id
         LEFT JOIN rooms r2 ON r2.id = s2.room_id
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
           )`,
        [student.id, student.company_id]
      );

      // Exam grades (low-sensitivity: exam name, course, date, grade). Tolerant
      // of DBs that haven't had the exams migration applied yet.
      let exams: any[] = [];
      try {
        exams = await query<any>(
          `SELECT e.name AS exam_name, c.name AS course_name, e.exam_date, e.max_grade, r.grade
           FROM exam_results r
           JOIN exams e   ON e.id = r.exam_id AND e.is_active = true
           JOIN courses c ON c.id = e.course_id
           WHERE r.student_id = $1 AND r.company_id = $2
           ORDER BY e.exam_date DESC`,
          [student.id, student.company_id],
        );
      } catch {
        exams = [];
      }

      // Derive status per session: SUBSTITUTED counts as present.
      const withStatus = [...attendance, ...orphanSubs]
        .map((a: any) => ({
          ...a,
          status: a.is_present_normal ? 'PRESENT' : (a.substituted_in_class_name ? 'SUBSTITUTED' : 'ABSENT'),
        }))
        .sort((a: any, b: any) => new Date(b.session_start_date).getTime() - new Date(a.session_start_date).getTime());
      const totalSessions = withStatus.length;
      const presentCount = withStatus.filter((a: any) => a.status !== 'ABSENT').length;
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
            recent: withStatus.slice(0, 10).map((row: any) => ({
              sessionStartDate: row.session_start_date,
              sessionNumber: row.session_number === null || row.session_number === undefined
                ? null
                : parseInt(row.session_number, 10),
              className: row.class_name,
              roomCode: row.room_code,
              status: row.status,
              substitutedInClassName: row.substituted_in_class_name || null,
              // Backward-compatible: present OR substituted.
              isPresent: row.status !== 'ABSENT',
            })),
          },
          exams: exams.map((row: any) => ({
            examName: row.exam_name,
            courseName: row.course_name,
            examDate: row.exam_date,
            grade: row.grade,
            maxGrade: row.max_grade !== null && row.max_grade !== undefined ? parseFloat(row.max_grade) : null,
          })),
        },
      };
    } catch (error) {
      console.error('Public student profile error:', error);
      return apiError(500, 'ERRORS.STUDENTS.PROFILE_FAILED', 'Failed to load profile');
    }
  },
};
