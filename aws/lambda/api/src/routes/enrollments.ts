import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapEnrollmentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    studentId: row.student_id,
    classId: row.class_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    enrollmentDate: row.enrollment_date,
    status: row.status,
    originalPrice: parseFloat(row.original_price),
    discountPercent: parseFloat(row.discount_percent || 0),
    discountAmount: parseFloat(row.discount_amount || 0),
    finalPrice: parseFloat(row.final_price),
    paymentStatus: row.payment_status,
    completionDate: row.completion_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const enrollmentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const enrollment = await insert('enrollments', {
        company_id: context.companyId,
        student_id: body.studentId,
        class_id: body.classId,
        course_id: body.courseId,
        branch_id: body.branchId,
        enrollment_date: body.enrollmentDate,
        status: body.status,
        original_price: body.originalPrice,
        discount_percent: body.discountPercent || 0,
        discount_amount: body.discountAmount || 0,
        final_price: body.finalPrice,
        payment_status: body.paymentStatus,
        completion_date: null,
        notes: body.notes || null,
      });

      return {
        status: 201 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Create enrollment error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create enrollment' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { studentId?: string; courseId?: string; branchId?: string; status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM enrollments WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        sql += ` AND student_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND course_id = $${params.length}`;
      }

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      if (queryParams.status) {
        params.push(queryParams.status);
        sql += ` AND status = $${params.length}`;
      }

      sql += ' ORDER BY enrollment_date DESC';

      const enrollments = await query(sql, params);
      return {
        status: 200 as const,
        body: enrollments.map(mapEnrollmentFromDB),
      };
    } catch (error) {
      console.error('List enrollments error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list enrollments' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return {
          status: 404 as const,
          body: { message: 'Enrollment not found' },
        };
      }

      if (!canAccessBranch(context, enrollment.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this enrollment' },
        };
      }

      return {
        status: 200 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Get enrollment error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Enrollment not found' },
      };
    }
  },

  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const enrollments = await query(
        'SELECT * FROM enrollments WHERE student_id = $1 AND company_id = $2 ORDER BY enrollment_date DESC',
        [params.studentId, context.companyId]
      );

      return {
        status: 200 as const,
        body: enrollments.map(mapEnrollmentFromDB),
      };
    } catch (error) {
      console.error('Get student enrollments error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get student enrollments' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Enrollment not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this enrollment' },
        };
      }

      const updateData: any = {};

      if (body.status !== undefined) updateData.status = body.status;
      if (body.paymentStatus !== undefined) updateData.payment_status = body.paymentStatus;
      if (body.completionDate !== undefined) updateData.completion_date = body.completionDate;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const enrollment = await update('enrollments', params.id, updateData);

      if (!enrollment) {
        return {
          status: 404 as const,
          body: { message: 'Enrollment not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Update enrollment error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update enrollment' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Enrollment not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this enrollment' },
        };
      }

      // Soft delete by setting status to DROPPED
      const enrollment = await update('enrollments', params.id, { status: 'DROPPED' });

      if (!enrollment) {
        return {
          status: 404 as const,
          body: { message: 'Enrollment not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Enrollment deleted successfully' },
      };
    } catch (error) {
      console.error('Delete enrollment error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete enrollment' },
      };
    }
  },
};
