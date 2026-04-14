import { query, queryOne } from '../db/connection';
import { extractTenantContext, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export const analyticsRoutes = {
  dashboard: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const startDate = queryParams.startDate || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const endDate = queryParams.endDate || new Date().toISOString().split('T')[0];

      // --- Company allocation method ---
      const company = await queryOne(
        'SELECT global_expense_allocation FROM companies WHERE id = $1',
        [context.companyId]
      );
      const allocationMethod: 'PROPORTIONAL' | 'EQUAL' | 'OVERHEAD' = company?.global_expense_allocation || 'OVERHEAD';

      // --- Company-wide revenue ---
      const enrollmentRevenueData = await query(
        `SELECT COALESCE(SUM(amount_paid), 0) as total_revenue
         FROM enrollments
         WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')
           AND enrollment_date >= $2 AND enrollment_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const productRevenueData = await query(
        `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
         FROM product_sales
         WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3`,
        [context.companyId, startDate, endDate]
      );

      const enrollmentRevenue = parseFloat(enrollmentRevenueData[0]?.total_revenue || '0');
      const productRevenue = parseFloat(productRevenueData[0]?.total_revenue || '0');

      // Subtract refunds from revenue
      const refundData = await query(
        `SELECT COALESCE(SUM(amount), 0) as total_refunds FROM refunds
         WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const totalRefunds = parseFloat(refundData[0]?.total_refunds || '0');
      const totalRevenue = enrollmentRevenue + productRevenue - totalRefunds;

      // --- Company-wide expenses (is_recurring = false to exclude templates) ---
      const expenseData = await query(
        `SELECT type, category, COALESCE(SUM(amount), 0) as total_amount
         FROM expenses
         WHERE company_id = $1 AND date >= $2 AND date <= $3 AND is_recurring = false
         GROUP BY type, category`,
        [context.companyId, startDate, endDate]
      );

      const fixedExpenses = expenseData.filter((e: any) => e.type === 'FIXED').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const variableExpenses = expenseData.filter((e: any) => e.type === 'VARIABLE' && e.category !== 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const sharedExpenses = expenseData.filter((e: any) => e.type === 'SHARED').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const capitalExpenses = expenseData.filter((e: any) => e.type === 'CAPITAL').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const cogsExpenses = expenseData.filter((e: any) => e.category === 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const salaries = expenseData.filter((e: any) => e.category === 'SALARIES').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const totalExpenses = fixedExpenses + variableExpenses + sharedExpenses + capitalExpenses + cogsExpenses;
      const grossProfit = totalRevenue - cogsExpenses;
      const netProfit = totalRevenue - totalExpenses;

      // --- Inventory value ---
      const inventoryData = await query(
        `SELECT COALESCE(SUM(stock * cost_price), 0) as inventory_value FROM products WHERE company_id = $1 AND is_active = true`,
        [context.companyId]
      );
      const inventoryValue = parseFloat(inventoryData[0]?.inventory_value || '0');

      // --- Cash & debts ---
      const cashState = await query('SELECT current_balance FROM cash_state WHERE company_id = $1 LIMIT 1', [context.companyId]);
      const currentCash = parseFloat(cashState[0]?.current_balance || '0');
      const debtsData = await query(
        `SELECT COALESCE(SUM(remaining_amount), 0) as total_debts FROM debts WHERE company_id = $1 AND status = 'ACTIVE'`,
        [context.companyId]
      ).catch(() => [{ total_debts: 0 }]);
      const totalOutstandingDebts = parseFloat(debtsData[0]?.total_debts || '0');

      // --- Global overhead (branch_id IS NULL, excluding product-cost categories) ---
      const globalOverheadData = await query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM expenses
         WHERE company_id = $1 AND branch_id IS NULL
           AND date >= $2 AND date <= $3
           AND is_recurring = false
           AND category NOT IN ('COGS', 'INVENTORY')`,
        [context.companyId, startDate, endDate]
      );
      const totalGlobalOverhead = parseFloat(globalOverheadData[0]?.total || '0');

      // --- Branch P&L ---
      const branchRawData = await query(
        `SELECT
           b.id,
           b.name,
           b.code,
           -- Enrollment revenue
           COALESCE((
             SELECT SUM(e.amount_paid) FROM enrollments e
             WHERE e.branch_id = b.id AND e.company_id = $1
               AND e.payment_status IN ('PAID', 'PARTIAL')
               AND e.enrollment_date >= $2 AND e.enrollment_date <= $3
           ), 0) AS enrollment_revenue,
           -- Product sale revenue
           COALESCE((
             SELECT SUM(ps.total_amount) FROM product_sales ps
             WHERE ps.branch_id = b.id AND ps.company_id = $1
               AND ps.sale_date >= $2 AND ps.sale_date <= $3
           ), 0) AS product_revenue,
           -- Direct expenses (explicitly assigned to this branch)
           COALESCE((
             SELECT SUM(ex.amount) FROM expenses ex
             WHERE ex.branch_id = b.id AND ex.company_id = $1
               AND ex.date >= $2 AND ex.date <= $3
               AND ex.is_recurring = false
           ), 0) AS direct_expenses,
           -- Active student count
           (SELECT COUNT(*) FROM enrollments en
            WHERE en.branch_id = b.id AND en.company_id = $1
              AND en.status = 'ACTIVE') AS student_count,
           -- Employee count
           (SELECT COUNT(*) FROM employees em
            WHERE em.branch_id = b.id AND em.company_id = $1 AND em.is_active = true) AS employee_count
         FROM branches b
         WHERE b.company_id = $1
         ORDER BY (COALESCE((SELECT SUM(e.amount_paid) FROM enrollments e WHERE e.branch_id = b.id AND e.company_id = $1 AND e.payment_status IN ('PAID','PARTIAL') AND e.enrollment_date >= $2 AND e.enrollment_date <= $3), 0) + COALESCE((SELECT SUM(ps.total_amount) FROM product_sales ps WHERE ps.branch_id = b.id AND ps.company_id = $1 AND ps.sale_date >= $2 AND ps.sale_date <= $3), 0)) DESC`,
        [context.companyId, startDate, endDate]
      );

      const totalBranchRevenue = branchRawData.reduce((s: number, b: any) =>
        s + parseFloat(b.enrollment_revenue) + parseFloat(b.product_revenue), 0);
      const branchCount = branchRawData.length;

      const branchSummaries = branchRawData.map((b: any) => {
        const revenue = parseFloat(b.enrollment_revenue) + parseFloat(b.product_revenue);
        const directExpenses = parseFloat(b.direct_expenses);

        let allocatedOverhead = 0;
        if (allocationMethod === 'PROPORTIONAL') {
          allocatedOverhead = totalBranchRevenue > 0
            ? totalGlobalOverhead * (revenue / totalBranchRevenue)
            : (branchCount > 0 ? totalGlobalOverhead / branchCount : 0);
        } else if (allocationMethod === 'EQUAL') {
          allocatedOverhead = branchCount > 0 ? totalGlobalOverhead / branchCount : 0;
        }
        // OVERHEAD: allocatedOverhead stays 0 — shown at company level only

        const totalBranchExpenses = directExpenses + allocatedOverhead;
        const branchNetProfit = revenue - totalBranchExpenses;
        const profitMargin = revenue > 0 ? (branchNetProfit / revenue) * 100 : 0;

        return {
          branchId: b.id,
          branchName: b.name,
          branchCode: b.code,
          totalRevenue: revenue,
          directExpenses,
          allocatedOverhead: Math.round(allocatedOverhead * 100) / 100,
          totalExpenses: Math.round(totalBranchExpenses * 100) / 100,
          netProfit: Math.round(branchNetProfit * 100) / 100,
          profitMargin: Math.round(profitMargin * 10) / 10,
          studentCount: parseInt(b.student_count),
          employeeCount: parseInt(b.employee_count),
        };
      });

      // --- Revenue by month ---
      const monthlyRevenue = await query(
        `SELECT TO_CHAR(date, 'YYYY-MM') as month,
                SUM(revenue) as revenue,
                SUM(expenses) as expenses,
                SUM(refunds) as refunds,
                SUM(revenue) - SUM(refunds) - SUM(expenses) as profit
         FROM (
           SELECT enrollment_date as date, amount_paid as revenue, 0 as expenses, 0 as refunds
           FROM enrollments
           WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')
             AND enrollment_date >= $2 AND enrollment_date <= $3
           UNION ALL
           SELECT sale_date as date, total_amount as revenue, 0 as expenses, 0 as refunds
           FROM product_sales
           WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3
           UNION ALL
           SELECT date, 0 as revenue, amount as expenses, 0 as refunds
           FROM expenses
           WHERE company_id = $1 AND date >= $2 AND date <= $3 AND is_recurring = false
           UNION ALL
           SELECT refund_date as date, 0 as revenue, 0 as expenses, amount as refunds
           FROM refunds
           WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3
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
            totalRefunds,
            grossProfit,
            fixedExpenses,
            variableExpenses,
            cogsExpenses,
            salaries,
            sharedExpenses,
            capitalExpenses,
            totalExpenses,
            netProfit,
            currentCash,
            totalOutstandingDebts,
            availableCash: currentCash - totalOutstandingDebts,
            inventoryValue,
            globalOverhead: totalGlobalOverhead,
            allocationMethod,
          },
          branchSummaries,
          revenueByMonth: monthlyRevenue.map((m: any) => ({
            month: m.month,
            revenue: parseFloat(m.revenue || '0'),
            expenses: parseFloat(m.expenses || '0'),
            refunds: parseFloat(m.refunds || '0'),
            profit: parseFloat(m.profit || '0'),
          })),
          expensesByCategory: expenseData.map((e: any) => ({
            type: e.type,
            category: e.category,
            amount: parseFloat(e.total_amount),
          })),
          topPerformingBranches: [...branchSummaries]
            .sort((a, b) => b.netProfit - a.netProfit)
            .slice(0, 5)
            .map(b => ({
              branchId: b.branchId,
              branchName: b.branchName,
              profit: b.netProfit,
              profitMargin: b.profitMargin,
              studentCount: b.studentCount,
              courseCount: 0,
            })),
          period: { startDate, endDate },
        },
      };
    } catch (error) {
      console.error('Dashboard error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to load dashboard' },
      };
    }
  },
};
