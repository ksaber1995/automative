import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

export const cashRoutes = {
  current: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Calculate current cash from enrollments (PAID/PARTIAL), expenses, withdrawals, and product sales
      const enrollmentRevenueResult = await query(
        'SELECT COALESCE(SUM(final_price), 0) as total FROM enrollments WHERE company_id = $1 AND payment_status IN (\'PAID\', \'PARTIAL\')',
        [context.companyId]
      );
      const expenseResult = await query(
        'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = $1',
        [context.companyId]
      );
      const withdrawalResult = await query(
        'SELECT COALESCE(SUM(amount), 0) as total FROM withdrawals WHERE company_id = $1 AND is_active = true',
        [context.companyId]
      );
      const productSalesResult = await query(
        'SELECT COALESCE(SUM(total_amount), 0) as total FROM product_sales WHERE company_id = $1',
        [context.companyId]
      );

      const totalRevenue = parseFloat(enrollmentRevenueResult[0]?.total || 0);
      const totalExpenses = parseFloat(expenseResult[0]?.total || 0);
      const totalWithdrawals = parseFloat(withdrawalResult[0]?.total || 0);
      const totalProductSales = parseFloat(productSalesResult[0]?.total || 0);

      const totalCash = totalRevenue + totalProductSales - totalExpenses - totalWithdrawals;

      // Get by branch
      const branchCashQuery = `
        SELECT
          b.id,
          b.name,
          COALESCE(SUM(e.final_price), 0) + COALESCE(SUM(ps.total_amount), 0) -
          COALESCE(SUM(exp.amount), 0) - COALESCE(SUM(w.amount), 0) as cash
        FROM branches b
        LEFT JOIN enrollments e ON b.id = e.branch_id AND e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL')
        LEFT JOIN product_sales ps ON b.id = ps.branch_id AND ps.company_id = $1
        LEFT JOIN expenses exp ON b.id = exp.branch_id AND exp.company_id = $1
        LEFT JOIN withdrawals w ON b.id = w.branch_id AND w.company_id = $1 AND w.is_active = true
        WHERE b.company_id = $1 AND b.is_active = true
        GROUP BY b.id, b.name
      `;

      const byBranch = await query(branchCashQuery, [context.companyId]);

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
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get current cash' },
      };
    }
  },

  state: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      // Return current cash state
      const current = await cashRoutes.current({ headers });
      return {
        status: 200 as const,
        body: current.body,
      };
    } catch (error) {
      console.error('Get cash state error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get cash state' },
      };
    }
  },

  adjust: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

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
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to adjust cash' },
      };
    }
  },

  flow: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // TODO: Implement detailed cash flow tracking
      return {
        status: 200 as const,
        body: [],
      };
    } catch (error) {
      console.error('Get cash flow error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get cash flow' },
      };
    }
  },
};
