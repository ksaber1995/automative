import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapMasterCourseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchName: row.branch_name ?? null,
    name: row.name,
    description: row.description,
    defaultPrice: parseFloat(row.default_price),
    defaultDuration: row.default_duration,
    defaultMaxStudents: row.default_max_students,
    levelId: row.level_id ?? null,
    levelName: row.level_name ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWithCounts(row: any) {
  return {
    ...mapMasterCourseFromDB(row),
    linkedCourseCount: parseInt(row.linked_course_count || '0', 10),
    branchCount: parseInt(row.branch_count || '0', 10),
    studentCount: parseInt(row.student_count || '0', 10),
    paidCount: parseInt(row.paid_count || '0', 10),
    partialCount: parseInt(row.partial_count || '0', 10),
    pendingCount: parseInt(row.pending_count || '0', 10),
  };
}

/**
 * The only payment type a master course can group, for now.
 *
 * A master sells its members as one bundle for one price (see master_enrollments),
 * which only has meaning if every member is charged the same way. A
 * MONTHLY_SUBSCRIPTION course renews on its own clock and a PER_SESSION course
 * bills off attendance — neither can answer "what does this bundle cost", so a
 * bundle mixing them has no single price to sell.
 *
 * Widening this is the whole job of supporting other types: give a master its own
 * payment_type and require its members to match it, rather than deleting the check.
 *
 * NOTE: enforced for NEW links only. Links made before this rule existed are left
 * alone — a live master with a paid enrolment is not something to rewrite from a
 * deploy. Prod had exactly one such master ("diploma of robotics", all three types)
 * when this landed.
 */
const BUNDLEABLE_PAYMENT_TYPE = 'ONE_TIME';

function isBundleable(paymentType: unknown): boolean {
  // Legacy rows predate the column's NOT NULL DEFAULT and read as one-time.
  return (paymentType ?? 'ONE_TIME') === BUNDLEABLE_PAYMENT_TYPE;
}

