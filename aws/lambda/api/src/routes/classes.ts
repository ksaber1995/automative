import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

let classSchemaInitPromise: Promise<void> | null = null;
async function ensureClassStatusColumns(): Promise<void> {
  if (!classSchemaInitPromise) {
    classSchemaInitPromise = (async () => {
      try {
        await query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS is_finished BOOLEAN NOT NULL DEFAULT FALSE`);
        await query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ`);
        await query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'OFFLINE'`);
        // The room a class is scheduled in, chosen up front. Sessions still carry
        // their own room_id (where it ACTUALLY ran, which can differ on the day);
        // this is the plan, and it's what the timetable shows before a session
        // exists. ON DELETE SET NULL: deleting a room must not delete classes.
        await query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS room_id UUID`);
        await query(`CREATE INDEX IF NOT EXISTS idx_classes_room_id ON classes(room_id)`);
        // The FK is added separately and guarded: this ensure() runs at the top of
        // EVERY class endpoint, so a throw here would take the whole feature down.
        // Nothing is lost if it doesn't attach — the column still works.
        await query(`DO $$
          BEGIN
            IF to_regclass('public.rooms') IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_room_id_fkey') THEN
              ALTER TABLE classes
                ADD CONSTRAINT classes_room_id_fkey
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
            END IF;
          END $$`);
        // Soft-delete marker: a class that has payments cannot be hard-deleted
        // (that would destroy financial records), so it is hidden from the tenant
        // by stamping deleted_at. Every tenant-facing class query filters it out.
        await query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
        // Drop redundant columns: branch_id and company_id are derivable from courses.
        // Drop the unique constraint and indexes that depend on company_id first.
        await query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_company_id_code_key`);
        await query(`DROP INDEX IF EXISTS idx_classes_branch_id`);
        await query(`DROP INDEX IF EXISTS idx_classes_company_id`);
        await query(`ALTER TABLE classes DROP COLUMN IF EXISTS branch_id`);
        await query(`ALTER TABLE classes DROP COLUMN IF EXISTS company_id`);
        // Drop the unused per-class code column (migration 039).
        await query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS unique_class_code`);
        await query(`DROP INDEX IF EXISTS idx_classes_code`);
        await query(`ALTER TABLE classes DROP COLUMN IF EXISTS code`);
      } catch (e) {
        classSchemaInitPromise = null;
        throw e;
      }
    })();
  }
  return classSchemaInitPromise;
}

/** Sentinel: a room id was given, but it isn't one of this company's rooms. */
const INVALID_ROOM = Symbol('invalid-room');

/**
 * Validate the scheduled room against the caller's company. Returns null when no
 * room was chosen (or it was cleared), the id when it checks out, and the
 * INVALID_ROOM sentinel when it belongs to someone else — which must 404 rather
 * than silently save nothing.
 */
async function resolveRoomId(raw: any, companyId: string): Promise<string | null | typeof INVALID_ROOM> {
  if (raw === undefined || raw === null || raw === '') return null;
  const room = await queryOne<any>('SELECT id FROM rooms WHERE id = $1 AND company_id = $2', [raw, companyId]);
  return room ? String(raw) : INVALID_ROOM;
}

function normalizeClassType(value: any): 'ONLINE' | 'OFFLINE' {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return upper === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
}

// ---- Per-day class times ------------------------------------------------
// A class can run at a different start/end on each of its days. class_day_times
// is the source of truth (one row per day); classes.days_of_week + start_time/
// end_time are kept in sync (the day set, and the min-start/max-end envelope) so
// legacy readers still work. Idempotent-runtime schema, mirrors ensureLevelSchema.
let classDayTimesInitPromise: Promise<void> | null = null;
export async function ensureClassDayTimesSchema(): Promise<void> {
  if (!classDayTimesInitPromise) {
    classDayTimesInitPromise = (async () => {
      try {
        await query(`CREATE TABLE IF NOT EXISTS class_day_times (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
          day_of_week VARCHAR(16) NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (class_id, day_of_week)
        )`);
        await query(`CREATE INDEX IF NOT EXISTS idx_class_day_times_class ON class_day_times(class_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_class_day_times_day ON class_day_times(day_of_week)`);
        // Backfill one row per (class, day) from the legacy single time so nothing
        // changes until a class is edited. Idempotent via UNIQUE + DO NOTHING.
        await query(`INSERT INTO class_day_times (class_id, day_of_week, start_time, end_time)
          SELECT c.id, UPPER(TRIM(d)) AS day_of_week, c.start_time, c.end_time
          FROM classes c,
               LATERAL unnest(string_to_array(c.days_of_week, ',')) AS d
          WHERE c.start_time IS NOT NULL AND c.end_time IS NOT NULL
            AND c.days_of_week IS NOT NULL AND c.days_of_week <> '' AND TRIM(d) <> ''
          ON CONFLICT (class_id, day_of_week) DO NOTHING`);
      } catch (e) {
        classDayTimesInitPromise = null;
        throw e;
      }
    })();
  }
  return classDayTimesInitPromise;
}

