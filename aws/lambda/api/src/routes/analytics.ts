import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export const analyticsRoutes = {
  dashboard: async ({ query: queryParams, headers }: { query: { startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!checkGranularPermission(context, 'dashboard', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

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
         WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')
           AND enrollment_date >= $2 AND enrollment_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const productRevenueData = await query(
        `SELECT COALESCE(SUM(total_amount), 0) as total_revenue
         FROM product_sales
         WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      // Master course bundle payments are revenue too.
      const masterRevenueData = await query(
        `SELECT COALESCE(SUM(amount_paid), 0) as total_revenue
         FROM master_enrollments
         WHERE company_id = $1 AND amount_paid > 0
           AND enrollment_date >= $2 AND enrollment_date <= $3`,
        [context.companyId, startDate, endDate]
      );

      const enrollmentRevenue = parseFloat(enrollmentRevenueData[0]?.total_revenue || '0');
      const productRevenue = parseFloat(productRevenueData[0]?.total_revenue || '0');
      const masterRevenue = parseFloat(masterRevenueData[0]?.total_revenue || '0');

      // Subtract refunds from revenue (includes master-bundle refunds via the
      // polymorphic refunds table).
      const refundData = await query(
        `SELECT COALESCE(SUM(amount), 0) as total_refunds FROM refunds
         WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const totalRefunds = parseFloat(refundData[0]?.total_refunds || '0');
      const totalRevenue = enrollmentRevenue + productRevenue + masterRevenue - totalRefunds;

      // --- Company-wide expenses (actual payments only) ---
      const expenseData = await query(
        `SELECT type, category, COALESCE(SUM(amount), 0) as total_amount
         FROM expense_payments
         WHERE company_id = $1 AND date >= $2 AND date <= $3
         GROUP BY type, category`,
        [context.companyId, startDate, endDate]
      );

      // Display buckets — non-overlapping. Each row contributes to exactly ONE
      // type bucket OR cogsExpenses (mutually exclusive), so totalExpenses is
      // the simple sum.
      const cogsExpenses = expenseData.filter((e: any) => e.category === 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const fixedExpenses = expenseData.filter((e: any) => e.type === 'FIXED' && e.category !== 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const variableExpenses = expenseData.filter((e: any) => e.type === 'VARIABLE' && e.category !== 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const sharedExpenses = expenseData.filter((e: any) => e.type === 'SHARED' && e.category !== 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const capitalExpenses = expenseData.filter((e: any) => e.type === 'CAPITAL' && e.category !== 'COGS').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      const salaries = expenseData.filter((e: any) => e.category === 'SALARIES').reduce((s: number, e: any) => s + parseFloat(e.total_amount), 0);
      // Authoritative total — single SUM, not derived from buckets, so a
      // miscategorised row can never silently drop or double-count.
      const totalExpensesRow = await query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM expense_payments
         WHERE company_id = $1 AND date >= $2 AND date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const totalExpenses = parseFloat(totalExpensesRow[0]?.total || '0');
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
         FROM expense_payments
         WHERE company_id = $1 AND branch_id IS NULL
           AND date >= $2 AND date <= $3
           AND category NOT IN ('COGS', 'INVENTORY')`,
        [context.companyId, startDate, endDate]
      );
      const totalGlobalOverhead = parseFloat(globalOverheadData[0]?.total || '0');

      // --- Company-level (unallocated) revenue & expenses ---
      // Captures product_sales with no branch + every expense_payment with no branch
      // (overhead AND COGS). These are not attributable to any specific branch and
      // must reconcile against the company-wide total so branch sums add up.
      // enrollments and master_enrollments require a branch_id (NOT NULL), so
      // unallocated revenue can only come from product_sales.
      const unallocRevData = await query(
        `SELECT COALESCE(SUM(total_amount), 0) as total
         FROM product_sales
         WHERE company_id = $1 AND branch_id IS NULL
           AND sale_date >= $2 AND sale_date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const unallocExpData = await query(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM expense_payments
         WHERE company_id = $1 AND branch_id IS NULL
           AND date >= $2 AND date <= $3`,
        [context.companyId, startDate, endDate]
      );
      const unallocatedRevenue = parseFloat(unallocRevData[0]?.total || '0');
      const unallocatedExpenses = parseFloat(unallocExpData[0]?.total || '0');
      const unallocatedNetProfit = unallocatedRevenue - unallocatedExpenses;

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
           -- Master bundle revenue
           COALESCE((
             SELECT SUM(me.amount_paid) FROM master_enrollments me
             WHERE me.branch_id = b.id AND me.company_id = $1
               AND me.amount_paid > 0
               AND me.enrollment_date >= $2 AND me.enrollment_date <= $3
           ), 0) AS master_revenue,
           -- Direct expenses (explicitly assigned to this branch)
           COALESCE((
             SELECT SUM(ep.amount) FROM expense_payments ep
             WHERE ep.branch_id = b.id AND ep.company_id = $1
               AND ep.date >= $2 AND ep.date <= $3
           ), 0) AS direct_expenses,
           -- Refunds attributable to this branch (joined via the parent enrollment)
           COALESCE((
             SELECT SUM(r.amount) FROM refunds r
             LEFT JOIN enrollments e ON r.enrollment_id = e.id
             LEFT JOIN master_enrollments me ON r.master_enrollment_id = me.id
             WHERE r.company_id = $1
               AND r.refund_date >= $2 AND r.refund_date <= $3
               AND COALESCE(e.branch_id, me.branch_id) = b.id
           ), 0) AS refunds_amount,
           -- Students enrolled in courses or master courses within the period
           (SELECT COUNT(DISTINCT s.student_id) FROM (
             SELECT student_id FROM enrollments
             WHERE branch_id = b.id AND company_id = $1
               AND enrollment_date >= $2 AND enrollment_date <= $3
             UNION
             SELECT student_id FROM master_enrollments
             WHERE branch_id = b.id AND company_id = $1
               AND enrollment_date >= $2 AND enrollment_date <= $3
           ) s) AS student_count,
           -- Distinct courses (regular + master) with enrollments in the period
           (SELECT COUNT(DISTINCT c.course_ref) FROM (
             SELECT course_id::text AS course_ref FROM enrollments
             WHERE branch_id = b.id AND company_id = $1
               AND enrollment_date >= $2 AND enrollment_date <= $3
             UNION
             SELECT master_course_id::text AS course_ref FROM master_enrollments
             WHERE branch_id = b.id AND company_id = $1
               AND enrollment_date >= $2 AND enrollment_date <= $3
           ) c) AS course_count,
           -- Employee count
           (SELECT COUNT(*) FROM employees em
            WHERE em.branch_id = b.id AND em.company_id = $1 AND em.is_active = true) AS employee_count
         FROM branches b
         WHERE b.company_id = $1
         ORDER BY (COALESCE((SELECT SUM(e.amount_paid) FROM enrollments e WHERE e.branch_id = b.id AND e.company_id = $1 AND e.payment_status IN ('PAID','PARTIAL') AND e.enrollment_date >= $2 AND e.enrollment_date <= $3), 0) + COALESCE((SELECT SUM(ps.total_amount) FROM product_sales ps WHERE ps.branch_id = b.id AND ps.company_id = $1 AND ps.sale_date >= $2 AND ps.sale_date <= $3), 0) + COALESCE((SELECT SUM(me.amount_paid) FROM master_enrollments me WHERE me.branch_id = b.id AND me.company_id = $1 AND me.amount_paid > 0 AND me.enrollment_date >= $2 AND me.enrollment_date <= $3), 0)) DESC`,
        [context.companyId, startDate, endDate]
      );

      // Net branch revenue (after subtracting per-branch refunds) drives proportional allocation.
      const branchNetRevenues = branchRawData.map((b: any) => {
        const gross = parseFloat(b.enrollment_revenue) + parseFloat(b.product_revenue) + parseFloat(b.master_revenue || '0');
        const refunds = parseFloat(b.refunds_amount || '0');
        return gross - refunds;
      });
      const totalBranchRevenue = branchNetRevenues.reduce((s, v) => s + v, 0);
      const branchCount = branchRawData.length;

      // In PROPORTIONAL/EQUAL modes the company-level unallocated P&L is pushed
      // down to branches so sum(branches) == totalNetProfit. In OVERHEAD it stays
      // at the company level and is reported as a separate bucket.
      const distributeUnallocated = allocationMethod !== 'OVERHEAD';

      const branchSummaries = branchRawData.map((b: any, i: number) => {
        const grossRevenue = parseFloat(b.enrollment_revenue) + parseFloat(b.product_revenue) + parseFloat(b.master_revenue || '0');
        const refunds = parseFloat(b.refunds_amount || '0');
        const netRevenue = grossRevenue - refunds;
        const directExpenses = parseFloat(b.direct_expenses);

        let allocatedUnallocated = 0;
        if (distributeUnallocated) {
          if (allocationMethod === 'PROPORTIONAL') {
            allocatedUnallocated = totalBranchRevenue > 0
              ? unallocatedNetProfit * (netRevenue / totalBranchRevenue)
              : (branchCount > 0 ? unallocatedNetProfit / branchCount : 0);
          } else if (allocationMethod === 'EQUAL') {
            allocatedUnallocated = branchCount > 0 ? unallocatedNetProfit / branchCount : 0;
          }
        }

        const totalBranchExpenses = directExpenses;
        const branchNetProfit = netRevenue - totalBranchExpenses + allocatedUnallocated;
        const profitMargin = netRevenue > 0 ? (branchNetProfit / netRevenue) * 100 : 0;

        return {
          branchId: b.id,
          branchName: b.name,
          branchCode: b.code,
          totalRevenue: netRevenue,
          grossRevenue,
          refunds: Math.round(refunds * 100) / 100,
          directExpenses,
          allocatedOverhead: Math.round(allocatedUnallocated * 100) / 100,
          totalExpenses: Math.round((totalBranchExpenses - allocatedUnallocated) * 100) / 100,
          netProfit: Math.round(branchNetProfit * 100) / 100,
          profitMargin: Math.round(profitMargin * 10) / 10,
          studentCount: parseInt(b.student_count),
          courseCount: parseInt(b.course_count),
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
           SELECT enrollment_date as date, amount_paid as revenue, 0 as expenses, 0 as refunds
           FROM master_enrollments
           WHERE company_id = $1 AND amount_paid > 0
             AND enrollment_date >= $2 AND enrollment_date <= $3
           UNION ALL
           SELECT date, 0 as revenue, amount as expenses, 0 as refunds
           FROM expense_payments
           WHERE company_id = $1 AND date >= $2 AND date <= $3
           UNION ALL
           SELECT refund_date as date, 0 as revenue, 0 as expenses, amount as refunds
           FROM refunds
           WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3
         ) combined
         GROUP BY TO_CHAR(date, 'YYYY-MM')
         ORDER BY month`,
        [context.companyId, startDate, endDate]
      );

      const sumBranchNetProfit = branchSummaries.reduce((s: number, b: any) => s + b.netProfit, 0);

      return {
        status: 200 as const,
        body: {
          companyWideSummary: {
            totalRevenue,
            enrollmentRevenue,
            productRevenue,
            masterRevenue,
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
            unallocatedRevenue,
            unallocatedExpenses,
            unallocatedNetProfit,
            sumBranchNetProfit: Math.round(sumBranchNetProfit * 100) / 100,
            allocationMethod,
            companyLevelUnallocated: {
              revenue: unallocatedRevenue,
              expenses: unallocatedExpenses,
              netProfit: unallocatedNetProfit,
              distributed: distributeUnallocated,
            },
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
              courseCount: b.courseCount,
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