export const masterCoursesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      if (!body.branchId || !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      const branch = await queryOne(
        'SELECT id FROM branches WHERE id = $1 AND company_id = $2',
        [body.branchId, context.companyId]
      );
      if (!branch) return apiError(400, 'ERRORS.MASTER_COURSES.INVALID_BRANCH', 'Invalid branch');

      const masterCourse = await insert('master_courses', {
        company_id: context.companyId,
        branch_id: body.branchId,
        name: body.name,
        description: body.description || null,
        default_price: body.defaultPrice,
        default_duration: body.defaultDuration,
        default_max_students: body.defaultMaxStudents || null,
        level_id: body.levelId || null,
        is_active: true,
      });

      return { status: 201 as const, body: mapMasterCourseFromDB(masterCourse) };
    } catch (error: any) {
      console.error('Create master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.CREATE_FAILED', 'Failed to create master course', 400);
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const sql = `
        SELECT
          mc.*,
          b.name AS branch_name,
          l.name AS level_name,
          COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true) AS linked_course_count,
          COUNT(DISTINCT c.branch_id) FILTER (WHERE c.is_active = true) AS branch_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.status != 'CANCELLED') AS student_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PAID' AND me.status != 'CANCELLED') AS paid_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PARTIAL' AND me.status != 'CANCELLED') AS partial_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PENDING' AND me.status != 'CANCELLED') AS pending_count
        FROM master_courses mc
        LEFT JOIN branches b ON b.id = mc.branch_id
        LEFT JOIN levels l ON l.id = mc.level_id
        LEFT JOIN master_course_courses mcc ON mcc.master_course_id = mc.id
        LEFT JOIN courses c ON c.id = mcc.course_id
        LEFT JOIN master_enrollments me ON me.master_course_id = mc.id
        WHERE mc.company_id = $1
        GROUP BY mc.id, b.name, l.name
        ORDER BY mc.created_at DESC
      `;
      const rows = await query(sql, [context.companyId]);
      const mapped = rows.map(mapWithCounts);
      const filtered = mapped.filter((m: any) => !m.branchId || canAccessBranch(context, m.branchId));
      return { status: 200 as const, body: filtered };
    } catch (error: any) {
      console.error('List master courses error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.LIST_FAILED', 'Failed to list master courses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne(
        `SELECT mc.*, b.name AS branch_name, l.name AS level_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         LEFT JOIN levels l ON l.id = mc.level_id
         WHERE mc.id = $1 AND mc.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      return { status: 200 as const, body: mapMasterCourseFromDB(row) };
    } catch (error: any) {
      console.error('Get master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found', 404);
    }
  },

  getLinkedCourses: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (master.branch_id && !canAccessBranch(context, master.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      const rows = await query(
        `SELECT c.*, b.name AS branch_name
         FROM courses c
         JOIN master_course_courses mcc ON mcc.course_id = c.id AND mcc.master_course_id = $1
         LEFT JOIN branches b ON b.id = c.branch_id
         WHERE c.company_id = $2
         ORDER BY b.name ASC, c.created_at DESC`,
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          branchId: r.branch_id,
          branchName: r.branch_name,
          name: r.name,
          price: parseFloat(r.price),
          isActive: r.is_active,
        })),
      };
    } catch (error: any) {
      console.error('List linked courses error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.LINKED_COURSES_FAILED', 'Failed to list linked courses');
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.defaultPrice !== undefined) updateData.default_price = body.defaultPrice;
      if (body.defaultDuration !== undefined) updateData.default_duration = body.defaultDuration;
      if (body.defaultMaxStudents !== undefined) updateData.default_max_students = body.defaultMaxStudents;
      if (body.levelId !== undefined) updateData.level_id = body.levelId || null;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const row = await update('master_courses', params.id, updateData);
      if (!row) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');

      const withBranch = await queryOne(
        `SELECT mc.*, b.name AS branch_name, l.name AS level_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         LEFT JOIN levels l ON l.id = mc.level_id
         WHERE mc.id = $1`,
        [row.id]
      );
      return { status: 200 as const, body: mapMasterCourseFromDB(withBranch || row) };
    } catch (error: any) {
      console.error('Update master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.UPDATE_FAILED', 'Failed to update master course', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      // Block hard-delete if anyone has subscribed (including cancelled — kept for audit).
      const enrollCount = await queryOne(
        'SELECT COUNT(*)::int AS n FROM master_enrollments WHERE master_course_id = $1',
        [params.id]
      );
      if ((enrollCount?.n || 0) > 0) {
        return apiError(
          409,
          'ERRORS.MASTER_COURSES.HAS_ENROLLMENTS',
          'Master course has enrollments and cannot be deleted; deactivate it instead'
        );
      }

      await query(
        'DELETE FROM master_course_courses WHERE master_course_id = $1',
        [params.id]
      );
      await query(
        'DELETE FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      return { status: 200 as const, body: { message: 'Master course deleted successfully', code: 'MASTER_COURSES.DELETED' } };
    } catch (error: any) {
      console.error('Delete master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.DELETE_FAILED', 'Failed to delete master course', 404);
    }
  },

  deactivate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }
      if (!existing.is_active) {
        return { status: 200 as const, body: mapMasterCourseFromDB(existing) };
      }

      // A linked course blocks deactivation if it is still active OR has an active/unfinished class.
      const blocking = await query(
        `SELECT c.id, c.name, c.is_active,
                COUNT(cl.id) FILTER (WHERE cl.is_active = true AND cl.is_finished = false) AS active_class_count
         FROM master_course_courses mcc
         JOIN courses c ON c.id = mcc.course_id
         LEFT JOIN classes cl ON cl.course_id = c.id
         WHERE mcc.master_course_id = $1
         GROUP BY c.id, c.name, c.is_active
         HAVING c.is_active = true
             OR COUNT(cl.id) FILTER (WHERE cl.is_active = true AND cl.is_finished = false) > 0`,
        [params.id]
      );

      if (blocking.length > 0) {
        return {
          status: 409 as const,
          body: {
            message: 'Master course has active linked courses or running classes',
            code: 'ERRORS.MASTER_COURSES.HAS_ACTIVE_COURSES',
            courses: blocking.map((c: any) => ({ id: c.id, name: c.name })),
          } as any,
        };
      }

      const row = await update('master_courses', params.id, { is_active: false });
      if (!row) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      return { status: 200 as const, body: mapMasterCourseFromDB(row) };
    } catch (error: any) {
      console.error('Deactivate master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.UPDATE_FAILED', 'Failed to deactivate master course', 400);
    }
  },

  activate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      const row = await update('master_courses', params.id, { is_active: true });
      if (!row) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      return { status: 200 as const, body: mapMasterCourseFromDB(row) };
    } catch (error: any) {
      console.error('Activate master course error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.UPDATE_FAILED', 'Failed to activate master course', 400);
    }
  },

  // Link an existing course to this master. Course and master must share branch.
  addCourse: async ({ params, body, headers }: { params: { id: string }; body: { courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.MASTER_COURSES.INSUFFICIENT_COURSES_PERMISSION', 'Insufficient permissions on courses');
      }

      const master = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (!canAccessBranch(context, master.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [body.courseId, context.companyId]
      );
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (course.branch_id !== master.branch_id) {
        return apiError(400, 'ERRORS.MASTER_COURSES.COURSE_BRANCH_MISMATCH', 'Course must be in the same branch as the master course');
      }

      // A master course sells its members as ONE bundle for ONE price, so its
      // members have to be charged the same way — and today that way is one-time.
      // A monthly course renews on its own schedule and a per-session course bills
      // off attendance; neither has an answer to "what did this bundle cost".
      // Mixing them is what this rejects. See availableCourses, which does not
      // offer them in the first place — this is the guard that actually holds,
      // because the picker is not the only thing that can call this.
      if (!isBundleable(course.payment_type)) {
        return apiError(
          400,
          'ERRORS.MASTER_COURSES.COURSE_PAYMENT_TYPE',
          'Only one-time payment courses can be grouped into a master course'
        );
      }

      await query(
        `INSERT INTO master_course_courses (master_course_id, course_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [master.id, course.id]
      );
      return { status: 200 as const, body: { message: 'Course added to master', code: 'MASTER_COURSES.COURSE_ADDED' } };
    } catch (error: any) {
      console.error('Add course to master error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.ADD_COURSE_FAILED', 'Failed to add course', 400);
    }
  },

  // Unlink a course from its master (leaves the course itself intact).
  removeCourse: async ({ params, headers }: { params: { id: string; courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (!canAccessBranch(context, master.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      await query(
        `DELETE FROM master_course_courses
         WHERE course_id = $1 AND master_course_id = $2`,
        [params.courseId, master.id]
      );
      return { status: 200 as const, body: { message: 'Course removed from master', code: 'MASTER_COURSES.COURSE_REMOVED' } };
    } catch (error: any) {
      console.error('Remove course from master error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.REMOVE_COURSE_FAILED', 'Failed to remove course', 400);
    }
  },

  // Courses in the master's branch that can still be added (no master yet).
  availableCourses: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (!canAccessBranch(context, master.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_COURSES.ACCESS_DENIED', 'Access denied to this master course');
      }

      // payment_type filtered here as well as in addCourse: this list is what the
      // picker shows, and offering a course that the save would then reject is a
      // worse experience than not offering it. addCourse stays the real guard.
      const rows = await query(
        `SELECT id, name, price
         FROM courses
         WHERE company_id = $1 AND branch_id = $2 AND is_active = true
           AND payment_type = $4
           AND id NOT IN (
             SELECT course_id FROM master_course_courses WHERE master_course_id = $3
           )
         ORDER BY name ASC`,
        [context.companyId, master.branch_id, master.id, BUNDLEABLE_PAYMENT_TYPE]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          price: parseFloat(r.price),
        })),
      };
    } catch (error: any) {
      console.error('Available courses error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_COURSES.AVAILABLE_COURSES_FAILED', 'Failed to list available courses');
    }
  },
};
