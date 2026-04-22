import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isAuthError, isSubscriptionError, isGlobalAdmin } from '../middleware/tenant-isolation';
import { mapPaymentFromDB } from './expense-payments';

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
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const expense = await insert('expenses', {
        company_id: context.companyId,
        branch_id: body.branchId || null,
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create expense' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string; type?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `SELECT e.*,
        COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
        (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
        (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
        FROM expenses e WHERE e.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list expenses' },
      };
    }
  },

  getDue: async ({ query: queryParams, headers }: { query: { month?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get due expenses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
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
        return {
          status: 404 as const,
          body: { message: 'Expense not found' },
        };
      }

      if (expense.branch_id && !canAccessBranch(context, expense.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this expense' },
        };
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Get expense error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Expense not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Expense not found' },
        };
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this expense' },
        };
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
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
        return {
          status: 404 as const,
          body: { message: 'Expense not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Update expense error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update expense' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Expense not found' } };
      }

      await query('DELETE FROM expense_payments WHERE expense_id = $1 AND company_id = $2', [params.id, context.companyId]);
      await query('DELETE FROM expenses WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Expense deleted successfully' } };
    } catch (error) {
      console.error('Delete expense error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to delete expense' },
      };
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const expense = await queryOne(
        'SELECT id FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!expense) {
        return { status: 404 as const, body: { message: 'Expense not found' } };
      }

      const payments = await query(
        'SELECT * FROM expense_payments WHERE expense_id = $1 AND company_id = $2 ORDER BY date DESC',
        [params.id, context.companyId]
      );

      return { status: 200 as const, body: payments.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get expense payments error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get payments' },
      };
    }
  },

  payRecurring: async ({ params, body, headers }: { params: { id: string }; body: { date?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const template = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND is_recurring = true',
        [params.id, context.companyId]
      );

      if (!template) {
        return { status: 404 as const, body: { message: 'Recurring expense not found' } };
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];

      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      const existing = await queryOne(
        `SELECT id FROM expense_payments WHERE company_id = $1 AND expense_id = $2 AND date >= $3 AND date <= $4`,
        [context.companyId, params.id, monthStart, monthEnd]
      );

      if (existing) {
        return { status: 400 as const, body: { message: 'This expense has already been paid for this month' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to pay recurring expense' },
      };
    }
  },

  paySalaries: async ({ body, headers }: { body: { date?: string; branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

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
        return { status: 400 as const, body: { message: 'No active employees with salary found' } };
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
        },
      };
    } catch (error) {
      console.error('Pay salaries error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to pay salaries' },
      };
    }
  },

  payEmployeeSalary: async ({ params, body, headers }: { params: { employeeId: string }; body: { date?: string; bonusAmount?: number; discountAmount?: number; adjustmentReason?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true',
        [params.employeeId, context.companyId]
      );

      if (!emp) return { status: 404 as const, body: { message: 'Employee not found' } };
      if (!emp.salary || parseFloat(emp.salary) <= 0) {
        return { status: 400 as const, body: { message: 'Employee has no salary configured' } };
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
        return { status: 400 as const, body: { message: `Salary already paid for ${monthLabel}` } };
      }

      const baseSalary = parseFloat(emp.salary);
      const bonus = body.bonusAmount || 0;
      const discount = body.discountAmount || 0;
      const finalAmount = baseSalary + bonus - discount;

      if (finalAmount <= 0) {
        return { status: 400 as const, body: { message: 'Final salary amount must be greater than zero' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to pay salary' },
      };
    }
  },

  getEmployeeSalaryHistory: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const emp = await queryOne(
        'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );

      if (!emp) return { status: 404 as const, body: { message: 'Employee not found' } };

      const rows = await query(
        `SELECT * FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' ORDER BY date DESC`,
        [context.companyId, params.employeeId]
      );

      return { status: 200 as const, body: rows.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get employee salary history error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get salary history' },
      };
    }
  },

};
