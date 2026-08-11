import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { mapPaymentFromDB } from './expense-payments';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureFreeSessionSchema } from './sessions';

// Idempotent guard — ensures the session-based salary columns exist even on a
// DB that hasn't had migration 037 applied yet (mirrors ensureExamTables).
let salaryColumnsEnsured = false;
export async function ensureSalaryColumns(): Promise<void> {
  if (salaryColumnsEnsured) return;
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS session_rate DECIMAL(10, 2)`);
  // PERCENTAGE salary type (migration 051): a % of what students have PAID for
  // the teacher's classes. Add the rate column and widen the salary_type CHECK.
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS percentage_rate DECIMAL(5, 2)`);
  // The probe names the NEWEST value in the list — UNPAID today, PERCENTAGE
  // before it. A database that already had the PERCENTAGE constraint would
  // otherwise be judged up to date and reject the value added after it.
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'employees_salary_type_check'
          AND pg_get_constraintdef(oid) LIKE '%UNPAID%'
      ) THEN
        ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_salary_type_check;
        ALTER TABLE employees ADD CONSTRAINT employees_salary_type_check
          CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED', 'PERCENTAGE', 'UNPAID'));
      END IF;
    END $$;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS session_salary_payments (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id)        ON DELETE CASCADE,
      employee_id UUID NOT NULL REFERENCES employees(id)        ON DELETE CASCADE,
      session_id  UUID NOT NULL REFERENCES sessions(id)         ON DELETE CASCADE,
      payment_id  UUID NOT NULL REFERENCES expense_payments(id) ON DELETE CASCADE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, session_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_employee ON session_salary_payments(employee_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_payment  ON session_salary_payments(payment_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_session  ON session_salary_payments(session_id)`);
  salaryColumnsEnsured = true;
}

// Session ids an employee was PRESENT for within [monthStart, monthEnd] that
// have NOT yet been covered by a salary payment. These are what's owed now.
//
// Free (trial) sessions are excluded: they bill no student, so there is no
// revenue for a per-session fee to come out of. A PERCENTAGE teacher already
// earns nothing from one for the same reason — their accrual is a share of money
// actually paid — so this keeps both salary types consistent.
async function getUnpaidSessionIds(
  companyId: string,
  employeeId: string,
  monthStart: string,
  monthEnd: string,
): Promise<string[]> {
  await ensureFreeSessionSchema();
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT s.id
     FROM session_teacher_attendance sta
     JOIN sessions s ON s.id = sta.session_id
     WHERE s.company_id = $1
       AND sta.employee_id = $2
       AND sta.status = 'PRESENT'
       AND s.is_free = FALSE
       AND s.start_date::date >= $3
       AND s.start_date::date <= $4
       AND NOT EXISTS (
         SELECT 1 FROM session_salary_payments ssp
         WHERE ssp.session_id = s.id AND ssp.employee_id = $2
       )`,
    [companyId, employeeId, monthStart, monthEnd],
  );
  return rows.map((r) => r.id);
}

// ── PERCENTAGE salary accrual (migration 051) ───────────────────────────────
// A PERCENTAGE teacher earns `percentage_rate`% of the net money students have
// actually PAID for the classes they teach (classes.instructor_id = employee).
// Earnings accrue live as payments arrive; the teacher can withdraw the balance
// any time (like SESSION_BASED). No ledger table is needed because the accrual
// is a running monetary sum, not a set of discrete units:
//   owed = accrued(percentage% of total paid) − base already withdrawn.

/** What one course brought in for this teacher, and the rate that applies to it. */
export interface TeacherCourseEarning {
  courseId: string | null;
  courseName: string | null;
  paid: number;
  /** The per-course rate when one is set, otherwise the employee's global rate. */
  rate: number;
  /** True when `rate` came from a per-course arrangement rather than the global. */
  isOverride: boolean;
  accrued: number;
}

// Net amount students have PAID for this employee's classes, BROKEN DOWN BY
// COURSE, summed over all payment models. Per course, because the rate is no
// longer necessarily one number: a teacher may take 90% of one course and 80% of
// another (migration 089), so the money has to be attributed before it is
// multiplied. The per-session tables are optional (created lazily per tenant), so
// guard them with to_regclass before referencing them.
async function getTeacherPaidByCourse(
  companyId: string,
  employeeId: string,
): Promise<Array<{ courseId: string | null; courseName: string | null; paid: number }>> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
            to_regclass('public.session_payments')            IS NOT NULL AS has_sp,
            to_regclass('public.session_packages')            IS NOT NULL AS has_spkg`
  );

  // ONE_TIME enrollments carry class_id directly; refunds net out via total_refunded.
  const parts: string[] = [
    `SELECT cl.course_id, COALESCE(SUM(COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0)), 0) AS amt
       FROM enrollments e
       JOIN classes cl ON cl.id = e.class_id
      WHERE cl.instructor_id = $2 AND e.company_id = $1
      GROUP BY cl.course_id`,
  ];
  // MONTHLY_SUBSCRIPTION and PER_SESSION tables lack class_id → reach it through
  // enrollment_id → enrollments.class_id. COVERED session rows carry amount_paid=0
  // (their money sits on the package row), so summing both never double-counts.
  if (reg?.has_msp) {
    parts.push(`SELECT cl.course_id, COALESCE(SUM(COALESCE(msp.amount_paid,0)), 0) AS amt
       FROM monthly_subscription_payments msp
       JOIN enrollments e ON e.id = msp.enrollment_id
       JOIN classes cl ON cl.id = e.class_id
      WHERE cl.instructor_id = $2 AND e.company_id = $1
      GROUP BY cl.course_id`);
  }
  if (reg?.has_sp) {
    parts.push(`SELECT cl.course_id, COALESCE(SUM(COALESCE(sp.amount_paid,0)), 0) AS amt
       FROM session_payments sp
       JOIN enrollments e ON e.id = sp.enrollment_id
       JOIN classes cl ON cl.id = e.class_id
      WHERE cl.instructor_id = $2 AND e.company_id = $1
      GROUP BY cl.course_id`);
  }
  if (reg?.has_spkg) {
    parts.push(`SELECT cl.course_id, COALESCE(SUM(COALESCE(spkg.amount_paid,0)), 0) AS amt
       FROM session_packages spkg
       JOIN enrollments e ON e.id = spkg.enrollment_id
       JOIN classes cl ON cl.id = e.class_id
      WHERE cl.instructor_id = $2 AND e.company_id = $1
      GROUP BY cl.course_id`);
  }

  const rows = await query(
    `WITH paid AS (${parts.join(' UNION ALL ')})
     SELECT p.course_id, co.name AS course_name, SUM(p.amt) AS paid
       FROM paid p
       LEFT JOIN courses co ON co.id = p.course_id
      GROUP BY p.course_id, co.name
      HAVING SUM(p.amt) <> 0
      ORDER BY co.name NULLS LAST`,
    [companyId, employeeId],
  );
  return (rows as any[]).map((r) => ({
    courseId: r.course_id ?? null,
    courseName: r.course_name ?? null,
    paid: parseFloat(r.paid || 0),
  }));
}

/** The teacher's per-course rates, keyed by course. Absent = use the global. */
async function getCoursePercentageRates(
  companyId: string,
  employeeId: string,
): Promise<Map<string, number>> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.employee_course_percentages') IS NOT NULL AS has_table`
  );
  if (!reg?.has_table) return new Map();
  const rows = await query(
    `SELECT course_id, percentage_rate FROM employee_course_percentages
      WHERE company_id = $1 AND employee_id = $2`,
    [companyId, employeeId],
  );
  return new Map((rows as any[]).map((r) => [r.course_id as string, parseFloat(r.percentage_rate)]));
}

