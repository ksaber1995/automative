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

let allocationsTableReady = false;
/**
 * Approved bundle splits (migration 091). Self-applying like the other salary
 * tables, so the endpoint works on a database the migration has not reached.
 */
async function ensureAllocationsSchema(): Promise<void> {
  if (allocationsTableReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS master_revenue_allocations (
      id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id        UUID NOT NULL REFERENCES companies(id)      ON DELETE CASCADE,
      master_course_id  UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
      billing_year      INTEGER NOT NULL,
      billing_month     INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
      employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      course_id         UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
      amount            DECIMAL(12, 2) NOT NULL CHECK (amount >= 0),
      suggested_amount  DECIMAL(12, 2),
      policy            VARCHAR(1) NOT NULL DEFAULT 'A' CHECK (policy IN ('A', 'C')),
      approved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
      approved_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at        TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (master_course_id, billing_year, billing_month, employee_id, course_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_mra_company_month ON master_revenue_allocations(company_id, billing_year, billing_month)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_mra_employee ON master_revenue_allocations(employee_id)`);
  allocationsTableReady = true;
}

/**
 * What ONE bundle collected in a month — the ceiling any split has to respect.
 *
 * The same three arms the report uses, and for the same reason: almost no bundle
 * money is a dated payment row. Most of it is the lump taken at the desk when
 * the student joined, which only the enrolment records.
 */
async function masterMonthCollected(
  context: { companyId: string },
  year: number,
  month: number,
  masterCourseId: string,
): Promise<{ collected: number }> {
  const row = await queryOne<any>(
    `WITH money AS (
       SELECT GREATEST(
                COALESCE(me.amount_paid, 0) - COALESCE(me.total_refunded, 0)
                  - COALESCE((SELECT SUM(mep2.amount) FROM master_enrollment_payments mep2
                               WHERE mep2.master_enrollment_id = me.id), 0), 0) AS amount
         FROM master_enrollments me
        WHERE me.company_id = $1 AND me.master_course_id = $4
          AND EXTRACT(YEAR FROM me.enrollment_date) = $2
          AND EXTRACT(MONTH FROM me.enrollment_date) = $3
       UNION ALL
       SELECT mep.amount FROM master_enrollment_payments mep
         JOIN master_enrollments me ON me.id = mep.master_enrollment_id
        WHERE mep.company_id = $1 AND me.master_course_id = $4
          AND EXTRACT(YEAR FROM mep.payment_date) = $2
          AND EXTRACT(MONTH FROM mep.payment_date) = $3
       UNION ALL
       SELECT msi.amount FROM monthly_subscription_installments msi
         JOIN master_enrollments me ON me.id = msi.master_enrollment_id
        WHERE msi.company_id = $1 AND me.master_course_id = $4
          AND EXTRACT(YEAR FROM msi.payment_date) = $2
          AND EXTRACT(MONTH FROM msi.payment_date) = $3
     )
     SELECT COALESCE(SUM(amount), 0) AS collected FROM money`,
    [context.companyId, year, month, masterCourseId],
  );
  return { collected: row?.collected != null ? parseFloat(row.collected) : 0 };
}

/** Bundle money approved to this teacher, by course. Empty until someone approves. */
async function getAllocatedByCourse(
  companyId: string,
  employeeId: string,
): Promise<Map<string, number>> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.master_revenue_allocations') IS NOT NULL AS has_table`
  );
  if (!reg?.has_table) return new Map();
  const rows = await query(
    `SELECT course_id, SUM(amount) AS amount
       FROM master_revenue_allocations
      WHERE company_id = $1 AND employee_id = $2
      GROUP BY course_id`,
    [companyId, employeeId],
  );
  return new Map((rows as any[]).map((r) => [r.course_id as string, parseFloat(r.amount)]));
}

/** How a teacher is paid for one particular course, when it differs. */
export interface CoursePayRule {
  payType: 'PERCENTAGE' | 'SESSION_BASED';
  percentageRate: number | null;
  sessionRate: number | null;
}

/**
 * The teacher's per-course arrangements, keyed by course. A course with no entry
 * falls back to the employee's own salary_type and rate — the row is an
 * exception to it, and overrides the METHOD as well as the number (migration
 * 090). So one teacher can take a percentage of one course and a fee per session
 * on another.
 */
async function getCoursePayRules(
  companyId: string,
  employeeId: string,
): Promise<Map<string, CoursePayRule>> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.employee_course_percentages') IS NOT NULL AS has_table`
  );
  if (!reg?.has_table) return new Map();
  const rows = await query(
    `SELECT course_id, percentage_rate,
            COALESCE(pay_type, 'PERCENTAGE') AS pay_type,
            session_rate
       FROM employee_course_percentages
      WHERE company_id = $1 AND employee_id = $2`,
    [companyId, employeeId],
  );
  return new Map((rows as any[]).map((r) => [r.course_id as string, {
    payType: r.pay_type as 'PERCENTAGE' | 'SESSION_BASED',
    percentageRate: r.percentage_rate != null ? parseFloat(r.percentage_rate) : null,
    sessionRate: r.session_rate != null ? parseFloat(r.session_rate) : null,
  }]));
}

/**
 * Unpaid PRESENT sessions this month, grouped by the course behind the class.
 * Grouped, because which rate applies is now a per-course question. Same rules
 * as getUnpaidSessionIds — free sessions excluded, and anything already covered
 * by a previous payment excluded — so the two can never disagree about what has
 * been paid for.
 */
