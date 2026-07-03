import { query } from '../db/connection';
import {
  extractTenantContext,
  checkGranularPermission,
  isGlobalAdmin,
  canAccessBranch,
  type TenantContext,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensurePerSessionSchema } from './session-payments';

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

function handleError(error: any, fallbackCode: string, fallbackMessage: string) {
  console.error(`${fallbackMessage}:`, error);
  return mapThrownError(error, fallbackCode, fallbackMessage);
}

/**
 * Returns a list of branch UUIDs to filter by for the current user, or null
 * if no branch filter applies (global admin with no branchId selected).
 * Throws an apiError result on access violation when the user requested a
 * branchId outside their scope.
 *
 * The result is wrapped in `{ ok: true, ids } | { ok: false, error }` so
 * callers can early-return on permission failure.
 */
function resolveBranchScope(
  context: TenantContext,
  requested?: string
): { ok: true; ids: string[] | null } | { ok: false; error: ReturnType<typeof apiError> } {
  if (isGlobalAdmin(context)) {
    return { ok: true, ids: requested ? [requested] : null };
  }
  const accessible = (context.branchIds && context.branchIds.length > 0)
    ? context.branchIds
    : (context.branchId ? [context.branchId] : []);
  if (requested) {
    if (!canAccessBranch(context, requested)) {
      return {
        ok: false,
        error: apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch'),
      };
    }
    return { ok: true, ids: [requested] };
  }
  return { ok: true, ids: accessible };
}

/**
 * Builds " AND <alias> IN ($N, $N+1, ...)" and appends UUID placeholders.
 * Returns '' when `ids` is null (no filter — global admin with no requested
 * branch). Returns ' AND FALSE' when `ids` is [] so scoped users with no
 * branches see empty result sets.
 */
function reportBranchClause(alias: string, params: any[], ids: string[] | null): string {
  if (ids === null) return '';
  if (ids.length === 0) return ' AND FALSE';
  const placeholders = ids.map((id) => {
    params.push(id);
    return `$${params.length}`;
  }).join(', ');
  return ` AND ${alias} IN (${placeholders})`;
}

// ── Shared student-status predicates ────────────────────────────────────────
// SQL fragments over a `students s` row with $2 = startDate and $3 = endDate.
// Used by both the churn summary and the per-branch report so "active",
// "dormant" (idle) and "left" mean the same thing on every tab.
//   active  = present as of $3 AND enrolled (by $3) in a class that was
//             running as of $3 — started by $3 and not finished by $3.
//   dormant = present as of $3 but in no running class.
//   left    = the student record was deactivated within [$2, $3].
// NOTE: classes.is_active is unreliable (false even for in-progress classes),
// and enrollment status has no history, so current status is used as a
// best-effort proxy. Checks single-course (enrollments) and bundle
// (master_class_enrollments) tables.
const ACTIVE_ENROLLMENT_EXISTS = `(
  EXISTS (
    SELECT 1 FROM enrollments e
    INNER JOIN classes c ON c.id = e.class_id
    WHERE e.student_id = s.id
      AND e.status NOT IN ('DROPPED', 'CANCELLED')
      AND e.enrollment_date <= $3::date
      AND c.start_date <= $3::date
      AND NOT (c.finished_at IS NOT NULL AND c.finished_at::date <= $3::date)
  )
  OR EXISTS (
    SELECT 1 FROM master_class_enrollments mce
    INNER JOIN classes c ON c.id = mce.class_id
    WHERE mce.student_id = s.id
      AND mce.status != 'DROPPED'
      AND mce.enrolled_at <= $3::date
      AND c.start_date <= $3::date
      AND NOT (c.finished_at IS NOT NULL AND c.finished_at::date <= $3::date)
  )
)`;
// Present as of the end date: joined by then and not yet left by then.
const PRESENT_AS_OF_END = `(s.enrollment_date <= $3::date
  AND (s.inactive_date IS NULL OR s.inactive_date > $3::date))`;
