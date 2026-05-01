import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

function mapMasterCourseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchName: row.branch_name ?? null,
    name: row.name,
    code: row.code,
    description: row.description,
    defaultPrice: parseFloat(row.default_price),
    defaultDuration: row.default_duration,
    defaultMaxStudents: row.default_max_students,
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

export const masterCoursesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (!body.branchId || !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }
      const branch = await queryOne(
        'SELECT id FROM branches WHERE id = $1 AND company_id = $2',
        [body.branchId, context.companyId]
      );
      if (!branch) return { status: 400 as const, body: { message: 'Invalid branch' } };

      const masterCourse = await insert('master_courses', {
        company_id: context.companyId,
        branch_id: body.branchId,
        name: body.name,
        code: body.code,
        description: body.description || null,
        default_price: body.defaultPrice,
        default_duration: body.defaultDuration,
        default_max_students: body.defaultMaxStudents || null,
        is_active: true,
      });

      return { status: 201 as const, body: mapMasterCourseFromDB(masterCourse) };
    } catch (error: any) {
      console.error('Create master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create master course' },
      };
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const sql = `
        SELECT
          mc.*,
          b.name AS branch_name,
          COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true) AS linked_course_count,
          COUNT(DISTINCT c.branch_id) FILTER (WHERE c.is_active = true) AS branch_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.status != 'CANCELLED') AS student_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PAID' AND me.status != 'CANCELLED') AS paid_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PARTIAL' AND me.status != 'CANCELLED') AS partial_count,
          COUNT(DISTINCT me.id) FILTER (WHERE me.payment_status = 'PENDING' AND me.status != 'CANCELLED') AS pending_count
        FROM master_courses mc
        LEFT JOIN branches b ON b.id = mc.branch_id
        LEFT JOIN master_course_courses mcc ON mcc.master_course_id = mc.id
        LEFT JOIN courses c ON c.id = mcc.course_id
        LEFT JOIN master_enrollments me ON me.master_course_id = mc.id
        WHERE mc.company_id = $1
        GROUP BY mc.id, b.name
        ORDER BY mc.created_at DESC
      `;
      const rows = await query(sql, [context.companyId]);
      const mapped = rows.map(mapWithCounts);
      const filtered = mapped.filter((m: any) => !m.branchId || canAccessBranch(context, m.branchId));
      return { status: 200 as const, body: filtered };
    } catch (error: any) {
      console.error('List master courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list master courses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const row = await queryOne(
        `SELECT mc.*, b.name AS branch_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         WHERE mc.id = $1 AND mc.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!row) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      return { status: 200 as const, body: mapMasterCourseFromDB(row) };
    } catch (error: any) {
      console.error('Get master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Master course not found' },
      };
    }
  },

  getLinkedCourses: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (master.branch_id && !canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
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
          code: r.code,
          price: parseFloat(r.price),
          duration: r.duration,
          maxStudents: r.max_students,
          isActive: r.is_active,
        })),
      };
    } catch (error: any) {
      console.error('List linked courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list linked courses' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.defaultPrice !== undefined) updateData.default_price = body.defaultPrice;
      if (body.defaultDuration !== undefined) updateData.default_duration = body.defaultDuration;
      if (body.defaultMaxStudents !== undefined) updateData.default_max_students = body.defaultMaxStudents;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const row = await update('master_courses', params.id, updateData);
      if (!row) return { status: 404 as const, body: { message: 'Master course not found' } };

      const withBranch = await queryOne(
        `SELECT mc.*, b.name AS branch_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         WHERE mc.id = $1`,
        [row.id]
      );
      return { status: 200 as const, body: mapMasterCourseFromDB(withBranch || row) };
    } catch (error: any) {
      console.error('Update master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update master course' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      await query(
        'DELETE FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      return { status: 200 as const, body: { message: 'Master course deleted successfully' } };
    } catch (error: any) {
      console.error('Delete master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete master course' },
      };
    }
  },

  // Link an existing course to this master. Course and master must share branch.
  addCourse: async ({ params, body, headers }: { params: { id: string }; body: { courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions on courses' } };
      }

      const master = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (!canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [body.courseId, context.companyId]
      );
      if (!course) return { status: 404 as const, body: { message: 'Course not found' } };
      if (course.branch_id !== master.branch_id) {
        return { status: 400 as const, body: { message: 'Course must be in the same branch as the master course' } };
      }

      await query(
        `INSERT INTO master_course_courses (master_course_id, course_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [master.id, course.id]
      );
      return { status: 200 as const, body: { message: 'Course added to master' } };
    } catch (error: any) {
      console.error('Add course to master error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to add course' },
      };
    }
  },

  // Unlink a course from its master (leaves the course itself intact).
  removeCourse: async ({ params, headers }: { params: { id: string; courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (!canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      await query(
        `DELETE FROM master_course_courses
         WHERE course_id = $1 AND master_course_id = $2`,
        [params.courseId, master.id]
      );
      return { status: 200 as const, body: { message: 'Course removed from master' } };
    } catch (error: any) {
      console.error('Remove course from master error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to remove course' },
      };
    }
  },

  // Courses in the master's branch that can still be added (no master yet).
  availableCourses: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (!canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const rows = await query(
        `SELECT id, name, code, price, duration
         FROM courses
         WHERE company_id = $1 AND branch_id = $2 AND is_active = true
           AND id NOT IN (
             SELECT course_id FROM master_course_courses WHERE master_course_id = $3
           )
         ORDER BY name ASC`,
        [context.companyId, master.branch_id, master.id]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          price: parseFloat(r.price),
          duration: r.duration,
        })),
      };
    } catch (error: any) {
      console.error('Available courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list available courses' },
      };
    }
  },
};
