import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

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
        'SELECT COALESCE(SUM(amount), 0) as total FROM expense_payments WHERE company_id = $1',
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
      const masterEnrollmentResult = await query(
        'SELECT COALESCE(SUM(amount_paid), 0) as total FROM master_enrollments WHERE company_id = $1 AND amount_paid > 0',
        [context.companyId]
      );

      const totalRevenue = parseFloat(enrollmentRevenueResult[0]?.total || 0);
      const totalExpenses = parseFloat(expenseResult[0]?.total || 0);
      const totalWithdrawals = parseFloat(withdrawalResult[0]?.total || 0);
      const totalProductSales = parseFloat(productSalesResult[0]?.total || 0);
      const totalMasterRevenue = parseFloat(masterEnrollmentResult[0]?.total || 0);

      const totalCash = totalRevenue + totalProductSales + totalMasterRevenue - totalExpenses - totalWithdrawals;

      // Get by branch
      const branchCashQuery = `
        SELECT
          b.id,
          b.name,
          COALESCE(enroll.total, 0) + COALESCE(prod.total, 0) + COALESCE(mast.total, 0)
            - COALESCE(exp.total, 0) - COALESCE(w.total, 0) AS cash
        FROM branches b
        LEFT JOIN (
          SELECT branch_id, SUM(final_price) AS total FROM enrollments
          WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')
          GROUP BY branch_id
        ) enroll ON enroll.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(total_amount) AS total FROM product_sales
          WHERE company_id = $1
          GROUP BY branch_id
        ) prod ON prod.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) AS total FROM master_enrollments
          WHERE company_id = $1 AND amount_paid > 0
          GROUP BY branch_id
        ) mast ON mast.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) AS total FROM expense_payments
          WHERE company_id = $1
          GROUP BY branch_id
        ) exp ON exp.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) AS total FROM withdrawals
          WHERE company_id = $1 AND is_active = true
          GROUP BY branch_id
        ) w ON w.branch_id = b.id
        WHERE b.company_id = $1 AND b.is_active = true
        GROUP BY b.id, b.name, enroll.total, prod.total, mast.total, exp.total, w.total
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get cash flow' },
      };
    }
  },
};
