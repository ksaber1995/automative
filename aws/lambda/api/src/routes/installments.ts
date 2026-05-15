import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission } from '../middleware/tenant-isolation';
import { mapPaymentFromDB } from './expense-payments';
import { apiError, mapThrownError } from '../utils/api-error';

function mapPlanFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id || null,
    name: row.name,
    description: row.description || null,
    type: row.type,
    category: row.category,
    totalAmount: parseFloat(row.total_amount),
    downpaymentAmount: parseFloat(row.downpayment_amount),
    financedAmount: parseFloat(row.financed_amount),
    monthsCount: row.months_count,
    monthlyAmount: parseFloat(row.monthly_amount),
    startDate: row.start_date,
    vendor: row.vendor || null,
    invoiceNumber: row.invoice_number || null,
    notes: row.notes || null,
    status: row.status,
    downpaymentPaymentId: row.downpayment_payment_id || null,
    paidCount: row.paid_count !== undefined ? parseInt(row.paid_count) || 0 : undefined,
    paidAmount: row.paid_total !== undefined ? parseFloat(row.paid_total) || 0 : undefined,
    nextDueDate: row.next_due_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapScheduleFromDB(row: any) {
  return {
    id: row.id,
    planId: row.plan_id,
    companyId: row.company_id,
    installmentNumber: row.installment_number,
    dueDate: row.due_date,
    amount: parseFloat(row.amount),
    status: row.status,
    paymentId: row.payment_id || null,
    paidDate: row.paid_date || null,
    paidAmount: row.paid_amount !== null && row.paid_amount !== undefined ? parseFloat(row.paid_amount) : null,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Add N months to an ISO date string, clamping to end-of-month if needed.
function addMonthsISO(iso: string, monthsToAdd: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  const targetMonth = d.getUTCMonth() + monthsToAdd;
  const targetYear = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const wrappedMonth = ((targetMonth % 12) + 12) % 12;
  const targetDay = d.getUTCDate();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, wrappedMonth + 1, 0)).getUTCDate();
  const day = Math.min(targetDay, lastDayOfTargetMonth);
  const result = new Date(Date.UTC(targetYear, wrappedMonth, day));
  return result.toISOString().split('T')[0];
}