type DayTime = { day: string; startTime: string; endTime: string };

// Aggregates a class's per-day times into a JSON array for the response body.
// Aliased `c` must be the classes row in the surrounding query.
const DAY_TIMES_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('day', cdt.day_of_week, 'startTime', cdt.start_time, 'endTime', cdt.end_time) ORDER BY cdt.start_time ASC)
  FROM class_day_times cdt
  WHERE cdt.class_id = c.id
), '[]'::json) AS day_times_json`;

// The per-day times a create/update body wants. Prefers the explicit `dayTimes`
// array; falls back to the legacy "one time for all listed days" shape.
function resolveDayTimes(body: any): DayTime[] | null {
  if (Array.isArray(body.dayTimes)) {
    const seen = new Set<string>();
    const out: DayTime[] = [];
    for (const dt of body.dayTimes) {
      const day = String(dt?.day || '').toUpperCase().trim();
      if (!day || seen.has(day) || !dt?.startTime || !dt?.endTime) continue;
      seen.add(day);
      out.push({ day, startTime: dt.startTime, endTime: dt.endTime });
    }
    return out;
  }
  if (body.daysOfWeek && body.startTime && body.endTime) {
    const days = String(body.daysOfWeek).split(',').map((d: string) => d.toUpperCase().trim()).filter(Boolean);
    return days.map((day) => ({ day, startTime: body.startTime, endTime: body.endTime }));
  }
  return null;
}

// Replace a class's day-time rows with exactly `dayTimes`.
async function setClassDayTimes(classId: string, dayTimes: DayTime[]) {
  await query('DELETE FROM class_day_times WHERE class_id = $1', [classId]);
  for (const dt of dayTimes) {
    await query(
      `INSERT INTO class_day_times (class_id, day_of_week, start_time, end_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_id, day_of_week) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
      [classId, dt.day, dt.startTime, dt.endTime]
    );
  }
}

// Current per-day times for a class, ordered by start.
async function getClassDayTimes(classId: string): Promise<DayTime[]> {
  const rows = await query(
    `SELECT day_of_week, start_time, end_time FROM class_day_times WHERE class_id = $1 ORDER BY start_time ASC`,
    [classId]
  );
  return rows.map((r: any) => ({ day: r.day_of_week, startTime: r.start_time, endTime: r.end_time }));
}

// Legacy class columns derived from the per-day times: the full day set, and the
// overall time envelope (earliest start, latest end) for readers not yet migrated.
function legacyColumnsFromDayTimes(dayTimes: DayTime[]) {
  if (dayTimes.length === 0) return { days_of_week: null, start_time: null, end_time: null };
  const days = dayTimes.map((d) => d.day).join(',');
  const start = dayTimes.reduce((m, d) => (timeToMinutes(d.startTime) < timeToMinutes(m) ? d.startTime : m), dayTimes[0].startTime);
  const end = dayTimes.reduce((m, d) => (timeToMinutes(d.endTime) > timeToMinutes(m) ? d.endTime : m), dayTimes[0].endTime);
  return { days_of_week: days, start_time: start, end_time: end };
}

function timeToMinutes(time: string | null | undefined): number {
  if (!time) return 0;
  const [hh, mm] = String(time).split(':').map(Number);
  return (hh || 0) * 60 + (mm || 0);
}

function deriveStatus(row: any): 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' {
  if (row.is_finished) return 'DONE';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = row.start_date ? new Date(row.start_date) : null;
  if (start && start.getTime() > today.getTime()) return 'SCHEDULED';
  return 'IN_PROGRESS';
}

/**
 * Map a raw `pg` driver error to a translated API error response when we can
 * recognise it. Returns `null` for anything we don't have a friendlier message
 * for so the caller can fall through to its generic fallback.
 *
 * Known cases:
 *   23505 (unique)           → duplicate value
 *   22001                    → a field is longer than the column allows (e.g. name)
 */
function mapClassDbError(error: any) {
  if (!error || typeof error !== 'object') return null;
  if (error.code === '23505') {
    return apiError(409, 'ERRORS.CLASSES.DUPLICATE', 'A class with these details already exists');
  }
  if (error.code === '22001') {
    return apiError(400, 'ERRORS.CLASSES.VALUE_TOO_LONG', 'The class name is too long.');
  }
  return null;
}

