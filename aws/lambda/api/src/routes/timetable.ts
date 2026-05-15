import { query } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

const DAY_NAMES = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

function dayNameForDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD; treat as local date
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return DAY_NAMES[dt.getUTCDay()];
}

function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

function buildIsoFromDateAndTime(date: string, time: string | null): string | null {
  if (!time) return null;
  // time may be "HH:MM" or "HH:MM:SS"
  const [hh, mm, ss] = time.split(':');
  const hours = String(hh).padStart(2, '0');
  const mins = String(mm).padStart(2, '0');
  const secs = ss ? String(ss).padStart(2, '0') : '00';
  return `${date}T${hours}:${mins}:${secs}`;
}

function mapEntry(row: any, date: string) {
  const scheduledStart = buildIsoFromDateAndTime(date, row.start_time);
  const scheduledEnd = buildIsoFromDateAndTime(date, row.end_time);

  return {
    classId: row.id,
    className: row.name,
    classCode: row.code,
    courseId: row.course_id,
    courseName: row.course_name,
    branchId: row.branch_id,
    branchName: row.branch_name,
    instructorId: row.instructor_id,
    instructorName: row.instructor_name,
    roomId: row.session_room_id || null,
    roomCode: row.session_room_code || null,
    sessionId: row.session_id || null,
    sessionStart: row.session_start || null,
    sessionEnd: row.session_end || null,
    isInProgress: !!row.session_id && !row.session_end,
    scheduledStart,
    scheduledEnd,
    startTime: row.start_time,
    endTime: row.end_time,
    daysOfWeek: row.days_of_week,
    studentCount: parseInt(row.student_count ?? '0', 10),
    maxStudents: row.max_students,
    notes: row.notes,
  };
}

export const timetableRoutes = {
  getDay: async ({
    query: queryParams,
    headers,
  }: {
    query: { date: string; branchId?: string; teacherId?: string; courseId?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const date = queryParams.date;
      if (!date || !isValidDate(date)) {
        return {
          status: 400 as const,
          body: { message: 'A valid date (YYYY-MM-DD) is required' },
        };
      }

      const dayName = dayNameForDate(date);

      let sql = `
        SELECT
          c.id,
          c.name,
          c.code,
          c.course_id,
          co.branch_id,
          c.instructor_id,
          c.start_time,
          c.end_time,
          c.days_of_week,
          c.start_date,
          c.end_date,
          c.max_students,
          c.notes,
          co.name AS course_name,
          b.name AS branch_name,
          CONCAT(e.first_name, ' ', e.last_name) AS instructor_name,
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          s.id AS session_id,
          s.start_date AS session_start,
          s.end_date AS session_end,
          s.room_id AS session_room_id,
          r.code AS session_room_code
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        LEFT JOIN LATERAL (
          SELECT s2.id, s2.start_date, s2.end_date, s2.room_id
          FROM sessions s2
          WHERE s2.class_id = c.id
            AND s2.start_date::date = $2::date
          ORDER BY s2.start_date DESC
          LIMIT 1
        ) s ON TRUE
        LEFT JOIN rooms r ON s.room_id = r.id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND c.start_time IS NOT NULL
          AND c.end_time IS NOT NULL
          AND c.days_of_week IS NOT NULL
          AND c.days_of_week <> ''
          AND POSITION($3 IN UPPER(c.days_of_week)) > 0
          AND (c.start_date IS NULL OR c.start_date <= $2::date)
          AND (c.end_date IS NULL OR c.end_date >= $2::date)
      `;
      const params: any[] = [context.companyId, date, dayName];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND co.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND co.branch_id = $${params.length}`;
      }

      if (queryParams.teacherId) {
        params.push(queryParams.teacherId);
        sql += ` AND c.instructor_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      sql += ' ORDER BY c.start_time ASC, c.name ASC';

      const rows = await query(sql, params);
      const entries = rows.map((r: any) => mapEntry(r, date));

      return {
        status: 200 as const,
        body: {
          date,
          dayOfWeek: dayName,
          entries,
        },
      };
    } catch (error) {
      console.error('Timetable getDay error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to load timetable' },
      };
    }
  },
};
