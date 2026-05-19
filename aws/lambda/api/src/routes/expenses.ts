import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin } from '../middleware/tenant-isolation';
import { mapPaymentFromDB } from './expense-payments';
import { apiError, mapThrownError } from '../utils/api-error';

// Parse a YYYY-MM-DD string into a calendar-only date with no timezone drift.
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function fmtDate(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

interface BackPayPeriod {
  monthKey: string;       // 'YYYY-MM'
  monthLabel: string;     // 'January 2026'
  startDate: string;      // 'YYYY-MM-DD'
  endDate: string;        // 'YYYY-MM-DD'
  daysInMonth: number;
  daysWorked: number;
  proRated: boolean;
  amount: number;
}

// Build list of owed monthly periods strictly before upTo's month.
// First month is pro-rated from hireDate.day; remaining months are full.
function buildBackPayPeriods(hireDateStr: string, upToStr: string, monthlySalary: number): BackPayPeriod[] {
  const hire = parseDateOnly(hireDateStr);
  const upTo = parseDateOnly(upToStr);
  const stopYear = upTo.getUTCFullYear();
  const stopMonth = upTo.getUTCMonth();   // exclude this month — paid normally end-of-month

  const periods: BackPayPeriod[] = [];
  let year = hire.getUTCFullYear();
  let month = hire.getUTCMonth();

  while (year < stopYear || (year === stopYear && month < stopMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const isHireMonth = year === hire.getUTCFullYear() && month === hire.getUTCMonth();
    const startDay = isHireMonth ? hire.getUTCDate() : 1;
    const daysWorked = daysInMonth - startDay + 1;
    const proRated = daysWorked < daysInMonth;
    const amount = proRated
      ? Math.round((monthlySalary * daysWorked / daysInMonth) * 100) / 100
      : monthlySalary;

    periods.push({
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthLabel: new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      startDate: fmtDate(year, month, startDay),
      endDate: fmtDate(year, month, daysInMonth),
      daysInMonth,
      daysWorked,
      proRated,
      amount,
    });

    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return periods;
}

function mapExpenseFromDB(row: any) {
  const amount = parseFloat(row.amount);
  const amortizationMonths = row.amortization_months || null;
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    type: row.type,
    category: row.category,
    amount,
    description: row.description,
    date: row.date,
    isRecurring: row.is_recurring,
    distributionMethod: row.distribution_method,
    vendor: row.vendor,
    invoiceNumber: row.invoice_number,
    notes: row.notes,
    assetName: row.asset_name,
    amortizationMonths,
    monthlyAmount: amortizationMonths ? parseFloat((amount / amortizationMonths).toFixed(2)) : null,
    bonusAmount: row.bonus_amount ? parseFloat(row.bonus_amount) : 0,
    discountAmount: row.discount_amount ? parseFloat(row.discount_amount) : 0,
    adjustmentReason: row.adjustment_reason || null,
    eventId: row.event_id || null,
    totalPaid: row.total_paid !== undefined ? parseFloat(row.total_paid) || 0 : undefined,
    lastPaymentDate: row.last_payment_date || null,
    paymentCount: row.payment_count !== undefined ? parseInt(row.payment_count) || 0 : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expensesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // If linked to an event, derive branch from the event automatically.
      // Event branch is the source of truth — explicit branchId is ignored when eventId is set.
      let resolvedBranchId: string | null = body.branchId || null;
      if (body.eventId) {
        const event = await queryOne(
          'SELECT branch_id FROM events WHERE id = $1 AND company_id = $2',
          [body.eventId, context.companyId]
        );
        if (event) {
          resolvedBranchId = event.branch_id || null;
        }
      }

      const expense = await insert('expenses', {
        company_id: context.companyId,
        branch_id: resolvedBranchId,
        type: body.type,
        category: body.category,
        amount: body.amount,
        description: body.description || null,
        date: body.date,
        is_recurring: body.isRecurring || false,
        distribution_method: body.distributionMethod || null,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        notes: body.notes || null,
        asset_name: body.assetName || null,
        amortization_months: body.type === 'CAPITAL' ? (body.amortizationMonths || null) : null,
        event_id: body.eventId || null,
      });

      return {
        status: 201 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Create expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.CREATE_FAILED', 'Failed to create expense', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string; type?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `SELECT e.*,
        COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
        (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
        (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
        FROM expenses e WHERE e.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND (e.branch_id = $${params.length} OR e.branch_id IS NULL)`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND e.date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND e.date <= $${params.length}`;
      }

      if (queryParams.isRecurring !== undefined) {
        params.push(queryParams.isRecurring === 'true');
        sql += ` AND e.is_recurring = $${params.length}`;
      }

      if (queryParams.category) {
        params.push(queryParams.category);
        sql += ` AND e.category = $${params.length}`;
      }

      if (queryParams.type) {
        params.push(queryParams.type);
        sql += ` AND e.type = $${params.length}`;
      }

      sql += ' ORDER BY e.date DESC, e.created_at DESC';

      const expenses = await query(sql, params);
      return {
        status: 200 as const,
        body: expenses.map(mapExpenseFromDB),
      };
    } catch (error) {
      console.error('List expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.LIST_FAILED', 'Failed to list expenses');
    }
  },

  getDue: async ({ query: queryParams, headers }: { query: { month?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const targetMonth = queryParams.month || new Date().toISOString().substring(0, 7);
      const monthStart = targetMonth + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      // Unpaid recurring expense templates for this month (check expense_payments)
      const recurringTemplates = await query(
        `SELECT e.*, b.name as branch_name
         FROM expenses e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_recurring = true
           AND NOT EXISTS (
             SELECT 1 FROM expense_payments ep
             WHERE ep.expense_id = e.id
               AND ep.date >= $2 AND ep.date <= $3
           )`,
        [context.companyId, monthStart, monthEnd]
      );

      // Employees with unpaid salary for this month (check expense_payments)
      const unpaidEmployees = await query(
        `SELECT e.*, b.name as branch_name
         FROM employees e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_active = true AND e.salary > 0
           AND NOT EXISTS (
             SELECT 1 FROM expense_payments ep
             WHERE ep.employee_id = e.id AND ep.category = 'SALARIES'
               AND ep.date >= $2 AND ep.date <= $3
           )`,
        [context.companyId, monthStart, monthEnd]
      );

      const items: any[] = [
        ...recurringTemplates.map((t: any) => ({
          id: t.id,
          type: 'recurring',
          label: t.description,
          amount: parseFloat(t.amount),
          category: t.category,
          branchId: t.branch_id,
          branchName: t.branch_name,
          templateId: t.id,
          employeeId: null,
        })),
        ...unpaidEmployees.map((e: any) => ({
          id: e.id,
          type: 'salary',
          label: `Salary: ${e.first_name} ${e.last_name}`,
          amount: parseFloat(e.salary),
          category: 'SALARIES',
          branchId: e.branch_id,
          branchName: e.branch_name,
          templateId: null,
          employeeId: e.id,
        })),
      ];

      const totalDue = items.reduce((sum, i) => sum + i.amount, 0);

      return {
        status: 200 as const,
        body: { items, totalDue, month: targetMonth },
      };
    } catch (error) {
      console.error('Get due expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DUE_FAILED', 'Failed to get due expenses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        `SELECT e.*,
          COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
          (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
          (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
         FROM expenses e WHERE e.id = $1 AND e.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (expense.branch_id && !canAccessBranch(context, expense.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED', 'Access denied to this expense');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Get expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED_UPDATE', 'Access denied to update this expense');
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.type !== undefined) updateData.type = body.type;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.date !== undefined) updateData.date = body.date;
      if (body.isRecurring !== undefined) updateData.is_recurring = body.isRecurring;
      if (body.distributionMethod !== undefined) updateData.distribution_method = body.distributionMethod;
      if (body.vendor !== undefined) updateData.vendor = body.vendor;
      if (body.invoiceNumber !== undefined) updateData.invoice_number = body.invoiceNumber;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.eventId !== undefined) updateData.event_id = body.eventId || null;
      if (body.assetName !== undefined) updateData.asset_name = body.assetName;
      if (body.amortizationMonths !== undefined) updateData.amortization_months = body.amortizationMonths;

      const expense = await update('expenses', params.id, updateData);

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Update expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.UPDATE_FAILED', 'Failed to update expense', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      await query('DELETE FROM expense_payments WHERE expense_id = $1 AND company_id = $2', [params.id, context.companyId]);
      await query('DELETE FROM expenses WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Expense deleted successfully', code: 'EXPENSES.DELETED' } };
    } catch (error) {
      console.error('Delete expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DELETE_FAILED', 'Failed to delete expense');
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        'SELECT id FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      const payments = await query(
        'SELECT * FROM expense_payments WHERE expense_id = $1 AND company_id = $2 ORDER BY date DESC',
        [params.id, context.companyId]
      );

      return { status: 200 as const, body: payments.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get expense payments error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.GET_PAYMENTS_FAILED', 'Failed to get payments');
    }
  },

  payRecurring: async ({ params, body, headers }: { params: { id: string }; body: { date?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const template = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND is_recurring = true',
        [params.id, context.companyId]
      );

      if (!template) {
        return apiError(404, 'ERRORS.EXPENSES.RECURRING_NOT_FOUND', 'Recurring expense not found');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];

      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      const existing = await queryOne(
        `SELECT id FROM expense_payments WHERE company_id = $1 AND expense_id = $2 AND date >= $3 AND date <= $4`,
        [context.companyId, params.id, monthStart, monthEnd]
      );

      if (existing) {
        return apiError(400, 'ERRORS.EXPENSE_PAYMENTS.ALREADY_PAID_THIS_MONTH', 'This expense has already been paid for this month');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        expense_id: params.id,
        branch_id: template.branch_id,
        type: template.type,
        category: template.category,
        amount: template.amount,
        date: payDate,
        vendor: template.vendor,
        invoice_number: null,
        notes: template.notes,
        event_id: template.event_id || null,
        bonus_amount: 0,
        discount_amount: 0,
      });

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay recurring error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_RECURRING_FAILED', 'Failed to pay recurring expense');
    }
  },

  paySalaries: async ({ body, headers }: { body: { date?: string; branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      let empSql = 'SELECT * FROM employees WHERE company_id = $1 AND is_active = true AND salary > 0';
      const empParams: any[] = [context.companyId];

      if (body.branchId) {
        empParams.push(body.branchId);
        empSql += ` AND branch_id = $${empParams.length}`;
      }

      const employees = await query(empSql, empParams);

      if (employees.length === 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_EMPLOYEES', 'No active employees with salary found');
      }

      const created: any[] = [];
      const skipped: string[] = [];

      for (const emp of employees) {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );

        if (existing) {
          skipped.push(emp.first_name + ' ' + emp.last_name);
          continue;
        }

        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: parseFloat(emp.salary),
          date: payDate,
          notes: `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`,
          bonus_amount: 0,
          discount_amount: 0,
        });

        created.push(mapPaymentFromDB(payment));
      }

      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped: skipped.length,
          skippedNames: skipped,
          payments: created,
          message: `Created ${created.length} salary payment(s)${skipped.length ? `, skipped ${skipped.length} already paid` : ''}.`,
          code: 'EXPENSES.SALARIES_PAID',
        },
      };
    } catch (error) {
      console.error('Pay salaries error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARIES_FAILED', 'Failed to pay salaries');
    }
  },

  payEmployeeSalary: async ({ params, body, headers }: { params: { employeeId: string }; body: { date?: string; bonusAmount?: number; discountAmount?: number; adjustmentReason?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (!emp.salary || parseFloat(emp.salary) <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      const existing = await queryOne(
        `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
        [context.companyId, emp.id, monthStart, monthEnd]
      );

      if (existing) {
        return apiError(400, 'ERRORS.EXPENSES.SALARY_ALREADY_PAID', `Salary already paid for ${monthLabel}`);
      }

      const baseSalary = parseFloat(emp.salary);
      const bonus = body.bonusAmount || 0;
      const discount = body.discountAmount || 0;
      const finalAmount = baseSalary + bonus - discount;

      if (finalAmount <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.SALARY_NON_POSITIVE', 'Final salary amount must be greater than zero');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        branch_id: emp.branch_id,
        employee_id: emp.id,
        type: 'FIXED',
        category: 'SALARIES',
        amount: finalAmount,
        date: payDate,
        notes: `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`,
        bonus_amount: bonus,
        discount_amount: discount,
        adjustment_reason: body.adjustmentReason || null,
      });

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay employee salary error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARY_FAILED', 'Failed to pay salary');
    }
  },

  getEmployeeSalaryHistory: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne(
        'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const rows = await query(
        `SELECT * FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' ORDER BY date DESC`,
        [context.companyId, params.employeeId]
      );

      return { status: 200 as const, body: rows.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get employee salary history error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.SALARY_HISTORY_FAILED', 'Failed to get salary history');
    }
  },

  previewEmployeeBackPay: async ({ params, query: q, headers }: {
    params: { employeeId: string };
    query: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id, is_active FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (q?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);

      // Detect already-paid months so the user knows what will be skipped.
      const paidRows = periods.length === 0 ? [] : await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const enriched = periods.map(p => ({ ...p, alreadyPaid: paidMonths.has(p.monthKey) }));
      const toCreate = enriched.filter(p => !p.alreadyPaid);

      return {
        status: 200 as const,
        body: {
          employee: {
            id: emp.id,
            firstName: emp.first_name,
            lastName: emp.last_name,
            hireDate: hireStr,
            salary,
            branchId: emp.branch_id,
          },
          upTo: upToStr,
          periods: enriched,
          totalToCreate: Math.round(toCreate.reduce((s, p) => s + p.amount, 0) * 100) / 100,
          totalAlreadyPaid: Math.round(enriched.filter(p => p.alreadyPaid).reduce((s, p) => s + p.amount, 0) * 100) / 100,
        },
      };
    } catch (error) {
      console.error('Preview back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_PREVIEW_FAILED', 'Failed to preview back pay');
    }
  },

  createEmployeeBackPay: async ({ params, body, headers }: {
    params: { employeeId: string };
    body: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (body?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);
      if (periods.length === 0) {
        return {
          status: 200 as const,
          body: { created: 0, skipped: 0, totalAmount: 0, payments: [], message: 'No back-pay periods to create.', code: 'EXPENSES.BACK_PAY_NONE' },
        };
      }

      const paidRows = await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const created: any[] = [];
      let skipped = 0;
      for (const p of periods) {
        if (paidMonths.has(p.monthKey)) { skipped += 1; continue; }
        const notes = p.proRated
          ? `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel} (pro-rated ${p.daysWorked}/${p.daysInMonth} days)`
          : `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel}`;
        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: p.amount,
          date: p.endDate,
          notes,
          bonus_amount: 0,
          discount_amount: 0,
        });
        created.push(mapPaymentFromDB(payment));
      }

      const totalAmount = Math.round(created.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped,
          totalAmount,
          payments: created,
          message: `Created ${created.length} back-pay entr${created.length === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already-paid month${skipped === 1 ? '' : 's'}` : ''}.`,
          code: 'EXPENSES.BACK_PAY_CREATED',
        },
      };
    } catch (error) {
      console.error('Create back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_FAILED', 'Failed to create back pay');
    }
  },

};