/**
 * Loads a class along with its derived branch/company (from the linked course).
 * Replaces the legacy `SELECT * FROM classes WHERE id=$1 AND company_id=$2`
 * pattern now that classes.branch_id and classes.company_id no longer exist.
 */
async function loadClassForTenant(classId: string, companyId: string): Promise<any | null> {
  return queryOne(
    `SELECT c.*, co.company_id, co.branch_id, r.code AS room_code
     FROM classes c
     INNER JOIN courses co ON c.course_id = co.id
     LEFT JOIN rooms r ON r.id = c.room_id
     WHERE c.id = $1 AND co.company_id = $2 AND c.deleted_at IS NULL`,
    [classId, companyId]
  );
}

// Parse the aggregated day_times_json (string or already-parsed) into an array.
function parseDayTimes(raw: any): DayTime[] {
  if (raw == null) return [];
  const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!Array.isArray(arr)) return [];
  return arr.map((d: any) => ({ day: d.day, startTime: d.startTime, endTime: d.endTime }));
}

function mapClassFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    instructorId: row.instructor_id,
    roomId: row.room_id ?? null,
    roomCode: row.room_code ?? null,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    daysOfWeek: row.days_of_week,
    dayTimes: parseDayTimes(row.day_times_json),
    maxStudents: row.max_students,
    currentEnrollment: row.current_enrollment || 0,
    notes: row.notes,
    isActive: row.is_active,
    isFinished: !!row.is_finished,
    finishedAt: row.finished_at || null,
    type: normalizeClassType(row.type),
    status: deriveStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClassWithDetailsFromDB(row: any) {
  return {
    ...mapClassFromDB(row),
    courseName: row.course_name,
    branchName: row.branch_name,
    instructorName: row.instructor_name,
    instructorEmail: row.instructor_email ?? null,
    studentCount: parseInt(row.student_count ?? row.current_enrollment ?? '0', 10),
    hasActiveSession: row.has_active_session === true || row.has_active_session === 'true' || parseInt(row.has_active_session ?? '0', 10) > 0,
  };
}

/**
 * Two classes cannot sit in the same room at the same time.
 *
 * ACADEMIES ONLY. A solo-teacher tenant is one person who cannot be in two
 * places at once anyway, and its "rooms" are often just labels for the same
 * physical space — blocking there would reject schedules that are perfectly
 * real. Academies genuinely run parallel classes and a double-booked room is a
 * mistake nobody notices until two groups arrive at the same door.
 *
 * A clash needs all three: the date ranges overlap, a weekday is shared, and the
 * times overlap on that weekday. `class_day_times` is the source of truth (a
 * class can sit 15:00 Saturday and 18:00 Wednesday, which the legacy envelope
 * columns flatten into one 15:00-20:00 block and would over-report). Classes
 * predating that table fall back to their legacy columns so they still count.
 *
 * Returns the clashing classes; empty means the slot is free.
 */
