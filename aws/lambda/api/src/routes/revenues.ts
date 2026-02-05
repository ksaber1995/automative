import { insert, update, findById, query } from '../db/connection';

function mapRevenueFromDB(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    courseId: row.course_id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    amount: parseFloat(row.amount),
    description: row.description,
    date: row.date,
    paymentMethod: row.payment_method,
    receiptNumber: row.receipt_number,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const revenuesRoutes = {
  create: async ({ body }: { body: any }) => {
    try {
      const revenue = await insert('revenues', {
        branch_id: body.branchId,
        course_id: body.courseId || null,
        enrollment_id: body.enrollmentId || null,
        student_id: body.studentId || null,
        amount: body.amount,
        description: body.description || null,
        date: body.date,
        payment_method: body.paymentMethod || null,
        receipt_number: body.receiptNumber || null,
        notes: body.notes || null,
      });

      return {
        status: 201 as const,
        body: mapRevenueFromDB(revenue),
      };
    } catch (error) {
      console.error('Create revenue error:', error);
      return {
        status: 400 as const,
        body: { message: 'Failed to create revenue' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string; startDate?: string; endDate?: string } }) => {
    try {
      let sql = 'SELECT * FROM revenues WHERE 1=1';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND date <= $${params.length}`;
      }

      sql += ' ORDER BY date DESC, created_at DESC';

      const revenues = await query(sql, params);
      return {
        status: 200 as const,
        body: revenues.map(mapRevenueFromDB),
      };
    } catch (error) {
      console.error('List revenues error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const revenue = await findById('revenues', params.id);

      if (!revenue) {
        return {
          status: 404 as const,
          body: { message: 'Revenue not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapRevenueFromDB(revenue),
      };
    } catch (error) {
      console.error('Get revenue error:', error);
      return {
        status: 404 as const,
        body: { message: 'Revenue not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
      if (body.courseId !== undefined) updateData.course_id = body.courseId;
      if (body.enrollmentId !== undefined) updateData.enrollment_id = body.enrollmentId;
      if (body.studentId !== undefined) updateData.student_id = body.studentId;
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.date !== undefined) updateData.date = body.date;
      if (body.paymentMethod !== undefined) updateData.payment_method = body.paymentMethod;
      if (body.receiptNumber !== undefined) updateData.receipt_number = body.receiptNumber;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const revenue = await update('revenues', params.id, updateData);

      if (!revenue) {
        return {
          status: 404 as const,
          body: { message: 'Revenue not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapRevenueFromDB(revenue),
      };
    } catch (error) {
      console.error('Update revenue error:', error);
      return {
        status: 404 as const,
        body: { message: 'Failed to update revenue' },
      };
    }
  },
};
