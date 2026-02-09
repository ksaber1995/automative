import { query } from '../db/connection';

export const cashRoutes = {
  current: async () => {
    try {
      // Calculate current cash from revenues, expenses, withdrawals, and product sales
      const revenueResult = await query('SELECT COALESCE(SUM(amount), 0) as total FROM revenues');
      const expenseResult = await query('SELECT COALESCE(SUM(amount), 0) as total FROM expenses');
      const withdrawalResult = await query("SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE status = 'APPROVED'");
      const productSalesResult = await query('SELECT COALESCE(SUM(total_amount), 0) as total FROM product_sales');

      const totalRevenue = parseFloat(revenueResult[0]?.total || 0);
      const totalExpenses = parseFloat(expenseResult[0]?.total || 0);
      const totalWithdrawals = parseFloat(withdrawalResult[0]?.total || 0);
      const totalProductSales = parseFloat(productSalesResult[0]?.total || 0);

      const totalCash = totalRevenue + totalProductSales - totalExpenses - totalWithdrawals;

      // Get by branch
      const branchCashQuery = `
        SELECT
          b.id,
          b.name,
          COALESCE(SUM(r.amount), 0) + COALESCE(SUM(ps.total_amount), 0) -
          COALESCE(SUM(e.amount), 0) - COALESCE(SUM(w.amount), 0) as cash
        FROM branches b
        LEFT JOIN revenues r ON b.id = r.branch_id
        LEFT JOIN product_sales ps ON b.id = ps.branch_id
        LEFT JOIN expenses e ON b.id = e.branch_id
        LEFT JOIN withdrawals w ON b.id = w.branch_id AND w.status = 'APPROVED'
        WHERE b.is_active = true
        GROUP BY b.id, b.name
      `;

      const byBranch = await query(branchCashQuery);

      return {
        status: 200 as const,
        body: {
          totalCash,
          byBranch: byBranch.map((row: any) => ({
            branchId: row.id,
            branchName: row.name,
            cash: parseFloat(row.cash),
          })),
        },
      };
    } catch (error) {
      console.error('Get current cash error:', error);
      return {
        status: 200 as const,
        body: {
          totalCash: 0,
          byBranch: [],
        },
      };
    }
  },

  state: async () => {
    try {
      // Return current cash state
      const current = await cashRoutes.current();
      return {
        status: 200 as const,
        body: current.body,
      };
    } catch (error) {
      console.error('Get cash state error:', error);
      return {
        status: 200 as const,
        body: {
          totalCash: 0,
          byBranch: [],
        },
      };
    }
  },

  adjust: async ({ body }: { body: any }) => {
    try {
      // TODO: Implement cash adjustment logic if needed
      return {
        status: 200 as const,
        body: {
          message: 'Cash adjustment not implemented yet',
        },
      };
    } catch (error) {
      console.error('Adjust cash error:', error);
      return {
        status: 400 as const,
        body: { message: 'Failed to adjust cash' },
      };
    }
  },

  flow: async ({ query: queryParams }: { query: { startDate?: string; endDate?: string } }) => {
    try {
      // TODO: Implement detailed cash flow tracking
      return {
        status: 200 as const,
        body: [],
      };
    } catch (error) {
      console.error('Get cash flow error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },
};
