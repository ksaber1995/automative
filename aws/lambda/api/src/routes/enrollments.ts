import { insert, update, findById, query } from '../db/connection';

function mapEnrollmentFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const enrollment = await insert('enrollments', {
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
        status: 400 as const,
        body: { message: 'Failed to create enrollment' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { studentId?: string; courseId?: string; branchId?: string; status?: string } }) => {
    try {
      let sql = 'SELECT * FROM enrollments WHERE 1=1';
      const params: any[] = [];

      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        sql += ` AND student_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND course_id = $${params.length}`;
      }

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const enrollment = await findById('enrollments', params.id);

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
      console.error('Get enrollment error:', error);
      return {
        status: 404 as const,
        body: { message: 'Enrollment not found' },
      };
    }
  },

  getByStudent: async ({ params }: { params: { studentId: string } }) => {
    try {
      const enrollments = await query(
        'SELECT * FROM enrollments WHERE student_id = $1 ORDER BY enrollment_date DESC',
        [params.studentId]
      );

      return {
        status: 200 as const,
        body: enrollments.map(mapEnrollmentFromDB),
      };
    } catch (error) {
      console.error('Get student enrollments error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to update enrollment' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to delete enrollment' },
      };
    }
  },
};