/**
 * What the teacher has earned, course by course.
 *
 * Each course's money is multiplied by its OWN rate — the per-course one where
 * an arrangement exists, the global rate everywhere else. With no per-course
 * rows this is exactly the old `total × global%`, which is what keeps every
 * existing percentage teacher on the same number as before.
 */
async function getTeacherEarnings(
  companyId: string,
  employeeId: string,
  globalRate: number,
): Promise<{ totalPaid: number; accrued: number; byCourse: TeacherCourseEarning[] }> {
  const [paidByCourse, overrides] = await Promise.all([
    getTeacherPaidByCourse(companyId, employeeId),
    getCoursePercentageRates(companyId, employeeId),
  ]);

  let totalPaid = 0;
  let accrued = 0;
  const byCourse: TeacherCourseEarning[] = paidByCourse.map((c) => {
    const override = c.courseId ? overrides.get(c.courseId) : undefined;
    const rate = override ?? globalRate;
    // Rounded per course, so the payslip's lines add up to its total exactly.
    const courseAccrued = Math.round(c.paid * rate) / 100;
    totalPaid += c.paid;
    accrued += courseAccrued;
    return {
      courseId: c.courseId,
      courseName: c.courseName,
      paid: c.paid,
      rate,
      isOverride: override !== undefined,
      accrued: courseAccrued,
    };
  });

  return {
    totalPaid: Math.round(totalPaid * 100) / 100,
    accrued: Math.round(accrued * 100) / 100,
    byCourse,
  };
}

// Base salary already withdrawn = the pre-bonus, pre-discount portion of past
// SALARIES payments (amount − bonus + discount). Bonuses don't reduce future
// accrual; discounts do (they mean less was actually drawn against earnings).
async function getWithdrawnSalaryBase(companyId: string, employeeId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(bonus_amount,0) + COALESCE(discount_amount,0)), 0) AS base
     FROM expense_payments
     WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'`,
    [companyId, employeeId]
  );
  return row && row.base != null ? parseFloat(row.base) : 0;
}

// The individual student payments behind getTeacherPaidTotal, so the accrual can
// be audited line by line instead of taken on trust. Same four sources, same
// joins and filters — if you change one, change the other or the lines stop
// adding up to the total.
//
// `window` narrows to the money that funded ONE withdrawal: (after, upTo]. Rows
// with no date are dropped there — they can't be placed in a window — which is
// why the unwindowed call keeps NULLS LAST instead of filtering them out.
async function getTeacherPaidLines(
  companyId: string,
  employeeId: string,
  window?: { after: string | null; upTo: string },
): Promise<any[]> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
            to_regclass('public.session_payments')            IS NOT NULL AS has_sp,
            to_regclass('public.session_packages')            IS NOT NULL AS has_spkg`
  );

  const parts: string[] = [
    `SELECT s.name AS student_name, c.name AS class_name, co.name AS course_name,
            'ENROLLMENT' AS source,
            (COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0)) AS amount,
            e.enrollment_date::date AS paid_at
       FROM enrollments e
       JOIN classes  c  ON c.id = e.class_id
       JOIN students s  ON s.id = e.student_id
       LEFT JOIN courses co ON co.id = c.course_id
      WHERE c.instructor_id = $2 AND e.company_id = $1
        AND (COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0)) <> 0`,
  ];
  // COVERED per-session rows carry amount_paid = 0 (the money sits on the
  // package row), so the <> 0 filter also keeps them from showing as noise.
  if (reg?.has_msp) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'MONTHLY', COALESCE(msp.amount_paid,0),
              COALESCE(msp.paid_date, msp.created_at::date)
         FROM monthly_subscription_payments msp
         JOIN enrollments e ON e.id = msp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = msp.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(msp.amount_paid,0) <> 0`
    );
  }
  if (reg?.has_sp) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'SESSION', COALESCE(sp.amount_paid,0),
              COALESCE(sp.paid_date, sp.created_at::date)
         FROM session_payments sp
         JOIN enrollments e ON e.id = sp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = sp.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(sp.amount_paid,0) <> 0`
    );
  }
  if (reg?.has_spkg) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'PACKAGE', COALESCE(spkg.amount_paid,0),
              spkg.created_at::date
         FROM session_packages spkg
         JOIN enrollments e ON e.id = spkg.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = spkg.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(spkg.amount_paid,0) <> 0`
    );
  }

  const union = parts.join(' UNION ALL ');
  if (!window) {
    return query<any>(`${union} ORDER BY paid_at DESC NULLS LAST, student_name`, [companyId, employeeId]);
  }
  return query<any>(
    `SELECT * FROM (${union}) x
      WHERE x.paid_at IS NOT NULL
        AND x.paid_at <= $4::date
        AND ($3::date IS NULL OR x.paid_at > $3::date)
      ORDER BY x.paid_at DESC, x.student_name`,
    [companyId, employeeId, window.after, window.upTo]
  );
}

