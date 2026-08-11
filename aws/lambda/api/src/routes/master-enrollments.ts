import { insert, query, queryOne, update } from '../db/connection';
import { ensurePaymentRecorderColumns } from '../db/payment-ledger';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureBillsForMonth } from './monthly-subscriptions';

type AuthHeaders = { authorization: string };

let paymentsTableReady = false;
async function ensurePaymentsTable() {
  if (paymentsTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS master_enrollment_payments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      master_enrollment_id UUID NOT NULL REFERENCES master_enrollments(id) ON DELETE CASCADE,
      company_id UUID NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_mep_me_id ON master_enrollment_payments(master_enrollment_id)`);
  paymentsTableReady = true;
}

function mapRow(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    studentId: row.student_id,
    studentName: row.student_name ?? null,
    masterCourseId: row.master_course_id,
    masterCourseName: row.master_course_name ?? null,
    masterCoursePrice: row.master_course_price !== undefined && row.master_course_price !== null
      ? parseFloat(row.master_course_price) : null,
    branchId: row.branch_id,
    branchName: row.branch_name ?? null,
    enrollmentDate: row.enrollment_date,
    originalPrice: parseFloat(row.original_price || '0'),
    discountPercent: parseFloat(row.discount_percent || '0'),
    discountAmount: parseFloat(row.discount_amount || '0'),
    finalPrice: parseFloat(row.final_price || '0'),
    paymentMode: row.payment_mode || 'FULL',
    downPayment: parseFloat(row.down_payment || '0'),
    amountPaid: parseFloat(row.amount_paid || '0'),
    totalRefunded: parseFloat(row.total_refunded || '0'),
    paymentStatus: row.payment_status || 'PENDING',
    paymentMethod: row.payment_method,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computePaymentStatus(finalPrice: number, amountPaid: number): 'PENDING' | 'PARTIAL' | 'PAID' {
  if (amountPaid <= 0) return 'PENDING';
  if (amountPaid >= finalPrice) return 'PAID';
  return 'PARTIAL';
}

function mapWithProgress(row: any) {
  return {
    ...mapRow(row),
    totalCourses: parseInt(row.total_courses || '0', 10),
    completedCourses: parseInt(row.completed_courses || '0', 10),
    activeCourses: parseInt(row.active_courses || '0', 10),
    pendingCourses: parseInt(row.pending_courses || '0', 10),
  };
}

const SELECT_WITH_PROGRESS = `
  SELECT
    me.*,
    s.name AS student_name,
    mc.name AS master_course_name,
    mc.default_price AS master_course_price,
    b.name AS branch_name,
    (SELECT COUNT(*) FROM master_course_courses mcc WHERE mcc.master_course_id = me.master_course_id) AS total_courses,
    (SELECT COUNT(*) FROM master_class_enrollments mce
       INNER JOIN classes cl ON cl.id = mce.class_id
      WHERE mce.master_enrollment_id = me.id
        AND mce.status != 'DROPPED'
        AND COALESCE(cl.is_finished, false) = true) AS completed_courses,
    (SELECT COUNT(*) FROM master_class_enrollments mce
       INNER JOIN classes cl ON cl.id = mce.class_id
      WHERE mce.master_enrollment_id = me.id
        AND mce.status != 'DROPPED'
        AND COALESCE(cl.is_finished, false) = false) AS active_courses,
    (SELECT COUNT(*) FROM master_class_enrollments mce
      WHERE mce.master_enrollment_id = me.id AND mce.status = 'DROPPED') AS pending_courses
  FROM master_enrollments me
  INNER JOIN students s ON s.id = me.student_id
  INNER JOIN master_courses mc ON mc.id = me.master_course_id
  INNER JOIN branches b ON b.id = me.branch_id
`;

export const masterEnrollmentsRoutes = {
  list: async ({ query: queryParams, headers }: { query: { status?: string; branchId?: string; studentId?: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const conditions: string[] = ['me.company_id = $1'];
      const params: any[] = [context.companyId];

      if (queryParams.status) {
        params.push(queryParams.status);
        conditions.push(`me.status = $${params.length}`);
      }
      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        conditions.push(`me.student_id = $${params.length}`);
      }
      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        conditions.push(`me.branch_id = $${params.length}`);
      }

      const rows = await query(
        `${SELECT_WITH_PROGRESS} WHERE ${conditions.join(' AND ')} ORDER BY me.enrollment_date DESC`,
        params
      );
      const filtered = rows.filter((r: any) => canAccessBranch(context, r.branch_id));
      return { status: 200 as const, body: filtered.map(mapWithProgress) };
    } catch (error: any) {
      console.error('List master enrollments error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.LIST_FAILED', 'Failed to list master enrollments');
    }
  },

  create: async ({ body, headers }: { body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [body.masterCourseId, context.companyId]
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');
      if (!canAccessBranch(context, master.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const student = await queryOne(
        'SELECT id, branch_id FROM students WHERE id = $1',
        [body.studentId]
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      if (student.branch_id !== master.branch_id) {
        return apiError(400, 'ERRORS.MASTER_ENROLLMENTS.STUDENT_BRANCH_MISMATCH', 'Student must belong to the same branch as the master course');
      }

      const existing = await queryOne(
        `SELECT id FROM master_enrollments
         WHERE student_id = $1 AND master_course_id = $2 AND status = 'ACTIVE'`,
        [body.studentId, body.masterCourseId]
      );
      if (existing) {
        return apiError(400, 'ERRORS.MASTER_ENROLLMENTS.ALREADY_ACTIVE', 'Student already has an active enrollment in this master course');
      }

      const masterFull = await queryOne(
        'SELECT default_price, payment_type FROM master_courses WHERE id = $1',
        [body.masterCourseId]
      );
      const defaultPrice = parseFloat(masterFull?.default_price || '0');
      const isMonthly = masterFull?.payment_type === 'MONTHLY_SUBSCRIPTION';

      const originalPrice = typeof body.originalPrice === 'number' ? body.originalPrice : defaultPrice;
      const discountPercent = typeof body.discountPercent === 'number' ? body.discountPercent : 0;
      const discountAmount = typeof body.discountAmount === 'number' ? body.discountAmount : 0;
      const finalPrice = typeof body.finalPrice === 'number' ? body.finalPrice : originalPrice;

      // A per-month master is not a sale, so none of the bundle's payment fields
      // mean anything here: there is no total to split into instalments and
      // nothing is collected at the desk when they join. final_price is the fee
      // agreed per month, and the monthly bills carry what is owed and paid.
      const paymentMode: 'FULL' | 'INSTALLMENTS' =
        !isMonthly && body.paymentMode === 'INSTALLMENTS' ? 'INSTALLMENTS' : 'FULL';
      const downPayment = paymentMode === 'INSTALLMENTS' ? (typeof body.downPayment === 'number' ? body.downPayment : 0) : 0;
      const amountPaid = isMonthly
        ? 0
        : typeof body.amountPaid === 'number'
          ? body.amountPaid
          : (paymentMode === 'FULL' ? finalPrice : downPayment);
      const paymentStatus = isMonthly ? 'PENDING' : computePaymentStatus(finalPrice, amountPaid);

      const row = await insert('master_enrollments', {
        company_id: context.companyId,
        student_id: body.studentId,
        master_course_id: body.masterCourseId,
        branch_id: master.branch_id,
        enrollment_date: body.enrollmentDate,
        original_price: originalPrice,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        final_price: finalPrice,
        payment_mode: paymentMode,
        down_payment: downPayment,
        amount_paid: amountPaid,
        payment_status: paymentStatus,
        payment_method: body.paymentMethod || null,
        notes: body.notes || null,
        status: 'ACTIVE',
      });

      // Raise this month's fee straight away rather than waiting for someone to
      // open the subscriptions page — a student who joined today owes for today's
      // month, and the desk should see it while they are still standing there.
      // Idempotent, and scoped to the month they joined in.
      if (isMonthly) {
        const joined = new Date(body.enrollmentDate || Date.now());
        await ensureBillsForMonth(context.companyId, joined.getFullYear(), joined.getMonth() + 1);
      }

      const full = await queryOne(`${SELECT_WITH_PROGRESS} WHERE me.id = $1`, [row.id]);
      return { status: 201 as const, body: mapWithProgress(full || row) };
    } catch (error: any) {
      console.error('Create master enrollment error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.CREATE_FAILED', 'Failed to create master enrollment', 400);
    }
  },

  listByStudent: async ({ params, headers }: { params: { studentId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query(
        `${SELECT_WITH_PROGRESS}
         WHERE me.company_id = $1 AND me.student_id = $2
         ORDER BY me.enrollment_date DESC`,
        [context.companyId, params.studentId]
      );
      const filtered = rows.filter((r: any) => canAccessBranch(context, r.branch_id));
      return { status: 200 as const, body: filtered.map(mapWithProgress) };
    } catch (error: any) {
      console.error('List master enrollments by student error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.LIST_FAILED', 'Failed to list master enrollments');
    }
  },

  listByMaster: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const rows = await query(
        `${SELECT_WITH_PROGRESS}
         WHERE me.company_id = $1 AND me.master_course_id = $2
         ORDER BY me.enrollment_date DESC`,
        [context.companyId, params.id]
      );
      const filtered = rows.filter((r: any) => canAccessBranch(context, r.branch_id));
      return { status: 200 as const, body: filtered.map(mapWithProgress) };
    } catch (error: any) {
      console.error('List master enrollments by master error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.LIST_FAILED', 'Failed to list master enrollments');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const row = await queryOne(
        `${SELECT_WITH_PROGRESS} WHERE me.id = $1 AND me.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }
      return { status: 200 as const, body: mapWithProgress(row) };
    } catch (error: any) {
      console.error('Get master enrollment error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found', 404);
    }
  },

  cancel: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne(
        'SELECT id, branch_id, status FROM master_enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }
      await update('master_enrollments', params.id, { status: 'CANCELLED' });
      return { status: 200 as const, body: { message: 'Master enrollment cancelled', code: 'MASTER_ENROLLMENTS.CANCELLED' } };
    } catch (error: any) {
      console.error('Cancel master enrollment error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.CANCEL_FAILED', 'Failed to cancel master enrollment', 400);
    }
  },

  // Refund history for one master enrollment.
  listRefunds: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const me = await queryOne(
        'SELECT branch_id FROM master_enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!me) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, me.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }
      const rows = await query(
        `SELECT * FROM refunds
         WHERE master_enrollment_id = $1 AND company_id = $2
         ORDER BY refund_date DESC, created_at DESC`,
        [params.id, context.companyId]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          enrollmentId: r.enrollment_id,
          masterEnrollmentId: r.master_enrollment_id,
          companyId: r.company_id,
          studentId: r.student_id,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      };
    } catch (error: any) {
      console.error('List master enrollment refunds error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.LIST_REFUNDS_FAILED', 'Failed to list refunds');
    }
  },

  // Refund a master enrollment (full or partial). Cannot refund more than the
  // paid-minus-already-refunded balance.
  createRefund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const me = await queryOne(
        'SELECT * FROM master_enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!me) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, me.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }

      const amount = parseFloat(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return apiError(400, 'ERRORS.MASTER_ENROLLMENTS.REFUND_NON_POSITIVE', 'Refund amount must be a positive number');
      }
      const type = body.type === 'FULL' ? 'FULL' : 'PARTIAL';

      const amountPaid = parseFloat(me.amount_paid || '0');
      const alreadyRefunded = parseFloat(me.total_refunded || '0');
      const refundable = amountPaid - alreadyRefunded;
      if (amount > refundable + 0.001) {
        return apiError(400, 'ERRORS.MASTER_ENROLLMENTS.REFUND_EXCEEDS_REFUNDABLE', `Cannot refund more than refundable amount (${refundable.toFixed(2)})`);
      }

      const refund = await insert('refunds', {
        enrollment_id: null,
        master_enrollment_id: params.id,
        company_id: context.companyId,
        student_id: me.student_id,
        amount,
        refund_date: body.refundDate,
        type,
        reason: body.reason || null,
      });

      const newTotalRefunded = alreadyRefunded + amount;
      const fullyRefunded = newTotalRefunded >= amountPaid - 0.001;
      const sets: string[] = ['total_refunded = $1', 'updated_at = NOW()'];
      const values: any[] = [newTotalRefunded];
      if (fullyRefunded) {
        sets.push(`payment_status = 'PENDING'`);
        sets.push(`status = 'CANCELLED'`);
      }
      values.push(params.id);
      await query(
        `UPDATE master_enrollments SET ${sets.join(', ')} WHERE id = $${values.length}`,
        values
      );

      return {
        status: 201 as const,
        body: {
          id: refund.id,
          enrollmentId: refund.enrollment_id,
          masterEnrollmentId: refund.master_enrollment_id,
          companyId: refund.company_id,
          studentId: refund.student_id,
          amount: parseFloat(refund.amount),
          refundDate: refund.refund_date,
          type: refund.type,
          reason: refund.reason,
          createdAt: refund.created_at,
        },
      };
    } catch (error: any) {
      console.error('Create master enrollment refund error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.CREATE_REFUND_FAILED', 'Failed to create refund', 400);
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensurePaymentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const me = await queryOne(
        'SELECT branch_id FROM master_enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!me) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, me.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }
      const rows = await query(
        `SELECT * FROM master_enrollment_payments
         WHERE master_enrollment_id = $1 AND company_id = $2
         ORDER BY payment_date ASC, created_at ASC`,
        [params.id, context.companyId]
      );
      return {
        status: 200 as const,
        body: rows.map((p: any) => ({
          id: p.id,
          enrollmentId: null,
          masterEnrollmentId: p.master_enrollment_id,
          companyId: p.company_id,
          amount: parseFloat(p.amount),
          paymentDate: p.payment_date,
          notes: p.notes,
          createdAt: p.created_at,
        })),
      };
    } catch (error: any) {
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.GET_PAYMENTS_FAILED', 'Failed to get payments');
    }
  },

  addPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      await ensurePaymentsTable();
      await ensurePaymentRecorderColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const me = await queryOne(
        'SELECT * FROM master_enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!me) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (!canAccessBranch(context, me.branch_id)) {
        return apiError(403, 'ERRORS.MASTER_ENROLLMENTS.ACCESS_DENIED', 'Access denied');
      }

      const currentAmountPaid = parseFloat(me.amount_paid || '0');
      const finalPrice = parseFloat(me.final_price || '0');
      const remaining = finalPrice - currentAmountPaid;
      const amount = parseFloat(body.amount);
      if (amount > remaining + 0.001) {
        return apiError(400, 'ERRORS.MASTER_ENROLLMENTS.PAYMENT_EXCEEDS_BALANCE', `Payment exceeds remaining balance (${remaining.toFixed(2)})`);
      }

      const payment = await insert('master_enrollment_payments', {
        master_enrollment_id: params.id,
        company_id: context.companyId,
        amount,
        payment_date: body.paymentDate,
        notes: body.notes || null,
        recorded_by_user_id: context.userId,
      });

      const newAmountPaid = currentAmountPaid + amount;
      const newPaymentStatus = computePaymentStatus(finalPrice, newAmountPaid);
      await query(
        'UPDATE master_enrollments SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
        [newAmountPaid, newPaymentStatus, params.id]
      );

      return {
        status: 201 as const,
        body: {
          id: payment.id,
          enrollmentId: null,
          masterEnrollmentId: payment.master_enrollment_id,
          companyId: payment.company_id,
          amount: parseFloat(payment.amount),
          paymentDate: payment.payment_date,
          notes: payment.notes,
          createdAt: payment.created_at,
        },
      };
    } catch (error: any) {
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.ADD_PAYMENT_FAILED', 'Failed to add payment', 400);
    }
  },

  // For enrollment flow: when a student tries to enroll in a course, check
  // whether that course is covered by an active master enrollment and return
  // the master enrollment id. Returns null if not covered.
  coverageCheck: async ({ query: q, headers }: { query: { studentId: string; courseId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const row = await queryOne(
        `SELECT me.id AS master_enrollment_id, mc.id AS master_course_id, mc.name AS master_course_name
         FROM master_enrollments me
         INNER JOIN master_courses mc ON mc.id = me.master_course_id
         INNER JOIN master_course_courses mcc ON mcc.master_course_id = mc.id
         WHERE me.company_id = $1
           AND me.student_id = $2
           AND me.status = 'ACTIVE'
           AND mcc.course_id = $3
         LIMIT 1`,
        [context.companyId, q.studentId, q.courseId]
      );
      if (!row) {
        return { status: 200 as const, body: { covered: false } };
      }
      return {
        status: 200 as const,
        body: {
          covered: true,
          masterEnrollmentId: row.master_enrollment_id,
          masterCourseId: row.master_course_id,
          masterCourseName: row.master_course_name,
        },
      };
    } catch (error: any) {
      console.error('Coverage check error:', error);
      return mapThrownError(error, 'ERRORS.MASTER_ENROLLMENTS.COVERAGE_CHECK_FAILED', 'Failed to check coverage');
    }
  },
};
