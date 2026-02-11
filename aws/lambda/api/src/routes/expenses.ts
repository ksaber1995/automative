import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapExpenseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    type: row.type,
    category: row.category,
    amount: parseFloat(row.amount),
    description: row.description,
    date: row.date,
    isRecurring: row.is_recurring,
    recurringDay: row.recurring_day,
    distributionMethod: row.distribution_method,
    vendor: row.vendor,
    invoiceNumber: row.invoice_number,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expensesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

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
        recurring_day: body.recurringDay || null,
        distribution_method: body.distributionMethod || null,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        notes: body.notes || null,
      });

      return {
        status: 201 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Create expense error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create expense' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM expenses WHERE company_id = $1';
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
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND (branch_id = $${params.length} OR branch_id IS NULL)`;
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

      const expenses = await query(sql, params);
      return {
        status: 200 as const,
        body: expenses.map(mapExpenseFromDB),
      };
    } catch (error) {
      console.error('List expenses error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list expenses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const expense = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
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
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Expense not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

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
      if (body.recurringDay !== undefined) updateData.recurring_day = body.recurringDay;
      if (body.distributionMethod !== undefined) updateData.distribution_method = body.distributionMethod;
      if (body.vendor !== undefined) updateData.vendor = body.vendor;
      if (body.invoiceNumber !== undefined) updateData.invoice_number = body.invoiceNumber;
      if (body.notes !== undefined) updateData.notes = body.notes;

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
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update expense' },
      };
    }
  },
};
