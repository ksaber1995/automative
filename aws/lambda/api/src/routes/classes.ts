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
        // Drop redundant columns: branch_id and company_id are derivable from courses.
        // Drop the unique constraint and indexes that depend on company_id first.
        await query(`ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_company_id_code_key`);
        await query(`DROP INDEX IF EXISTS idx_classes_branch_id`);
        await query(`DROP INDEX IF EXISTS idx_classes_company_id`);
        await query(`ALTER TABLE classes DROP COLUMN IF EXISTS branch_id`);
        await query(`ALTER TABLE classes DROP COLUMN IF EXISTS company_id`);
      } catch (e) {
        classSchemaInitPromise = null;
        throw e;
      }
    })();
  }
  return classSchemaInitPromise;
}

function normalizeClassType(value: any): 'ONLINE' | 'OFFLINE' {
  const upper = typeof value === 'string' ? value.toUpperCase() : '';
  return upper === 'ONLINE' ? 'ONLINE' : 'OFFLINE';
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
 *   23505 unique_class_code  → another class already uses this code
 *   23505 (other unique)     → duplicate value, less specific
 *   22001                    → a field is longer than the column allows (e.g. name/code > 50 chars)
 */
function mapClassDbError(error: any) {
  if (!error || typeof error !== 'object') return null;
  if (error.code === '23505') {
    if (error.constraint === 'unique_class_code') {
      return apiError(409, 'ERRORS.CLASSES.DUPLICATE_CODE', 'A class with this code already exists');
    }
    return apiError(409, 'ERRORS.CLASSES.DUPLICATE', 'A class with these details already exists');
  }
  if (error.code === '22001') {
    return apiError(400, 'ERRORS.CLASSES.VALUE_TOO_LONG', 'One of the fields (name or code) is too long. Keep it under 50 characters.');
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
    `SELECT c.*, co.company_id, co.branch_id
     FROM classes c
     INNER JOIN courses co ON c.course_id = co.id
     WHERE c.id = $1 AND co.company_id = $2`,
    [classId, companyId]
  );
}

function mapClassFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    instructorId: row.instructor_id,
    name: row.name,
    code: row.code,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    daysOfWeek: row.days_of_week,
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
    studentCount: parseInt(row.student_count ?? row.current_enrollment ?? '0', 10),
    hasActiveSession: row.has_active_session === true || row.has_active_session === 'true' || parseInt(row.has_active_session ?? '0', 10) > 0,
  };
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

      const insertData = {
        course_id: body.courseId,
        instructor_id: body.instructorId || null,
        name: body.name,
        code: body.code,
        start_date: body.startDate,
        end_date: body.endDate,
        start_time: body.startTime || null,
        end_time: body.endTime || null,
        days_of_week: body.daysOfWeek || null,
        max_students: body.maxStudents || null,
        current_enrollment: 0,
        notes: body.notes || null,
        is_active: true,
        type: normalizeClassType(body.type),
      };

      const classRecord = await insert('classes', insertData);

      return {
        status: 201 as const,
        body: mapClassFromDB({
          ...classRecord,
          company_id: course.company_id,
          branch_id: course.branch_id,
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
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.class_id = c.id AND s.end_date IS NULL
          ) AS has_active_session
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE co.company_id = $1
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
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count,
          EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.class_id = c.id AND s.end_date IS NULL
          ) AS has_active_session
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE co.company_id = $1 AND c.is_active = true
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

  checkTeacherAvailability: async ({ query: queryParams, headers }: { query: { instructorId: string; startDate: string; endDate: string; startTime?: string; endTime?: string; daysOfWeek?: string; excludeClassId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureClassStatusColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { instructorId, startDate, endDate, startTime, endTime, daysOfWeek, excludeClassId } = queryParams;

      if (!instructorId || !startDate || !endDate || !startTime || !endTime || !daysOfWeek) {
        return { status: 200 as const, body: { available: true, conflicts: [] } };
      }

      const newDays = daysOfWeek.split(',').map(d => d.trim()).filter(Boolean);
      if (newDays.length === 0) {
        return { status: 200 as const, body: { available: true, conflicts: [] } };
      }

      const params: any[] = [context.companyId, instructorId, endDate, startDate];
      let sql = `
        SELECT c.id, c.name, c.code, c.days_of_week, c.start_time, c.end_time, c.start_date, c.end_date
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        WHERE co.company_id = $1
          AND c.instructor_id = $2
          AND c.is_active = true
          AND COALESCE(c.is_finished, false) = false
          AND c.start_date <= $3
          AND c.end_date >= $4
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
          code: row.code,
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
          (
            SELECT COALESCE(COUNT(*), 0) FROM enrollments en
            WHERE en.class_id = c.id AND en.status NOT IN ('DROPPED', 'CANCELLED')
          ) + (
            SELECT COALESCE(COUNT(*), 0) FROM master_class_enrollments mce
            WHERE mce.class_id = c.id AND mce.status != 'DROPPED'
          ) AS student_count
        FROM classes c
        INNER JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON co.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE c.id = $1 AND co.company_id = $2
      `;

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
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      if (body.startTime !== undefined) updateData.start_time = body.startTime;
      if (body.endTime !== undefined) updateData.end_time = body.endTime;
      if (body.daysOfWeek !== undefined) updateData.days_of_week = body.daysOfWeek;
      if (body.maxStudents !== undefined) updateData.max_students = body.maxStudents;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.type !== undefined) updateData.type = normalizeClassType(body.type);

      const classRecord = await update('classes', params.id, updateData);

      if (!classRecord) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }

      // Reload to include the (possibly-updated) joined branch/company.
      const reloaded = await loadClassForTenant(params.id, context.companyId);
      return {
        status: 200 as const,
        body: mapClassFromDB(reloaded || classRecord),
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
          s.first_name as student_first_name,
          s.last_name as student_last_name,
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
          s.first_name as student_first_name,
          s.last_name as student_last_name,
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
          studentFirstName: row.student_first_name,
          studentLastName: row.student_last_name,
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

      if (existing.is_finished) {
        return apiError(400, 'ERRORS.CLASSES.CANNOT_DEACTIVATE_FINISHED', 'Cannot deactivate a finished class.');
      }

      const classRecord = await update('classes', params.id, { is_active: false });

      if (!classRecord) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
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