async function findRoomConflicts(
  companyId: string,
  // Dates come straight off an existing row on the update path, so they can be
  // Date objects as well as the ISO strings a request body carries.
  opts: { roomId: string | null; startDate: string | Date; endDate: string | Date; dayTimes: DayTime[]; excludeClassId?: string },
): Promise<Array<{ id: string; name: string; day: string; startTime: string; endTime: string; roomCode: string | null }>> {
  const { roomId, startDate, endDate, dayTimes, excludeClassId } = opts;
  // No room, no times, or no dates — nothing to collide with.
  if (!roomId || !startDate || !endDate || !dayTimes.length) return [];

  const company = await queryOne<any>('SELECT type FROM companies WHERE id = $1', [companyId]);
  if ((company?.type || '').toUpperCase() !== 'ACADEMY') return [];

  const params: any[] = [
    companyId, roomId, endDate, startDate,
    dayTimes.map(d => d.day.toUpperCase()),
    dayTimes.map(d => d.startTime),
    dayTimes.map(d => d.endTime),
  ];
  let exclude = '';
  if (excludeClassId) { params.push(excludeClassId); exclude = `AND c.id <> $${params.length}`; }

  // Same room, overlapping date range, still running. `candidates` is that set;
  // `booked` expands each one into its individual weekday slots.
  const rows = await query(
    `WITH incoming AS (
       SELECT UPPER(d) AS day, s::time AS st, e::time AS et
       FROM unnest($5::text[], $6::text[], $7::text[]) AS t(d, s, e)
     ),
     candidates AS (
       SELECT c.id, c.name, c.start_time, c.end_time, c.days_of_week, r.code AS room_code
       FROM classes c
       INNER JOIN courses co ON co.id = c.course_id
       LEFT JOIN rooms r ON r.id = c.room_id
       WHERE co.company_id = $1
         AND c.room_id = $2
         AND c.deleted_at IS NULL
         AND COALESCE(c.is_active, true) = true
         AND COALESCE(c.is_finished, false) = false
         AND c.start_date <= $3
         AND c.end_date >= $4
         ${exclude}
     ),
     booked AS (
       -- per-day times: the source of truth
       SELECT cd.id, cd.name, cd.room_code,
              UPPER(cdt.day_of_week) AS day, cdt.start_time AS st, cdt.end_time AS et
       FROM candidates cd
       JOIN class_day_times cdt ON cdt.class_id = cd.id
       UNION ALL
       -- classes predating that table: one time for every listed day
       SELECT cd.id, cd.name, cd.room_code,
              UPPER(TRIM(d)) AS day, cd.start_time AS st, cd.end_time AS et
       FROM candidates cd
       CROSS JOIN LATERAL unnest(string_to_array(cd.days_of_week, ',')) AS d
       WHERE NOT EXISTS (SELECT 1 FROM class_day_times x WHERE x.class_id = cd.id)
         AND cd.start_time IS NOT NULL AND cd.end_time IS NOT NULL
         AND COALESCE(cd.days_of_week, '') <> ''
         AND TRIM(d) <> ''
     )
     SELECT DISTINCT b.id, b.name, b.room_code, b.day,
            b.st::text AS start_time, b.et::text AS end_time
     FROM booked b
     JOIN incoming i ON i.day = b.day AND i.st < b.et AND b.st < i.et
     ORDER BY b.day, start_time`,
    params,
  );

  return (rows as any[]).map(r => ({
    id: r.id, name: r.name, day: r.day,
    startTime: r.start_time, endTime: r.end_time, roomCode: r.room_code ?? null,
  }));
}

/** English fallback text; the frontend translates ERRORS.CLASSES.ROOM_CONFLICT. */
function roomConflictMessage(conflicts: Array<{ name: string; day: string; startTime: string; endTime: string; roomCode: string | null }>): string {
  const c = conflicts[0];
  const hhmm = (t: string) => String(t).slice(0, 5);
  const where = c.roomCode ? `Room ${c.roomCode}` : 'That room';
  return `${where} is already taken by "${c.name}" on ${c.day} ${hhmm(c.startTime)}-${hhmm(c.endTime)}`;
}

