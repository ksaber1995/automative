import { query } from '../db/connection';
import {
  extractTenantContext,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

type AuthHeaders = { authorization: string };
type RangeQuery = { startDate?: string; endDate?: string; branchId?: string };

function defaultRange(q: RangeQuery) {
  const end = q.endDate || new Date().toISOString().split('T')[0];
  const endDate = new Date(end);
  const start = new Date(endDate);
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  const startDate = q.startDate || start.toISOString().split('T')[0];
  return { startDate, endDate: end };
}

function handleError(error: any, fallback: string) {
  console.error(`${fallback}:`, error);
  const status = isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500;
  return { status: status as 402 | 401 | 500, body: { message: error?.message || fallback } };
}

export const reportsRoutes = {
  // Monthly P&L: revenue (enrollments + product_sales - refunds) and expenses per month.
  monthlyPL: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $2::date),
             date_trunc('month', $3::date),
             interval '1 month'
           )::date AS month_start
         ),
         enroll_rev AS (
           SELECT date_trunc('month', enrollment_date)::date AS m, SUM(amount_paid) AS amt
           FROM enrollments
           WHERE company_id = $1 AND payment_status IN ('PAID','PARTIAL')
             AND enrollment_date >= $2 AND enrollment_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         product_rev AS (
           SELECT date_trunc('month', sale_date)::date AS m, SUM(total_amount) AS amt
           FROM product_sales
           WHERE company_id = $1 AND sale_date >= $2 AND sale_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         master_rev AS (
           SELECT date_trunc('month', enrollment_date)::date AS m, SUM(amount_paid) AS amt
           FROM master_enrollments
           WHERE company_id = $1 AND amount_paid > 0
             AND enrollment_date >= $2 AND enrollment_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         refund_amt AS (
           SELECT date_trunc('month', refund_date)::date AS m, SUM(amount) AS amt
           FROM refunds
           WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         expense_amt AS (
           SELECT date_trunc('month', date)::date AS m, SUM(amount) AS amt
           FROM expenses
           WHERE company_id = $1 AND date >= $2 AND date <= $3 AND is_recurring = false ${branchClause}
           GROUP BY 1
         )
         SELECT
           TO_CHAR(months.month_start, 'YYYY-MM') AS month,
           COALESCE(enroll_rev.amt, 0) AS enrollment_revenue,
           COALESCE(product_rev.amt, 0) AS product_revenue,
           COALESCE(master_rev.amt, 0) AS master_revenue,
           COALESCE(refund_amt.amt, 0) AS refunds,
           COALESCE(expense_amt.amt, 0) AS expenses
         FROM months
         LEFT JOIN enroll_rev ON enroll_rev.m = months.month_start
         LEFT JOIN product_rev ON product_rev.m = months.month_start
         LEFT JOIN master_rev ON master_rev.m = months.month_start
         LEFT JOIN refund_amt ON refund_amt.m = months.month_start
         LEFT JOIN expense_amt ON expense_amt.m = months.month_start
         ORDER BY months.month_start ASC`,
        params
      );

      const data = rows.map((r: any) => {
        const enrollmentRevenue = parseFloat(r.enrollment_revenue);
        const productRevenue = parseFloat(r.product_revenue);
        const masterRevenue = parseFloat(r.master_revenue);
        const refunds = parseFloat(r.refunds);
        const expenses = parseFloat(r.expenses);
        const revenue = enrollmentRevenue + productRevenue + masterRevenue - refunds;
        return {
          month: r.month,
          enrollmentRevenue,
          productRevenue,
          masterRevenue,
          refunds,
          revenue,
          expenses,
          netProfit: revenue - expenses,
        };
      });
      return { status: 200 as const, body: data };
    } catch (error) {
      return handleError(error, 'Failed to compute monthly P&L');
    }
  },

  // Salary growth: total SALARIES expenses per month.
  salaryGrowth: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $2::date),
             date_trunc('month', $3::date),
             interval '1 month'
           )::date AS month_start
         ),
         salary AS (
           SELECT date_trunc('month', date)::date AS m, SUM(amount) AS amt, COUNT(*) AS cnt
           FROM expenses
           WHERE company_id = $1 AND category = 'SALARIES' AND is_recurring = false
             AND date >= $2 AND date <= $3 ${branchClause}
           GROUP BY 1
         )
         SELECT TO_CHAR(m.month_start, 'YYYY-MM') AS month,
                COALESCE(s.amt, 0) AS total,
                COALESCE(s.cnt, 0) AS count
         FROM months m LEFT JOIN salary s ON s.m = m.month_start
         ORDER BY m.month_start ASC`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          month: r.month,
          total: parseFloat(r.total),
          count: parseInt(r.count, 10),
        })),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute salary growth');
    }
  },

  // Top courses by enrollment count + revenue.
  topCourses: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND e.branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `SELECT
           c.id AS course_id,
           c.name AS course_name,
           c.code AS course_code,
           b.name AS branch_name,
           COUNT(e.id) AS enrollment_count,
           COUNT(e.id) FILTER (WHERE e.status = 'ACTIVE') AS active_count,
           COALESCE(SUM(e.amount_paid), 0) AS revenue
         FROM enrollments e
         INNER JOIN courses c ON c.id = e.course_id
         INNER JOIN branches b ON b.id = e.branch_id
         WHERE e.company_id = $1
           AND e.enrollment_date >= $2 AND e.enrollment_date <= $3 ${branchClause}
         GROUP BY c.id, c.name, c.code, b.name
         ORDER BY enrollment_count DESC, revenue DESC
         LIMIT 20`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          courseId: r.course_id,
          courseName: r.course_name,
          courseCode: r.course_code,
          branchName: r.branch_name,
          enrollmentCount: parseInt(r.enrollment_count, 10),
          activeCount: parseInt(r.active_count, 10),
          revenue: parseFloat(r.revenue),
        })),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute top courses');
    }
  },

  // New + churned students per month.
  studentsOverTime: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND s.branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $2::date),
             date_trunc('month', $3::date),
             interval '1 month'
           )::date AS month_start
         ),
         enrolled AS (
           SELECT date_trunc('month', s.enrollment_date)::date AS m, COUNT(*) AS cnt
           FROM students s
           INNER JOIN branches b ON b.id = s.branch_id
           WHERE b.company_id = $1
             AND s.enrollment_date >= $2 AND s.enrollment_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         churned AS (
           SELECT date_trunc('month', s.churn_date)::date AS m, COUNT(*) AS cnt
           FROM students s
           INNER JOIN branches b ON b.id = s.branch_id
           WHERE b.company_id = $1
             AND s.churn_date IS NOT NULL
             AND s.churn_date >= $2 AND s.churn_date <= $3 ${branchClause}
           GROUP BY 1
         )
         SELECT TO_CHAR(m.month_start, 'YYYY-MM') AS month,
                COALESCE(e.cnt, 0) AS new_students,
                COALESCE(c.cnt, 0) AS churned
         FROM months m
         LEFT JOIN enrolled e ON e.m = m.month_start
         LEFT JOIN churned c ON c.m = m.month_start
         ORDER BY m.month_start ASC`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const newStudents = parseInt(r.new_students, 10);
          const churned = parseInt(r.churned, 10);
          return {
            month: r.month,
            newStudents,
            churned,
            netChange: newStudents - churned,
          };
        }),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute students over time');
    }
  },

  // Churn: % of active students with no enrollment activity in the last N months.
  studentChurn: async ({ query: q, headers }: { query: RangeQuery & { inactiveMonths?: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const inactiveMonths = Math.min(Math.max(parseInt(q.inactiveMonths || '3', 10) || 3, 1), 24);
      const branchClause = q.branchId ? ' AND s.branch_id = $2' : '';
      const params: any[] = [context.companyId];
      if (q.branchId) params.push(q.branchId);

      const totals = await query(
        `SELECT
           COUNT(*) FILTER (WHERE s.is_active = true) AS active,
           COUNT(*) FILTER (WHERE s.churn_date IS NOT NULL) AS churned,
           COUNT(*) AS total
         FROM students s
         INNER JOIN branches b ON b.id = s.branch_id
         WHERE b.company_id = $1 ${branchClause}`,
        params
      );
      const inactive = await query(
        `SELECT COUNT(*) AS c FROM students s
         INNER JOIN branches b ON b.id = s.branch_id
         WHERE b.company_id = $1 ${branchClause}
           AND s.is_active = true
           AND NOT EXISTS (
             SELECT 1 FROM enrollments e
             WHERE e.student_id = s.id
               AND e.enrollment_date >= (CURRENT_DATE - INTERVAL '${inactiveMonths} months')
           )`,
        params
      );

      const total = parseInt(totals[0]?.total || '0', 10);
      const active = parseInt(totals[0]?.active || '0', 10);
      const churned = parseInt(totals[0]?.churned || '0', 10);
      const inactiveCount = parseInt(inactive[0]?.c || '0', 10);
      const churnRate = total > 0 ? (churned / total) * 100 : 0;
      const inactivityRate = active > 0 ? (inactiveCount / active) * 100 : 0;

      return {
        status: 200 as const,
        body: {
          totalStudents: total,
          activeStudents: active,
          churnedStudents: churned,
          inactiveStudents: inactiveCount,
          inactiveMonths,
          churnRate: Math.round(churnRate * 100) / 100,
          inactivityRate: Math.round(inactivityRate * 100) / 100,
        },
      };
    } catch (error) {
      return handleError(error, 'Failed to compute churn');
    }
  },

  // Profit per course: revenue from enrollments grouped by course.
  profitByCourse: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND c.branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `SELECT
           c.id AS course_id,
           c.name AS course_name,
           c.code AS course_code,
           b.name AS branch_name,
           COUNT(e.id) AS enrollments,
           COALESCE(SUM(e.amount_paid), 0) AS revenue,
           COALESCE(AVG(e.final_price), 0) AS avg_price
         FROM courses c
         INNER JOIN branches b ON b.id = c.branch_id
         LEFT JOIN enrollments e ON e.course_id = c.id
           AND e.company_id = $1
           AND e.enrollment_date >= $2 AND e.enrollment_date <= $3
         WHERE b.company_id = $1 ${branchClause}
         GROUP BY c.id, c.name, c.code, b.name
         HAVING COUNT(e.id) > 0
         ORDER BY revenue DESC
         LIMIT 50`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          courseId: r.course_id,
          courseName: r.course_name,
          courseCode: r.course_code,
          branchName: r.branch_name,
          enrollments: parseInt(r.enrollments, 10),
          revenue: parseFloat(r.revenue),
          avgPrice: parseFloat(r.avg_price),
        })),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute profit by course');
    }
  },

  // Profit per branch: revenue (enrollments + products - refunds) − branch expenses.
  profitByBranch: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);

      const rows = await query(
        `SELECT
           b.id AS branch_id,
           b.name AS branch_name,
           b.code AS branch_code,
           COALESCE((
             SELECT SUM(e.amount_paid) FROM enrollments e
             WHERE e.branch_id = b.id AND e.company_id = $1
               AND e.payment_status IN ('PAID','PARTIAL')
               AND e.enrollment_date >= $2 AND e.enrollment_date <= $3
           ), 0) AS enrollment_revenue,
           COALESCE((
             SELECT SUM(ps.total_amount) FROM product_sales ps
             WHERE ps.branch_id = b.id AND ps.company_id = $1
               AND ps.sale_date >= $2 AND ps.sale_date <= $3
           ), 0) AS product_revenue,
           COALESCE((
             SELECT SUM(me.amount_paid) FROM master_enrollments me
             WHERE me.branch_id = b.id AND me.company_id = $1
               AND me.amount_paid > 0
               AND me.enrollment_date >= $2 AND me.enrollment_date <= $3
           ), 0) AS master_revenue,
           COALESCE((
             SELECT SUM(rf.amount) FROM refunds rf
             WHERE rf.branch_id = b.id AND rf.company_id = $1
               AND rf.refund_date >= $2 AND rf.refund_date <= $3
           ), 0) AS refunds,
           COALESCE((
             SELECT SUM(ex.amount) FROM expenses ex
             WHERE ex.branch_id = b.id AND ex.company_id = $1
               AND ex.date >= $2 AND ex.date <= $3
               AND ex.is_recurring = false
           ), 0) AS expenses,
           (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id AND s.is_active = true) AS active_students
         FROM branches b
         WHERE b.company_id = $1
         ORDER BY enrollment_revenue DESC`,
        [context.companyId, startDate, endDate]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const enrollmentRevenue = parseFloat(r.enrollment_revenue);
          const productRevenue = parseFloat(r.product_revenue);
          const masterRevenue = parseFloat(r.master_revenue);
          const refunds = parseFloat(r.refunds);
          const expenses = parseFloat(r.expenses);
          const revenue = enrollmentRevenue + productRevenue + masterRevenue - refunds;
          return {
            branchId: r.branch_id,
            branchName: r.branch_name,
            branchCode: r.branch_code,
            enrollmentRevenue,
            productRevenue,
            masterRevenue,
            refunds,
            revenue,
            expenses,
            netProfit: revenue - expenses,
            activeStudents: parseInt(r.active_students, 10),
          };
        }),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute profit by branch');
    }
  },

  // Profit per product: (selling − cost) × units sold in window.
  profitByProduct: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND p.branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `SELECT
           p.id AS product_id,
           p.name AS product_name,
           p.code AS product_code,
           b.name AS branch_name,
           COALESCE(SUM(ps.quantity), 0) AS units_sold,
           COALESCE(SUM(ps.total_amount), 0) AS revenue,
           COALESCE(SUM(ps.quantity * p.cost_price), 0) AS cost,
           p.stock AS current_stock
         FROM products p
         INNER JOIN branches b ON b.id = p.branch_id
         LEFT JOIN product_sales ps ON ps.product_id = p.id
           AND ps.company_id = $1
           AND ps.sale_date >= $2 AND ps.sale_date <= $3
         WHERE b.company_id = $1 AND p.is_active = true ${branchClause}
         GROUP BY p.id, p.name, p.code, b.name, p.stock
         ORDER BY revenue DESC
         LIMIT 50`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const revenue = parseFloat(r.revenue);
          const cost = parseFloat(r.cost);
          return {
            productId: r.product_id,
            productName: r.product_name,
            productCode: r.product_code,
            branchName: r.branch_name,
            unitsSold: parseInt(r.units_sold, 10),
            revenue,
            cost,
            margin: revenue - cost,
            currentStock: parseInt(r.current_stock, 10),
          };
        }),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute profit by product');
    }
  },

  // Expense breakdown by category (for donut chart).
  expensesByCategory: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const { startDate, endDate } = defaultRange(q);
      const branchClause = q.branchId ? ' AND branch_id = $4' : '';
      const params: any[] = [context.companyId, startDate, endDate];
      if (q.branchId) params.push(q.branchId);

      const rows = await query(
        `SELECT category, SUM(amount) AS total, COUNT(*) AS count
         FROM expenses
         WHERE company_id = $1 AND date >= $2 AND date <= $3 AND is_recurring = false ${branchClause}
         GROUP BY category
         ORDER BY total DESC`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          category: r.category,
          total: parseFloat(r.total),
          count: parseInt(r.count, 10),
        })),
      };
    } catch (error) {
      return handleError(error, 'Failed to compute expenses by category');
    }
  },
};