const LEFT_IN_RANGE = `(s.inactive_date IS NOT NULL
  AND s.inactive_date >= $2::date AND s.inactive_date <= $3::date)`;

export const reportsRoutes = {
  // Monthly P&L: revenue (enrollments + product_sales - refunds) and expenses per month.
  monthlyPL: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      // session_packages / session_payments are created lazily — make sure they
      // exist before the session_rev CTE references them.
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      // Push branch UUIDs once and reuse the same placeholders across CTEs.
      const branchClause = reportBranchClause('branch_id', params, scope.ids);

      const rows = await query(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', $2::date),
             date_trunc('month', $3::date),
             interval '1 month'
           )::date AS month_start
         ),
         enroll_rev AS (
           -- Include REFUNDED: amount_paid survives a refund (only total_refunded
           -- grows), so it's real collected revenue. The refund_amt CTE subtracts
           -- it once below; excluding REFUNDED here would double-count the loss.
           SELECT date_trunc('month', enrollment_date)::date AS m, SUM(amount_paid) AS amt
           FROM enrollments
           WHERE company_id = $1 AND payment_status IN ('PAID','PARTIAL','REFUNDED')
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
         sub_rev AS (
           SELECT date_trunc('month', paid_date)::date AS m, SUM(amount_paid) AS amt
           FROM monthly_subscription_payments
           WHERE company_id = $1 AND amount_paid > 0
             AND paid_date >= $2 AND paid_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         -- Per-session money: prepaid packages + pay-as-you-go charges. COVERED
         -- charges carry amount_paid = 0, so the two never double-count.
         session_rev AS (
           SELECT m, SUM(amt) AS amt FROM (
             SELECT date_trunc('month', purchased_at)::date AS m, SUM(amount_paid) AS amt
             FROM session_packages
             WHERE company_id = $1 AND amount_paid > 0
               AND purchased_at::date >= $2 AND purchased_at::date <= $3 ${branchClause}
             GROUP BY 1
             UNION ALL
             SELECT date_trunc('month', COALESCE(paid_date, created_at::date))::date AS m, SUM(amount_paid) AS amt
             FROM session_payments
             WHERE company_id = $1 AND amount_paid > 0
               AND COALESCE(paid_date, created_at::date) >= $2
               AND COALESCE(paid_date, created_at::date) <= $3 ${branchClause}
             GROUP BY 1
           ) u GROUP BY m
         ),
         refund_amt AS (
           SELECT date_trunc('month', refund_date)::date AS m, SUM(amount) AS amt
           FROM refunds
           WHERE company_id = $1 AND refund_date >= $2 AND refund_date <= $3 ${branchClause}
           GROUP BY 1
         ),
         expense_amt AS (
           SELECT date_trunc('month', date)::date AS m, SUM(amount) AS amt
           FROM expense_payments
           WHERE company_id = $1 AND date >= $2 AND date <= $3 ${branchClause}
           GROUP BY 1
         )
         SELECT
           TO_CHAR(months.month_start, 'YYYY-MM') AS month,
           COALESCE(enroll_rev.amt, 0) AS enrollment_revenue,
           COALESCE(product_rev.amt, 0) AS product_revenue,
           COALESCE(master_rev.amt, 0) AS master_revenue,
           COALESCE(sub_rev.amt, 0) AS subscription_revenue,
           COALESCE(session_rev.amt, 0) AS session_revenue,
           COALESCE(refund_amt.amt, 0) AS refunds,
           COALESCE(expense_amt.amt, 0) AS expenses
         FROM months
         LEFT JOIN enroll_rev ON enroll_rev.m = months.month_start
         LEFT JOIN product_rev ON product_rev.m = months.month_start
         LEFT JOIN master_rev ON master_rev.m = months.month_start
         LEFT JOIN sub_rev ON sub_rev.m = months.month_start
         LEFT JOIN session_rev ON session_rev.m = months.month_start
         LEFT JOIN refund_amt ON refund_amt.m = months.month_start
         LEFT JOIN expense_amt ON expense_amt.m = months.month_start
         ORDER BY months.month_start ASC`,
        params
      );

      const data = rows.map((r: any) => {
        const enrollmentRevenue = parseFloat(r.enrollment_revenue);
        const productRevenue = parseFloat(r.product_revenue);
        const masterRevenue = parseFloat(r.master_revenue);
        const subscriptionRevenue = parseFloat(r.subscription_revenue);
        const sessionRevenue = parseFloat(r.session_revenue);
        const refunds = parseFloat(r.refunds);
        const expenses = parseFloat(r.expenses);
        const revenue = enrollmentRevenue + productRevenue + masterRevenue + subscriptionRevenue + sessionRevenue - refunds;
        return {
          month: r.month,
          enrollmentRevenue,
          productRevenue,
          masterRevenue,
          sessionRevenue,
          refunds,
          revenue,
          expenses,
          netProfit: revenue - expenses,
        };
      });
      return { status: 200 as const, body: data };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.MONTHLY_PL_FAILED', 'Failed to compute monthly P&L');
    }
  },

  // Salary growth: total SALARIES expenses per month.
  salaryGrowth: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('branch_id', params, scope.ids);

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
           FROM expense_payments
           WHERE company_id = $1 AND category = 'SALARIES'
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
      return handleError(error, 'ERRORS.REPORTS.SALARY_GROWTH_FAILED', 'Failed to compute salary growth');
    }
  },

  // Top courses by enrollment count + revenue. Mixes regular courses and
  // master-course bundles — bundles appear with type='MASTER'.
  topCourses: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      // Revenue subqueries reference the lazily-created per-session tables.
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const courseBranchClause = reportBranchClause('e.branch_id', params, scope.ids);
      const masterBranchClause = reportBranchClause('me.branch_id', params, scope.ids);

      const rows = await query(
        `SELECT * FROM (
           SELECT
             'COURSE' AS type,
             c.id AS course_id,
             c.name AS course_name,
             b.name AS branch_name,
             COUNT(e.id) AS enrollment_count,
             COUNT(e.id) FILTER (WHERE e.status = 'ACTIVE') AS active_count,
             -- Real collected revenue, net of refunds: up-front enrollment money
             -- plus monthly bills and per-session money paid in the range. The
             -- old SUM(amount_paid) alone showed the course price for one-time
             -- enrollments and 0 for monthly/per-session courses.
             COALESCE(SUM(e.amount_paid), 0)
               + COALESCE((SELECT SUM(msp.amount_paid) FROM monthly_subscription_payments msp
                   WHERE msp.course_id = c.id AND msp.company_id = $1 AND msp.amount_paid > 0
                     AND msp.paid_date >= $2 AND msp.paid_date <= $3), 0)
               + COALESCE((SELECT SUM(sp.amount_paid) FROM session_payments sp
                   WHERE sp.course_id = c.id AND sp.company_id = $1 AND sp.amount_paid > 0
                     AND COALESCE(sp.paid_date, sp.created_at::date) >= $2
                     AND COALESCE(sp.paid_date, sp.created_at::date) <= $3), 0)
               + COALESCE((SELECT SUM(spkg.amount_paid) FROM session_packages spkg
                   WHERE spkg.course_id = c.id AND spkg.company_id = $1 AND spkg.amount_paid > 0
                     AND spkg.purchased_at::date >= $2 AND spkg.purchased_at::date <= $3), 0)
               - COALESCE((SELECT SUM(r.amount) FROM refunds r
                   JOIN enrollments e2 ON r.enrollment_id = e2.id
                   WHERE r.company_id = $1 AND e2.course_id = c.id
                     AND r.refund_date >= $2 AND r.refund_date <= $3), 0) AS revenue
           FROM enrollments e
           INNER JOIN courses c ON c.id = e.course_id
           INNER JOIN branches b ON b.id = e.branch_id
           WHERE e.company_id = $1
             AND e.enrollment_date >= $2 AND e.enrollment_date <= $3 ${courseBranchClause}
           GROUP BY c.id, c.name, b.name

           UNION ALL

           SELECT
             'MASTER' AS type,
             mc.id AS course_id,
             mc.name AS course_name,
             b.name AS branch_name,
             COUNT(me.id) AS enrollment_count,
             COUNT(me.id) FILTER (WHERE me.status = 'ACTIVE') AS active_count,
             COALESCE(SUM(me.amount_paid), 0)
               - COALESCE((SELECT SUM(r.amount) FROM refunds r
                   JOIN master_enrollments me2 ON r.master_enrollment_id = me2.id
                   WHERE r.company_id = $1 AND me2.master_course_id = mc.id
                     AND r.refund_date >= $2 AND r.refund_date <= $3), 0) AS revenue
           FROM master_enrollments me
           INNER JOIN master_courses mc ON mc.id = me.master_course_id
           INNER JOIN branches b ON b.id = me.branch_id
           WHERE me.company_id = $1
             AND me.enrollment_date >= $2 AND me.enrollment_date <= $3 ${masterBranchClause}
           GROUP BY mc.id, mc.name, b.name
         ) combined
         ORDER BY enrollment_count DESC, revenue DESC
         LIMIT 20`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          type: r.type,
          courseId: r.course_id,
          courseName: r.course_name,
          branchName: r.branch_name,
          enrollmentCount: parseInt(r.enrollment_count, 10),
          activeCount: parseInt(r.active_count, 10),
          revenue: parseFloat(r.revenue),
        })),
      };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.TOP_COURSES_FAILED', 'Failed to compute top courses');
    }
  },

  // New + churned students per month.
  studentsOverTime: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('s.branch_id', params, scope.ids);

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
           SELECT date_trunc('month', s.inactive_date)::date AS m, COUNT(*) AS cnt
           FROM students s
           INNER JOIN branches b ON b.id = s.branch_id
           WHERE b.company_id = $1
             AND s.inactive_date IS NOT NULL
             AND s.inactive_date >= $2 AND s.inactive_date <= $3 ${branchClause}
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
      return handleError(error, 'ERRORS.REPORTS.STUDENTS_OVER_TIME_FAILED', 'Failed to compute students over time');
    }
  },

  // Churn: % of active students with no enrollment activity in the last N months.
  studentChurn: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;

      // Snapshot the student body AS OF the end of the selected range ($3), with
      // "left" measured within the range [$2, $3]. This makes the top date filter
      // drive the report (e.g. picking an earlier end date shows who was active
      // back then, before later classes finished). See the shared predicate
      // definitions above `reportsRoutes` for the exact semantics.
      const { startDate, endDate } = defaultRange(q);
      const activeEnrollmentExists = ACTIVE_ENROLLMENT_EXISTS;
      const presentAsOfEnd = PRESENT_AS_OF_END;
      const leftInRange = LEFT_IN_RANGE;

      const countParams: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('s.branch_id', countParams, scope.ids);
      const counts = await query(
        `SELECT
           COUNT(*) FILTER (WHERE ${leftInRange}) AS inactive,
           COUNT(*) FILTER (
             WHERE ${presentAsOfEnd} AND ${activeEnrollmentExists}
           ) AS active,
           COUNT(*) FILTER (
             WHERE ${presentAsOfEnd} AND NOT ${activeEnrollmentExists}
           ) AS dormant
         FROM students s
         INNER JOIN branches b ON b.id = s.branch_id
         WHERE b.company_id = $1 ${branchClause}`,
        countParams
      );

      const active = parseInt(counts[0]?.active || '0', 10);
      const dormant = parseInt(counts[0]?.dormant || '0', 10);
      const inactive = parseInt(counts[0]?.inactive || '0', 10);
      // totalStudents is the body present as of the end date — active + dormant.
      // Students who left are reported separately and excluded from the total.
      const total = active + dormant;
      const cohort = total + inactive;
      // Leave rate: share of the period cohort (present + left) that left.
      const inactiveRate = cohort > 0 ? (inactive / cohort) * 100 : 0;
      // Dormancy rate: share of the present body that has no running-class enrollment.
      const dormancyRate = total > 0 ? (dormant / total) * 100 : 0;

      return {
        status: 200 as const,
        body: {
          totalStudents: total,
          activeStudents: active,
          dormantStudents: dormant,
          inactiveStudents: inactive,
          inactiveRate: Math.round(inactiveRate * 100) / 100,
          dormancyRate: Math.round(dormancyRate * 100) / 100,
        },
      };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.CHURN_FAILED', 'Failed to compute churn');
    }
  },

  // Revenue per course. Includes both regular courses and master-course
  // bundles — bundles appear as rows with type='MASTER'.
  profitByCourse: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      // Revenue subqueries reference the lazily-created per-session tables.
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const courseBranchClause = reportBranchClause('c.branch_id', params, scope.ids);
      const masterBranchClause = reportBranchClause('mc.branch_id', params, scope.ids);

      const rows = await query(
        `SELECT * FROM (
           SELECT
             'COURSE' AS type,
             c.id AS course_id,
             c.name AS course_name,
             b.name AS branch_name,
             COUNT(e.id) AS enrollments,
             -- Real collected revenue, net of refunds (see topCourses).
             COALESCE(SUM(e.amount_paid), 0)
               + COALESCE((SELECT SUM(msp.amount_paid) FROM monthly_subscription_payments msp
                   WHERE msp.course_id = c.id AND msp.company_id = $1 AND msp.amount_paid > 0
                     AND msp.paid_date >= $2 AND msp.paid_date <= $3), 0)
               + COALESCE((SELECT SUM(sp.amount_paid) FROM session_payments sp
                   WHERE sp.course_id = c.id AND sp.company_id = $1 AND sp.amount_paid > 0
                     AND COALESCE(sp.paid_date, sp.created_at::date) >= $2
                     AND COALESCE(sp.paid_date, sp.created_at::date) <= $3), 0)
               + COALESCE((SELECT SUM(spkg.amount_paid) FROM session_packages spkg
                   WHERE spkg.course_id = c.id AND spkg.company_id = $1 AND spkg.amount_paid > 0
                     AND spkg.purchased_at::date >= $2 AND spkg.purchased_at::date <= $3), 0)
               - COALESCE((SELECT SUM(r.amount) FROM refunds r
                   JOIN enrollments e2 ON r.enrollment_id = e2.id
                   WHERE r.company_id = $1 AND e2.course_id = c.id
                     AND r.refund_date >= $2 AND r.refund_date <= $3), 0) AS revenue,
             COALESCE(AVG(e.final_price), 0) AS avg_price,
             -- The unit the price is charged in (per course / month / session).
             COALESCE(c.payment_type, 'ONE_TIME') AS payment_type
           FROM courses c
           INNER JOIN branches b ON b.id = c.branch_id
           LEFT JOIN enrollments e ON e.course_id = c.id
             AND e.company_id = $1
             AND e.enrollment_date >= $2 AND e.enrollment_date <= $3
           WHERE b.company_id = $1 ${courseBranchClause}
           GROUP BY c.id, c.name, b.name, c.payment_type

           UNION ALL

           SELECT
             'MASTER' AS type,
             mc.id AS course_id,
             mc.name AS course_name,
             b.name AS branch_name,
             COUNT(me.id) AS enrollments,
             COALESCE(SUM(me.amount_paid), 0)
               - COALESCE((SELECT SUM(r.amount) FROM refunds r
                   JOIN master_enrollments me2 ON r.master_enrollment_id = me2.id
                   WHERE r.company_id = $1 AND me2.master_course_id = mc.id
                     AND r.refund_date >= $2 AND r.refund_date <= $3), 0) AS revenue,
             COALESCE(AVG(me.final_price), 0) AS avg_price,
             'ONE_TIME' AS payment_type
           FROM master_courses mc
           INNER JOIN branches b ON b.id = mc.branch_id
           LEFT JOIN master_enrollments me ON me.master_course_id = mc.id
             AND me.company_id = $1
             AND me.enrollment_date >= $2 AND me.enrollment_date <= $3
           WHERE b.company_id = $1 ${masterBranchClause}
           GROUP BY mc.id, mc.name, b.name
         ) combined
         -- Keep a course visible when it collected money in the range even with
         -- no NEW enrollments (monthly/per-session renewals), and vice versa.
         WHERE enrollments > 0 OR revenue <> 0
         ORDER BY revenue DESC
         LIMIT 50`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          type: r.type,
          courseId: r.course_id,
          courseName: r.course_name,
          branchName: r.branch_name,
          enrollments: parseInt(r.enrollments, 10),
          revenue: parseFloat(r.revenue),
          avgPrice: parseFloat(r.avg_price),
          paymentType: r.payment_type || 'ONE_TIME',
        })),
      };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.PROFIT_BY_COURSE_FAILED', 'Failed to compute profit by course');
    }
  },

  // Profit per branch: revenue (enrollments + products - refunds) − branch expenses.
  profitByBranch: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchScopeClause = reportBranchClause('b.id', params, scope.ids);

      const rows = await query(
        `SELECT
           b.id AS branch_id,
           b.name AS branch_name,
           b.code AS branch_code,
           COALESCE((
             SELECT SUM(e.amount_paid) FROM enrollments e
             WHERE e.branch_id = b.id AND e.company_id = $1
               AND e.payment_status IN ('PAID','PARTIAL','REFUNDED')
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
             SELECT SUM(msp.amount_paid) FROM monthly_subscription_payments msp
             WHERE msp.branch_id = b.id AND msp.company_id = $1
               AND msp.amount_paid > 0
               AND msp.paid_date >= $2 AND msp.paid_date <= $3
           ), 0) AS subscription_revenue,
           -- Per-session revenue: prepaid packages + pay-as-you-go charges
           COALESCE((
             SELECT SUM(spkg.amount_paid) FROM session_packages spkg
             WHERE spkg.branch_id = b.id AND spkg.company_id = $1
               AND spkg.amount_paid > 0
               AND spkg.purchased_at::date >= $2 AND spkg.purchased_at::date <= $3
           ), 0) + COALESCE((
             SELECT SUM(sp.amount_paid) FROM session_payments sp
             WHERE sp.branch_id = b.id AND sp.company_id = $1
               AND sp.amount_paid > 0
               AND COALESCE(sp.paid_date, sp.created_at::date) >= $2
               AND COALESCE(sp.paid_date, sp.created_at::date) <= $3
           ), 0) AS session_revenue,
           -- Refunds attributable to this branch. Most refunds have a NULL
           -- branch_id and are linked via enrollment / master enrollment /
           -- product sale / event subscription, so attribute through those
           -- links and only fall back to the refund's own branch_id. Matching
           -- solely on rf.branch_id missed almost all refunds, so branch net
           -- profit was overstated.
           COALESCE((
             SELECT SUM(rf.amount) FROM refunds rf
             LEFT JOIN enrollments e2 ON rf.enrollment_id = e2.id
             LEFT JOIN master_enrollments me2 ON rf.master_enrollment_id = me2.id
             LEFT JOIN product_sales ps2 ON rf.product_sale_id = ps2.id
             LEFT JOIN event_subscriptions es2 ON rf.subscription_id = es2.id
             WHERE rf.company_id = $1
               AND rf.refund_date >= $2 AND rf.refund_date <= $3
               AND COALESCE(e2.branch_id, me2.branch_id, ps2.branch_id, es2.branch_id, rf.branch_id) = b.id
           ), 0) AS refunds,
           COALESCE((
             SELECT SUM(ep.amount) FROM expense_payments ep
             WHERE ep.branch_id = b.id AND ep.company_id = $1
               AND ep.date >= $2 AND ep.date <= $3
           ), 0) AS expenses,
           -- Student counts use the same definitions as the Students tab (churn):
           -- active = enrolled in a class running as of the end date, dormant =
           -- present but with no running enrollment, left = deactivated in range.
           (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id
              AND ${PRESENT_AS_OF_END} AND ${ACTIVE_ENROLLMENT_EXISTS}) AS active_students,
           (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id
              AND ${PRESENT_AS_OF_END} AND NOT ${ACTIVE_ENROLLMENT_EXISTS}) AS dormant_students,
           (SELECT COUNT(*) FROM students s WHERE s.branch_id = b.id
              AND ${LEFT_IN_RANGE}) AS left_students
         FROM branches b
         WHERE b.company_id = $1 ${branchScopeClause}
         ORDER BY enrollment_revenue DESC`,
        params
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const enrollmentRevenue = parseFloat(r.enrollment_revenue);
          const productRevenue = parseFloat(r.product_revenue);
          const masterRevenue = parseFloat(r.master_revenue);
          // Subscription and per-session revenue are folded into the branch total
          // (no separate response field) so branch revenue/profit reconciles with
          // the P&L.
          const subscriptionRevenue = parseFloat(r.subscription_revenue);
          const sessionRevenue = parseFloat(r.session_revenue);
          const refunds = parseFloat(r.refunds);
          const expenses = parseFloat(r.expenses);
          const revenue = enrollmentRevenue + productRevenue + masterRevenue + subscriptionRevenue + sessionRevenue - refunds;
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
            dormantStudents: parseInt(r.dormant_students, 10),
            leftStudents: parseInt(r.left_students, 10),
          };
        }),
      };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.PROFIT_BY_BRANCH_FAILED', 'Failed to compute profit by branch');
    }
  },

  // Profit per product: (selling − cost) × units sold in window.
  profitByProduct: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('p.branch_id', params, scope.ids);

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
      return handleError(error, 'ERRORS.REPORTS.PROFIT_BY_PRODUCT_FAILED', 'Failed to compute profit by product');
    }
  },

  // Expense breakdown by category (for donut chart).
  expensesByCategory: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('branch_id', params, scope.ids);

      const rows = await query(
        `SELECT category, SUM(amount) AS total, COUNT(*) AS count
         FROM expense_payments
         WHERE company_id = $1 AND date >= $2 AND date <= $3 ${branchClause}
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
      return handleError(error, 'ERRORS.REPORTS.EXPENSES_BY_CATEGORY_FAILED', 'Failed to compute expenses by category');
    }
  },

  // Per-event P&L within a date range.
  // An event appears if either its scheduled dates overlap the range OR it had
  // any subscription / expense / refund / product-sale activity in the range —
  // so a long-running event keeps showing up while only the in-range financials
  // are aggregated.
  profitByEvent: async ({ query: q, headers }: { query: RangeQuery; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'reports', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { startDate, endDate } = defaultRange(q);
      const scope = resolveBranchScope(context, q.branchId);
      if (!scope.ok) return scope.error;
      const params: any[] = [context.companyId, startDate, endDate];
      const branchClause = reportBranchClause('e.branch_id', params, scope.ids);

      const rows = await query(
        `SELECT
           e.id,
           e.name,
           e.event_type,
           e.status,
           e.start_date,
           e.end_date,
           e.branch_id,
           b.name AS branch_name,
           COALESCE(rev.total, 0) AS revenue,
           COALESCE(rev.count, 0) AS subscriber_count,
           COALESCE(exp.total, 0) AS expenses,
           COALESCE(exp.count, 0) AS expense_count,
           COALESCE(ref.total, 0) AS refunds,
           COALESCE(ref.count, 0) AS refund_count,
           COALESCE(prod.revenue, 0) AS product_revenue,
           COALESCE(prod.cost, 0) AS product_cost
         FROM events e
         LEFT JOIN branches b ON b.id = e.branch_id
         LEFT JOIN (
           SELECT event_id, SUM(amount) AS total, COUNT(*) AS count
           FROM event_subscriptions
           WHERE company_id = $1
             AND payment_date BETWEEN $2 AND $3
           GROUP BY event_id
         ) rev ON rev.event_id = e.id
         LEFT JOIN (
           SELECT COALESCE(ep.event_id, ex.event_id) AS event_id,
                  SUM(ep.amount) AS total,
                  COUNT(*) AS count
           FROM expense_payments ep
           LEFT JOIN expenses ex ON ex.id = ep.expense_id
           WHERE ep.company_id = $1
             AND ep.date BETWEEN $2 AND $3
             AND (ep.event_id IS NOT NULL OR ex.event_id IS NOT NULL)
           GROUP BY COALESCE(ep.event_id, ex.event_id)
         ) exp ON exp.event_id = e.id
         LEFT JOIN (
           SELECT event_id, SUM(amount) AS total, COUNT(*) AS count
           FROM refunds
           WHERE company_id = $1
             AND event_id IS NOT NULL
             AND refund_date BETWEEN $2 AND $3
           GROUP BY event_id
         ) ref ON ref.event_id = e.id
         LEFT JOIN (
           SELECT ps.event_id,
                  SUM(ps.total_amount) AS revenue,
                  SUM(COALESCE(p.cost_price, 0) * ps.quantity) AS cost
           FROM product_sales ps
           LEFT JOIN products p ON p.id = ps.product_id
           WHERE ps.company_id = $1
             AND ps.event_id IS NOT NULL
             AND ps.sale_date BETWEEN $2 AND $3
           GROUP BY ps.event_id
         ) prod ON prod.event_id = e.id
         WHERE e.company_id = $1
           AND (
             (COALESCE(e.start_date, e.created_at::date) <= $3
              AND COALESCE(e.end_date, e.start_date, e.created_at::date) >= $2)
             OR rev.event_id IS NOT NULL
             OR exp.event_id IS NOT NULL
             OR ref.event_id IS NOT NULL
             OR prod.event_id IS NOT NULL
           )
           ${branchClause}
         ORDER BY COALESCE(e.start_date, e.created_at::date) DESC, e.name ASC`,
        params
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const revenue = parseFloat(r.revenue);
          const expenses = parseFloat(r.expenses);
          const refunds = parseFloat(r.refunds);
          const productRevenue = parseFloat(r.product_revenue);
          const productCost = parseFloat(r.product_cost);
          const productMargin = productRevenue - productCost;
          return {
            eventId: r.id,
            name: r.name,
            eventType: r.event_type,
            status: r.status,
            startDate: r.start_date,
            endDate: r.end_date,
            branchId: r.branch_id,
            branchName: r.branch_name,
            subscriberCount: parseInt(r.subscriber_count, 10),
            revenue,
            expenses,
            expenseCount: parseInt(r.expense_count, 10),
            refunds,
            refundCount: parseInt(r.refund_count, 10),
            productRevenue,
            productCost,
            productMargin,
            netProfit: revenue + productMargin - expenses - refunds,
          };
        }),
      };
    } catch (error) {
      return handleError(error, 'ERRORS.REPORTS.PROFIT_BY_EVENT_FAILED', 'Failed to compute profit by event');
    }
  },
};