async function getUnpaidSessionsByCourse(
  companyId: string,
  employeeId: string,
  monthStart: string,
  monthEnd: string,
): Promise<Array<{ courseId: string | null; courseName: string | null; sessionIds: string[] }>> {
  await ensureFreeSessionSchema();
  const rows = await query<any>(
    `SELECT DISTINCT s.id, cl.course_id, co.name AS course_name
     FROM session_teacher_attendance sta
     JOIN sessions s ON s.id = sta.session_id
     LEFT JOIN classes cl ON cl.id = s.class_id
     LEFT JOIN courses co ON co.id = cl.course_id
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
  const byCourse = new Map<string, { courseId: string | null; courseName: string | null; sessionIds: string[] }>();
  for (const r of rows as any[]) {
    const key = r.course_id ?? '';
    const group = byCourse.get(key)
      ?? { courseId: r.course_id ?? null, courseName: r.course_name ?? null, sessionIds: [] as string[] };
    group.sessionIds.push(r.id);
    byCourse.set(key, group);
  }
  return [...byCourse.values()];
}

/** Does this teacher have any course they are paid a percentage of? */
async function hasPercentageRule(companyId: string, employeeId: string): Promise<boolean> {
  const rules = await getCoursePayRules(companyId, employeeId);
  return [...rules.values()].some((r) => r.payType === 'PERCENTAGE');
}

/**
 * What this teacher is owed for sessions taught this month, course by course.
 *
 * A session is paid per-session when the course says so, or when the teacher
 * themselves is SESSION_BASED and the course has not been moved onto a
 * percentage. A session of a percentage-paid course earns nothing here — the
 * student money behind it is what pays, through the accrual — and that
 * complement is exactly what stops a mixed teacher being paid twice for one
 * session.
 */
async function getSessionPayForMonth(
  companyId: string,
  emp: any,
  monthStart: string,
  monthEnd: string,
): Promise<{ amount: number; sessionIds: string[]; lines: Array<{ courseId: string | null; courseName: string | null; sessions: number; rate: number; amount: number }> }> {
  const rules = await getCoursePayRules(companyId, emp.id);
  const employeeIsSessionBased = emp.salary_type === 'SESSION_BASED';
  const employeeRate = emp.session_rate != null ? parseFloat(emp.session_rate) : 0;

  // Nothing to look up when neither the employee nor any course is session-paid.
  const anySessionRule = [...rules.values()].some((r) => r.payType === 'SESSION_BASED');
  if (!employeeIsSessionBased && !anySessionRule) {
    return { amount: 0, sessionIds: [], lines: [] };
  }

  const groups = await getUnpaidSessionsByCourse(companyId, emp.id, monthStart, monthEnd);
  const lines: Array<{ courseId: string | null; courseName: string | null; sessions: number; rate: number; amount: number }> = [];
  const sessionIds: string[] = [];
  let amount = 0;

  for (const g of groups) {
    const rule = g.courseId ? rules.get(g.courseId) : undefined;
    let rate = 0;
    if (rule?.payType === 'SESSION_BASED') rate = rule.sessionRate ?? 0;
    else if (!rule && employeeIsSessionBased) rate = employeeRate;
    // rule.payType === 'PERCENTAGE' → paid through the accrual, not here.
    if (rate <= 0) continue;

    const lineAmount = Math.round(g.sessionIds.length * rate * 100) / 100;
    amount += lineAmount;
    sessionIds.push(...g.sessionIds);
    lines.push({ courseId: g.courseId, courseName: g.courseName, sessions: g.sessionIds.length, rate, amount: lineAmount });
  }

  return { amount: Math.round(amount * 100) / 100, sessionIds, lines };
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
  const [paidCourseRows, rules, allocated] = await Promise.all([
    getTeacherPaidByCourse(companyId, employeeId),
    getCoursePayRules(companyId, employeeId),
    getAllocatedByCourse(companyId, employeeId),
  ]);

  // Approved bundle money joins the course it was attributed to and is then
  // treated exactly like money a student paid for that course — same rate, same
  // rounding. That is the whole point of storing money rather than earnings.
  const paidByCourse = [...paidCourseRows];
  for (const [courseId, amount] of allocated) {
    const existing = paidByCourse.find((c) => c.courseId === courseId);
    if (existing) existing.paid = Math.round((existing.paid + amount) * 100) / 100;
    else paidByCourse.push({ courseId, courseName: null, paid: amount });
  }

  let totalPaid = 0;
  let accrued = 0;
  const byCourse: TeacherCourseEarning[] = paidByCourse
    // A course the teacher is paid per session for earns nothing from student
    // money — they are paid for turning up, and counting it here as well would
    // pay them twice for the same teaching.
    .filter((c) => !(c.courseId && rules.get(c.courseId)?.payType === 'SESSION_BASED'))
    .map((c) => {
    const rule = c.courseId ? rules.get(c.courseId) : undefined;
    const override = rule?.payType === 'PERCENTAGE' ? rule.percentageRate ?? undefined : undefined;
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

/**
 * One course on a teacher's salary report, told in the terms that course is
 * actually paid on. A teacher is no longer on one arrangement: migration 090 lets
 * a course be a percentage of its money or a fee per session, migration 089 lets
 * two percentage courses carry two different rates, and an approved bundle split
 * (091) can route bundle money to a course as well. So a report row has to carry
 * which of those it is, not just a number.
 */
export interface CourseBreakdownLine {
  courseId: string | null;
  courseName: string | null;
  /** PERCENTAGE — paid as a share of money received; SESSION — a fee per session. */
  method: 'PERCENTAGE' | 'SESSION';
  /** The percentage (PERCENTAGE) or the per-session fee (SESSION). */
  rate: number;
  /** True when this course has its own arrangement, apart from the teacher's global one. */
  isOverride: boolean;
  /** Student money attributed to this course (the percentage basis). */
  studentPaid: number;
  /** Approved bundle money routed to this course, already inside studentPaid's cut. */
  bundleAllocated: number;
  /** Present sessions this month (SESSION rows only). */
  sessions: number;
  /**
   * The teacher's cut. For PERCENTAGE this is the all-time accrual, in step with
   * the report's headline `accrued`. For SESSION it is THIS MONTH's fee — session
   * pay is a monthly, per-session settlement, not a running balance.
   */
  earning: number;
  /** Convenience for the UI: some of this row's money came through a bundle. */
  fromBundle: boolean;
}

/**
 * The teacher's earnings laid out course by course, each in its own currency of
 * explanation — a percentage of receipts, a fee per session, or bundle money the
 * office attributed. The percentage rows add up to the report's `accrued`; the
 * session rows are this month's, because that is the only window per-session pay
 * has. Bundle money is folded into the course it was approved against, exactly as
 * the accrual treats it, and flagged so the reader can see where it came from.
 */
async function getTeacherCourseBreakdown(
  companyId: string,
  emp: any,
  globalRate: number,
  monthStart: string,
  monthEnd: string,
): Promise<CourseBreakdownLine[]> {
  const [paidCourseRows, rules, allocated, sessionPay] = await Promise.all([
    getTeacherPaidByCourse(companyId, emp.id),
    getCoursePayRules(companyId, emp.id),
    getAllocatedByCourse(companyId, emp.id),
    getSessionPayForMonth(companyId, emp, monthStart, monthEnd),
  ]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const rows = new Map<string, CourseBreakdownLine>();
  const ensure = (courseId: string | null, courseName: string | null): CourseBreakdownLine => {
    const key = courseId ?? '';
    let row = rows.get(key);
    if (!row) {
      row = {
        courseId: courseId ?? null, courseName: courseName ?? null,
        method: 'PERCENTAGE', rate: globalRate, isOverride: false,
        studentPaid: 0, bundleAllocated: 0, sessions: 0, earning: 0, fromBundle: false,
      };
      rows.set(key, row);
    } else if (!row.courseName && courseName) {
      row.courseName = courseName;
    }
    return row;
  };

  for (const c of paidCourseRows) {
    const row = ensure(c.courseId, c.courseName);
    row.studentPaid = round2(row.studentPaid + c.paid);
  }
  for (const [courseId, amount] of allocated) {
    const row = ensure(courseId, null);
    row.bundleAllocated = round2(row.bundleAllocated + amount);
    row.fromBundle = true;
  }

  // The arrangement decides the method and rate. A per-course rule overrides both;
  // otherwise the course inherits the teacher's own percentage.
  for (const row of rows.values()) {
    const rule = row.courseId ? rules.get(row.courseId) : undefined;
    if (rule?.payType === 'SESSION_BASED') {
      row.method = 'SESSION';
      row.rate = rule.sessionRate ?? 0;
      row.isOverride = true;
    } else if (rule?.payType === 'PERCENTAGE') {
      row.rate = rule.percentageRate ?? globalRate;
      row.isOverride = rule.percentageRate != null;
    }
  }

  // Sessions actually taught this month, and their fee — this covers a purely
  // session-based teacher too, whose courses never appear in the money rows above.
  for (const line of sessionPay.lines) {
    const row = ensure(line.courseId, line.courseName);
    row.method = 'SESSION';
    row.rate = line.rate;
    row.isOverride = true;
    row.sessions = line.sessions;
  }

  // Bundle-only or session-only courses can reach here without a name.
  const unnamed = [...rows.values()].filter((r) => r.courseId && !r.courseName).map((r) => r.courseId as string);
  if (unnamed.length) {
    const names = await query<any>(
      'SELECT id, name FROM courses WHERE company_id = $1 AND id = ANY($2::uuid[])',
      [companyId, unnamed],
    );
    const byId = new Map((names as any[]).map((n) => [n.id as string, n.name as string]));
    for (const r of rows.values()) if (r.courseId && !r.courseName) r.courseName = byId.get(r.courseId) ?? null;
  }

  for (const row of rows.values()) {
    row.earning = row.method === 'SESSION'
      ? round2(row.sessions * row.rate)
      // Bundle money is earned at the same rate as the course's own money.
      : round2((row.studentPaid + row.bundleAllocated) * row.rate / 100);
  }

  // Percentage courses first (the accrual), then session courses; each biggest earner first.
  return [...rows.values()].sort((a, b) =>
    a.method === b.method ? b.earning - a.earning : a.method === 'PERCENTAGE' ? -1 : 1,
  );
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
            c.course_id AS course_id,
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
      `SELECT s.name, c.name, co.name, c.course_id, 'MONTHLY', COALESCE(msp.amount_paid,0),
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
      `SELECT s.name, c.name, co.name, c.course_id, 'SESSION', COALESCE(sp.amount_paid,0),
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
      `SELECT s.name, c.name, co.name, c.course_id, 'PACKAGE', COALESCE(spkg.amount_paid,0),
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
  // ORDER MATTERS. itty-router matches in registration order and registration
  // follows this object's keys, so every STATIC path has to be declared above
  // `/api/expenses/:id`. Declared last, /api/expenses/bundle-income was read
  // as an expense whose id is "bundle-income" and answered "id: Invalid uuid".
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
  /**
   * POST /api/expenses/bundle-income/approve — see masterMonthCollected below
   * for where the ceiling comes from.
   *
   * Records a decision about one bundle's month: who gets how much of what it
   * collected. Replaces any earlier decision for that bundle and month, so
   * approving twice corrects rather than pays twice.
   *
   * The amounts are MONEY, not earnings — each teacher's own rate is applied
   * afterwards by the accrual, so this endpoint refuses anything that would
   * leave the academy with nothing once those rates are applied.
   */
  approveBundleSplit: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureAllocationsSchema();

      const year = parseInt(body?.year, 10);
      const month = parseInt(body?.month, 10);
      const masterCourseId = body?.masterCourseId;
      const policy = body?.policy === 'C' ? 'C' : 'A';
      const lines: Array<{ employeeId: string; courseId: string; amount: number; suggestedAmount?: number }> =
        Array.isArray(body?.lines) ? body.lines : [];

      if (!masterCourseId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return apiError(400, 'ERRORS.EXPENSES.BAD_MONTH', 'A bundle, a year and a month are required');
      }

      const master = await queryOne<any>(
        'SELECT id FROM master_courses WHERE id = $1 AND company_id = $2',
        [masterCourseId, context.companyId],
      );
      if (!master) return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Master course not found');

      // What that bundle actually took this month — the ceiling for any split.
      const report: any = await masterMonthCollected(context, year, month, masterCourseId);
      const collected = report.collected;

      let totalAllocated = 0;
      let totalEarnings = 0;
      for (const line of lines) {
        if (!(typeof line.amount === 'number') || line.amount < 0) {
          return apiError(400, 'ERRORS.EXPENSES.BAD_ALLOCATION', 'An allocated amount cannot be negative');
        }
        const emp = await queryOne<any>(
          `SELECT e.id, e.percentage_rate, ecp.percentage_rate AS course_rate
             FROM employees e
             LEFT JOIN employee_course_percentages ecp
                    ON ecp.employee_id = e.id AND ecp.course_id = $3
                       AND COALESCE(ecp.pay_type, 'PERCENTAGE') = 'PERCENTAGE'
            WHERE e.id = $1 AND e.company_id = $2`,
          [line.employeeId, context.companyId, line.courseId],
        );
        if (!emp) return apiError(400, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
        const course = await queryOne<any>(
          'SELECT id FROM courses WHERE id = $1 AND company_id = $2',
          [line.courseId, context.companyId],
        );
        if (!course) return apiError(400, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');

        const rate = emp.course_rate != null
          ? parseFloat(emp.course_rate)
          : (emp.percentage_rate != null ? parseFloat(emp.percentage_rate) : 0);
        totalAllocated += line.amount;
        totalEarnings += line.amount * rate / 100;
      }

      totalAllocated = Math.round(totalAllocated * 100) / 100;
      totalEarnings = Math.round(totalEarnings * 100) / 100;

      if (totalAllocated > collected + 0.001) {
        return apiError(400, 'ERRORS.EXPENSES.ALLOCATION_OVER_COLLECTED',
          `Cannot attribute more than the bundle collected (${collected})`);
      }
      // The rule the academy asked for, enforced here rather than trusted from
      // the screen: what the teachers earn must leave something behind.
      if (collected - totalEarnings <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.ACADEMY_EARNS_NOTHING',
          'This split leaves the academy nothing once each rate is applied');
      }

      // Replace the decision for this bundle+month rather than adding to it.
      await query(
        `DELETE FROM master_revenue_allocations
          WHERE company_id = $1 AND master_course_id = $2
            AND billing_year = $3 AND billing_month = $4`,
        [context.companyId, masterCourseId, year, month],
      );
      for (const line of lines) {
        if (line.amount <= 0) continue;
        await query(
          `INSERT INTO master_revenue_allocations
             (company_id, master_course_id, billing_year, billing_month, employee_id, course_id,
              amount, suggested_amount, policy, approved_by, approved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
          [context.companyId, masterCourseId, year, month, line.employeeId, line.courseId,
           line.amount, line.suggestedAmount ?? null, policy, context.userId],
        );
      }

      return {
        status: 200 as const,
        body: {
          approved: lines.filter((l) => l.amount > 0).length,
          allocated: totalAllocated,
          teacherEarnings: totalEarnings,
          academy: Math.round((collected - totalEarnings) * 100) / 100,
        },
      };
    } catch (error: any) {
      console.error('Approve bundle split error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BUNDLE_APPROVE_FAILED', 'Failed to approve the split', 400);
    }
  },

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
                    emp.first_name, emp.last_name, emp.salary_type, emp.percentage_rate, emp.session_rate,
                    ecp.percentage_rate AS course_rate,
                    ecp.pay_type       AS course_pay_type,
                    ecp.session_rate   AS course_session_rate,
                    (ecp.course_id IS NOT NULL) AS has_course_rule
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

      // What has already been decided for these bundles this month, so the
      // screen can show an approved split instead of proposing one again.
      await ensureAllocationsSchema();
      const approvedRows = masterIds.length
        ? await query(
            `SELECT master_course_id, employee_id, course_id, amount, policy, approved_at
               FROM master_revenue_allocations
              WHERE company_id = $1 AND billing_year = $2 AND billing_month = $3
                AND master_course_id = ANY($4::uuid[])`,
            [context.companyId, year, month, masterIds],
          )
        : [];
      const approvedByMaster = new Map<string, any[]>();
      for (const a of approvedRows as any[]) {
        const list = approvedByMaster.get(a.master_course_id) ?? [];
        list.push({
          employeeId: a.employee_id,
          courseId: a.course_id,
          amount: parseFloat(a.amount),
          policy: a.policy,
          approvedAt: a.approved_at,
        });
        approvedByMaster.set(a.master_course_id, list);
      }

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

        // How each member course pays its teacher. A per-course arrangement wins
        // over the teacher's global type (migration 090), so the SAME teacher can
        // be a percentage on one course and a session fee on another.
        const memberLines = raw.map((m: any) => {
          const listPrice = m.price != null ? parseFloat(m.price) : 0;
          const hasRule = m.has_course_rule === true;
          const method = hasRule ? (m.course_pay_type ?? 'PERCENTAGE') : (m.salary_type ?? null);
          const pctRate = m.course_rate != null
            ? parseFloat(m.course_rate)
            : (m.percentage_rate != null ? parseFloat(m.percentage_rate) : null);
          const sessionRate = m.course_session_rate != null
            ? parseFloat(m.course_session_rate)
            : (m.session_rate != null ? parseFloat(m.session_rate) : null);
          const hasInstructor = !!m.instructor_id;

          // A course paid PER SESSION is settled in the teacher's salary already,
          // from the class — it must NOT be paid a second time out of bundle money.
          const paidPerSession = hasInstructor && method === 'SESSION_BASED';
          const payMethod: 'PERCENTAGE' | 'SESSION' | 'NONE' =
            paidPerSession ? 'SESSION'
            : (hasInstructor && method === 'PERCENTAGE') ? 'PERCENTAGE'
            : 'NONE';

          return {
            courseId: m.course_id,
            courseName: m.course_name,
            listPrice,
            employeeId: m.instructor_id ?? null,
            employeeName: m.first_name ? `${m.first_name} ${m.last_name ?? ''}`.trim() : null,
            salaryType: m.salary_type ?? null,
            rate: pctRate,
            isCourseRate: m.course_rate != null,
            payMethod,
            paidPerSession,
            sessionRate,
            // Only a percentage course is paid FROM the bundle.
            payable: payMethod === 'PERCENTAGE' && pctRate != null && listPrice > 0,
          };
        });

        const payable = memberLines.filter((m) => m.payable);
        // Session courses still occupy part of the bundle's value: they belong in
        // the denominator so a percentage teacher is weighted against the WHOLE
        // bundle, not only its percentage courses — otherwise they'd be handed the
        // session course's money too. Their own slice simply goes to the academy,
        // because their teacher was already paid per session.
        const sessionMembers = memberLines.filter((m) => m.paidPerSession && m.listPrice > 0);
        const sessionList = round2(sessionMembers.reduce((sum, m) => sum + m.listPrice, 0));
        const payableList = round2(payable.reduce((sum, m) => sum + m.listPrice, 0));
        const listTotal = round2(payableList + sessionList);

        // The money that corresponds to session courses — shown so the operator
        // can see it was accounted for, not forgotten.
        const sessionLinesOut = sessionMembers.map((m) => ({
          ...m,
          share: listTotal > 0 ? round2(collectedAmount * (m.listPrice / listTotal)) : 0,
          earning: 0,
        }));
        const sessionSettled = round2(sessionLinesOut.reduce((sum, l) => sum + l.share, 0));

        // Why a bundle cannot be split, named in the order an operator would fix it.
        // A bundle whose teachers are ALL paid per session is not blocked — it is
        // already settled, so it is neither split nor counted as unattributable.
        let blockedReason: string | null = null;
        if (!memberLines.length) blockedReason = 'NO_MEMBER_COURSES';
        else if (!payable.length || payableList <= 0) {
          if (sessionMembers.length) blockedReason = null;   // settled per session
          else if (memberLines.some((m) => !m.employeeId)) blockedReason = 'NO_INSTRUCTOR';
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
            sessionMembers: sessionLinesOut,
            sessionSettled,
            settledPerSession: false,
            blockedReason,
            approved: approvedByMaster.get(row.id) ?? [],
            policyA: null,
            policyC: null,
          };
        }

        // Nothing to split, but nothing wrong either: every teacher here is on a
        // session fee, already paid from their classes. Report it plainly.
        if (!payable.length) {
          return {
            masterCourseId: row.id,
            masterCourseName: row.name,
            paymentType: row.payment_type ?? 'ONE_TIME',
            collected: round2(collectedAmount),
            listTotal,
            discount: round2(listTotal - collectedAmount),
            academyFloor: round2(collectedAmount),
            members: memberLines,
            sessionMembers: sessionLinesOut,
            sessionSettled,
            settledPerSession: true,
            blockedReason: null,
            approved: approvedByMaster.get(row.id) ?? [],
            policyA: null,
            policyC: null,
          };
        }

        // ── Policy A: everyone shares the discount in proportion ──────────────
        // Weighted by the WHOLE bundle (listTotal), so a percentage course earns
        // on its own slice only; the session slice falls through to the academy.
        const linesA = payable.map((m) => {
          const share = round2(collectedAmount * (m.listPrice / listTotal));
          return { ...m, share, earning: round2(share * (m.rate as number) / 100) };
        });
        const teachersA = round2(linesA.reduce((sum, l) => sum + l.earning, 0));
        const academyA = round2(collectedAmount - teachersA);

        // ── Policy C: the academy keeps what list prices would have left it ───
        // The floor is each percentage course's non-teacher slice PLUS the whole
        // of every session course (its teacher is paid elsewhere, so all of that
        // slice is the academy's). Sold below the floor there is no pool to pay
        // anyone from, reported as infeasible rather than printed as a negative.
        const academyFloor = round2(
          payable.reduce((sum, m) => sum + m.listPrice * (1 - (m.rate as number) / 100), 0) + sessionList,
        );
        const poolC = round2(collectedAmount - academyFloor);
        const linesC = payable.map((m) => ({
          ...m,
          share: round2(collectedAmount * (m.listPrice / listTotal)),
          // The pool pays only the percentage courses, split by their weight
          // among themselves.
          earning: payableList > 0 ? round2(poolC * (m.listPrice / payableList)) : 0,
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
          // Session courses whose teacher was already paid per session, with the
          // bundle money that corresponds to them.
          sessionMembers: sessionLinesOut,
          sessionSettled,
          settledPerSession: false,
          blockedReason: null,
          approved: approvedByMaster.get(row.id) ?? [],
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

  /**
   * GET /api/expenses/bundle-income/outstanding?branchId=
   *
   * The same question as bundleIncome, but for the WHOLE period rather than one
   * month. A bundle pays a teacher only once its split is approved; a percentage
   * teacher's dues never expire at a month boundary. So this walks every month a
   * bundle ever collected money, drops the ones already split, and totals what is
   * still owed — the figure the salaries alarm shows so it cannot go stale when
   * the month picker moves.
   */
  bundleIncomeOutstanding: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureAllocationsSchema();

      const params: any[] = [context.companyId];
      let branchClause = '';
      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        branchClause = ' AND me.branch_id = $2';
      }

      // How a course pays its teacher decides which bucket a bundle falls in. A
      // per-course rule wins over the teacher's global type; the rule table is
      // created lazily, so fall back to the global type where it isn't there.
      //   • has_percentage → money owed to a percentage teacher (the alarm's job)
      //   • has_session    → its teacher is paid per session, already settled — no
      //                      alarm, so these must not read as "blocked"
      const hasEcp = (await queryOne<any>(
        `SELECT to_regclass('public.employee_course_percentages') IS NOT NULL AS h`,
      ))?.h;
      const effectiveMethod = hasEcp
        ? `CASE WHEN ecp.course_id IS NOT NULL THEN COALESCE(ecp.pay_type,'PERCENTAGE') ELSE emp.salary_type END`
        : `emp.salary_type`;
      const methodExists = (target: 'PERCENTAGE' | 'SESSION_BASED') => `EXISTS (
        SELECT 1 FROM master_course_courses mcc
          JOIN courses c ON c.id = mcc.course_id
          LEFT JOIN employees emp ON emp.id = COALESCE(c.instructor_id, (
                SELECT cl.instructor_id FROM classes cl
                 WHERE cl.course_id = c.id AND cl.instructor_id IS NOT NULL LIMIT 1))
          ${hasEcp ? 'LEFT JOIN employee_course_percentages ecp ON ecp.employee_id = emp.id AND ecp.course_id = c.id' : ''}
         WHERE mcc.master_course_id = pm.mc
           AND emp.id IS NOT NULL
           AND c.price > 0
           AND (${effectiveMethod}) = '${target}'
           ${target === 'PERCENTAGE'
             ? `AND COALESCE(${hasEcp ? 'ecp.percentage_rate, ' : ''}emp.percentage_rate, 0) > 0`
             : ''}
      )`;

      // The three arms mirror the per-month report; here they carry the money's
      // own year and month so it can be grouped and matched against the splits.
      const rows = await query<any>(
        `WITH money AS (
           SELECT me.master_course_id AS mc,
                  EXTRACT(YEAR  FROM me.enrollment_date)::int AS y,
                  EXTRACT(MONTH FROM me.enrollment_date)::int AS m,
                  GREATEST(
                    COALESCE(me.amount_paid, 0) - COALESCE(me.total_refunded, 0)
                      - COALESCE((SELECT SUM(mep2.amount) FROM master_enrollment_payments mep2
                                   WHERE mep2.master_enrollment_id = me.id), 0), 0) AS amount
             FROM master_enrollments me
            WHERE me.company_id = $1 AND me.enrollment_date IS NOT NULL${branchClause}
           UNION ALL
           SELECT me.master_course_id,
                  EXTRACT(YEAR FROM mep.payment_date)::int,
                  EXTRACT(MONTH FROM mep.payment_date)::int, mep.amount
             FROM master_enrollment_payments mep
             JOIN master_enrollments me ON me.id = mep.master_enrollment_id
            WHERE mep.company_id = $1 AND mep.payment_date IS NOT NULL${branchClause}
           UNION ALL
           SELECT me.master_course_id,
                  EXTRACT(YEAR FROM msi.payment_date)::int,
                  EXTRACT(MONTH FROM msi.payment_date)::int, msi.amount
             FROM monthly_subscription_installments msi
             JOIN master_enrollments me ON me.id = msi.master_enrollment_id
            WHERE msi.company_id = $1 AND msi.payment_date IS NOT NULL${branchClause}
         ),
         per_month AS (
           SELECT mc, y, m, SUM(amount) AS collected
             FROM money GROUP BY mc, y, m HAVING SUM(amount) > 0
         )
         SELECT pm.y, pm.m, pm.collected,
                (${methodExists('PERCENTAGE')})    AS has_percentage,
                (${methodExists('SESSION_BASED')}) AS has_session
           FROM per_month pm
          WHERE NOT EXISTS (
                  SELECT 1 FROM master_revenue_allocations a
                   WHERE a.company_id = $1 AND a.master_course_id = pm.mc
                     AND a.billing_year = pm.y AND a.billing_month = pm.m)`,
        params,
      );

      const round2 = (n: number) => Math.round(n * 100) / 100;
      let totalOutstanding = 0, outstandingCount = 0, totalBlocked = 0, blockedCount = 0;
      const periodMap = new Map<string, { year: number; month: number; outstanding: number; blocked: number }>();
      for (const r of rows as any[]) {
        const collected = parseFloat(r.collected);
        const key = `${r.y}-${r.m}`;
        if (r.has_percentage) {
          // A percentage teacher is owed a share nobody has settled.
          totalOutstanding += collected; outstandingCount += 1;
          const p = periodMap.get(key) ?? { year: r.y, month: r.m, outstanding: 0, blocked: 0 };
          p.outstanding = round2(p.outstanding + collected);
          periodMap.set(key, p);
        } else if (r.has_session) {
          // Every teacher here is paid per session — already settled, no alarm.
          continue;
        } else {
          // Money that reaches no teacher as configured.
          totalBlocked += collected; blockedCount += 1;
          const p = periodMap.get(key) ?? { year: r.y, month: r.m, outstanding: 0, blocked: 0 };
          p.blocked = round2(p.blocked + collected);
          periodMap.set(key, p);
        }
      }
      const periods = [...periodMap.values()].sort((a, b) => b.year - a.year || b.month - a.month);

      return {
        status: 200 as const,
        body: {
          totalOutstanding: round2(totalOutstanding),
          outstandingCount,
          totalBlocked: round2(totalBlocked),
          blockedCount,
          periods,
        },
      };
    } catch (error: any) {
      console.error('Bundle outstanding error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BUNDLE_INCOME_FAILED', 'Failed to compute outstanding bundle income');
    }
  },

  /**
   * GET /api/expenses/session-pay/outstanding?branchId=
   *
   * Per-session pay the academy still owes for sessions taught in CLOSED months
   * — the session equivalent of the bundle backlog. A per-session teacher is paid
   * for turning up, month by month; a month that was never settled leaves those
   * sessions unpaid, and looking only at the picked month hides them. So this
   * sums every unpaid PRESENT session dated before the current month, at the rate
   * that applies to it (a per-course session fee, or the teacher's own), and
   * groups it by the month it was taught so each can be settled from the pending
   * tab. The current month is deliberately excluded: it isn't overdue until it
   * closes, and the pending tab already shows it.
   */
  sessionPayOutstanding: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();
      await ensureFreeSessionSchema();

      // Overdue is measured against TODAY's month, never the picker — the alarm
      // must not change with the month being viewed.
      const now = new Date();
      const currentMonthStart = fmtDate(now.getUTCFullYear(), now.getUTCMonth(), 1);

      const params: any[] = [context.companyId, currentMonthStart];
      let branchClause = '';
      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        // Cross-branch staff (NULL branch) stay in view, as on the pending tab.
        branchClause = ' AND (e.branch_id = $3 OR e.branch_id IS NULL)';
      }

      // The rate a session earns follows the same precedence as getSessionPayForMonth:
      // a per-course rule wins (SESSION_BASED → its fee, PERCENTAGE → nothing, since
      // that course is paid through the accrual), otherwise the teacher's own rate
      // if they are session-based, otherwise nothing.
      const hasEcp = (await queryOne<any>(
        `SELECT to_regclass('public.employee_course_percentages') IS NOT NULL AS h`,
      ))?.h;
      const ecpJoin = hasEcp
        ? `LEFT JOIN employee_course_percentages ecp
                  ON ecp.employee_id = sta.employee_id AND ecp.course_id = cl.course_id`
        : '';
      const rateExpr = hasEcp
        ? `CASE
             WHEN ecp.course_id IS NOT NULL THEN
               CASE WHEN COALESCE(ecp.pay_type,'PERCENTAGE') = 'SESSION_BASED'
                    THEN COALESCE(ecp.session_rate, 0) ELSE 0 END
             ELSE
               CASE WHEN e.salary_type = 'SESSION_BASED' THEN COALESCE(e.session_rate, 0) ELSE 0 END
           END`
        : `CASE WHEN e.salary_type = 'SESSION_BASED' THEN COALESCE(e.session_rate, 0) ELSE 0 END`;

      const rows = await query<any>(
        `SELECT EXTRACT(YEAR  FROM s.start_date)::int AS y,
                EXTRACT(MONTH FROM s.start_date)::int AS m,
                sta.employee_id,
                (${rateExpr}) AS rate
           FROM session_teacher_attendance sta
           JOIN sessions s   ON s.id = sta.session_id
           JOIN employees e  ON e.id = sta.employee_id
           LEFT JOIN classes cl ON cl.id = s.class_id
           ${ecpJoin}
          WHERE s.company_id = $1
            AND sta.status = 'PRESENT'
            AND s.is_free = FALSE
            AND s.start_date::date < $2
            AND NOT EXISTS (
              SELECT 1 FROM session_salary_payments ssp
               WHERE ssp.session_id = s.id AND ssp.employee_id = sta.employee_id
            )${branchClause}`,
        params,
      );

      const round2 = (n: number) => Math.round(n * 100) / 100;
      let totalOutstanding = 0, sessionCount = 0;
      const teachers = new Set<string>();
      const periodMap = new Map<string, { year: number; month: number; amount: number; sessions: number }>();
      for (const r of rows as any[]) {
        const rate = r.rate != null ? parseFloat(r.rate) : 0;
        if (!(rate > 0)) continue;   // a percentage-paid course earns nothing here
        totalOutstanding += rate;
        sessionCount += 1;
        if (r.employee_id) teachers.add(r.employee_id);
        const key = `${r.y}-${r.m}`;
        const p = periodMap.get(key) ?? { year: r.y, month: r.m, amount: 0, sessions: 0 };
        p.amount = round2(p.amount + rate);
        p.sessions += 1;
        periodMap.set(key, p);
      }
      const periods = [...periodMap.values()].sort((a, b) => b.year - a.year || b.month - a.month);

      return {
        status: 200 as const,
        body: {
          totalOutstanding: round2(totalOutstanding),
          sessionCount,
          teacherCount: teachers.size,
          periods,
        },
      };
    } catch (error: any) {
      console.error('Session pay outstanding error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.SESSION_OUTSTANDING_FAILED', 'Failed to compute outstanding session pay');
    }
  },

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
             -- A monthly teacher with a per-course arrangement is owed for that
             -- course too, and would otherwise never appear on this page.
             OR (to_regclass('public.employee_course_percentages') IS NOT NULL AND EXISTS (
                   SELECT 1 FROM employee_course_percentages ecp WHERE ecp.employee_id = e.id
                 ))
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
        // The two teaching components are no longer alternatives: a per-course
        // arrangement can put one teacher on a percentage for one course and a
        // session fee for another (migration 090), so both are computed and
        // whichever apply are added together.
        const sessionPay = await getSessionPayForMonth(context.companyId, e, monthStart, monthEnd);
        const percentagePay = e.salary_type === 'PERCENTAGE' || (await hasPercentageRule(context.companyId, e.id))
          ? await getPercentageSummary(context.companyId, e)
          : null;
        const percentageOwed = percentagePay && percentagePay.owed > 0 ? percentagePay.owed : 0;

        if (e.salary_type === 'MONTHLY' || !e.salary_type) {
          // A monthly salary is its own item and keeps its own once-a-month rule.
          salaryItems.push({ ...base, amount: parseFloat(e.salary), salaryType: 'MONTHLY' });
        }

        const teachingAmount = Math.round((sessionPay.amount + percentageOwed) * 100) / 100;
        if (teachingAmount > 0) {
          const mixed = sessionPay.amount > 0 && percentageOwed > 0;
          salaryItems.push({
            ...base,
            amount: teachingAmount,
            salaryType: mixed ? 'MIXED' : (sessionPay.amount > 0 ? 'SESSION_BASED' : 'PERCENTAGE'),
            sessionCount: sessionPay.sessionIds.length,
            sessionRate: sessionPay.lines.length === 1 ? sessionPay.lines[0].rate : null,
            sessionLines: sessionPay.lines,
            percentageRate: percentagePay?.percentageRate ?? null,
            percentageAmount: percentageOwed,
            sessionAmount: sessionPay.amount,
          });
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
      // A per-course arrangement can be the ONLY thing a teacher is paid by, so
      // an employee-level rate of zero is no longer proof that nothing is owed.
      const hasAnyCourseRule = (await getCoursePayRules(context.companyId, emp.id)).size > 0;
      if (isSessionBased) {
        if ((!emp.session_rate || parseFloat(emp.session_rate) <= 0) && !hasAnyCourseRule) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no session rate configured');
        }
      } else if (isPercentage) {
        if ((!emp.percentage_rate || parseFloat(emp.percentage_rate) <= 0) && !hasAnyCourseRule) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no percentage rate configured');
        }
      } else if ((!emp.salary || parseFloat(emp.salary) <= 0) && !hasAnyCourseRule) {
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

      // Both teaching components in one payment, because a teacher can be on a
      // percentage for one course and a session fee for another (migration 090)
      // and they are owed the sum, not one or the other. Each component is
      // settled by its own mechanism below: the sessions are stamped paid, and
      // the percentage's withdrawn base moves by the whole payment.
      const sessionPay = await getSessionPayForMonth(context.companyId, emp, monthStart, monthEnd);
      const wantsPercentage = isPercentage || (await hasPercentageRule(context.companyId, emp.id));
      const percentageSummary = wantsPercentage ? await getPercentageSummary(context.companyId, emp) : null;
      const percentageOwed = percentageSummary && percentageSummary.owed > 0 ? percentageSummary.owed : 0;

      // A monthly salary is a third component, not an alternative to the other
      // two: a teacher on a monthly wage who also takes a percentage of one
      // course is owed both. It keeps its own once-a-month rule — already paid
      // this month means it contributes nothing, while the teaching components
      // can still be drawn.
      const monthlySalary = parseFloat(emp.salary || 0);
      let monthlyComponent = 0;
      let monthlyAlreadyPaid = false;
      if (!isSessionBased && !isPercentage && monthlySalary > 0) {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );
        monthlyAlreadyPaid = !!existing;
        if (!existing) monthlyComponent = monthlySalary;
      }

      unpaidSessionIds = sessionPay.sessionIds;
      baseSalary = Math.round((sessionPay.amount + percentageOwed + monthlyComponent) * 100) / 100;

      if (baseSalary <= 0) {
        // Say which of the three had nothing, rather than a generic refusal.
        if (isSessionBased) return apiError(400, 'ERRORS.EXPENSES.NO_UNPAID_SESSIONS', 'No unpaid sessions for this month');
        if (isPercentage) return apiError(400, 'ERRORS.EXPENSES.NO_PERCENTAGE_DUE', 'No percentage earnings available to withdraw');
        if (monthlyAlreadyPaid) return apiError(400, 'ERRORS.EXPENSES.SALARY_ALREADY_PAID', `Salary already paid for ${monthLabel}`);
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Nothing is owed to this employee for this month');
      }

      const parts: string[] = [];
      if (sessionPay.amount > 0) {
        parts.push(sessionPay.lines.length === 1
          ? `${sessionPay.lines[0].sessions} sessions × ${sessionPay.lines[0].rate}`
          : `${unpaidSessionIds.length} sessions across ${sessionPay.lines.length} courses`);
      }
      if (percentageOwed > 0) parts.push(`${percentageSummary!.percentageRate}% revenue share`);
      if (monthlyComponent > 0 && parts.length) parts.push('monthly salary');
      if (parts.length) {
        baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel} (${parts.join(' + ')})`;
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

      // Session pay has only a monthly window, so the report's session rows are
      // this calendar month's — the same month the salaries page settles.
      const now = new Date();
      const my = now.getUTCFullYear();
      const mm = now.getUTCMonth();
      const monthStart = fmtDate(my, mm, 1);
      const monthEnd = fmtDate(my, mm, new Date(Date.UTC(my, mm + 1, 0)).getUTCDate());

      const summary = await getPercentageSummary(context.companyId, emp);
      const [rows, unpaidRows, byCourse] = await Promise.all([
        getTeacherPaidLines(context.companyId, params.employeeId),
        getTeacherUnpaidLines(context.companyId, params.employeeId),
        getTeacherCourseBreakdown(context.companyId, emp, summary.percentageRate, monthStart, monthEnd),
      ]);

      // The rate that applies to one payment is a per-course question now: a
      // course on its own arrangement uses that, a session-paid course earns
      // nothing from student money (its teacher is paid per session), and
      // everything else falls back to the global rate.
      const rateByCourse = new Map<string, number>();
      for (const c of byCourse) {
        if (!c.courseId) continue;
        rateByCourse.set(c.courseId, c.method === 'SESSION' ? 0 : c.rate);
      }
      const lineRate = (courseId: string | null): number =>
        courseId && rateByCourse.has(courseId) ? rateByCourse.get(courseId)! : summary.percentageRate;

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
          // Earnings course by course, each in the terms it is paid on — a
          // percentage, a session fee, or attributed bundle money.
          byCourse,
          lines: rows.map((r) => {
            const amount = r.amount != null ? parseFloat(r.amount) : 0;
            const rate = lineRate(r.course_id ?? null);
            return {
              studentName: r.student_name || '',
              className: r.class_name ?? null,
              courseName: r.course_name ?? null,
              courseId: r.course_id ?? null,
              source: r.source,
              amount,
              // The rate that applies to THIS course, not one flat number — a
              // teacher can be on 90% of one course and 80% of another, and a
              // session-paid course earns nothing from this money at all.
              rate,
              // The teacher's cut of this one payment. Rounded per line, so the
              // column can drift a cent or two from `accrued` (rounded once on
              // the total) — accrued stays the figure of record.
              share: Math.round(amount * rate) / 100,
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


};