async function recalcPlanStatus(planId: string): Promise<void> {
  const stats = await queryOne<any>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
       COUNT(*)::int AS total
     FROM installment_schedule WHERE plan_id = $1`,
    [planId]
  );
  if (!stats) return;
  if (stats.pending === 0 && stats.total > 0) {
    await query(`UPDATE installment_plans SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status <> 'CANCELED'`, [planId]);
  } else {
    await query(`UPDATE installment_plans SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'COMPLETED'`, [planId]);
  }
}

export const installmentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const totalAmount = Number(body.totalAmount);
      const downpaymentAmount = Number(body.downpaymentAmount || 0);
      const monthsCount = Number(body.monthsCount);

      if (!(totalAmount > 0)) {
        return apiError(400, 'ERRORS.INSTALLMENTS.TOTAL_NON_POSITIVE', 'Total amount must be greater than zero');
      }
      if (downpaymentAmount < 0 || downpaymentAmount >= totalAmount) {
        return apiError(400, 'ERRORS.INSTALLMENTS.DOWNPAYMENT_INVALID', 'Downpayment must be between 0 and less than total amount');
      }
      if (!Number.isInteger(monthsCount) || monthsCount < 1) {
        return apiError(400, 'ERRORS.INSTALLMENTS.MONTHS_INVALID', 'Months count must be a positive integer');
      }

      const financedAmount = parseFloat((totalAmount - downpaymentAmount).toFixed(2));
      const monthlyAmount = parseFloat((financedAmount / monthsCount).toFixed(2));

      const startDate: string = body.startDate;
      if (!startDate) {
        return apiError(400, 'ERRORS.INSTALLMENTS.START_DATE_REQUIRED', 'Start date is required');
      }

      // 1. Create downpayment expense_payment first if needed (so we can FK link it)
      let downpaymentPaymentId: string | null = null;
      if (downpaymentAmount > 0) {
        const dpPayment = await insert('expense_payments', {
          company_id: context.companyId,
          expense_id: null,
          branch_id: body.branchId || null,
          type: body.type || 'CAPITAL',
          category: body.category,
          amount: downpaymentAmount,
          date: startDate,
          notes: `Installment downpayment: ${body.name}`,
          vendor: body.vendor || null,
          invoice_number: body.invoiceNumber || null,
        });
        downpaymentPaymentId = dpPayment.id;
      }

      // 2. Create plan
      const plan = await insert('installment_plans', {
        company_id: context.companyId,
        branch_id: body.branchId || null,
        name: body.name,
        description: body.description || null,
        type: body.type || 'CAPITAL',
        category: body.category,
        total_amount: totalAmount,
        downpayment_amount: downpaymentAmount,
        financed_amount: financedAmount,
        months_count: monthsCount,
        monthly_amount: monthlyAmount,
        start_date: startDate,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        notes: body.notes || null,
        status: 'ACTIVE',
        downpayment_payment_id: downpaymentPaymentId,
      });

      // 3. Generate schedule rows. Last installment absorbs rounding remainder.
      const scheduleRows: any[] = [];
      let runningSum = 0;
      for (let i = 1; i <= monthsCount; i++) {
        const isLast = i === monthsCount;
        const amount = isLast ? parseFloat((financedAmount - runningSum).toFixed(2)) : monthlyAmount;
        runningSum += amount;
        const dueDate = addMonthsISO(startDate, i);
        const scheduleRow = await insert('installment_schedule', {
          plan_id: plan.id,
          company_id: context.companyId,
          installment_number: i,
          due_date: dueDate,
          amount,
          status: 'PENDING',
        });
        scheduleRows.push(scheduleRow);
      }

      return {
        status: 201 as const,
        body: {
          plan: mapPlanFromDB(plan),
          schedule: scheduleRows.map(mapScheduleFromDB),
          downpaymentPayment: downpaymentPaymentId ? { id: downpaymentPaymentId } : null,
        },
      };
    } catch (error) {
      console.error('Create installment plan error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.CREATE_FAILED', 'Failed to create installment plan', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT p.*,
          (SELECT COUNT(*) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PAID') AS paid_count,
          (SELECT COALESCE(SUM(s.paid_amount), 0) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PAID') AS paid_total,
          (SELECT MIN(s.due_date) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PENDING') AS next_due_date
        FROM installment_plans p
        WHERE p.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND p.branch_id = $${params.length}`;
      }
      if (queryParams.status) {
        params.push(queryParams.status);
        sql += ` AND p.status = $${params.length}`;
      }
      sql += ` ORDER BY p.created_at DESC`;

      const plans = await query(sql, params);
      return { status: 200 as const, body: plans.map(mapPlanFromDB) };
    } catch (error) {
      console.error('List installment plans error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.LIST_FAILED', 'Failed to list installment plans');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const plan = await queryOne(
        `SELECT p.*,
           (SELECT COUNT(*) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PAID') AS paid_count,
           (SELECT COALESCE(SUM(s.paid_amount), 0) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PAID') AS paid_total,
           (SELECT MIN(s.due_date) FROM installment_schedule s WHERE s.plan_id = p.id AND s.status = 'PENDING') AS next_due_date
         FROM installment_plans p
         WHERE p.id = $1 AND p.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!plan) {
        return apiError(404, 'ERRORS.INSTALLMENTS.PLAN_NOT_FOUND', 'Installment plan not found');
      }

      if (plan.branch_id && !canAccessBranch(context, plan.branch_id)) {
        return apiError(403, 'ERRORS.INSTALLMENTS.PLAN_ACCESS_DENIED', 'Access denied to this plan');
      }

      const schedule = await query(
        `SELECT * FROM installment_schedule WHERE plan_id = $1 ORDER BY installment_number ASC`,
        [params.id]
      );

      let downpaymentPayment: any = null;
      if (plan.downpayment_payment_id) {
        const dp = await queryOne(
          `SELECT * FROM expense_payments WHERE id = $1`,
          [plan.downpayment_payment_id]
        );
        if (dp) downpaymentPayment = mapPaymentFromDB(dp);
      }

      return {
        status: 200 as const,
        body: {
          plan: mapPlanFromDB(plan),
          schedule: schedule.map(mapScheduleFromDB),
          downpaymentPayment,
        },
      };
    } catch (error) {
      console.error('Get installment plan error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.PLAN_NOT_FOUND', 'Installment plan not found', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const plan = await queryOne(
        `SELECT * FROM installment_plans WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!plan) {
        return apiError(404, 'ERRORS.INSTALLMENTS.PLAN_NOT_FOUND', 'Installment plan not found');
      }
      if (plan.branch_id && !canAccessBranch(context, plan.branch_id)) {
        return apiError(403, 'ERRORS.INSTALLMENTS.PLAN_ACCESS_DENIED', 'Access denied to this plan');
      }

      // Delete linked expense_payments (downpayment + paid installments)
      const linkedPaymentIds = await query(
        `SELECT payment_id FROM installment_schedule WHERE plan_id = $1 AND payment_id IS NOT NULL`,
        [params.id]
      );
      for (const row of linkedPaymentIds) {
        await query(`DELETE FROM expense_payments WHERE id = $1 AND company_id = $2`, [row.payment_id, context.companyId]);
      }
      if (plan.downpayment_payment_id) {
        await query(`DELETE FROM expense_payments WHERE id = $1 AND company_id = $2`, [plan.downpayment_payment_id, context.companyId]);
      }

      await query(`DELETE FROM installment_plans WHERE id = $1 AND company_id = $2`, [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Installment plan deleted successfully', code: 'INSTALLMENTS.PLAN_DELETED' } };
    } catch (error) {
      console.error('Delete installment plan error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.DELETE_FAILED', 'Failed to delete installment plan');
    }
  },

  pay: async ({ params, body, headers }: { params: { id: string; scheduleId: string }; body: { date?: string; amount?: number; notes?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const plan = await queryOne(
        `SELECT * FROM installment_plans WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!plan) {
        return apiError(404, 'ERRORS.INSTALLMENTS.PLAN_NOT_FOUND', 'Installment plan not found');
      }
      if (plan.branch_id && !canAccessBranch(context, plan.branch_id)) {
        return apiError(403, 'ERRORS.INSTALLMENTS.PLAN_ACCESS_DENIED', 'Access denied to this plan');
      }

      const sched = await queryOne(
        `SELECT * FROM installment_schedule WHERE id = $1 AND plan_id = $2 AND company_id = $3`,
        [params.scheduleId, params.id, context.companyId]
      );
      if (!sched) {
        return apiError(404, 'ERRORS.INSTALLMENTS.SCHEDULE_NOT_FOUND', 'Installment not found');
      }
      if (sched.status === 'PAID') {
        return apiError(400, 'ERRORS.INSTALLMENTS.ALREADY_PAID', 'This installment is already paid');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const payAmount = body.amount !== undefined && body.amount !== null ? Number(body.amount) : parseFloat(sched.amount);
      if (!(payAmount > 0)) {
        return apiError(400, 'ERRORS.INSTALLMENTS.PAY_AMOUNT_NON_POSITIVE', 'Payment amount must be greater than zero');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        expense_id: null,
        branch_id: plan.branch_id,
        type: plan.type,
        category: plan.category,
        amount: payAmount,
        date: payDate,
        notes: body.notes || `Installment ${sched.installment_number}/${plan.months_count}: ${plan.name}`,
        vendor: plan.vendor,
        invoice_number: plan.invoice_number,
      });

      await update('installment_schedule', sched.id, {
        status: 'PAID',
        payment_id: payment.id,
        paid_date: payDate,
        paid_amount: payAmount,
        notes: body.notes || sched.notes,
      });

      await recalcPlanStatus(params.id);

      return {
        status: 201 as const,
        body: {
          payment: mapPaymentFromDB(payment),
          schedule: mapScheduleFromDB({
            ...sched,
            status: 'PAID',
            payment_id: payment.id,
            paid_date: payDate,
            paid_amount: payAmount,
          }),
        },
      };
    } catch (error) {
      console.error('Pay installment error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.PAY_FAILED', 'Failed to pay installment');
    }
  },

  unpay: async ({ params, headers }: { params: { id: string; scheduleId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const plan = await queryOne(
        `SELECT * FROM installment_plans WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!plan) {
        return apiError(404, 'ERRORS.INSTALLMENTS.PLAN_NOT_FOUND', 'Installment plan not found');
      }
      if (plan.branch_id && !canAccessBranch(context, plan.branch_id)) {
        return apiError(403, 'ERRORS.INSTALLMENTS.PLAN_ACCESS_DENIED', 'Access denied to this plan');
      }

      const sched = await queryOne(
        `SELECT * FROM installment_schedule WHERE id = $1 AND plan_id = $2 AND company_id = $3`,
        [params.scheduleId, params.id, context.companyId]
      );
      if (!sched) {
        return apiError(404, 'ERRORS.INSTALLMENTS.SCHEDULE_NOT_FOUND', 'Installment not found');
      }
      if (sched.status !== 'PAID') {
        return apiError(400, 'ERRORS.INSTALLMENTS.NOT_PAID', 'This installment is not paid');
      }

      if (sched.payment_id) {
        await query(`DELETE FROM expense_payments WHERE id = $1 AND company_id = $2`, [sched.payment_id, context.companyId]);
      }

      await update('installment_schedule', sched.id, {
        status: 'PENDING',
        payment_id: null,
        paid_date: null,
        paid_amount: null,
      });

      await recalcPlanStatus(params.id);

      return { status: 200 as const, body: { message: 'Installment payment reversed', code: 'INSTALLMENTS.UNPAID' } };
    } catch (error) {
      console.error('Unpay installment error:', error);
      return mapThrownError(error, 'ERRORS.INSTALLMENTS.UNPAY_FAILED', 'Failed to reverse installment payment');
    }
  },
};
