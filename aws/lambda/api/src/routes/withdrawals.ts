import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';

function mapWithdrawalFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    amount: parseFloat(row.amount),
    stakeholders: row.stakeholders || [],
    withdrawalDate: row.withdrawal_date,
    reason: row.reason || '',
    category: row.category || 'OTHER',
    paymentMethod: row.payment_method || 'CASH',
    approvedBy: row.approved_by || '',
    notes: row.notes,
    receiptUrl: row.receipt_url,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const withdrawalsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const withdrawal = await insert('withdrawals', {
        company_id: context.companyId,
        amount: body.amount,
        stakeholders: JSON.stringify(body.stakeholders),
        withdrawal_date: body.withdrawalDate,
        reason: body.reason,
        category: body.category,
        payment_method: body.paymentMethod,
        approved_by: '',
        notes: body.notes || null,
        receipt_url: null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapWithdrawalFromDB({
          ...withdrawal,
          stakeholders: JSON.parse(withdrawal.stakeholders as string),
        }),
      };
    } catch (error) {
      console.error('Create withdrawal error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create withdrawal' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM withdrawals WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND withdrawal_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND withdrawal_date <= $${params.length}`;
      }

      sql += ' ORDER BY withdrawal_date DESC, created_at DESC';

      const withdrawals = await query(sql, params);
      return {
        status: 200 as const,
        body: withdrawals.map((row: any) => mapWithdrawalFromDB({
          ...row,
          stakeholders: typeof row.stakeholders === 'string'
            ? JSON.parse(row.stakeholders)
            : row.stakeholders,
        })),
      };
    } catch (error) {
      console.error('List withdrawals error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list withdrawals' },
      };
    }
  },

  summary: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM withdrawals WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND withdrawal_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND withdrawal_date <= $${params.length}`;
      }

      const withdrawals = await query(sql, params);

      // Calculate summary
      const totalWithdrawals = withdrawals.length;
      const totalAmount = withdrawals.reduce((sum: number, w: any) => sum + parseFloat(w.amount || 0), 0);

      // Group by category
      const byCategory: any = {};
      withdrawals.forEach((w: any) => {
        const category = w.category || 'OTHER';
        if (!byCategory[category]) {
          byCategory[category] = { category, amount: 0, count: 0 };
        }
        byCategory[category].amount += parseFloat(w.amount || 0);
        byCategory[category].count += 1;
      });

      // Group by stakeholder
      const byStakeholder: any = {};
      withdrawals.forEach((w: any) => {
        const stakeholders = typeof w.stakeholders === 'string'
          ? JSON.parse(w.stakeholders)
          : w.stakeholders || [];

        stakeholders.forEach((s: any) => {
          const name = s.stakeholderName;
          if (!byStakeholder[name]) {
            byStakeholder[name] = { name, amount: 0, count: 0 };
          }
          byStakeholder[name].amount += s.amount;
          byStakeholder[name].count += 1;
        });
      });

      return {
        status: 200 as const,
        body: {
          totalWithdrawals,
          totalAmount,
          byCategory: Object.values(byCategory) as Array<{ category: string; amount: number; count: number }>,
          byStakeholder: Object.values(byStakeholder) as Array<{ name: string; amount: number; count: number }>,
          withdrawals: withdrawals.map((row: any) => mapWithdrawalFromDB({
            ...row,
            stakeholders: typeof row.stakeholders === 'string'
              ? JSON.parse(row.stakeholders)
              : row.stakeholders,
          })),
        },
      };
    } catch (error) {
      console.error('Withdrawal summary error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to generate withdrawal summary' },
      };
    }
  },

  getByStakeholder: async ({ params, headers }: { params: { stakeholderName: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const stakeholderName = decodeURIComponent(params.stakeholderName);

      // Query withdrawals where stakeholders JSONB array contains the stakeholder name
      const sql = `
        SELECT * FROM withdrawals
        WHERE company_id = $1 AND stakeholders::text LIKE $2
        ORDER BY withdrawal_date DESC
      `;

      const withdrawals = await query(sql, [context.companyId, `%${stakeholderName}%`]);

      // Filter to exact matches
      const filtered = withdrawals.filter((row: any) => {
        const stakeholders = typeof row.stakeholders === 'string'
          ? JSON.parse(row.stakeholders)
          : row.stakeholders || [];
        return stakeholders.some((s: any) => s.stakeholderName === stakeholderName);
      });

      return {
        status: 200 as const,
        body: filtered.map((row: any) => mapWithdrawalFromDB({
          ...row,
          stakeholders: typeof row.stakeholders === 'string'
            ? JSON.parse(row.stakeholders)
            : row.stakeholders,
        })),
      };
    } catch (error) {
      console.error('Get withdrawals by stakeholder error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get withdrawals by stakeholder' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const withdrawal = await queryOne(
        'SELECT * FROM withdrawals WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!withdrawal) {
        return {
          status: 404 as const,
          body: { message: 'Withdrawal not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapWithdrawalFromDB({
          ...withdrawal,
          stakeholders: typeof withdrawal.stakeholders === 'string'
            ? JSON.parse(withdrawal.stakeholders as string)
            : withdrawal.stakeholders,
        }),
      };
    } catch (error) {
      console.error('Get withdrawal error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Withdrawal not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM withdrawals WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Withdrawal not found' },
        };
      }

      const updateData: any = {};

      if (body.stakeholders !== undefined) updateData.stakeholders = JSON.stringify(body.stakeholders);
      if (body.reason !== undefined) updateData.reason = body.reason;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.paymentMethod !== undefined) updateData.payment_method = body.paymentMethod;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const withdrawal = await update('withdrawals', params.id, updateData);

      if (!withdrawal) {
        return {
          status: 404 as const,
          body: { message: 'Withdrawal not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapWithdrawalFromDB({
          ...withdrawal,
          stakeholders: typeof withdrawal.stakeholders === 'string'
            ? JSON.parse(withdrawal.stakeholders as string)
            : withdrawal.stakeholders,
        }),
      };
    } catch (error) {
      console.error('Update withdrawal error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update withdrawal' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM withdrawals WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Withdrawal not found' },
        };
      }

      // Soft delete by setting is_active to false
      const withdrawal = await update('withdrawals', params.id, { is_active: false });

      if (!withdrawal) {
        return {
          status: 404 as const,
          body: { message: 'Withdrawal not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Withdrawal deleted successfully' },
      };
    } catch (error) {
      console.error('Delete withdrawal error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete withdrawal' },
      };
    }
  },
};