export const classesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Resolve course -> branch/company. The class is implicitly scoped to
      // the course's branch and company; there is no separate branch_id field.
      const course = await queryOne(
        'SELECT id, company_id, branch_id FROM courses WHERE id = $1',
        [body.courseId]
      );
      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }
      if (course.company_id !== context.companyId) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }
      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      await ensureClassDayTimesSchema();

      // Per-day times drive the legacy columns (day set + time envelope) so old
      // readers stay correct; fall back to the raw body when no times are given.
      const dayTimes = resolveDayTimes(body);
      const legacy = dayTimes
        ? legacyColumnsFromDayTimes(dayTimes)
        : { days_of_week: body.daysOfWeek || null, start_time: body.startTime || null, end_time: body.endTime || null };

      const roomId = await resolveRoomId(body.roomId, context.companyId);
      if (roomId === INVALID_ROOM) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      const clashes = await findRoomConflicts(context.companyId, {
        roomId, startDate: body.startDate, endDate: body.endDate, dayTimes: dayTimes ?? [],
      });
      if (clashes.length) {
        return apiError(409, 'ERRORS.CLASSES.ROOM_CONFLICT', roomConflictMessage(clashes));
      }

      const insertData = {
        course_id: body.courseId,
        instructor_id: body.instructorId || null,
        room_id: roomId,
        name: body.name,
        start_date: body.startDate,
        end_date: body.endDate,
        start_time: legacy.start_time,
        end_time: legacy.end_time,
        days_of_week: legacy.days_of_week,
        max_students: body.maxStudents || null,
        current_enrollment: 0,
        notes: body.notes || null,
        is_active: true,
        type: normalizeClassType(body.type),
      };

      const classRecord = await insert('classes', insertData);
      if (dayTimes) await setClassDayTimes(classRecord.id, dayTimes);

      return {
        status: 201 as const,
        body: mapClassFromDB({
          ...classRecord,
          company_id: course.company_id,
          branch_id: course.branch_id,
          day_times_json: JSON.stringify(dayTimes ?? []),
        }),
      };
    } catch (error) {
      console.error('Create class error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      const specific = mapClassDbError(error);
      if (specific) return specific;
      return mapThrownError(error, 'ERRORS.CLASSES.CREATE_FAILED', 'Failed to create class', 400);
    }
  },

  /**
   * Put a set of classes in one room (or clear it). Everything is scoped in the
   * UPDATE itself — company, branch access and soft-deletes — so ids the caller
   * shouldn't touch simply don't match, and `updated` tells them how many did.
   */
  assignRoom: async ({ body, headers }: { body: { classIds: string[]; roomId: string | null }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const classIds = Array.isArray(body?.classIds) ? body.classIds : [];
      if (!classIds.length) {
        return apiError(400, 'ERRORS.CLASSES.NO_CLASSES_SELECTED', 'Select at least one class');
      }

      const roomId = await resolveRoomId(body?.roomId, context.companyId);
      if (roomId === INVALID_ROOM) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      const params: any[] = [roomId, context.companyId, classIds];
      let sql = `
        UPDATE classes c
        SET room_id = $1, updated_at = NOW()
        FROM courses co
        WHERE co.id = c.course_id
          AND co.company_id = $2
          AND c.id = ANY($3::uuid[])
          AND c.deleted_at IS NULL`;
      const branchClause = appendBranchSqlFilter(context, params, 'co.branch_id');
      if (branchClause) sql += ` AND ${branchClause}`;
      sql += ' RETURNING c.id';

      const rows = await query(sql, params);
      return { status: 200 as const, body: { updated: rows.length } };
    } catch (error) {
      console.error('Assign class room error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.ASSIGN_ROOM_FAILED', 'Failed to assign the room', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT
          c.*,
          co.company_id,
          co.branch_id,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name,
          e.email AS instructor_email,
          r.code AS room_code,
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          EXISTS (
            SELECT 1 FROM sessions s
            -- Only formally-started sessions count: a prepared (started=false)
            -- pre-attendance session must not lock the class out of the Start
            -- dialog — the start flow promotes/reuses it. Matches the Active
            -- Sessions list, which also filters on started = true.
            WHERE s.class_id = c.id AND s.end_date IS NULL AND s.started = true
          ) AS has_active_session
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        LEFT JOIN rooms r ON r.id = c.room_id
        WHERE co.company_id = $1 AND c.deleted_at IS NULL
      `;
      const params: any[] = [context.companyId];

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

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      sql += ' ORDER BY c.start_date DESC, c.created_at DESC';

      const classes = await query(sql, params);
      return {
        status: 200 as const,
        body: classes.map(mapClassWithDetailsFromDB),
      };
    } catch (error) {
      console.error('List classes error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.LIST_FAILED', 'Failed to list classes');
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT
          c.*,
          co.company_id,
          co.branch_id,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name,
          e.email AS instructor_email,
          r.code AS room_code,
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          EXISTS (
            SELECT 1 FROM sessions s
            -- Only formally-started sessions count: a prepared (started=false)
            -- pre-attendance session must not lock the class out of the Start
            -- dialog — the start flow promotes/reuses it. Matches the Active
            -- Sessions list, which also filters on started = true.
            WHERE s.class_id = c.id AND s.end_date IS NULL AND s.started = true
          ) AS has_active_session
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        LEFT JOIN rooms r ON r.id = c.room_id
        WHERE co.company_id = $1 AND c.is_active = true AND c.deleted_at IS NULL
      `;
      const params: any[] = [context.companyId];

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

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      sql += ' ORDER BY c.start_date DESC, c.created_at DESC';

      const classes = await query(sql, params);
      return {
        status: 200 as const,
        body: classes.map(mapClassWithDetailsFromDB),
      };
    } catch (error) {
      console.error('List active classes error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.LIST_FAILED', 'Failed to list active classes');
    }
  },

  checkTeacherAvailability: async ({ query: queryParams, headers }: { query: { instructorId?: string; startDate: string; endDate: string; startTime?: string; endTime?: string; daysOfWeek?: string; excludeClassId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { instructorId, startDate, endDate, startTime, endTime, daysOfWeek, excludeClassId } = queryParams;

      if (!startDate || !endDate || !startTime || !endTime || !daysOfWeek) {
        return { status: 200 as const, body: { available: true, conflicts: [] } };
      }

      // TEACHER-type companies have no instructor field on classes — every class
      // implicitly belongs to the owner-teacher, so an overlap check without an
      // instructorId compares against ALL of the company's classes. Academies
      // still require an instructorId (no instructor chosen = nothing to check).
      let checkWholeCompany = false;
      if (!instructorId) {
        const comp = await queryOne<any>('SELECT type FROM companies WHERE id = $1', [context.companyId]);
        if ((comp?.type || '').toUpperCase() !== 'TEACHER') {
          return { status: 200 as const, body: { available: true, conflicts: [] } };
        }
        checkWholeCompany = true;
      }

      const newDays = daysOfWeek.split(',').map(d => d.trim()).filter(Boolean);
      if (newDays.length === 0) {
        return { status: 200 as const, body: { available: true, conflicts: [] } };
      }

      const params: any[] = [context.companyId, endDate, startDate];
      let instructorClause = '';
      if (!checkWholeCompany) {
        params.push(instructorId);
        instructorClause = `AND c.instructor_id = $${params.length}`;
      }
      let sql = `
        SELECT c.id, c.name, c.days_of_week, c.start_time, c.end_time, c.start_date, c.end_date
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        WHERE co.company_id = $1
          ${instructorClause}
          AND c.is_active = true
          AND c.deleted_at IS NULL
          AND COALESCE(c.is_finished, false) = false
          AND c.start_date <= $2
          AND c.end_date >= $3
          AND c.start_time IS NOT NULL
          AND c.end_time IS NOT NULL
          AND c.days_of_week IS NOT NULL
      `;
      if (excludeClassId) {
        params.push(excludeClassId);
        sql += ` AND c.id != $${params.length}`;
      }

      const rows = await query(sql, params);

      const newStart = timeToMinutes(startTime);
      const newEnd = timeToMinutes(endTime);

      const conflicts = rows
        .filter((row: any) => {
          const existingDays: string[] = String(row.days_of_week || '')
            .split(',')
            .map((d: string) => d.trim())
            .filter(Boolean);
          if (!existingDays.some(d => newDays.includes(d))) return false;

          const existingStart = timeToMinutes(row.start_time);
          const existingEnd = timeToMinutes(row.end_time);
          return newStart < existingEnd && existingStart < newEnd;
        })
        .map((row: any) => ({
          id: row.id,
          name: row.name,
          daysOfWeek: row.days_of_week,
          startTime: row.start_time,
          endTime: row.end_time,
          startDate: row.start_date,
          endDate: row.end_date,
        }));

      return { status: 200 as const, body: { available: conflicts.length === 0, conflicts } };
    } catch (error) {
      console.error('Check teacher availability error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.CHECK_AVAILABILITY_FAILED', 'Failed to check availability', 400);
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const sql = `
        SELECT
          c.*,
          co.company_id,
          co.branch_id,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name,
          e.email AS instructor_email,
          r.code AS room_code,
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          ${DAY_TIMES_SUBQUERY}
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        LEFT JOIN rooms r ON r.id = c.room_id
        WHERE c.id = $1 AND co.company_id = $2 AND c.deleted_at IS NULL
      `;

      await ensureClassDayTimesSchema();
      const result = await query(sql, [params.id, context.companyId]);

      if (!result || result.length === 0) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED', 'Access denied to this class');
      }

      return {
        status: 200 as const,
        body: mapClassWithDetailsFromDB(result[0]),
      };
    } catch (error) {
      console.error('Get class error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await loadClassForTenant(params.id, context.companyId);

      if (!existing) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED_UPDATE', 'Access denied to update this class');
      }

      await ensureClassDayTimesSchema();
      const updateData: any = {};

      if (body.courseId !== undefined) {
        // Switching course also implicitly switches branch/company. Re-validate.
        const newCourse = await queryOne(
          'SELECT id, company_id, branch_id FROM courses WHERE id = $1',
          [body.courseId]
        );
        if (!newCourse || newCourse.company_id !== context.companyId) {
          return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Target course not found');
        }
        if (!canAccessBranch(context, newCourse.branch_id)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.course_id = body.courseId;
      }
      if (body.instructorId !== undefined) updateData.instructor_id = body.instructorId || null;
      if (body.roomId !== undefined) {
        const roomId = await resolveRoomId(body.roomId, context.companyId);
        if (roomId === INVALID_ROOM) {
          return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
        }
        updateData.room_id = roomId;
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      if (body.maxStudents !== undefined) updateData.max_students = body.maxStudents;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.type !== undefined) updateData.type = normalizeClassType(body.type);

      // Per-day times: recompute whenever any day/time field is present, then keep
      // the legacy columns (day set + envelope) in sync with them.
      const timesTouched = body.dayTimes !== undefined || body.daysOfWeek !== undefined
        || body.startTime !== undefined || body.endTime !== undefined;
      let effectiveDayTimes: DayTime[] | null = null;
      if (timesTouched) {
        if (Array.isArray(body.dayTimes)) {
          effectiveDayTimes = resolveDayTimes(body) ?? [];
        } else {
          const days = (body.daysOfWeek !== undefined ? String(body.daysOfWeek) : String(existing.days_of_week || ''))
            .split(',').map((d: string) => d.toUpperCase().trim()).filter(Boolean);
          const st = body.startTime !== undefined ? body.startTime : existing.start_time;
          const et = body.endTime !== undefined ? body.endTime : existing.end_time;
          effectiveDayTimes = (st && et) ? days.map((day) => ({ day, startTime: st, endTime: et })) : [];
        }
        const legacy = legacyColumnsFromDayTimes(effectiveDayTimes);
        updateData.days_of_week = legacy.days_of_week;
        updateData.start_time = legacy.start_time;
        updateData.end_time = legacy.end_time;
      }

      // Moving a class's room, dates or times can double-book a room just as
      // creating one can, so the same rule applies — checked against whatever the
      // class will look like AFTER the edit, ignoring its own current booking.
      const nextRoomId = updateData.room_id !== undefined ? updateData.room_id : existing.room_id;
      if (nextRoomId) {
        const nextDayTimes = effectiveDayTimes ?? await getClassDayTimes(params.id);
        const clashes = await findRoomConflicts(context.companyId, {
          roomId: nextRoomId,
          startDate: updateData.start_date !== undefined ? updateData.start_date : existing.start_date,
          endDate: updateData.end_date !== undefined ? updateData.end_date : existing.end_date,
          dayTimes: nextDayTimes,
          excludeClassId: params.id,
        });
        if (clashes.length) {
          return apiError(409, 'ERRORS.CLASSES.ROOM_CONFLICT', roomConflictMessage(clashes));
        }
      }

      const classRecord = await update('classes', params.id, updateData);

      if (!classRecord) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (effectiveDayTimes !== null) await setClassDayTimes(params.id, effectiveDayTimes);

      // Reload to include the (possibly-updated) joined branch/company + day times.
      const reloaded = await loadClassForTenant(params.id, context.companyId);
      const dayTimesJson = JSON.stringify(effectiveDayTimes ?? await getClassDayTimes(params.id));
      return {
        status: 200 as const,
        body: mapClassFromDB({ ...(reloaded || classRecord), day_times_json: dayTimesJson }),
      };
    } catch (error) {
      console.error('Update class error:', error);
      const specific = mapClassDbError(error);
      if (specific) return specific;
      return mapThrownError(error, 'ERRORS.CLASSES.UPDATE_FAILED', 'Failed to update class', 404);
    }
  },

  getEnrollments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const cls = await loadClassForTenant(params.id, context.companyId);

      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (!canAccessBranch(context, cls.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED', 'Access denied to this class');
      }

      const enrollments = await query(
        `SELECT
          e.id as enrollment_id,
          e.student_id,
          s.name AS student_name,
          e.enrollment_date,
          e.status,
          e.original_price,
          e.discount_percent,
          e.discount_amount,
          e.final_price,
          e.payment_mode,
          e.down_payment,
          e.amount_paid,
          e.payment_status,
          e.notes,
          e.created_at,
          'DIRECT' as enrollment_type,
          NULL as master_course_name
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        WHERE e.class_id = $1 AND e.company_id = $2 AND e.status != 'DROPPED'

        UNION ALL

        SELECT
          mce.id as enrollment_id,
          mce.student_id,
          s.name AS student_name,
          me.enrollment_date,
          mce.status,
          me.original_price,
          me.discount_percent,
          me.discount_amount,
          me.final_price,
          me.payment_mode,
          me.down_payment,
          me.amount_paid,
          me.payment_status,
          mce.notes,
          mce.created_at,
          'MASTER' as enrollment_type,
          mc.name as master_course_name
        FROM master_class_enrollments mce
        JOIN students s ON mce.student_id = s.id
        JOIN master_enrollments me ON mce.master_enrollment_id = me.id
        JOIN master_courses mc ON me.master_course_id = mc.id
        WHERE mce.class_id = $1 AND mce.company_id = $2 AND mce.status != 'DROPPED'

        ORDER BY enrollment_date DESC`,
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: enrollments.map((row: any) => ({
          enrollmentId: row.enrollment_id,
          studentId: row.student_id,
          studentName: row.student_name,
          enrollmentDate: row.enrollment_date,
          status: row.status,
          originalPrice: parseFloat(row.original_price),
          discountPercent: parseFloat(row.discount_percent || 0),
          discountAmount: parseFloat(row.discount_amount || 0),
          finalPrice: parseFloat(row.final_price),
          paymentMode: row.payment_mode || 'FULL',
          downPayment: parseFloat(row.down_payment || 0),
          amountPaid: parseFloat(row.amount_paid || 0),
          paymentStatus: row.payment_status,
          notes: row.notes,
          createdAt: row.created_at,
          enrollmentType: row.enrollment_type,
          masterCourseName: row.master_course_name,
        })),
      };
    } catch (error) {
      console.error('Get class enrollments error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.ENROLLMENTS_FAILED', 'Failed to get class enrollments');
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await loadClassForTenant(params.id, context.companyId);

      if (!existing) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED_DELETE', 'Access denied to delete this class');
      }

      // Does the class carry any financial footprint? If so, a hard delete would
      // cascade-destroy payment/salary records, so we soft-delete instead. We
      // check paid enrollments, monthly/per-session payments, teacher salary
      // payments, and any master-bundle enrollment (a paid bundle link).
      const footprint = await queryOne<{ has_payments: boolean }>(
        `SELECT (
            EXISTS (SELECT 1 FROM enrollments e
                     WHERE e.class_id = $1 AND (COALESCE(e.amount_paid,0) > 0 OR COALESCE(e.down_payment,0) > 0))
         OR EXISTS (SELECT 1 FROM master_class_enrollments mce WHERE mce.class_id = $1)
         OR EXISTS (SELECT 1 FROM monthly_subscription_payments msp
                      JOIN enrollments e ON msp.enrollment_id = e.id
                     WHERE e.class_id = $1 AND COALESCE(msp.amount_paid,0) > 0)
         OR EXISTS (SELECT 1 FROM session_payments sp
                      JOIN enrollments e ON sp.enrollment_id = e.id
                     WHERE e.class_id = $1)
         OR EXISTS (SELECT 1 FROM session_packages spk
                      JOIN enrollments e ON spk.enrollment_id = e.id
                     WHERE e.class_id = $1)
         OR EXISTS (SELECT 1 FROM session_salary_payments ssp
                      JOIN sessions s ON ssp.session_id = s.id
                     WHERE s.class_id = $1)
         ) AS has_payments`,
        [params.id]
      );

      if (footprint?.has_payments) {
        // Soft delete: hide the class from the tenant, drop its enrollments so
        // nothing keeps billing or shows the student as active, but keep the row
        // and all payment records intact for financial integrity.
        await update('classes', params.id, { is_active: false, deleted_at: new Date().toISOString() });
        await query(`UPDATE enrollments SET status = 'DROPPED' WHERE class_id = $1 AND status != 'DROPPED'`, [params.id]);
        await query(`UPDATE master_class_enrollments SET status = 'DROPPED' WHERE class_id = $1 AND status != 'DROPPED'`, [params.id]);
      } else {
        // No money involved: hard-delete the class. Foreign keys cascade to its
        // enrollments, sessions, attendance and teacher-attendance rows, removing
        // every reference to it.
        await query('DELETE FROM classes WHERE id = $1', [params.id]);
      }

      return {
        status: 200 as const,
        body: { message: 'Class deleted successfully', code: 'CLASSES.DELETED' },
      };
    } catch (error) {
      console.error('Delete class error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.DELETE_FAILED', 'Failed to delete class', 404);
    }
  },

  finish: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await loadClassForTenant(params.id, context.companyId);

      if (!existing) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED', 'Access denied to this class');
      }

      if (existing.is_finished) {
        return apiError(400, 'ERRORS.CLASSES.ALREADY_FINISHED', 'Class is already finished');
      }

      const activeSession = await queryOne(
        'SELECT id FROM sessions WHERE class_id = $1 AND end_date IS NULL',
        [params.id]
      );
      if (activeSession) {
        return apiError(400, 'ERRORS.CLASSES.HAS_ACTIVE_SESSION', 'Cannot finish a class with an active session running. End the session first.');
      }

      const updated = await update('classes', params.id, {
        is_finished: true,
        finished_at: new Date().toISOString(),
        is_active: false,
      });

      if (!updated) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      return {
        status: 200 as const,
        body: mapClassFromDB({
          ...updated,
          company_id: existing.company_id,
          branch_id: existing.branch_id,
        }),
      };
    } catch (error) {
      console.error('Finish class error:', error);
      return mapThrownError(error, 'ERRORS.CLASSES.FINISH_FAILED', 'Failed to finish class', 400);
    }
  },
};
