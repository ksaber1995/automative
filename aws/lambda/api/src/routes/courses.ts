import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

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
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
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
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Create course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create course' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `
        SELECT
          c.*,
          COUNT(DISTINCT e.id) FILTER (WHERE e.status != 'DROPPED') as direct_enrollment_count,
          COUNT(DISTINCT mce.id) FILTER (WHERE mce.status != 'DROPPED') as master_enrollment_count
        FROM courses c
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.status != 'DROPPED'
        LEFT JOIN master_class_enrollments mce ON c.id = mce.course_id AND mce.status != 'DROPPED'
        WHERE c.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      }

      sql += ' GROUP BY c.id ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseWithEnrollmentCountFromDB),
      };
    } catch (error) {
      console.error('List courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list courses' },
      };
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = 'SELECT * FROM courses WHERE company_id = $1 AND is_active = true';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseFromDB),
      };
    } catch (error) {
      console.error('List active courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list active courses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this course' },
        };
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Get course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Course not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this course' },
        };
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
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

      const course = await update('courses', params.id, updateData);

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Update course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update course' },
      };
    }
  },

  getEnrollments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!course) {
        return { status: 404 as const, body: { message: 'Course not found' } };
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this course' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get course enrollments' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this course' },
        };
      }

      const course = await update('courses', params.id, { is_active: false });

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Course deleted successfully' },
      };
    } catch (error) {
      console.error('Delete course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete course' },
      };
    }
  },
};
