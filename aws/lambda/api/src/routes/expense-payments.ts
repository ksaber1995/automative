import { insert, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export function mapPaymentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    expenseId: row.expense_id || null,
    branchId: row.branch_id || null,
    employeeId: row.employee_id || null,
    eventId: row.event_id || null,
    type: row.type,
    category: row.category,
    amount: parseFloat(row.amount),
    date: row.date,
    notes: row.notes || null,
    vendor: row.vendor || null,
    invoiceNumber: row.invoice_number || null,
    bonusAmount: row.bonus_amount ? parseFloat(row.bonus_amount) : 0,
    discountAmount: row.discount_amount ? parseFloat(row.discount_amount) : 0,
    adjustmentReason: row.adjustment_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expensePaymentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.expenseId) {
        const expense = await queryOne(
          'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
          [body.expenseId, context.companyId]
        );
        if (!expense) {
          return { status: 404 as const, body: { message: 'Expense not found' } };
        }
        if (expense.is_recurring) {
          const payDate: string = body.date || new Date().toISOString().split('T')[0];
          const monthStart = payDate.substring(0, 7) + '-01';
          const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
          const existing = await queryOne(
            `SELECT id FROM expense_payments WHERE company_id = $1 AND expense_id = $2 AND date >= $3 AND date <= $4`,
            [context.companyId, body.expenseId, monthStart, monthEnd]
          );
          if (existing) {
            return { status: 400 as const, body: { message: 'This expense has already been paid for this month' } };
          }
        }
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        expense_id: body.expenseId || null,
        branch_id: body.branchId || null,
        employee_id: body.employeeId || null,
        event_id: body.eventId || null,
        type: body.type,
        category: body.category,
        amount: body.amount,
        date: body.date,
        notes: body.notes || null,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        bonus_amount: body.bonusAmount || 0,
        discount_amount: body.discountAmount || 0,
        adjustment_reason: body.adjustmentReason || null,
      });

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Create expense payment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create payment' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { expenseId?: string; branchId?: string; startDate?: string; endDate?: string; category?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = 'SELECT * FROM expense_payments WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.expenseId) {
        params.push(queryParams.expenseId);
        sql += ` AND expense_id = $${params.length}`;
      }

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

      if (queryParams.category) {
        params.push(queryParams.category);
        sql += ` AND category = $${params.length}`;
      }

      sql += ' ORDER BY date DESC, created_at DESC';

      const payments = await query(sql, params);
      return { status: 200 as const, body: payments.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('List expense payments error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list payments' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const payment = await queryOne(
        'SELECT * FROM expense_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!payment) {
        return { status: 404 as const, body: { message: 'Payment not found' } };
      }

      return { status: 200 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Payment not found' },
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
        'SELECT id FROM expense_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Payment not found' } };
      }

      await query('DELETE FROM expense_payments WHERE id = $1', [params.id]);

      return { status: 200 as const, body: { message: 'Payment deleted successfully' } };
    } catch (error) {
      console.error('Delete expense payment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to delete payment' },
      };
    }
  },
};
