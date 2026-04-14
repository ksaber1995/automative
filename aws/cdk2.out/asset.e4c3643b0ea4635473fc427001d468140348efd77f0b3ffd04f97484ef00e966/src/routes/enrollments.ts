import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

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
    paymentMode: row.payment_mode || 'FULL',
    downPayment: parseFloat(row.down_payment || 0),
    amountPaid: parseFloat(row.amount_paid || 0),
    totalRefunded: parseFloat(row.total_refunded || 0),
    paymentStatus: row.payment_status,
    completionDate: row.completion_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computePaymentStatus(finalPrice: number, amountPaid: number): string {
  if (amountPaid <= 0) return 'PENDING';
  if (amountPaid >= finalPrice) return 'PAID';
  return 'PARTIAL';
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

      const paymentMode = body.paymentMode || 'FULL';
      const downPayment = body.downPayment || 0;
      const amountPaid = paymentMode === 'FULL' ? body.finalPrice : downPayment;
      const paymentStatus = computePaymentStatus(body.finalPrice, amountPaid);

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
        payment_mode: paymentMode,
        down_payment: downPayment,
        amount_paid: amountPaid,
        payment_status: paymentStatus,
        completion_date: null,
        notes: body.notes || null,
      });

      // If there's a down payment or full payment, record it
      if (amountPaid > 0) {
        await insert('enrollment_payments', {
          enrollment_id: enrollment.id,
          company_id: context.companyId,
          amount: amountPaid,
          payment_date: body.enrollmentDate,
          notes: paymentMode === 'FULL' ? 'Full payment' : 'Down payment',
        });
      }

      return {
        status: 201 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Create enrollment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update enrollment' },
      };
    }
  },

  listDues: async ({ query: q, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const conditions: string[] = ['e.company_id = $1', "e.payment_mode = 'INSTALLMENTS'", "e.payment_status != 'PAID'", "e.status != 'DROPPED'"];
      const params: any[] = [context.companyId];
      let idx = 2;

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        conditions.push(`e.branch_id = $${idx++}`);
        params.push(q.branchId);
      } else if (context.role !== 'ADMIN' && context.branchId) {
        conditions.push(`e.branch_id = $${idx++}`);
        params.push(context.branchId);
      }

      const rows = await query(
        `SELECT e.id, e.student_id, e.course_id, e.branch_id, e.enrollment_date,
                e.final_price, e.amount_paid, e.payment_status, e.status,
                s.first_name || ' ' || s.last_name AS student_name,
                c.name AS course_name,
                b.name AS branch_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN courses c ON e.course_id = c.id
         JOIN branches b ON e.branch_id = b.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY e.enrollment_date DESC`,
        params
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          studentId: r.student_id,
          studentName: r.student_name,
          courseId: r.course_id,
          courseName: r.course_name,
          branchId: r.branch_id,
          branchName: r.branch_name,
          enrollmentDate: r.enrollment_date,
          finalPrice: parseFloat(r.final_price),
          amountPaid: parseFloat(r.amount_paid || 0),
          remaining: Math.max(0, parseFloat(r.final_price) - parseFloat(r.amount_paid || 0)),
          paymentStatus: r.payment_status,
          status: r.status,
        })),
      };
    } catch (error) {
      return { status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500, body: { message: error.message || 'Failed to list dues' } };
    }
  },

  listRefunds: async ({ query: q, headers }: { query: { branchId?: string; studentId?: string; type?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const conditions: string[] = ['r.company_id = $1'];
      const params: any[] = [context.companyId];
      let idx = 2;

      if (q.branchId) { conditions.push(`e.branch_id = $${idx++}`); params.push(q.branchId); }
      if (q.studentId) { conditions.push(`r.student_id = $${idx++}`); params.push(q.studentId); }
      if (q.type) { conditions.push(`r.type = $${idx++}`); params.push(q.type); }
      if (q.startDate) { conditions.push(`r.refund_date >= $${idx++}`); params.push(q.startDate); }
      if (q.endDate) { conditions.push(`r.refund_date <= $${idx++}`); params.push(q.endDate); }

      const refunds = await query(
        `SELECT r.*,
                s.first_name || ' ' || s.last_name AS student_name,
                c.name AS course_name,
                b.name AS branch_name,
                e.branch_id
         FROM refunds r
         JOIN enrollments e ON r.enrollment_id = e.id
         JOIN students s ON r.student_id = s.id
         JOIN courses c ON e.course_id = c.id
         JOIN branches b ON e.branch_id = b.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY r.refund_date DESC, r.created_at DESC`,
        params
      );

      return {
        status: 200 as const,
        body: refunds.map((r: any) => ({
          id: r.id,
          enrollmentId: r.enrollment_id,
          companyId: r.company_id,
          studentId: r.student_id,
          studentName: r.student_name,
          courseName: r.course_name,
          branchName: r.branch_name,
          branchId: r.branch_id,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      };
    } catch (error) {
      return { status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500, body: { message: error.message || 'Failed to list refunds' } };
    }
  },

  getRefunds: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const refunds = await query(
        'SELECT * FROM refunds WHERE enrollment_id = $1 AND company_id = $2 ORDER BY refund_date ASC',
        [params.id, context.companyId]
      );
      return {
        status: 200 as const,
        body: refunds.map((r: any) => ({
          id: r.id, enrollmentId: r.enrollment_id, companyId: r.company_id,
          studentId: r.student_id, amount: parseFloat(r.amount),
          refundDate: r.refund_date, type: r.type, reason: r.reason, createdAt: r.created_at,
        })),
      };
    } catch (error) {
      return { status: 500 as const, body: { message: error.message || 'Failed to get refunds' } };
    }
  },

  createRefund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!enrollment) return { status: 404 as const, body: { message: 'Enrollment not found' } };

      const refundAmount = parseFloat(body.amount);
      const currentAmountPaid = parseFloat(enrollment.amount_paid || 0);
      const currentTotalRefunded = parseFloat(enrollment.total_refunded || 0);
      const refundableAmount = currentAmountPaid - currentTotalRefunded;

      if (refundAmount > refundableAmount) {
        return { status: 400 as const, body: { message: `Cannot refund more than refundable amount (${refundableAmount.toFixed(2)})` } };
      }

      const refund = await insert('refunds', {
        enrollment_id: params.id,
        company_id: context.companyId,
        student_id: enrollment.student_id,
        amount: refundAmount,
        refund_date: body.refundDate,
        type: body.type,
        reason: body.reason || null,
      });

      // Increment total_refunded; only set REFUNDED if fully refunded, otherwise keep payment_status
      const newTotalRefunded = currentTotalRefunded + refundAmount;
      const isFullyRefunded = newTotalRefunded >= currentAmountPaid;

      await query(
        `UPDATE enrollments SET total_refunded = $1${isFullyRefunded ? ", payment_status = 'REFUNDED'" : ''}, updated_at = NOW() WHERE id = $2`,
        [newTotalRefunded, params.id]
      );

      return {
        status: 201 as const,
        body: {
          id: refund.id, enrollmentId: refund.enrollment_id, companyId: refund.company_id,
          studentId: refund.student_id, amount: parseFloat(refund.amount),
          refundDate: refund.refund_date, type: refund.type, reason: refund.reason, createdAt: refund.created_at,
        },
      };
    } catch (error) {
      return { status: 400 as const, body: { message: error.message || 'Failed to create refund' } };
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return { status: 404 as const, body: { message: 'Enrollment not found' } };
      }

      const payments = await query(
        'SELECT * FROM enrollment_payments WHERE enrollment_id = $1 AND company_id = $2 ORDER BY payment_date ASC, created_at ASC',
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: payments.map((p: any) => ({
          id: p.id,
          enrollmentId: p.enrollment_id,
          companyId: p.company_id,
          amount: parseFloat(p.amount),
          paymentDate: p.payment_date,
          notes: p.notes,
          createdAt: p.created_at,
        })),
      };
    } catch (error) {
      console.error('Get payments error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get payments' },
      };
    }
  },

  addPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return { status: 404 as const, body: { message: 'Enrollment not found' } };
      }

      const currentAmountPaid = parseFloat(enrollment.amount_paid || 0);
      const finalPrice = parseFloat(enrollment.final_price);
      const remaining = finalPrice - currentAmountPaid;

      if (parseFloat(body.amount) > remaining) {
        return { status: 400 as const, body: { message: `Payment exceeds remaining balance (${remaining.toFixed(2)})` } };
      }

      const payment = await insert('enrollment_payments', {
        enrollment_id: params.id,
        company_id: context.companyId,
        amount: body.amount,
        payment_date: body.paymentDate,
        notes: body.notes || null,
      });

      // Update enrollment amount_paid and payment_status
      const newAmountPaid = currentAmountPaid + parseFloat(body.amount);
      const newPaymentStatus = computePaymentStatus(finalPrice, newAmountPaid);

      await query(
        'UPDATE enrollments SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
        [newAmountPaid, newPaymentStatus, params.id]
      );

      return {
        status: 201 as const,
        body: {
          id: payment.id,
          enrollmentId: payment.enrollment_id,
          companyId: payment.company_id,
          amount: parseFloat(payment.amount),
          paymentDate: payment.payment_date,
          notes: payment.notes,
          createdAt: payment.created_at,
        },
      };
    } catch (error) {
      console.error('Add payment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to add payment' },
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete enrollment' },
      };
    }
  },
};