// The mirror image of getTeacherPaidLines: students who ATTENDED this teacher's
// classes and still owe for it. None of this is in `accrued` — a percentage is
// taken on money received, not money billed — so it reads as what the teacher
// stands to earn once the office collects, never as pay already due.
//
// "Attended" is proven per billing model, because each stores it differently:
//   • PER_SESSION — the pending charge IS the attendance (attendance raised it)
//   • MONTHLY     — an unpaid month they actually showed up in
//   • ONE_TIME    — a part-paid enrollment they have attended at least once
// The unpaid predicates deliberately match /dues (enrollments.listDues) so the
// two screens never disagree about who owes what.
async function getTeacherUnpaidLines(companyId: string, employeeId: string): Promise<any[]> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
            to_regclass('public.session_payments')            IS NOT NULL AS has_sp`
  );

  // Attendance rows are keyed by session, so "did they attend this class" is a
  // session_attendance ⋈ sessions lookup. LATERAL + `ON att.sessions > 0` turns
  // the count into the filter as well as a displayed column.
  const parts: string[] = [
    `SELECT s.name AS student_name, c.name AS class_name, co.name AS course_name,
            'ENROLLMENT' AS source,
            (e.final_price - COALESCE(e.amount_paid,0)) AS outstanding,
            att.sessions AS attended_sessions,
            att.last_at  AS last_attended_at
       FROM enrollments e
       JOIN classes  c  ON c.id = e.class_id
       JOIN students s  ON s.id = e.student_id
       LEFT JOIN courses co ON co.id = c.course_id
       JOIN LATERAL (
         SELECT COUNT(*)::int AS sessions, MAX(se.start_date)::date AS last_at
           FROM session_attendance sa
           JOIN sessions se ON se.id = sa.session_id
          WHERE sa.student_id = e.student_id AND se.class_id = e.class_id
       ) att ON att.sessions > 0
      WHERE c.instructor_id = $2 AND e.company_id = $1
        AND e.payment_type = 'ONE_TIME'
        AND COALESCE(e.amount_paid,0) < e.final_price
        AND COALESCE(e.total_refunded,0) = 0
        AND e.status <> 'DROPPED'`,
  ];

  if (reg?.has_msp) {
    // Only months that have come due — a future month isn't owed yet, and
    // materialising one would be phantom debt.
    parts.push(
      `SELECT s.name, c.name, co.name, 'MONTHLY',
              (msp.amount_due - COALESCE(msp.amount_paid,0)),
              att.sessions, att.last_at
         FROM monthly_subscription_payments msp
         JOIN enrollments e ON e.id = msp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = msp.student_id
         LEFT JOIN courses co ON co.id = c.course_id
         JOIN LATERAL (
           SELECT COUNT(*)::int AS sessions, MAX(se.start_date)::date AS last_at
             FROM session_attendance sa
             JOIN sessions se ON se.id = sa.session_id
            WHERE sa.student_id = msp.student_id AND se.class_id = e.class_id
              AND EXTRACT(YEAR  FROM se.start_date)::int = msp.billing_year
              AND EXTRACT(MONTH FROM se.start_date)::int = msp.billing_month
         ) att ON att.sessions > 0
        WHERE c.instructor_id = $2 AND msp.company_id = $1
          AND msp.amount_due > COALESCE(msp.amount_paid,0)
          AND msp.payment_status NOT IN ('PAID', 'REFUNDED')
          AND COALESCE(msp.refunded_amount,0) = 0
          AND e.status = 'ACTIVE'
          AND (msp.billing_year * 12 + msp.billing_month)
              <= (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int)`
    );
  }
  if (reg?.has_sp) {
    // PRESENT only: an ABSENT charge (a no-show fee, where the course charges
    // for those) is money owed but not a session they sat in.
    parts.push(
      `SELECT s.name, c.name, co.name, 'SESSION',
              (sp.amount_due - COALESCE(sp.amount_paid,0)),
              1, se.start_date::date
         FROM session_payments sp
         JOIN enrollments e ON e.id = sp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = sp.student_id
         JOIN sessions se ON se.id = sp.session_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND sp.company_id = $1
          AND sp.payment_status = 'PENDING'
          AND sp.attendance_state = 'PRESENT'
          AND sp.amount_due > COALESCE(sp.amount_paid,0)
          AND COALESCE(sp.refunded_amount,0) = 0
          AND e.status = 'ACTIVE'`
    );
  }

  return query<any>(
    `${parts.join(' UNION ALL ')} ORDER BY last_attended_at DESC NULLS LAST, student_name`,
    [companyId, employeeId]
  );
}

// Full percentage picture for one employee: what they've earned so far and what
// remains to withdraw right now.
async function getPercentageSummary(
  companyId: string,
  emp: any,
): Promise<{
  percentageRate: number; totalPaid: number; accrued: number; withdrawn: number; owed: number;
  byCourse: TeacherCourseEarning[];
}> {
  // The global rate — still what most teachers are on, and the fallback for any
  // course they have no separate arrangement for.
  const percentageRate = emp.percentage_rate ? parseFloat(emp.percentage_rate) : 0;
  const { totalPaid, accrued, byCourse } = await getTeacherEarnings(companyId, emp.id, percentageRate);
  const withdrawn = await getWithdrawnSalaryBase(companyId, emp.id);
  const owed = Math.max(0, Math.round((accrued - withdrawn) * 100) / 100);
  return { percentageRate, totalPaid, accrued, withdrawn, owed, byCourse };
}

// Total PRESENT sessions for an employee in a month (paid or not) — used for
// the per-payment session count on the salary history view.

// Parse a YYYY-MM-DD string into a calendar-only date with no timezone drift.
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function fmtDate(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

interface BackPayPeriod {
  monthKey: string;       // 'YYYY-MM'
  monthLabel: string;     // 'January 2026'
  startDate: string;      // 'YYYY-MM-DD'
  endDate: string;        // 'YYYY-MM-DD'
  daysInMonth: number;
  daysWorked: number;
  proRated: boolean;
  amount: number;
}

// Build list of owed monthly periods strictly before upTo's month.
// First month is pro-rated from hireDate.day; remaining months are full.
function buildBackPayPeriods(hireDateStr: string, upToStr: string, monthlySalary: number): BackPayPeriod[] {
  const hire = parseDateOnly(hireDateStr);
  const upTo = parseDateOnly(upToStr);
  const stopYear = upTo.getUTCFullYear();
  const stopMonth = upTo.getUTCMonth();   // exclude this month — paid normally end-of-month

  const periods: BackPayPeriod[] = [];
  let year = hire.getUTCFullYear();
  let month = hire.getUTCMonth();

  while (year < stopYear || (year === stopYear && month < stopMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const isHireMonth = year === hire.getUTCFullYear() && month === hire.getUTCMonth();
    const startDay = isHireMonth ? hire.getUTCDate() : 1;
    const daysWorked = daysInMonth - startDay + 1;
    const proRated = daysWorked < daysInMonth;
    const amount = proRated
      ? Math.round((monthlySalary * daysWorked / daysInMonth) * 100) / 100
      : monthlySalary;

    periods.push({
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthLabel: new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      startDate: fmtDate(year, month, startDay),
      endDate: fmtDate(year, month, daysInMonth),
      daysInMonth,
      daysWorked,
      proRated,
      amount,
    });

    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return periods;
}

function mapExpenseFromDB(row: any) {
  const amount = parseFloat(row.amount);
  const amortizationMonths = row.amortization_months || null;
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    type: row.type,
    category: row.category,
    amount,
    description: row.description,
    date: row.date,
    isRecurring: row.is_recurring,
    distributionMethod: row.distribution_method,
    vendor: row.vendor,
    invoiceNumber: row.invoice_number,
    notes: row.notes,
    assetName: row.asset_name,
    amortizationMonths,
    monthlyAmount: amortizationMonths ? parseFloat((amount / amortizationMonths).toFixed(2)) : null,
    bonusAmount: row.bonus_amount ? parseFloat(row.bonus_amount) : 0,
    discountAmount: row.discount_amount ? parseFloat(row.discount_amount) : 0,
    adjustmentReason: row.adjustment_reason || null,
    eventId: row.event_id || null,
    totalPaid: row.total_paid !== undefined ? parseFloat(row.total_paid) || 0 : undefined,
    lastPaymentDate: row.last_payment_date || null,
    paymentCount: row.payment_count !== undefined ? parseInt(row.payment_count) || 0 : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expensesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // If linked to an event, derive branch from the event automatically.
      // Event branch is the source of truth — explicit branchId is ignored when eventId is set.
      let resolvedBranchId: string | null = body.branchId || null;
      if (body.eventId) {
        const event = await queryOne(
          'SELECT branch_id, status FROM events WHERE id = $1 AND company_id = $2',
          [body.eventId, context.companyId]
        );
        if (event) {
          if (event.status === 'CANCELLED') {
            return apiError(409, 'ERRORS.EVENTS.CANCELLED_NO_EXPENSES', 'Event is cancelled; no new expenses can be added');
          }
          resolvedBranchId = event.branch_id || null;
        }
      }

      const expense = await insert('expenses', {
        company_id: context.companyId,
        branch_id: resolvedBranchId,
        type: body.type,
        category: body.category,
        amount: body.amount,
        description: body.description || null,
        date: body.date,
        is_recurring: body.isRecurring || false,
        distribution_method: body.distributionMethod || null,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        notes: body.notes || null,
        asset_name: body.assetName || null,
        amortization_months: body.type === 'CAPITAL' ? (body.amortizationMonths || null) : null,
        event_id: body.eventId || null,
      });

      return {
        status: 201 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Create expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.CREATE_FAILED', 'Failed to create expense', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string; type?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `SELECT e.*,
        COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
        (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
        (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
        FROM expenses e WHERE e.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchClause) sql += ` AND (${branchClause} OR e.branch_id IS NULL)`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND e.date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND e.date <= $${params.length}`;
      }

      if (queryParams.isRecurring !== undefined) {
        params.push(queryParams.isRecurring === 'true');
        sql += ` AND e.is_recurring = $${params.length}`;
      }

      if (queryParams.category) {
        params.push(queryParams.category);
        sql += ` AND e.category = $${params.length}`;
      }

      if (queryParams.type) {
        params.push(queryParams.type);
        sql += ` AND e.type = $${params.length}`;
      }

      sql += ' ORDER BY e.date DESC, e.created_at DESC';

      const expenses = await query(sql, params);
      return {
        status: 200 as const,
        body: expenses.map(mapExpenseFromDB),
      };
    } catch (error) {
      console.error('List expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.LIST_FAILED', 'Failed to list expenses');
    }
  },

  getDue: async ({ query: queryParams, headers }: { query: { month?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const targetMonth = queryParams.month || new Date().toISOString().substring(0, 7);
      const monthStart = targetMonth + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      // Branch admins (etc.) see dues only for their assigned branches plus
      // the global (NULL branch_id) expenses that apply company-wide.
      const recurringParams: any[] = [context.companyId, monthStart, monthEnd];
      const recurringBranchClause = appendBranchSqlFilter(context, recurringParams, 'e.branch_id');
      const recurringScope = recurringBranchClause ? ` AND (${recurringBranchClause} OR e.branch_id IS NULL)` : '';
      const recurringTemplates = await query(
        `SELECT e.*, b.name as branch_name
         FROM expenses e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_recurring = true${recurringScope}
           AND NOT EXISTS (
             SELECT 1 FROM expense_payments ep
             WHERE ep.expense_id = e.id
               AND ep.date >= $2 AND ep.date <= $3
           )`,
        recurringParams
      );

      // Employees with unpaid salary for this month (check expense_payments).
      // Employees can have NULL branch_id (cross-branch staff); include those
      // for branch admins so company-wide hires aren't silently dropped.
      const employeeParams: any[] = [context.companyId, monthStart, monthEnd];
      const employeeBranchClause = appendBranchSqlFilter(context, employeeParams, 'e.branch_id');
      const employeeScope = employeeBranchClause ? ` AND (${employeeBranchClause} OR e.branch_id IS NULL)` : '';
      // Candidates: monthly staff with a salary not yet paid this month, AND
      // session-based staff with a rate (their "due" is computed from unpaid
      // sessions below — they may reappear after a mid-month payment).
      const unpaidEmployees = await query(
        `SELECT e.*, b.name as branch_name
         FROM employees e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_active = true${employeeScope}
           AND (e.hire_date IS NULL OR e.hire_date <= $3)
           AND (
             (COALESCE(e.salary_type, 'MONTHLY') = 'MONTHLY' AND e.salary > 0
              AND NOT EXISTS (
                SELECT 1 FROM expense_payments ep
                WHERE ep.employee_id = e.id AND ep.category = 'SALARIES'
                  AND ep.date >= $2 AND ep.date <= $3
              ))
             OR (e.salary_type = 'SESSION_BASED' AND e.session_rate > 0)
             OR (e.salary_type = 'PERCENTAGE' AND e.percentage_rate > 0)
           )`,
        employeeParams
      );

      // For session-based employees the amount = UNPAID present sessions × rate.
      const salaryItems: any[] = [];
      for (const e of unpaidEmployees as any[]) {
        const base = {
          id: e.id,
          type: 'salary' as const,
          label: `Salary: ${e.first_name} ${e.last_name}`,
          category: 'SALARIES',
          branchId: e.branch_id,
          branchName: e.branch_name,
          templateId: null,
          employeeId: e.id,
        };
        if (e.salary_type === 'SESSION_BASED') {
          const rate = e.session_rate ? parseFloat(e.session_rate) : 0;
          const unpaidIds = await getUnpaidSessionIds(context.companyId, e.id, monthStart, monthEnd);
          const amount = unpaidIds.length * rate;
          if (amount > 0) {
            salaryItems.push({ ...base, amount, salaryType: 'SESSION_BASED', sessionCount: unpaidIds.length, sessionRate: rate });
          }
        } else if (e.salary_type === 'PERCENTAGE') {
          // Owed = accrued (percentage of paid) − already withdrawn; withdraw any time.
          const { percentageRate, owed } = await getPercentageSummary(context.companyId, e);
          if (owed > 0) {
            salaryItems.push({ ...base, amount: owed, salaryType: 'PERCENTAGE', percentageRate });
          }
        } else {
          salaryItems.push({ ...base, amount: parseFloat(e.salary), salaryType: 'MONTHLY' });
        }
      }

      const items: any[] = [
        ...recurringTemplates.map((t: any) => ({
          id: t.id,
          type: 'recurring',
          label: t.description,
          amount: parseFloat(t.amount),
          category: t.category,
          branchId: t.branch_id,
          branchName: t.branch_name,
          templateId: t.id,
          employeeId: null,
        })),
        ...salaryItems,
      ];

      const totalDue = items.reduce((sum, i) => sum + i.amount, 0);

      return {
        status: 200 as const,
        body: { items, totalDue, month: targetMonth },
      };
    } catch (error) {
      console.error('Get due expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DUE_FAILED', 'Failed to get due expenses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        `SELECT e.*,
          COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
          (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
          (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
         FROM expenses e WHERE e.id = $1 AND e.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (expense.branch_id && !canAccessBranch(context, expense.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED', 'Access denied to this expense');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Get expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED_UPDATE', 'Access denied to update this expense');
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.type !== undefined) updateData.type = body.type;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.date !== undefined) updateData.date = body.date;
      if (body.isRecurring !== undefined) updateData.is_recurring = body.isRecurring;
      if (body.distributionMethod !== undefined) updateData.distribution_method = body.distributionMethod;
      if (body.vendor !== undefined) updateData.vendor = body.vendor;
      if (body.invoiceNumber !== undefined) updateData.invoice_number = body.invoiceNumber;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.eventId !== undefined) updateData.event_id = body.eventId || null;
      if (body.assetName !== undefined) updateData.asset_name = body.assetName;
      if (body.amortizationMonths !== undefined) updateData.amortization_months = body.amortizationMonths;

      const expense = await update('expenses', params.id, updateData);

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Update expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.UPDATE_FAILED', 'Failed to update expense', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      await query('DELETE FROM expense_payments WHERE expense_id = $1 AND company_id = $2', [params.id, context.companyId]);
      await query('DELETE FROM expenses WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Expense deleted successfully', code: 'EXPENSES.DELETED' } };
    } catch (error) {
      console.error('Delete expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DELETE_FAILED', 'Failed to delete expense');
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        'SELECT id FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      const payments = await query(
        'SELECT * FROM expense_payments WHERE expense_id = $1 AND company_id = $2 ORDER BY date DESC',
        [params.id, context.companyId]
      );

      return { status: 200 as const, body: payments.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get expense payments error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.GET_PAYMENTS_FAILED', 'Failed to get payments');
    }
  },

  payRecurring: async ({ params, body, headers }: { params: { id: string }; body: { date?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const template = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND is_recurring = true',
        [params.id, context.companyId]
      );

      if (!template) {
        return apiError(404, 'ERRORS.EXPENSES.RECURRING_NOT_FOUND', 'Recurring expense not found');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];

      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      const existing = await queryOne(
        `SELECT id FROM expense_payments WHERE company_id = $1 AND expense_id = $2 AND date >= $3 AND date <= $4`,
        [context.companyId, params.id, monthStart, monthEnd]
      );

      if (existing) {
        return apiError(400, 'ERRORS.EXPENSE_PAYMENTS.ALREADY_PAID_THIS_MONTH', 'This expense has already been paid for this month');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        expense_id: params.id,
        branch_id: template.branch_id,
        type: template.type,
        category: template.category,
        amount: template.amount,
        date: payDate,
        vendor: template.vendor,
        invoice_number: null,
        notes: template.notes,
        event_id: template.event_id || null,
        bonus_amount: 0,
        discount_amount: 0,
      });

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay recurring error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_RECURRING_FAILED', 'Failed to pay recurring expense');
    }
  },

  paySalaries: async ({ body, headers }: { body: { date?: string; branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      let empSql = 'SELECT * FROM employees WHERE company_id = $1 AND is_active = true AND salary > 0';
      const empParams: any[] = [context.companyId];

      if (body.branchId) {
        empParams.push(body.branchId);
        empSql += ` AND branch_id = $${empParams.length}`;
      }

      const employees = await query(empSql, empParams);

      if (employees.length === 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_EMPLOYEES', 'No active employees with salary found');
      }

      const created: any[] = [];
      const skipped: string[] = [];

      for (const emp of employees) {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );

        if (existing) {
          skipped.push(emp.first_name + ' ' + emp.last_name);
          continue;
        }

        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: parseFloat(emp.salary),
          date: payDate,
          notes: `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`,
          bonus_amount: 0,
          discount_amount: 0,
        });

        created.push(mapPaymentFromDB(payment));
      }

      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped: skipped.length,
          skippedNames: skipped,
          payments: created,
          message: `Created ${created.length} salary payment(s)${skipped.length ? `, skipped ${skipped.length} already paid` : ''}.`,
          code: 'EXPENSES.SALARIES_PAID',
        },
      };
    } catch (error) {
      console.error('Pay salaries error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARIES_FAILED', 'Failed to pay salaries');
    }
  },

  payEmployeeSalary: async ({ params, body, headers }: { params: { employeeId: string }; body: { date?: string; bonusAmount?: number; discountAmount?: number; adjustmentReason?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      const isSessionBased = emp.salary_type === 'SESSION_BASED';
      const isPercentage = emp.salary_type === 'PERCENTAGE';
      if (isSessionBased) {
        if (!emp.session_rate || parseFloat(emp.session_rate) <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no session rate configured');
        }
      } else if (isPercentage) {
        if (!emp.percentage_rate || parseFloat(emp.percentage_rate) <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no percentage rate configured');
        }
      } else if (!emp.salary || parseFloat(emp.salary) <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      // Session-based: base = UNPAID present sessions in the month × rate, and
      // multiple payments per month are allowed (one per batch of new sessions).
      // Monthly: base = salary, and only one payment per month is allowed.
      let baseSalary: number;
      let baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`;
      let unpaidSessionIds: string[] = [];
      if (isSessionBased) {
        const rate = parseFloat(emp.session_rate);
        unpaidSessionIds = await getUnpaidSessionIds(context.companyId, emp.id, monthStart, monthEnd);
        if (unpaidSessionIds.length === 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_UNPAID_SESSIONS', 'No unpaid sessions for this month');
        }
        baseSalary = unpaidSessionIds.length * rate;
        baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel} (${unpaidSessionIds.length} sessions × ${rate})`;
      } else if (isPercentage) {
        // Withdraw the currently-available balance (accrued − already withdrawn).
        // No monthly lock: pay out whatever has accrued since the last withdrawal.
        const { percentageRate, owed } = await getPercentageSummary(context.companyId, emp);
        if (owed <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_PERCENTAGE_DUE', 'No percentage earnings available to withdraw');
        }
        baseSalary = owed;
        baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel} (${percentageRate}% revenue share)`;
      } else {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );
        if (existing) {
          return apiError(400, 'ERRORS.EXPENSES.SALARY_ALREADY_PAID', `Salary already paid for ${monthLabel}`);
        }
        baseSalary = parseFloat(emp.salary);
      }
      const bonus = body.bonusAmount || 0;
      const discount = body.discountAmount || 0;
      const finalAmount = baseSalary + bonus - discount;

      if (finalAmount <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.SALARY_NON_POSITIVE', 'Final salary amount must be greater than zero');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        branch_id: emp.branch_id,
        employee_id: emp.id,
        type: 'FIXED',
        category: 'SALARIES',
        amount: finalAmount,
        date: payDate,
        notes: baseNote,
        bonus_amount: bonus,
        discount_amount: discount,
        adjustment_reason: body.adjustmentReason || null,
      });

      // Mark the covered sessions as paid (links cascade-delete if voided).
      for (const sid of unpaidSessionIds) {
        await query(
          `INSERT INTO session_salary_payments (company_id, employee_id, session_id, payment_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (employee_id, session_id) DO NOTHING`,
          [context.companyId, emp.id, sid, payment.id],
        );
      }

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay employee salary error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARY_FAILED', 'Failed to pay salary');
    }
  },

  getEmployeeSalaryHistory: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSalaryColumns();
      const emp = await queryOne(
        'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const rows = await query(
        `SELECT ep.*,
                (SELECT COUNT(*) FROM session_salary_payments ssp WHERE ssp.payment_id = ep.id) AS session_count
         FROM expense_payments ep
         WHERE ep.company_id = $1 AND ep.employee_id = $2 AND ep.category = 'SALARIES'
         ORDER BY ep.date DESC`,
        [context.companyId, params.employeeId]
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          ...mapPaymentFromDB(r),
          sessionCount: r.session_count !== null && r.session_count !== undefined ? parseInt(r.session_count, 10) : 0,
        })),
      };
    } catch (error) {
      console.error('Get employee salary history error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.SALARY_HISTORY_FAILED', 'Failed to get salary history');
    }
  },

  // Live percentage earnings for one teacher: total paid across their classes,
  // accrued share, already withdrawn, and what's available to withdraw now.
  getEmployeePercentageSummary: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const summary = await getPercentageSummary(context.companyId, emp);
      // The unpaid totals ride along here rather than inside getPercentageSummary:
      // that helper also runs per-employee on the pay-salaries list and at payout
      // time, where this extra query would be pure waste.
      const unpaidRows = await getTeacherUnpaidLines(context.companyId, emp.id);
      const unpaidTotal = Math.round(
        unpaidRows.reduce((s, r) => s + Math.max(0, r.outstanding != null ? parseFloat(r.outstanding) : 0), 0) * 100
      ) / 100;
      return {
        status: 200 as const,
        body: {
          salaryType: emp.salary_type || 'MONTHLY',
          ...summary,
          unpaidTotal,
          unpaidShare: Math.round(unpaidTotal * summary.percentageRate) / 100,
          unpaidStudents: new Set(unpaidRows.map((r) => r.student_name || '')).size,
        },
      };
    } catch (error) {
      console.error('Get employee percentage summary error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PERCENTAGE_SUMMARY_FAILED', 'Failed to get percentage summary');
    }
  },

  /**
   * GET /api/expenses/employee/:employeeId/percentage-breakdown
   * The summary plus every student payment behind it — who paid, for which
   * class, when, and the teacher's cut of each. Read-only audit of the accrual.
   */
  getEmployeePercentageBreakdown: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne<any>(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const summary = await getPercentageSummary(context.companyId, emp);
      const [rows, unpaidRows] = await Promise.all([
        getTeacherPaidLines(context.companyId, params.employeeId),
        getTeacherUnpaidLines(context.companyId, params.employeeId),
      ]);

      const unpaid = unpaidRows.map((r) => {
        const outstanding = r.outstanding != null ? Math.max(0, parseFloat(r.outstanding)) : 0;
        return {
          studentName: r.student_name || '',
          className: r.class_name ?? null,
          courseName: r.course_name ?? null,
          source: r.source,
          outstanding,
          // What this line WOULD add to the accrual once collected. Kept apart
          // from `share` on purpose — it is not earned yet.
          potentialShare: Math.round(outstanding * summary.percentageRate) / 100,
          attendedSessions: r.attended_sessions != null ? Number(r.attended_sessions) : 0,
          lastAttendedAt: r.last_attended_at ? new Date(r.last_attended_at).toISOString() : null,
        };
      });
      const unpaidTotal = Math.round(unpaid.reduce((s, u) => s + u.outstanding, 0) * 100) / 100;

      return {
        status: 200 as const,
        body: {
          salaryType: emp.salary_type || 'MONTHLY',
          ...summary,
          unpaidTotal,
          // Rounded once on the total, the same way `accrued` is — so it doesn't
          // drift from the sum of the per-line potentialShare column.
          unpaidShare: Math.round(unpaidTotal * summary.percentageRate) / 100,
          unpaid,
          lines: rows.map((r) => {
            const amount = r.amount != null ? parseFloat(r.amount) : 0;
            return {
              studentName: r.student_name || '',
              className: r.class_name ?? null,
              courseName: r.course_name ?? null,
              source: r.source,
              amount,
              // The teacher's cut of this one payment. Rounded per line, so the
              // column can drift a cent or two from `accrued` (rounded once on
              // the total) — accrued stays the figure of record.
              share: Math.round(amount * summary.percentageRate) / 100,
              paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
            };
          }),
        },
      };
    } catch (error) {
      console.error('Get employee percentage breakdown error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PERCENTAGE_SUMMARY_FAILED', 'Failed to get percentage breakdown');
    }
  },

  /**
   * GET /api/expenses/salary-payment/:paymentId/breakdown
   * How ONE salary payment in the history got to its number. What that means
   * depends on how the employee is paid, so the reply carries whichever of the
   * three shapes applies:
   *   • PERCENTAGE    — the student payments that funded this withdrawal
   *   • SESSION_BASED — the exact sessions it covered (a stored link, not a guess)
   *   • MONTHLY       — the flat salary for that month
   * Every type then shares the same last step: base + bonus − discount = paid.
   */
  getSalaryPaymentBreakdown: async ({ params, headers }: { params: { paymentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const pay = await queryOne<any>(
        `SELECT * FROM expense_payments
          WHERE id = $1 AND company_id = $2 AND category = 'SALARIES'`,
        [params.paymentId, context.companyId]
      );
      if (!pay) return apiError(404, 'ERRORS.EXPENSES.PAYMENT_NOT_FOUND', 'Salary payment not found');
      if (pay.branch_id && !canAccessBranch(context, pay.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this payment');
      }

      const emp = pay.employee_id
        ? await queryOne<any>('SELECT * FROM employees WHERE id = $1 AND company_id = $2', [pay.employee_id, context.companyId])
        : null;

      const amount = pay.amount != null ? parseFloat(pay.amount) : 0;
      const bonus = pay.bonus_amount != null ? parseFloat(pay.bonus_amount) : 0;
      const discount = pay.discount_amount != null ? parseFloat(pay.discount_amount) : 0;
      // The stored figure is the final amount; the base is recovered the same way
      // getWithdrawnSalaryBase does it, so both agree on what was really drawn.
      const baseSalary = Math.round((amount - bonus + discount) * 100) / 100;
      const payDate = typeof pay.date === 'string' ? pay.date.substring(0, 10) : new Date(pay.date).toISOString().substring(0, 10);
      const salaryType = emp?.salary_type || 'MONTHLY';

      const body: any = {
        salaryType,
        employeeName: emp ? `${emp.first_name || ''} ${emp.last_name || ''}`.trim() : '',
        payment: {
          id: pay.id,
          date: new Date(payDate).toISOString(),
          amount,
          bonusAmount: bonus,
          discountAmount: discount,
          adjustmentReason: pay.adjustment_reason ?? null,
          notes: pay.notes ?? null,
          baseSalary,
        },
        percentageRate: null,
        windowStart: null,
        windowEnd: null,
        linesTotal: 0,
        lines: [],
        sessionRate: null,
        sessions: [],
        monthLabel: new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      };

      if (emp && salaryType === 'PERCENTAGE') {
        const percentageRate = emp.percentage_rate ? parseFloat(emp.percentage_rate) : 0;
        // A withdrawal always takes the WHOLE available balance (payEmployeeSalary
        // sets base = owed), so consecutive withdrawals partition the accrual
        // exactly: this one was funded by the student money that came in after
        // the previous withdrawal. Nothing stores that link, so the window is
        // reconstructed from the payment dates — ordered by (date, created_at) so
        // two withdrawals on the same day still fall in the right order.
        const prev = await queryOne<any>(
          `SELECT date FROM expense_payments
            WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
              AND (date, created_at) < ($3::date, $4::timestamptz)
            ORDER BY date DESC, created_at DESC
            LIMIT 1`,
          [context.companyId, emp.id, payDate, pay.created_at]
        );
        const prevDate = prev?.date
          ? (typeof prev.date === 'string' ? prev.date.substring(0, 10) : new Date(prev.date).toISOString().substring(0, 10))
          : null;

        const rows = await getTeacherPaidLines(context.companyId, emp.id, { after: prevDate, upTo: payDate });
        const lines = rows.map((r) => {
          const paid = r.amount != null ? parseFloat(r.amount) : 0;
          return {
            studentName: r.student_name || '',
            className: r.class_name ?? null,
            courseName: r.course_name ?? null,
            source: r.source,
            amount: paid,
            share: Math.round(paid * percentageRate) / 100,
            paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
          };
        });

        body.percentageRate = percentageRate;
        body.windowStart = prevDate ? new Date(prevDate).toISOString() : null;
        body.windowEnd = new Date(payDate).toISOString();
        body.linesTotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
        body.lines = lines;
      } else if (emp && salaryType === 'SESSION_BASED') {
        // Which sessions this payment covered is recorded at pay time, so this
        // is the real list rather than a re-derivation that could drift.
        const rows = await query<any>(
          `SELECT se.start_date, c.name AS class_name, co.name AS course_name,
                  (SELECT COUNT(*) FROM session_attendance sa WHERE sa.session_id = se.id) AS students_present
             FROM session_salary_payments ssp
             JOIN sessions se ON se.id = ssp.session_id
             JOIN classes  c  ON c.id = se.class_id
             LEFT JOIN courses co ON co.id = c.course_id
            WHERE ssp.payment_id = $1 AND ssp.company_id = $2
            ORDER BY se.start_date`,
          [pay.id, context.companyId]
        );
        body.sessionRate = emp.session_rate ? parseFloat(emp.session_rate) : 0;
        body.sessions = rows.map((r) => ({
          date: r.start_date ? new Date(r.start_date).toISOString() : null,
          className: r.class_name ?? null,
          courseName: r.course_name ?? null,
          studentsPresent: r.students_present != null ? Number(r.students_present) : 0,
        }));
      }

      return { status: 200 as const, body };
    } catch (error) {
      console.error('Get salary payment breakdown error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.SALARY_BREAKDOWN_FAILED', 'Failed to get salary payment breakdown');
    }
  },

  previewEmployeeBackPay: async ({ params, query: q, headers }: {
    params: { employeeId: string };
    query: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id, is_active FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (q?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);

      // Detect already-paid months so the user knows what will be skipped.
      const paidRows = periods.length === 0 ? [] : await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const enriched = periods.map(p => ({ ...p, alreadyPaid: paidMonths.has(p.monthKey) }));
      const toCreate = enriched.filter(p => !p.alreadyPaid);

      return {
        status: 200 as const,
        body: {
          employee: {
            id: emp.id,
            firstName: emp.first_name,
            lastName: emp.last_name,
            hireDate: hireStr,
            salary,
            branchId: emp.branch_id,
          },
          upTo: upToStr,
          periods: enriched,
          totalToCreate: Math.round(toCreate.reduce((s, p) => s + p.amount, 0) * 100) / 100,
          totalAlreadyPaid: Math.round(enriched.filter(p => p.alreadyPaid).reduce((s, p) => s + p.amount, 0) * 100) / 100,
        },
      };
    } catch (error) {
      console.error('Preview back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_PREVIEW_FAILED', 'Failed to preview back pay');
    }
  },

  createEmployeeBackPay: async ({ params, body, headers }: {
    params: { employeeId: string };
    body: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (body?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);
      if (periods.length === 0) {
        return {
          status: 200 as const,
          body: { created: 0, skipped: 0, totalAmount: 0, payments: [], message: 'No back-pay periods to create.', code: 'EXPENSES.BACK_PAY_NONE' },
        };
      }

      const paidRows = await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const created: any[] = [];
      let skipped = 0;
      for (const p of periods) {
        if (paidMonths.has(p.monthKey)) { skipped += 1; continue; }
        const notes = p.proRated
          ? `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel} (pro-rated ${p.daysWorked}/${p.daysInMonth} days)`
          : `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel}`;
        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: p.amount,
          date: p.endDate,
          notes,
          bonus_amount: 0,
          discount_amount: 0,
        });
        created.push(mapPaymentFromDB(payment));
      }

      const totalAmount = Math.round(created.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped,
          totalAmount,
          payments: created,
          message: `Created ${created.length} back-pay entr${created.length === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already-paid month${skipped === 1 ? '' : 's'}` : ''}.`,
          code: 'EXPENSES.BACK_PAY_CREATED',
        },
      };
    } catch (error) {
      console.error('Create back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_FAILED', 'Failed to create back pay');
    }
  },

  /**
   * GET /api/expenses/bundle-income?year=&month=&branchId=
   *
   * READ-ONLY. What each master course collected in a month, and what a split
   * between its teachers WOULD look like. Nothing here is stored and no salary
   * moves because of it.
   *
   * It exists because bundle money reaches no teacher at all today: every
   * accrual walks money -> enrollment -> class -> instructor, and a bundle's
   * payment hangs off a master enrolment, which has neither an enrolment nor a
   * class behind it. The money is not lost, it is invisible — so the first job
   * of this report is to show how much of it there is.
   *
   * Two policies, both of which leave the academy earning:
   *   A  pro-rata      — the bundle's discount is shared by everyone in proportion
   *   C  teachers fund — the academy keeps the margin list prices would have
   *                      given it, and the rest is split between teachers
   */
  bundleIncome: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      // Salary money — the same gate the rest of this page uses.
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const year = parseInt(q.year, 10);
      const month = parseInt(q.month, 10);
      if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return apiError(400, 'ERRORS.EXPENSES.BAD_MONTH', 'A year and a month are required');
      }

      const params: any[] = [context.companyId, year, month];
      let branchClause = '';
      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        branchClause = ' AND me.branch_id = $4';
      }

      // What was actually COLLECTED this month, per master course. Money that
      // arrived, not money that was billed — a salary question is about the
      // former. Three arms, because bundle money is recorded three ways:
      //
      //  1. What was taken at the desk when the student joined. This is the big
      //     one and it has no payment row of its own: the enrolment carries it
      //     as a lump in amount_paid (13,550 of the 13,550 in prod), so it is
      //     dated by the enrolment and reduced by anything itemised below.
      //  2. Later instalments against a one-off bundle, which are dated rows.
      //  3. A per-month bundle's monthly instalment ledger.
      const collected = await query(
        `WITH money AS (
           SELECT me.master_course_id,
                  GREATEST(
                    COALESCE(me.amount_paid, 0)
                      - COALESCE(me.total_refunded, 0)
                      - COALESCE((SELECT SUM(mep2.amount) FROM master_enrollment_payments mep2
                                   WHERE mep2.master_enrollment_id = me.id), 0),
                    0
                  ) AS amount
             FROM master_enrollments me
            WHERE me.company_id = $1
              AND EXTRACT(YEAR FROM me.enrollment_date) = $2
              AND EXTRACT(MONTH FROM me.enrollment_date) = $3${branchClause}
           UNION ALL
           SELECT me.master_course_id, mep.amount
             FROM master_enrollment_payments mep
             JOIN master_enrollments me ON me.id = mep.master_enrollment_id
            WHERE mep.company_id = $1
              AND EXTRACT(YEAR FROM mep.payment_date) = $2
              AND EXTRACT(MONTH FROM mep.payment_date) = $3${branchClause}
           UNION ALL
           SELECT me.master_course_id, msi.amount
             FROM monthly_subscription_installments msi
             JOIN master_enrollments me ON me.id = msi.master_enrollment_id
            WHERE msi.company_id = $1
              AND EXTRACT(YEAR FROM msi.payment_date) = $2
              AND EXTRACT(MONTH FROM msi.payment_date) = $3${branchClause}
         )
         SELECT mc.id, mc.name, mc.payment_type, mc.default_price,
                COALESCE(SUM(money.amount), 0) AS collected
           FROM money
           JOIN master_courses mc ON mc.id = money.master_course_id
          GROUP BY mc.id, mc.name, mc.payment_type, mc.default_price
         HAVING COALESCE(SUM(money.amount), 0) <> 0
          ORDER BY SUM(money.amount) DESC`,
        params,
      );

      // The member courses of every bundle that took money, with the teacher
      // behind each and the rate that teacher is on for it. A course may name its
      // instructor directly; where it does not, one of its classes might.
      const masterIds = (collected as any[]).map((r) => r.id);
      const members = masterIds.length
        ? await query(
            `SELECT mcc.master_course_id, c.id AS course_id, c.name AS course_name, c.price,
                    COALESCE(c.instructor_id, (
                      SELECT cl.instructor_id FROM classes cl
                       WHERE cl.course_id = c.id AND cl.instructor_id IS NOT NULL
                       LIMIT 1
                    )) AS instructor_id,
                    emp.first_name, emp.last_name, emp.salary_type, emp.percentage_rate,
                    ecp.percentage_rate AS course_rate
               FROM master_course_courses mcc
               JOIN courses c ON c.id = mcc.course_id
               LEFT JOIN employees emp ON emp.id = COALESCE(c.instructor_id, (
                      SELECT cl.instructor_id FROM classes cl
                       WHERE cl.course_id = c.id AND cl.instructor_id IS NOT NULL
                       LIMIT 1))
               LEFT JOIN employee_course_percentages ecp
                      ON ecp.employee_id = emp.id AND ecp.course_id = c.id
              WHERE mcc.master_course_id = ANY($1::uuid[])
              ORDER BY c.name`,
            [masterIds],
          )
        : [];

      const membersByMaster = new Map<string, any[]>();
      for (const m of members as any[]) {
        const list = membersByMaster.get(m.master_course_id) ?? [];
        list.push(m);
        membersByMaster.set(m.master_course_id, list);
      }

      const round2 = (n: number) => Math.round(n * 100) / 100;
      let unattributable = 0;

      const bundles = (collected as any[]).map((row) => {
        const collectedAmount = parseFloat(row.collected);
        const raw = membersByMaster.get(row.id) ?? [];

        // A member can only carry a share if there is somebody to pay, a rate to
        // pay them at, and a price to weight them by.
        const memberLines = raw.map((m: any) => {
          const rate = m.course_rate != null
            ? parseFloat(m.course_rate)
            : (m.percentage_rate != null ? parseFloat(m.percentage_rate) : null);
          const listPrice = m.price != null ? parseFloat(m.price) : 0;
          return {
            courseId: m.course_id,
            courseName: m.course_name,
            listPrice,
            employeeId: m.instructor_id ?? null,
            employeeName: m.first_name ? `${m.first_name} ${m.last_name ?? ''}`.trim() : null,
            salaryType: m.salary_type ?? null,
            rate,
            isCourseRate: m.course_rate != null,
            payable: !!m.instructor_id && m.salary_type === 'PERCENTAGE' && rate != null && listPrice > 0,
          };
        });

        const payable = memberLines.filter((m) => m.payable);
        const listTotal = round2(payable.reduce((sum, m) => sum + m.listPrice, 0));

        // Why a bundle cannot be split, named in the order an operator would fix it.
        let blockedReason: string | null = null;
        if (!memberLines.length) blockedReason = 'NO_MEMBER_COURSES';
        else if (!payable.length || listTotal <= 0) {
          if (memberLines.some((m) => !m.employeeId)) blockedReason = 'NO_INSTRUCTOR';
          else if (memberLines.some((m) => m.salaryType !== 'PERCENTAGE')) blockedReason = 'NOT_PERCENTAGE_PAID';
          else blockedReason = 'NO_LIST_PRICE';
        }

        if (blockedReason) {
          unattributable += collectedAmount;
          return {
            masterCourseId: row.id,
            masterCourseName: row.name,
            paymentType: row.payment_type ?? 'ONE_TIME',
            collected: round2(collectedAmount),
            listTotal,
            discount: 0,
            academyFloor: 0,
            members: memberLines,
            blockedReason,
            policyA: null,
            policyC: null,
          };
        }

        // ── Policy A: everyone shares the discount in proportion ──────────────
        const linesA = payable.map((m) => {
          const share = round2(collectedAmount * (m.listPrice / listTotal));
          return { ...m, share, earning: round2(share * (m.rate as number) / 100) };
        });
        const teachersA = round2(linesA.reduce((sum, l) => sum + l.earning, 0));
        const academyA = round2(collectedAmount - teachersA);

        // ── Policy C: the academy keeps what list prices would have left it ───
        // The floor is the sum of every member's non-teacher slice. Sold below
        // it there is no pool to pay anyone from, which is reported as
        // infeasible rather than printed as a negative.
        const academyFloor = round2(
          payable.reduce((sum, m) => sum + m.listPrice * (1 - (m.rate as number) / 100), 0),
        );
        const poolC = round2(collectedAmount - academyFloor);
        const linesC = payable.map((m) => ({
          ...m,
          share: round2(collectedAmount * (m.listPrice / listTotal)),
          earning: round2(poolC * (m.listPrice / listTotal)),
        }));
        const teachersC = round2(linesC.reduce((sum, l) => sum + l.earning, 0));

        return {
          masterCourseId: row.id,
          masterCourseName: row.name,
          paymentType: row.payment_type ?? 'ONE_TIME',
          collected: round2(collectedAmount),
          listTotal,
          // What the student was given: the gap between the parts and the bundle.
          discount: round2(listTotal - collectedAmount),
          academyFloor,
          members: memberLines,
          blockedReason: null,
          policyA: {
            lines: linesA,
            teachersTotal: teachersA,
            academy: academyA,
            // Only a teacher on 100% can take the academy to nothing here.
            feasible: academyA > 0,
          },
          policyC: {
            lines: poolC > 0 ? linesC : [],
            teachersTotal: poolC > 0 ? teachersC : 0,
            academy: academyFloor,
            feasible: poolC > 0,
          },
        };
      });

      return {
        status: 200 as const,
        body: {
          year,
          month,
          totalCollected: round2(bundles.reduce((sum, b) => sum + b.collected, 0)),
          unattributable: round2(unattributable),
          bundles,
        },
      };
    } catch (error: any) {
      console.error('Bundle income report error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BUNDLE_INCOME_FAILED', 'Failed to build the bundle income report');
    }
  },

};
