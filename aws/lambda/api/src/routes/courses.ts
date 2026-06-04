import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapCourseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    name: row.name,
    code: row.code,
    description: row.description,
    price: parseFloat(row.price),
    duration: row.duration,
    maxStudents: row.max_students,
    instructorId: row.instructor_id,
    levelId: row.level_id ?? null,
    levelName: row.level_name ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCourseWithEnrollmentCountFromDB(row: any) {
  const direct = parseInt(row.direct_enrollment_count || '0', 10);
  const master = parseInt(row.master_enrollment_count || '0', 10);
  return {
    ...mapCourseFromDB(row),
    directEnrollmentCount: direct,
    masterEnrollmentCount: master,
    enrollmentCount: direct + master,
  };
}

export const coursesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const course = await insert('courses', {
        company_id: context.companyId,
        branch_id: body.branchId,
        name: body.name,
        code: body.code,
        description: body.description || null,
        price: body.price,
        duration: body.duration,
        max_students: body.maxStudents || null,
        instructor_id: body.instructorId || null,
        level_id: body.levelId || null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Create course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.CREATE_FAILED', 'Failed to create course', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT
          c.*,
          l.name as level_name,
          COUNT(DISTINCT e.id) FILTER (WHERE e.status != 'DROPPED') as direct_enrollment_count,
          COUNT(DISTINCT mce.id) FILTER (WHERE mce.status != 'DROPPED') as master_enrollment_count
        FROM courses c
        LEFT JOIN levels l ON c.level_id = l.id
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.status != 'DROPPED'
        LEFT JOIN master_class_enrollments mce ON c.id = mce.course_id AND mce.status != 'DROPPED'
        WHERE c.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'c.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' GROUP BY c.id, l.name ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseWithEnrollmentCountFromDB),
      };
    } catch (error) {
      console.error('List courses error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.LIST_FAILED', 'Failed to list courses');
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = 'SELECT * FROM courses WHERE company_id = $1 AND is_active = true';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseFromDB),
      };
    } catch (error) {
      console.error('List active courses error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.LIST_FAILED', 'Failed to list active courses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const course = await queryOne(
        `SELECT c.*, l.name as level_name
         FROM courses c
         LEFT JOIN levels l ON c.level_id = l.id
         WHERE c.id = $1 AND c.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Get course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.NOT_FOUND', 'Course not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.price !== undefined) updateData.price = body.price;
      if (body.duration !== undefined) updateData.duration = body.duration;
      if (body.maxStudents !== undefined) updateData.max_students = body.maxStudents;
      if (body.instructorId !== undefined) updateData.instructor_id = body.instructorId || null;
      if (body.levelId !== undefined) updateData.level_id = body.levelId || null;

      const course = await update('courses', params.id, updateData);

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Update course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to update course', 404);
    }
  },

  getEnrollments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED', 'Access denied to this course');
      }

      const enrollments = await query(
        `SELECT
          e.id as enrollment_id,
          e.student_id,
          s.first_name as student_first_name,
          s.last_name as student_last_name,
          e.class_id,
          cl.name as class_name,
          e.enrollment_date,
          e.status,
          e.original_price,
          e.discount_percent,
          e.discount_amount,
          e.final_price,
          e.payment_mode,
          e.down_payment,
          e.amount_paid,
          e.total_refunded,
          e.payment_status,
          e.notes,
          e.created_at
        FROM enrollments e
        JOIN students s ON e.student_id = s.id
        LEFT JOIN classes cl ON e.class_id = cl.id
        WHERE e.course_id = $1 AND e.company_id = $2 AND e.status != 'DROPPED'
        ORDER BY e.enrollment_date DESC`,
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: enrollments.map((row: any) => ({
          enrollmentId: row.enrollment_id,
          studentId: row.student_id,
          studentFirstName: row.student_first_name,
          studentLastName: row.student_last_name,
          classId: row.class_id,
          className: row.class_name,
          enrollmentDate: row.enrollment_date,
          status: row.status,
          originalPrice: parseFloat(row.original_price),
          discountPercent: parseFloat(row.discount_percent || 0),
          discountAmount: parseFloat(row.discount_amount || 0),
          finalPrice: parseFloat(row.final_price),
          paymentMode: row.payment_mode || 'FULL',
          downPayment: parseFloat(row.down_payment || 0),
          amountPaid: parseFloat(row.amount_paid || 0),
          totalRefunded: parseFloat(row.total_refunded || 0),
          paymentStatus: row.payment_status,
          notes: row.notes,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('Get course enrollments error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.ENROLLMENTS_FAILED', 'Failed to get course enrollments');
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_DELETE', 'Access denied to delete this course');
      }

      // Reject hard-delete if anyone has ever enrolled (direct or via a master bundle).
      // Even DROPPED enrollments are kept for audit, so we count all rows.
      const enrollCounts = await queryOne(
        `SELECT
            (SELECT COUNT(*) FROM enrollments WHERE course_id = $1) AS direct,
            (SELECT COUNT(*) FROM master_class_enrollments WHERE course_id = $1) AS bundle`,
        [params.id]
      );
      const direct = parseInt(enrollCounts?.direct || '0', 10);
      const bundle = parseInt(enrollCounts?.bundle || '0', 10);
      if (direct + bundle > 0) {
        return apiError(
          409,
          'ERRORS.COURSES.HAS_ENROLLMENTS',
          'Course has enrollments and cannot be deleted; deactivate it instead'
        );
      }

      await query('DELETE FROM classes WHERE course_id = $1', [params.id]);
      await query(
        'DELETE FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: { message: 'Course deleted successfully', code: 'COURSES.DELETED' },
      };
    } catch (error) {
      console.error('Delete course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.DELETE_FAILED', 'Failed to delete course', 404);
    }
  },

  deactivate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }
      if (!existing.is_active) {
        return { status: 200 as const, body: mapCourseFromDB(existing) };
      }

      // A class blocks deactivation if it is still active AND not finished.
      // The caller must either finish the class (status DONE) or deactivate it first.
      const blockingClasses = await query(
        `SELECT id, name, code, start_date
         FROM classes
         WHERE course_id = $1 AND is_active = true AND is_finished = false`,
        [params.id]
      );

      if (blockingClasses.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const inProgress = blockingClasses.filter((c: any) => {
          const start = c.start_date ? new Date(c.start_date) : null;
          return !start || start.getTime() <= today.getTime();
        });
        const codeKey = inProgress.length > 0
          ? 'ERRORS.COURSES.HAS_IN_PROGRESS_CLASSES'
          : 'ERRORS.COURSES.HAS_ACTIVE_CLASSES';
        return {
          status: 409 as const,
          body: {
            message: 'Course has classes that must be finished or deactivated first',
            code: codeKey,
            classes: blockingClasses.map((c: any) => ({ id: c.id, name: c.name, code: c.code })),
          } as any,
        };
      }

      const course = await update('courses', params.id, { is_active: false });
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      return { status: 200 as const, body: mapCourseFromDB(course) };
    } catch (error) {
      console.error('Deactivate course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to deactivate course', 400);
    }
  },

  activate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.COURSES.ACCESS_DENIED_UPDATE', 'Access denied to update this course');
      }

      const course = await update('courses', params.id, { is_active: true });
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      return { status: 200 as const, body: mapCourseFromDB(course) };
    } catch (error) {
      console.error('Activate course error:', error);
      return mapThrownError(error, 'ERRORS.COURSES.UPDATE_FAILED', 'Failed to activate course', 400);
    }
  },
};
