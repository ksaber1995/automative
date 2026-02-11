import { query } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';

export const analyticsRoutes = {
  dashboard: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const startDate = queryParams.startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const endDate = queryParams.endDate || new Date().toISOString().split('T')[0];

      // Get company-wide revenue from enrollments
      const enrollmentRevenueData = await query(
        `SELECT
          COALESCE(SUM(final_price), 0) as total_revenue
        FROM enrollments
        WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')
          AND enrollment_date >= $2 AND enrollment_date <= $3`,
        [context.companyId, startDate, endDate]
      );

      // Get product sales revenue
      const productRevenueData = await query(
        `SELECT
          COALESCE(SUM(total_amount), 0) as total_revenue
        FROM product_sales
        WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3`,
        [context.companyId, startDate, endDate]
      );

      // Get expenses by type
      const expenseData = await query(
        `SELECT
          type,
          category,
          COALESCE(SUM(amount), 0) as total_amount
        FROM expenses
        WHERE company_id = $1 AND date >= $2 AND date <= $3
        GROUP BY type, category`,
        [context.companyId, startDate, endDate]
      );

      // Calculate expense totals
      const fixedExpenses = expenseData
        .filter((e: any) => e.type === 'FIXED')
        .reduce((sum: number, e: any) => sum + parseFloat(e.total_amount), 0);

      const variableExpenses = expenseData
        .filter((e: any) => e.type === 'VARIABLE')
        .reduce((sum: number, e: any) => sum + parseFloat(e.total_amount), 0);

      const sharedExpenses = expenseData
        .filter((e: any) => e.type === 'SHARED')
        .reduce((sum: number, e: any) => sum + parseFloat(e.total_amount), 0);

      const salaries = expenseData
        .filter((e: any) => e.category === 'SALARIES')
        .reduce((sum: number, e: any) => sum + parseFloat(e.total_amount), 0);

      const totalExpenses = fixedExpenses + variableExpenses + sharedExpenses;
      const enrollmentRevenue = parseFloat(enrollmentRevenueData[0]?.total_revenue || '0');
      const productRevenue = parseFloat(productRevenueData[0]?.total_revenue || '0');
      const totalRevenue = enrollmentRevenue + productRevenue;
      const netProfit = totalRevenue - totalExpenses;

      // Get cash state for company
      const cashState = await query(
        'SELECT current_balance FROM cash_state WHERE company_id = $1 LIMIT 1',
        [context.companyId]
      );
      const currentCash = parseFloat(cashState[0]?.current_balance || '0');

      // Get outstanding debts (if table exists and has company_id)
      const debtsData = await query(
        `SELECT COALESCE(SUM(remaining_amount), 0) as total_debts
        FROM debts
        WHERE company_id = $1 AND status = 'ACTIVE'`,
        [context.companyId]
      ).catch(() => [{ total_debts: 0 }]); // Fallback if debts table not fully implemented
      const totalOutstandingDebts = parseFloat(debtsData[0]?.total_debts || '0');

      // Get revenue by branch (enrollments + product sales)
      const branchRevenueData = await query(
        `SELECT
          b.id,
          b.name,
          COALESCE(SUM(e.final_price), 0) + COALESCE(SUM(ps.total_amount), 0) as total_revenue
        FROM branches b
        LEFT JOIN enrollments e ON b.id = e.branch_id AND e.company_id = $1
          AND e.payment_status IN ('PAID', 'PARTIAL')
          AND e.enrollment_date >= $2 AND e.enrollment_date <= $3
        LEFT JOIN product_sales ps ON b.id = ps.branch_id AND ps.company_id = $1
          AND ps.sale_date >= $2 AND ps.sale_date <= $3
        WHERE b.company_id = $1
        GROUP BY b.id, b.name
        ORDER BY total_revenue DESC`,
        [context.companyId, startDate, endDate]
      );

      // Get revenue by month (combined enrollments and product sales)
      const monthlyRevenue = await query(
        `SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          SUM(amount) as total
        FROM (
          SELECT enrollment_date as date, final_price as amount
          FROM enrollments
          WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')
            AND enrollment_date >= $2 AND enrollment_date <= $3
          UNION ALL
          SELECT sale_date as date, total_amount as amount
          FROM product_sales
          WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3
        ) combined
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month`,
        [context.companyId, startDate, endDate]
      );

      return {
        status: 200 as const,
        body: {
          companyWideSummary: {
            totalRevenue,
            enrollmentRevenue,
            productRevenue,
            fixedExpenses,
            variableExpenses,
            salaries,
            sharedExpenses,
            totalExpenses,
            netProfit,
            currentCash,
            totalOutstandingDebts,
            availableCash: currentCash - totalOutstandingDebts,
          },
          branchSummaries: branchRevenueData.map((b: any) => ({
            branchId: b.id,
            branchName: b.name,
            totalRevenue: parseFloat(b.total_revenue),
          })),
          revenueByMonth: monthlyRevenue.map((m: any) => ({
            month: m.month,
            total: parseFloat(m.total),
          })),
          expensesByCategory: expenseData.map((e: any) => ({
            type: e.type,
            category: e.category,
            amount: parseFloat(e.total_amount),
          })),
          topPerformingBranches: branchRevenueData.slice(0, 5).map((b: any) => ({
            branchId: b.id,
            branchName: b.name,
            totalRevenue: parseFloat(b.total_revenue),
          })),
          period: {
            startDate,
            endDate,
          },
        },
      };
    } catch (error) {
      console.error('Dashboard error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to load dashboard' },
      };
    }
  },
};
