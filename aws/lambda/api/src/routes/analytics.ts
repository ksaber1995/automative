import { query } from '../db/connection';

export const analyticsRoutes = {
  dashboard: async ({ query: queryParams }: { query: { startDate?: string; endDate?: string } }) => {
    try {
      const startDate = queryParams.startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const endDate = queryParams.endDate || new Date().toISOString().split('T')[0];

      // Get company-wide revenue
      const revenueData = await query(
        `SELECT
          COALESCE(SUM(amount), 0) as total_revenue
        FROM revenues
        WHERE date >= $1 AND date <= $2`,
        [startDate, endDate]
      );

      // Get expenses by type
      const expenseData = await query(
        `SELECT
          type,
          category,
          COALESCE(SUM(amount), 0) as total_amount
        FROM expenses
        WHERE date >= $1 AND date <= $2
        GROUP BY type, category`,
        [startDate, endDate]
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
      const totalRevenue = parseFloat(revenueData[0]?.total_revenue || '0');
      const netProfit = totalRevenue - totalExpenses;

      // Get cash state
      const cashState = await query('SELECT current_balance FROM cash_state LIMIT 1');
      const currentCash = parseFloat(cashState[0]?.current_balance || '0');

      // Get outstanding debts
      const debtsData = await query(
        `SELECT COALESCE(SUM(remaining_amount), 0) as total_debts
        FROM debts
        WHERE status = 'ACTIVE'`
      );
      const totalOutstandingDebts = parseFloat(debtsData[0]?.total_debts || '0');

      // Get revenue by branch
      const branchRevenueData = await query(
        `SELECT
          b.id,
          b.name,
          COALESCE(SUM(r.amount), 0) as total_revenue
        FROM branches b
        LEFT JOIN revenues r ON b.id = r.branch_id AND r.date >= $1 AND r.date <= $2
        GROUP BY b.id, b.name
        ORDER BY total_revenue DESC`,
        [startDate, endDate]
      );

      // Get revenue by month
      const monthlyRevenue = await query(
        `SELECT
          DATE_TRUNC('month', date) as month,
          COALESCE(SUM(amount), 0) as total
        FROM revenues
        WHERE date >= $1 AND date <= $2
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY month`,
        [startDate, endDate]
      );

      return {
        status: 200 as const,
        body: {
          companyWideSummary: {
            totalRevenue,
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
        status: 200 as const,
        body: {
          companyWideSummary: {},
          branchSummaries: [],
          revenueByMonth: [],
          expensesByCategory: [],
          topPerformingBranches: [],
          period: { startDate: '', endDate: '' },
        },
      };
    }
  },
};
