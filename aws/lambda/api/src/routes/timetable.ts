import { query } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureClassDayTimesSchema } from './classes';

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
    // A prepared (started=false) session is NOT in progress — it's pre-attendance.
    // Accept 1 as well as true so a started session is detected regardless of how
    // the driver returns booleans (SQLite hands back 1/0, Postgres true/false) —
    // otherwise a started session is never flagged and lingers in "upcoming".
    sessionStarted: row.session_started === true || row.session_started === 1,
    isInProgress: !!row.session_id && (row.session_started === true || row.session_started === 1) && !row.session_end,
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
    query: { date: string; branchId?: string; teacherId?: string; courseId?: string; roomId?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const date = queryParams.date;
      if (!date || !isValidDate(date)) {
        return apiError(400, 'ERRORS.TIMETABLE.INVALID_DATE', 'A valid date (YYYY-MM-DD) is required');
      }

      const dayName = dayNameForDate(date);

      let sql = `
        SELECT
          c.id,
          c.name,
          c.course_id,
          co.branch_id,
          c.instructor_id,
          -- Per-day time when the class has one; otherwise the class's own legacy
          -- time, which may itself be NULL for a class scheduled by day only.
          COALESCE(cdt.start_time, c.start_time) AS start_time,
          COALESCE(cdt.end_time, c.end_time) AS end_time,
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
          s.started AS session_started,
          -- Where it actually ran beats where it was scheduled: a session opened
          -- in another room is the truth for that day. Before any session exists,
          -- the class's own room is what the timetable shows.
          COALESCE(s.room_id, c.room_id) AS session_room_id,
          COALESCE(r.code, cr.code) AS session_room_code
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        -- One row per day the class runs, carrying that day's own start/end time.
        -- LEFT, not INNER: class_day_times is only backfilled for classes that
        -- have a start_time, so a class scheduled by weekday with no time never
        -- got a row — and an inner join dropped it from the timetable entirely.
        LEFT JOIN class_day_times cdt ON cdt.class_id = c.id AND cdt.day_of_week = $3
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        LEFT JOIN LATERAL (
          SELECT s2.id, s2.start_date, s2.end_date, s2.room_id, s2.started
          FROM sessions s2
          WHERE s2.class_id = c.id
            AND s2.start_date::date = $2::date
          ORDER BY s2.start_date DESC
          LIMIT 1
        ) s ON TRUE
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN rooms cr ON cr.id = c.room_id
        WHERE co.company_id = $1
          AND c.is_active = true
          AND (c.start_date IS NULL OR c.start_date <= $2::date)
          AND (c.end_date IS NULL OR c.end_date >= $2::date)
          AND (
            -- Normal case: this class has a per-day row for this weekday.
            cdt.class_id IS NOT NULL
            -- Fallback for a class that has NO per-day rows at all: honour the
            -- legacy days_of_week list. Scoped to classes with no rows so a class
            -- that IS scheduled per-day doesn't leak onto days it was removed
            -- from — those removals live only in class_day_times.
            OR (
              NOT EXISTS (SELECT 1 FROM class_day_times d2 WHERE d2.class_id = c.id)
              AND c.days_of_week IS NOT NULL
              AND c.days_of_week <> ''
              AND $3 = ANY(string_to_array(UPPER(REPLACE(c.days_of_week, ' ', '')), ','))
            )
          )
      `;
      const params: any[] = [context.companyId, date, dayName];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND co.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'co.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      if (queryParams.teacherId) {
        params.push(queryParams.teacherId);
        sql += ` AND c.instructor_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      // Matches on the same room the row displays: the day's session room when it
      // has one, otherwise the class's scheduled room.
      if (queryParams.roomId) {
        params.push(queryParams.roomId);
        sql += ` AND COALESCE(s.room_id, c.room_id) = $${params.length}`;
      }

      sql += ' ORDER BY cdt.start_time ASC, c.name ASC';

      await ensureClassDayTimesSchema();
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
      return mapThrownError(error, 'ERRORS.TIMETABLE.LOAD_FAILED', 'Failed to load timetable');
    }
  },
};
