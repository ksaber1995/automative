import { insert, update, findById, query } from '../db/connection';

function mapExpenseFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const expense = await insert('expenses', {
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
        status: 400 as const,
        body: { message: 'Failed to create expense' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string; startDate?: string; endDate?: string } }) => {
    try {
      let sql = 'SELECT * FROM expenses WHERE 1=1';
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

      const expenses = await query(sql, params);
      return {
        status: 200 as const,
        body: expenses.map(mapExpenseFromDB),
      };
    } catch (error) {
      console.error('List expenses error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const expense = await findById('expenses', params.id);

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
      console.error('Get expense error:', error);
      return {
        status: 404 as const,
        body: { message: 'Expense not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
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
        status: 404 as const,
        body: { message: 'Failed to update expense' },
      };
    }
  },
};
