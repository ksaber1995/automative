import { insert, query, queryOne } from '../db/connection';
import {
  ensureMonthlyInstallmentLedger,
  recordMonthlyInstallment,
  clearMonthlyInstallments,
} from '../db/payment-ledger';
import { ensureQrCardSchema, qrStudentMatch } from './qr-cards';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { issueReceipt, voidReceiptsFor } from '../db/receipts';
import { studentIsPresent, studentIsPresentById } from '../db/active-students';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The bill's subject is STILL billed monthly.
 *
 * Every query that CREATES or PROJECTS a bill already filters on
 * `payment_type = 'MONTHLY_SUBSCRIPTION'`, but the two that READ stored bills —
 * `list` and `stats` — did not, and that gap showed. Converting a tenant from
 * monthly to per-session turns each bill into a prepaid bundle carrying the same
 * balance; with the bills still listed here, the identical debt appeared on both
 * the monthly page and the bundles page, and the two pages disagreed on the
 * count. One debt, one place.
 *
 * The rows are NOT deleted. Their collection ledger
 * (monthly_subscription_installments) is what revenue is built from, and cascading
 * a delete through it would erase money that really was taken.
 *
 * COALESCE ends in MONTHLY_SUBSCRIPTION on purpose: a bill whose course or master
 * course has since been deleted keeps showing, because hiding a debt nobody can
 * explain is worse than showing an orphan. Expects `c` = courses and
 * `mc` = master_courses to be joined.
 */
const SUBJECT_STILL_MONTHLY =
  `COALESCE(c.payment_type, mc.payment_type, 'MONTHLY_SUBSCRIPTION') = 'MONTHLY_SUBSCRIPTION'`;

/** "March 2026" — the period a monthly receipt is for. */
function monthLabel(year: any, month: any): string {
  const m = Number(month);
  return `${MONTH_NAMES[m - 1] || m} ${Number(year)}`;
}

function mapPaymentFromDB(row: any) {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    // Set instead of enrollmentId/courseId when the bill is a per-month master
    // course's fee — the bundle is the subject, not one of its courses.
    masterEnrollmentId: row.master_enrollment_id ?? null,
    companyId: row.company_id,
    studentId: row.student_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    billingYear: parseInt(row.billing_year, 10),
    billingMonth: parseInt(row.billing_month, 10),
    amountDue: parseFloat(row.amount_due),
    amountPaid: parseFloat(row.amount_paid || 0),
    paymentStatus: row.payment_status,
    dueDate: row.due_date,
    paidDate: row.paid_date || null,
    notes: row.notes || null,
    refundedAmount: parseFloat(row.refunded_amount || 0),
    refundNote: row.refund_note || null,
    refundedAt: row.refunded_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPaymentWithDetailsFromDB(row: any) {
  return {
    ...mapPaymentFromDB(row),
    studentName: row.student_name,
    // The code, plus what the UI needs to decide whether it may be shown yet:
    // a TEACHER company only reveals it once the student's QR is live.
    studentCode: row.student_code ?? null,
    // The bundle's name for a master bill, the course's for a course bill.
    courseName: row.course_name,
    masterCourseId: row.master_course_id ?? null,
    branchName: row.branch_name,
    className: row.class_name || null,
    studentPhone: row.student_phone || null,
    parentPhone: row.parent_phone || null,
    parentName: row.parent_name || null,
    enrollmentStatus: row.enrollment_status || null,
    // False only when the row's query selected it and the student has LEFT —
    // the dashboard moves their unpaid bills to their own tab instead of
    // mixing them with students who are still expected to pay.
    studentIsActive: row.student_is_active !== false,
  };
}

function mapOverrideFromDB(row: any) {
  return {
    id: row.id,
    courseId: row.course_id,
    /** Set instead of courseId when the overridden thing is a per-month bundle. */
    masterCourseId: row.master_course_id ?? null,
    companyId: row.company_id,
    billingYear: parseInt(row.billing_year, 10),
    billingMonth: parseInt(row.billing_month, 10),
    overridePrice: parseFloat(row.override_price),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resolve overdue status on-read: any PENDING row past its due_date becomes OVERDUE */
export function resolveStatus(row: any): string {
  // REFUNDED is terminal — never re-derive it to OVERDUE on read.
  if (row.payment_status === 'REFUNDED') return 'REFUNDED';
  // A bill that owes nothing (100% discount) is settled the moment it exists.
  // Left as PENDING it would fall through to OVERDUE below and chase a free
  // student for money they were never charged.
  if (row.amount_due != null && parseFloat(row.amount_due) === 0) return 'PAID';
  if (row.payment_status === 'PAID' || row.payment_status === 'PARTIAL') return row.payment_status;
  const due = new Date(row.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return 'OVERDUE';
  return row.payment_status;
}

/**
 * Recalculate amount_due for all non-PAID bills of a course+month based on a
 * new effective price. Each student's amount scales proportionally:
 *   new_amount = effectivePrice * (enrollment.final_price / course.price)
 * Returns the number of bills updated.
 */
async function recalcBillsForCourseMonth(
  companyId: string,
  courseId: string,
  billingYear: number,
  billingMonth: number,
  effectivePrice: number,
): Promise<number> {
  // Get the course base price for ratio calculation
  const course = await queryOne<any>(
    'SELECT price FROM courses WHERE id = $1 AND company_id = $2',
    [courseId, companyId]
  );
  if (!course) return 0;
  const basePrice = parseFloat(course.price);
  if (basePrice <= 0) return 0;

  // Find all non-fully-paid bills for this course+month
  const bills = await query(
    `SELECT msp.id, msp.amount_paid,
            COALESCE(e.final_price, $5) AS enrollment_fee
     FROM monthly_subscription_payments msp
     JOIN enrollments e ON msp.enrollment_id = e.id
     WHERE msp.company_id = $1
       AND msp.course_id = $2
       AND msp.billing_year = $3
       AND msp.billing_month = $4
       AND msp.payment_status <> 'PAID'`,
    [companyId, courseId, billingYear, billingMonth, basePrice]
  );

  let updated = 0;
  for (const bill of bills) {
    const enrollmentFee = parseFloat(bill.enrollment_fee);
    const ratio = enrollmentFee / basePrice;
    const newAmountDue = Math.round(effectivePrice * ratio * 100) / 100;
    const amountPaid = parseFloat(bill.amount_paid || 0);

    // Determine new status based on recalculated amount
    let newStatus: string;
    let paidDate: string | null = null;
    if (amountPaid >= newAmountDue && newAmountDue > 0) {
      newStatus = 'PAID';
      paidDate = new Date().toISOString().split('T')[0];
    } else if (amountPaid > 0) {
      newStatus = 'PARTIAL';
    } else {
      newStatus = 'PENDING';
    }

    await query(
      `UPDATE monthly_subscription_payments
       SET amount_due = $1, payment_status = $2, paid_date = COALESCE($3, paid_date), updated_at = NOW()
       WHERE id = $4`,
      [newAmountDue, newStatus, paidDate, bill.id]
    );
    updated++;
  }
  return updated;
}

/**
 * The same recalculation for a master course sold per month.
 *
 * The subject is the bundle, so the ratio is the student's agreed monthly fee
 * against the master's list price rather than an enrolment's against a course's.
 * Bills already settled in full are left alone, exactly as the course version
 * leaves them: money that has changed hands is not repriced by a later decision
 * about the month.
 */
async function recalcBillsForMasterMonth(
  companyId: string,
  masterCourseId: string,
  billingYear: number,
  billingMonth: number,
  effectivePrice: number,
): Promise<number> {
  const master = await queryOne<any>(
    'SELECT default_price FROM master_courses WHERE id = $1 AND company_id = $2',
    [masterCourseId, companyId]
  );
  if (!master) return 0;
  const basePrice = parseFloat(master.default_price);
  if (basePrice <= 0) return 0;

  const bills = await query(
    `SELECT msp.id, msp.amount_paid,
            COALESCE(NULLIF(me.final_price, 0), $5) AS enrollment_fee
     FROM monthly_subscription_payments msp
     JOIN master_enrollments me ON msp.master_enrollment_id = me.id
     WHERE msp.company_id = $1
       AND me.master_course_id = $2
       AND msp.billing_year = $3
       AND msp.billing_month = $4
       AND msp.payment_status <> 'PAID'`,
    [companyId, masterCourseId, billingYear, billingMonth, basePrice]
  );

  let updated = 0;
  for (const bill of bills) {
    const ratio = parseFloat(bill.enrollment_fee) / basePrice;
    const newAmountDue = Math.round(effectivePrice * ratio * 100) / 100;
    const amountPaid = parseFloat(bill.amount_paid || 0);

    let newStatus: string;
    let paidDate: string | null = null;
    if (amountPaid >= newAmountDue && newAmountDue > 0) {
      newStatus = 'PAID';
      paidDate = new Date().toISOString().split('T')[0];
    } else if (amountPaid > 0) {
      newStatus = 'PARTIAL';
    } else {
      newStatus = 'PENDING';
    }

    await query(
      `UPDATE monthly_subscription_payments
       SET amount_due = $1, payment_status = $2, paid_date = COALESCE($3, paid_date), updated_at = NOW()
       WHERE id = $4`,
      [newAmountDue, newStatus, paidDate, bill.id]
    );
    updated++;
  }
  return updated;
}

/**
 * Make sure a month's bills EXIST.
 *
 * Bills used to appear only when an enrollment was created (which backfills up to
 * that day) or when staff pressed a "Generate" button — and that button was removed
 * from the UI, with no cron behind it. So on the 1st of a new month nothing created
 * the new rows: the month showed no unpaid students, and scanning a card offered
 * only the previous month's stale bill, because every read path can only return
 * rows that already exist.
 *
 * The rows are now materialised on demand by the read paths themselves. One
 * set-based statement, idempotent through the (enrollment_id, billing_year,
 * billing_month) unique key, so calling it on every page load costs an insert that
 * does nothing once the month is there.
 *
 * Only ACTIVE enrollments on active MONTHLY_SUBSCRIPTION courses are billed, and —
 * unlike the old generate loop — never for a month that ENDS BEFORE the student
 * enrolled, which would have invented debt for months they were not yet a student.
 *
 * amount_due mirrors the old JS maths: a course price override for the month is
 * scaled by the enrollment's own discount ratio (final_price / course price).
 * due_date is the first day of the billing month, computed in SQL — building it
 * from a LOCAL Date and serialising with toISOString() would, on any server east
 * of UTC, land a day early.
 */
/**
 * Per-STUDENT month prices: what one enrollment pays for one month, absolute.
 * A student who joined mid-month pays a prorated first month; the course-wide
 * override scales everyone, this names one student's figure exactly. Read by
 * every place a bill amount is computed (materialisation, single-bill collect,
 * future-month projection), so past, current and future months all honour it.
 */
let enrollmentMonthOverridesPromise: Promise<void> | null = null;
export async function ensureEnrollmentMonthOverrides(): Promise<void> {
  if (!enrollmentMonthOverridesPromise) {
    enrollmentMonthOverridesPromise = (async () => {
      try {
        await query(`CREATE TABLE IF NOT EXISTS enrollment_monthly_price_overrides (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          company_id UUID NOT NULL,
          enrollment_id UUID NOT NULL,
          billing_year INTEGER NOT NULL,
          billing_month INTEGER NOT NULL,
          override_price NUMERIC(10,2) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (enrollment_id, billing_year, billing_month)
        )`);
        await query(`CREATE INDEX IF NOT EXISTS idx_empo_company ON enrollment_monthly_price_overrides(company_id)`);
      } catch (e) {
        enrollmentMonthOverridesPromise = null;
        throw e;
      }
    })();
  }
  return enrollmentMonthOverridesPromise;
}

export async function ensureBillsForMonth(
  companyId: string,
  billingYear: number,
  billingMonth: number,
): Promise<number> {
  if (!Number.isInteger(billingYear) || !Number.isInteger(billingMonth)) return 0;
  if (billingMonth < 1 || billingMonth > 12) return 0;
  await ensureEnrollmentMonthOverrides();

  const rows = await query(
    `WITH period AS (
       SELECT make_date($2::int, $3::int, 1)                                  AS first_day,
              (make_date($2::int, $3::int, 1) + INTERVAL '1 month - 1 day')::date AS last_day
     )
     INSERT INTO monthly_subscription_payments
       (enrollment_id, company_id, student_id, course_id, branch_id,
        billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
     SELECT
       e.id, e.company_id, e.student_id, e.course_id, e.branch_id,
       $2::int, $3::int,
       -- A per-student month price outranks everything: it IS the figure staff
       -- typed for this enrollment and month. Otherwise the course-wide month
       -- override scales the fee; otherwise the fee itself.
       COALESCE(eo.override_price, CASE
         WHEN ov.override_price IS NOT NULL AND c.price > 0
           THEN ROUND(ov.override_price * (COALESCE(e.final_price, c.price) / c.price), 2)
         ELSE COALESCE(e.final_price, c.price)
       END),
       0, 'PENDING', period.first_day
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     CROSS JOIN period
     LEFT JOIN course_monthly_price_overrides ov
       ON ov.course_id = e.course_id
      AND ov.billing_year = $2::int
      AND ov.billing_month = $3::int
     LEFT JOIN enrollment_monthly_price_overrides eo
       ON eo.enrollment_id = e.id
      AND eo.billing_year = $2::int
      AND eo.billing_month = $3::int
     WHERE e.company_id = $1
       AND e.status = 'ACTIVE'
       -- never bill someone who has left. Their enrolment is still ACTIVE —
       -- marking a student left is the act staff perform, not cancelling their
       -- enrolments one by one — so without this a fresh bill is raised every
       -- month against a person who has gone, and the dues report chases it.
       AND ${studentIsPresentById('e.student_id')}
       AND c.payment_type = 'MONTHLY_SUBSCRIPTION'
       AND c.is_active = true
       -- Not if this enrolment came in through a master course — one-time or
       -- per-month, the bundle already covers it (its own fee is the bill, or
       -- there is none), so charging the member course too would bill the
       -- student twice for the same month. NOT EXISTS is null-safe: a plain
       -- enrolment has no master.
       AND NOT EXISTS (
         SELECT 1 FROM master_enrollments me
         WHERE me.id = e.master_enrollment_id
       )
       -- never bill a month that ended before the student even enrolled
       AND (e.enrollment_date IS NULL OR e.enrollment_date <= period.last_day)
       -- never bill a FUTURE month: a bill for a month that has not started yet is
       -- phantom debt. Nothing is owed before the month begins.
       AND period.first_day <= date_trunc('month', CURRENT_DATE)::date
     ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING
     RETURNING id`,
    [companyId, billingYear, billingMonth],
  );
  const masterRows = await ensureMasterBillsForMonth(companyId, billingYear, billingMonth);
  return (rows as any[]).length + masterRows;
}

/**
 * The same job for a master course sold per month: one bill a month for the
 * master enrolment itself, whatever the student attends inside it.
 *
 * The subject is the master enrolment, not a course enrolment — the whole point
 * of the bundle is that no single member course is what's being paid for. Priced
 * off the master enrolment's agreed fee, falling back to the master's list price
 * for rows that predate an agreed one.
 *
 * Every other rule is deliberately the same as the course version — active only,
 * nothing for a student who has left, nothing for a month that ended before they
 * joined, nothing for a month that has not started — because they are the same
 * rules about when money is owed, not rules about courses.
 */
async function ensureMasterBillsForMonth(
  companyId: string,
  billingYear: number,
  billingMonth: number,
): Promise<number> {
  const rows = await query(
    `WITH period AS (
       SELECT make_date($2::int, $3::int, 1)                                  AS first_day,
              (make_date($2::int, $3::int, 1) + INTERVAL '1 month - 1 day')::date AS last_day
     )
     INSERT INTO monthly_subscription_payments
       (master_enrollment_id, company_id, student_id, branch_id,
        billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
     SELECT
       me.id, me.company_id, me.student_id, me.branch_id,
       $2::int, $3::int,
       -- A month's override replaces the fee, scaled by whatever this student
       -- agreed to pay against the master's list price — the same proportional
       -- rule course bills use, so a student on a discounted fee keeps their
       -- discount through an overridden month.
       CASE
         WHEN ov.override_price IS NOT NULL AND mc.default_price > 0
           THEN ROUND(ov.override_price * (COALESCE(NULLIF(me.final_price, 0), mc.default_price) / mc.default_price), 2)
         ELSE COALESCE(NULLIF(me.final_price, 0), mc.default_price)
       END,
       0, 'PENDING', period.first_day
     FROM master_enrollments me
     JOIN master_courses mc ON mc.id = me.master_course_id
     CROSS JOIN period
     LEFT JOIN course_monthly_price_overrides ov
       ON ov.master_course_id = me.master_course_id
      AND ov.billing_year = $2::int
      AND ov.billing_month = $3::int
     WHERE me.company_id = $1
       AND me.status = 'ACTIVE'
       AND mc.payment_type = 'MONTHLY_SUBSCRIPTION'
       AND mc.is_active = true
       AND ${studentIsPresentById('me.student_id')}
       AND (me.enrollment_date IS NULL OR me.enrollment_date <= period.last_day)
       AND period.first_day <= date_trunc('month', CURRENT_DATE)::date
     ON CONFLICT (master_enrollment_id, billing_year, billing_month)
       WHERE master_enrollment_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [companyId, billingYear, billingMonth],
  );
  return (rows as any[]).length;
}

/** Today's year/month as the DATABASE sees it, so every caller agrees on "now". */
async function currentPeriod(): Promise<{ year: number; month: number }> {
  const row = await queryOne<any>(
    `SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS y, EXTRACT(MONTH FROM CURRENT_DATE)::int AS m`,
  );
  return { year: Number(row?.y), month: Number(row?.m) };
}

/**
 * Materialise every month in an inclusive range (the page's filter range), so the
 * table and its unpaid tab show the month you asked for — including the current one.
 *
 * A FUTURE month is never materialised: a bill for a month that has not started yet
 * is phantom debt, and once written it surfaced everywhere (the student page, the
 * dashboard) as money owed. The range is clamped to the current month even when a
 * caller filters forward — a future month simply shows no bills.
 * Bounded: a filter can only ever ask for a handful of months.
 */
async function ensureBillsForRange(
  companyId: string,
  fromKey: number,
  toKey: number,
): Promise<void> {
  if (!Number.isFinite(fromKey) || !Number.isFinite(toKey) || toKey < fromKey) return;
  // Clamp the range so it never reaches past the current month (the DB's "now").
  const cur = await currentPeriod();
  const curKey = cur.year * 12 + cur.month;
  if (toKey > curKey) toKey = curKey;
  if (toKey < fromKey) return;
  // A runaway range must not turn one page load into hundreds of writes.
  if (toKey - fromKey > 23) return;
  for (let key = fromKey; key <= toKey; key++) {
    const year = Math.floor((key - 1) / 12);
    const month = ((key - 1) % 12) + 1;
    await ensureBillsForMonth(companyId, year, month);
  }
}

/**
 * PROJECT (don't create) the bills a future month WOULD have. Same maths as
 * `ensureBillsForMonth`, but a SELECT — so viewing next month can show who would
 * owe and how much without writing a single row. Enrollments that already have a
 * real bill for the month are excluded (the real row is shown instead). Rows are
 * flagged `projected: true` and carry a synthetic, non-persisted id.
 *
 * Only ever called for a range already clamped to the future (> current month);
 * the current/past months are real rows materialised by ensureBillsForRange.
 */
async function projectBillsForRange(
  context: any,
  fromKey: number,
  toKey: number,
  branchId: string | undefined,
  courseId: string | undefined,
): Promise<any[]> {
  if (!Number.isFinite(fromKey) || !Number.isFinite(toKey) || toKey < fromKey) return [];
  await ensureEnrollmentMonthOverrides();   // the projection joins the table
  const params: any[] = [context.companyId, fromKey, toKey];
  const conds: string[] = [];
  if (branchId) {
    params.push(branchId);
    conds.push(`e.branch_id = $${params.length}`);
  } else {
    const bc = appendBranchSqlFilter(context, params, 'e.branch_id');
    if (bc) conds.push(bc);
  }
  if (courseId) {
    params.push(courseId);
    conds.push(`e.course_id = $${params.length}`);
  }
  const extra = conds.length ? ` AND ${conds.join(' AND ')}` : '';

  const rows = await query(
    `WITH periods AS (
       SELECT ((k - 1) / 12)      AS billing_year,
              ((k - 1) % 12) + 1  AS billing_month,
              make_date(((k - 1) / 12)::int, (((k - 1) % 12) + 1)::int, 1) AS first_day,
              (make_date(((k - 1) / 12)::int, (((k - 1) % 12) + 1)::int, 1)
                 + INTERVAL '1 month - 1 day')::date AS last_day
       FROM generate_series($2::int, $3::int) AS k
     )
     SELECT
       ('proj-' || e.id || '-' || p.billing_year || '-' || p.billing_month) AS id,
       e.id AS enrollment_id, e.company_id, e.student_id, e.course_id, e.branch_id,
       p.billing_year, p.billing_month,
       COALESCE(eo.override_price, CASE
         WHEN ov.override_price IS NOT NULL AND c.price > 0
           THEN ROUND(ov.override_price * (COALESCE(e.final_price, c.price) / c.price), 2)
         ELSE COALESCE(e.final_price, c.price)
       END) AS amount_due,
       0 AS amount_paid, 'PENDING' AS payment_status,
       p.first_day AS due_date, NULL AS paid_date, NULL AS notes,
       0 AS refunded_amount, NULL AS refund_note, NULL AS refunded_at,
       -- Not a stored row, but the schema wants non-null timestamps; the period's
       -- first day is a harmless, stable stand-in.
       p.first_day AS created_at, p.first_day AS updated_at,
       s.name AS student_name, s.student_code AS student_code,
       s.phone AS student_phone, s.parent_phone AS parent_phone, s.parent_name AS parent_name,
       c.name AS course_name, b.name AS branch_name, cl.name AS class_name,
       e.status AS enrollment_status
     FROM enrollments e
     JOIN courses  c ON c.id = e.course_id
     JOIN students s ON s.id = e.student_id
     JOIN branches b ON b.id = e.branch_id
     LEFT JOIN classes cl ON cl.id = e.class_id
     CROSS JOIN periods p
     LEFT JOIN course_monthly_price_overrides ov
       ON ov.course_id = e.course_id
      AND ov.billing_year = p.billing_year
      AND ov.billing_month = p.billing_month
     LEFT JOIN enrollment_monthly_price_overrides eo
       ON eo.enrollment_id = e.id
      AND eo.billing_year = p.billing_year
      AND eo.billing_month = p.billing_month
     LEFT JOIN monthly_subscription_payments existing
       ON existing.enrollment_id = e.id
      AND existing.billing_year = p.billing_year
      AND existing.billing_month = p.billing_month
     WHERE e.company_id = $1
       AND e.status = 'ACTIVE'
       -- Same rule for the rows shown before they are stored: a month that would
       -- never be billed must not be displayed as owed either.
       AND ${studentIsPresent('s')}
       AND c.payment_type = 'MONTHLY_SUBSCRIPTION'
       AND c.is_active = true
       AND (e.enrollment_date IS NULL OR e.enrollment_date <= p.last_day)
       AND existing.id IS NULL${extra}`,
    params,
  );

  return (rows as any[]).map((r) => ({
    ...mapPaymentWithDetailsFromDB(r),
    paymentStatus: resolveStatus(r),
    projected: true,
  }));
}

export const monthlySubscriptionsRoutes = {
  /** POST /api/monthly-subscriptions/generate
   *  Idempotent: creates one row per active enrollment in monthly courses for the given month.
   *  Uses ON CONFLICT DO NOTHING so running twice is safe.
   *  Respects course_monthly_price_overrides when computing amount_due.
   */
  generate: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { billingYear, billingMonth, courseId, branchId } = body;

      // due_date = first day of the billing month (built as a plain string so a
      // UTC conversion can never shift it a day early on servers east of UTC).
      const dueDateStr = `${billingYear}-${String(billingMonth).padStart(2, '0')}-01`;

      // Build query to find active enrollments in monthly-subscription courses.
      // If a price override exists for this course+month, scale the enrollment fee
      // proportionally: override_price * (enrollment.final_price / course.price).
      let sql = `
        SELECT
          e.id AS enrollment_id,
          e.student_id,
          e.course_id,
          e.branch_id,
          e.company_id,
          COALESCE(e.final_price, c.price) AS enrollment_fee,
          c.price AS course_price,
          ov.override_price
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        LEFT JOIN course_monthly_price_overrides ov
          ON ov.course_id = e.course_id
         AND ov.billing_year = $2
         AND ov.billing_month = $3
        WHERE e.company_id = $1
          AND e.status = 'ACTIVE'
          AND ${studentIsPresentById('e.student_id')}
          AND c.payment_type = 'MONTHLY_SUBSCRIPTION'
          AND c.is_active = true
      `;
      const params: any[] = [context.companyId, billingYear, billingMonth];

      if (courseId) {
        params.push(courseId);
        sql += ` AND e.course_id = $${params.length}`;
      }
      if (branchId) {
        if (!canAccessBranch(context, branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      const enrollments = await query(sql, params);

      let generated = 0;
      for (const enr of enrollments) {
        const enrollmentFee = parseFloat(enr.enrollment_fee);
        const coursePrice = parseFloat(enr.course_price);
        let monthlyFee = enrollmentFee;

        // If an override exists, scale proportionally
        if (enr.override_price != null && coursePrice > 0) {
          const overridePrice = parseFloat(enr.override_price);
          const ratio = enrollmentFee / coursePrice;
          monthlyFee = Math.round(overridePrice * ratio * 100) / 100;
        }

        // ON CONFLICT DO NOTHING — idempotent
        const result = await query(
          `INSERT INTO monthly_subscription_payments
             (enrollment_id, company_id, student_id, course_id, branch_id,
              billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'PENDING', $9)
           ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING`,
          [
            enr.enrollment_id, enr.company_id, enr.student_id,
            enr.course_id, enr.branch_id,
            billingYear, billingMonth, monthlyFee, dueDateStr,
          ]
        );
        if ((result as any).rowCount > 0) generated++;
      }

      const monthLabel = `${billingYear}-${String(billingMonth).padStart(2, '0')}`;
      return {
        status: 201 as const,
        body: { generated, month: monthLabel },
      };
    } catch (error) {
      console.error('Generate monthly bills error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.GENERATE_FAILED', 'Failed to generate monthly bills', 400);
    }
  },

  /** GET /api/monthly-subscriptions?billingYear=&billingMonth=&branchId=&courseId=&status= */
  list: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Inclusive month range, encoded as year*12+month so it compares cleanly
      // across year boundaries (e.g. last 3 months ending in January).
      const fromKey = parseInt(q.fromYear, 10) * 12 + parseInt(q.fromMonth, 10);
      const toKey = parseInt(q.toYear, 10) * 12 + parseInt(q.toMonth, 10);

      // The months being asked for might never have been billed — nothing rolls the
      // bills over. Create them first, or the current month reads as "nobody owes
      // anything" when in fact nobody has been charged.
      await ensureBillsForRange(context.companyId, fromKey, toKey);

      const conditions: string[] = [
        'msp.company_id = $1',
        '(msp.billing_year * 12 + msp.billing_month) BETWEEN $2 AND $3',
        SUBJECT_STILL_MONTHLY,
      ];
      const params: any[] = [context.companyId, fromKey, toKey];

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`msp.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'msp.branch_id');
        if (branchClause) conditions.push(branchClause);
      }

      if (q.courseId) {
        params.push(q.courseId);
        conditions.push(`msp.course_id = $${params.length}`);
      }

      const rows = await query(
        `SELECT
           msp.*,
           s.name AS student_name,
           s.student_code AS student_code,
           s.phone        AS student_phone,
           s.parent_phone AS parent_phone,
           s.parent_name  AS parent_name,
           -- A master bill names the bundle, since no single course is what the
           -- student is paying for. COALESCE rather than two columns: every
           -- caller wants "what is this bill for", and the answer is one string.
           COALESCE(c.name, mc.name) AS course_name,
           mc.id        AS master_course_id,
           b.name       AS branch_name,
           cl.name      AS class_name,
           COALESCE(e.status, me.status) AS enrollment_status,
           COALESCE(s.is_active, true)   AS student_is_active
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN courses c ON msp.course_id = c.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         LEFT JOIN master_enrollments me ON msp.master_enrollment_id = me.id
         LEFT JOIN master_courses mc     ON mc.id = me.master_course_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, s.name`,
        params
      );

      // Apply on-read overdue resolution.
      let result = rows.map((r: any) => ({
        ...mapPaymentWithDetailsFromDB(r),
        paymentStatus: resolveStatus(r),
      }));

      // Future months are PROJECTED, not created: fold in virtual rows for any
      // month in the range past the current one, so staff see who would owe next
      // month without a single write. Real early collections already sit in
      // `result` and are excluded from the projection.
      const cur = await currentPeriod();
      const curKey = cur.year * 12 + cur.month;
      const futureFrom = Math.max(fromKey, curKey + 1);
      if (futureFrom <= toKey) {
        const projected = await projectBillsForRange(context, futureFrom, toKey, q.branchId, q.courseId);
        result = result.concat(projected);
      }

      // Newest month first, then by student — the real rows arrived already
      // ordered, but projected rows are now interleaved and must re-sort.
      result.sort((a: any, b: any) => {
        const ak = a.billingYear * 12 + a.billingMonth;
        const bk = b.billingYear * 12 + b.billingMonth;
        if (ak !== bk) return bk - ak;
        return (a.studentName || '').localeCompare(b.studentName || '');
      });

      if (q.status && q.status !== 'ALL') {
        result = result.filter((r: any) => r.paymentStatus === q.status);
      }

      return { status: 200 as const, body: result };
    } catch (error) {
      console.error('List monthly payments error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to list monthly payments');
    }
  },

  /**
   * GET /api/monthly-subscriptions/held?branchId=
   * Held (ON_HOLD) monthly subscriptions. These generate no bills, so they
   * never appear in `list`; this surfaces them for the dashboard's On-Hold view.
   */
  listHeld: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const conditions: string[] = [
        'e.company_id = $1',
        `e.status = 'ON_HOLD'`,
        `e.payment_type = 'MONTHLY_SUBSCRIPTION'`,
      ];
      const params: any[] = [context.companyId];

      if (q?.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`e.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchClause) conditions.push(branchClause);
      }

      const rows = await query(
        `SELECT
           e.id           AS enrollment_id,
           e.student_id,
           e.course_id,
           e.branch_id,
           e.hold_start_month,
           e.hold_start_year,
           s.name AS student_name,
           s.student_code AS student_code,
           c.name         AS course_name,
           b.name         AS branch_name,
           cl.name        AS class_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN courses  c ON e.course_id  = c.id
         JOIN branches b ON e.branch_id  = b.id
         LEFT JOIN classes cl ON e.class_id = cl.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY s.name`,
        params
      );

      const result = rows.map((r: any) => ({
        enrollmentId: r.enrollment_id,
        studentId: r.student_id,
        courseId: r.course_id,
        branchId: r.branch_id,
        studentName: r.student_name,
        studentCode: r.student_code ?? null,
        courseName: r.course_name,
        branchName: r.branch_name,
        className: r.class_name || null,
        holdStartMonth: r.hold_start_month != null ? Number(r.hold_start_month) : null,
        holdStartYear: r.hold_start_year != null ? Number(r.hold_start_year) : null,
      }));

      return { status: 200 as const, body: result };
    } catch (error) {
      console.error('List held subscriptions error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to list held subscriptions');
    }
  },

  /** GET /api/monthly-subscriptions/summary?billingYear=&billingMonth=&branchId= */
  summary: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const fromKey = parseInt(q.fromYear, 10) * 12 + parseInt(q.fromMonth, 10);
      const toKey = parseInt(q.toYear, 10) * 12 + parseInt(q.toMonth, 10);

      // Same materialisation as list(): the summary runs in parallel with it, and
      // counters that disagree with the table underneath them are worse than slow.
      await ensureBillsForRange(context.companyId, fromKey, toKey);

      const conditions: string[] = [
        'msp.company_id = $1',
        '(msp.billing_year * 12 + msp.billing_month) BETWEEN $2 AND $3',
        // Must agree with list() or the counters contradict the table they sit above.
        SUBJECT_STILL_MONTHLY,
      ];
      const params: any[] = [context.companyId, fromKey, toKey];

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`msp.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'msp.branch_id');
        if (branchClause) conditions.push(branchClause);
      }

      // is_live_billing marks a bill that still represents a real billing
      // relationship. A bill outlives the thing that created it: drop the
      // enrollment or deactivate the student and the row stays, so counting rows
      // over-reports. The money columns are read from EVERY row regardless —
      // cash already collected does not stop existing because someone left.
      const rows = await query(
        `SELECT msp.student_id, msp.payment_status, msp.due_date, msp.amount_due, msp.amount_paid, msp.refunded_amount,
                (COALESCE(e.status, me.status) = 'ACTIVE' AND COALESCE(s.is_active, true)) AS is_live_billing,
                COALESCE(s.is_active, true) AS student_is_active
         FROM monthly_subscription_payments msp
         LEFT JOIN enrollments e ON e.id = msp.enrollment_id
         LEFT JOIN master_enrollments me ON me.id = msp.master_enrollment_id
         -- Joined only so SUBJECT_STILL_MONTHLY can be applied here too; list()
         -- already had both, which is why the gap showed up as two pages
         -- disagreeing rather than as a wrong total.
         LEFT JOIN courses c ON c.id = msp.course_id
         LEFT JOIN master_courses mc ON mc.id = me.master_course_id
         JOIN students s ON s.id = msp.student_id
         WHERE ${conditions.join(' AND ')}`,
        params
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let paidCount = 0, pendingCount = 0, overdueCount = 0, partialCount = 0;
      let totalRevenue = 0, totalExpected = 0, totalRefunded = 0;
      // Students, not bills: one student enrolled on two monthly courses is one
      // student with two bills, and used to be counted twice.
      const billedStudents = new Set<string>();

      for (const r of rows) {
        if (r.is_live_billing) billedStudents.add(r.student_id);
        const status = resolveStatus(r);
        const refunded = parseFloat(r.refunded_amount || 0);
        totalRefunded += refunded;
        // Refunded bills count only their net retained revenue (gross amount_paid
        // minus what was refunded); they are not "expected" and don't belong in
        // the pending/overdue buckets.
        if (status === 'REFUNDED') {
          totalRevenue += parseFloat(r.amount_paid || 0) - refunded;
          continue;
        }
        totalExpected += parseFloat(r.amount_due);
        // Net of any partial refund recorded against a still-active bill.
        totalRevenue += parseFloat(r.amount_paid || 0) - refunded;
        // The unpaid counters match the tabs below them: a student who has
        // LEFT is not pending/partial/overdue — their bills live on the
        // Left-with-dues tab. Paid stays paid whoever paid it, and the money
        // sums above deliberately keep every row.
        if (status === 'PAID') paidCount++;
        else if (r.student_is_active !== false) {
          if (status === 'PARTIAL') partialCount++;
          else if (status === 'OVERDUE') overdueCount++;
          else pendingCount++;
        }
      }

      // Fold in PROJECTED future months so the counters agree with the table
      // underneath them (list() shows the same projected rows). Nothing is written.
      const curP = await currentPeriod();
      const curKeyS = curP.year * 12 + curP.month;
      const futureFromS = Math.max(fromKey, curKeyS + 1);
      if (futureFromS <= toKey) {
        const projected = await projectBillsForRange(context, futureFromS, toKey, q.branchId, undefined);
        for (const p of projected) {
          billedStudents.add(p.studentId);
          totalExpected += p.amountDue;
          // A projected month is never overdue (it has not started); a fully
          // discounted student reads as PAID, everyone else is pending.
          if (p.paymentStatus === 'PAID') paidCount++;
          else pendingCount++;
        }
      }

      // The counts are how the desk works — who has paid, who is overdue — so
      // they follow `enrollments: read` like the table underneath them. The money
      // totals are a different thing to know: what the academy takes in a month.
      // Someone hired to collect fees needs the first and not the second, so the
      // totals are omitted here rather than hidden in the UI — a hidden tile is
      // still a number sitting in the network response.
      const canSeeMoney = checkGranularPermission(context, 'revenues', 'read');

      return {
        status: 200 as const,
        body: {
          // Echo the range end so the client can label the period.
          billingYear: parseInt(q.toYear, 10),
          billingMonth: parseInt(q.toMonth, 10),
          totalStudents: billedStudents.size,
          paidCount,
          pendingCount,
          overdueCount,
          partialCount,
          ...(canSeeMoney ? { totalRevenue, totalExpected, totalRefunded } : {}),
        },
      };
    } catch (error) {
      console.error('Monthly summary error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.SUMMARY_FAILED', 'Failed to get summary');
    }
  },

  /** POST /api/monthly-subscriptions/:id/pay */
  recordPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensureMonthlyInstallmentLedger();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne<any>(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_FOUND', 'Payment record not found');

      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const amountDue = parseFloat(row.amount_due);
      const currentPaid = parseFloat(row.amount_paid || 0);
      const pay = parseFloat(body.amount);
      // Guarded so a malformed request can never desync amount_paid from the
      // installment ledger below (collect() has always validated the same way).
      if (!isFinite(pay) || pay <= 0) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.BAD_AMOUNT', 'Payment amount must be greater than zero');
      }
      const newPaid = currentPaid + pay;

      // paid_date is now only "when was this bill last paid" for display/status —
      // revenue is bucketed by each installment's own date (see the ledger insert
      // below), so a second payment no longer drags earlier money onto today.
      // Still stamped for PARTIAL as well as PAID, defaulting to today.
      const effectiveDate = body.paymentDate || new Date().toISOString().split('T')[0];
      let newStatus: string;
      let paidDate: string | null = null;
      if (newPaid >= amountDue) {
        newStatus = 'PAID';
        paidDate = effectiveDate;
      } else if (newPaid > 0) {
        newStatus = 'PARTIAL';
        paidDate = effectiveDate;
      } else {
        newStatus = 'PENDING';
      }

      await query(
        `UPDATE monthly_subscription_payments
         SET amount_paid = $1, payment_status = $2, paid_date = $3, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $5`,
        [newPaid, newStatus, paidDate, body.notes || null, params.id]
      );

      // Record THIS collection on its own date. No separate revenues row is
      // written: the ledger is the single source of truth for dated subscription
      // revenue, and the bill row for status/dues.
      await recordMonthlyInstallment(row, pay, effectiveDate, body.notes || null, context.userId);

      const receipt = await issueReceipt({
        companyId: context.companyId,
        sourceType: 'MONTHLY',
        sourceId: row.id,
        studentId: row.student_id,
        courseId: row.course_id,
        branchId: row.branch_id,
        amount: pay,
        paymentDate: effectiveDate,
        totalDue: amountDue,
        paidToDate: newPaid,
        periodLabel: monthLabel(row.billing_year, row.billing_month),
        notes: body.notes || null,
        recordedByUserId: context.userId,
      });

      const updated = await queryOne(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1',
        [params.id]
      );

      return { status: 200 as const, body: { ...mapPaymentFromDB(updated), receipt } };
    } catch (error) {
      console.error('Record monthly payment error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.PAY_FAILED', 'Failed to record payment', 400);
    }
  },

  /**
   * POST /api/monthly-subscriptions/collect
   * Collect a payment for a month that has no bill yet — the ONLY path that
   * creates a future bill. It materialises the single row for THIS one enrollment
   * (never the whole tenant), then records the payment on it, atomically enough
   * that a future month never exists as unpaid phantom debt: the row is born with
   * money on it. If the bill already exists (a prior collect, or a real early
   * one), it just records the payment on it.
   */
  collect: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensureMonthlyInstallmentLedger();
      await ensureEnrollmentMonthOverrides();   // the bill insert joins the table
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { enrollmentId, billingYear, billingMonth, amount, paymentDate, notes } = body;
      if (!Number.isInteger(billingYear) || !Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.BAD_PERIOD', 'Invalid billing month');
      }
      const pay = parseFloat(amount);
      if (!(pay > 0)) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.BAD_AMOUNT', 'Payment amount must be greater than zero');
      }

      const enr = await queryOne<any>(
        `SELECT e.id, e.branch_id, c.payment_type, c.is_active AS course_active
           FROM enrollments e JOIN courses c ON c.id = e.course_id
          WHERE e.id = $1 AND e.company_id = $2`,
        [enrollmentId, context.companyId]
      );
      if (!enr) return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_FOUND', 'Enrollment not found');
      if (!canAccessBranch(context, enr.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      if (enr.payment_type !== 'MONTHLY_SUBSCRIPTION' || !enr.course_active) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_MONTHLY', 'Not an active monthly subscription');
      }

      // Create the single bill for this enrollment+month, computing amount_due the
      // same way ensureBillsForMonth does (course price / discounted fee, scaled by
      // any month override). Guarded so a month before the student enrolled makes
      // nothing. Idempotent — a bill already there is left as-is.
      await query(
        `WITH period AS (
           SELECT make_date($2::int, $3::int, 1) AS first_day,
                  (make_date($2::int, $3::int, 1) + INTERVAL '1 month - 1 day')::date AS last_day
         )
         INSERT INTO monthly_subscription_payments
           (enrollment_id, company_id, student_id, course_id, branch_id,
            billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
         SELECT e.id, e.company_id, e.student_id, e.course_id, e.branch_id,
           $2::int, $3::int,
           COALESCE(eo.override_price, CASE
             WHEN ov.override_price IS NOT NULL AND c.price > 0
               THEN ROUND(ov.override_price * (COALESCE(e.final_price, c.price) / c.price), 2)
             ELSE COALESCE(e.final_price, c.price)
           END),
           0, 'PENDING', period.first_day
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         CROSS JOIN period
         LEFT JOIN course_monthly_price_overrides ov
           ON ov.course_id = e.course_id AND ov.billing_year = $2::int AND ov.billing_month = $3::int
         LEFT JOIN enrollment_monthly_price_overrides eo
           ON eo.enrollment_id = e.id AND eo.billing_year = $2::int AND eo.billing_month = $3::int
         WHERE e.id = $1 AND e.company_id = $4
           AND e.status = 'ACTIVE'
           AND c.payment_type = 'MONTHLY_SUBSCRIPTION'
           AND c.is_active = true
           AND (e.enrollment_date IS NULL OR e.enrollment_date <= period.last_day)
         ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING`,
        [enrollmentId, billingYear, billingMonth, context.companyId]
      );

      const bill = await queryOne<any>(
        `SELECT * FROM monthly_subscription_payments
          WHERE enrollment_id = $1 AND billing_year = $2 AND billing_month = $3`,
        [enrollmentId, billingYear, billingMonth]
      );
      // No row means the guard rejected it — the month is before the student enrolled.
      if (!bill) return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_BILLABLE', 'This student is not billable for that month');

      const amountDue = parseFloat(bill.amount_due);
      const newPaid = parseFloat(bill.amount_paid || 0) + pay;
      const effectiveDate = paymentDate || new Date().toISOString().split('T')[0];
      let newStatus: string;
      let paidDate: string | null = null;
      if (newPaid >= amountDue) { newStatus = 'PAID'; paidDate = effectiveDate; }
      else if (newPaid > 0) { newStatus = 'PARTIAL'; paidDate = effectiveDate; }
      else { newStatus = 'PENDING'; }

      await query(
        `UPDATE monthly_subscription_payments
            SET amount_paid = $1, payment_status = $2, paid_date = $3, notes = COALESCE($4, notes), updated_at = NOW()
          WHERE id = $5`,
        [newPaid, newStatus, paidDate, notes || null, bill.id]
      );

      // This collection, on its own date — see recordPayment.
      await recordMonthlyInstallment(bill, pay, effectiveDate, notes || null, context.userId);

      const receipt = await issueReceipt({
        companyId: context.companyId,
        sourceType: 'MONTHLY',
        sourceId: bill.id,
        studentId: bill.student_id,
        courseId: bill.course_id,
        branchId: bill.branch_id,
        amount: pay,
        paymentDate: effectiveDate,
        totalDue: amountDue,
        paidToDate: newPaid,
        periodLabel: monthLabel(bill.billing_year, bill.billing_month),
        notes: notes || null,
        recordedByUserId: context.userId,
      });

      const updated = await queryOne('SELECT * FROM monthly_subscription_payments WHERE id = $1', [bill.id]);
      return { status: 200 as const, body: { ...mapPaymentFromDB(updated), receipt } };
    } catch (error) {
      console.error('Collect monthly payment error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.PAY_FAILED', 'Failed to collect payment', 400);
    }
  },

  /** POST /api/monthly-subscriptions/:id/void
   *  Reverse a recorded payment: clears amount_paid and resets the bill to unpaid.
   *  The installment ledger rows go with it, so every day this money was booked on
   *  loses it — a void is "this never happened", unlike a refund.
   */
  voidPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensureMonthlyInstallmentLedger();
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_FOUND', 'Payment record not found');

      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const reason = body?.reason ? String(body.reason).slice(0, 500) : null;

      await query(
        `UPDATE monthly_subscription_payments
         SET amount_paid = 0, payment_status = 'PENDING', paid_date = NULL,
             notes = $2, updated_at = NOW()
         WHERE id = $1`,
        [params.id, reason ? 'Voided: ' + reason : 'Payment voided']
      );

      await clearMonthlyInstallments(params.id);
      // The printed slip stays resolvable, but now reads "cancelled".
      await voidReceiptsFor('MONTHLY', params.id);

      const updated = await queryOne(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1',
        [params.id]
      );

      return { status: 200 as const, body: mapPaymentFromDB(updated) };
    } catch (error) {
      console.error('Void monthly payment error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.VOID_FAILED', 'Failed to void payment', 400);
    }
  },

  /** POST /api/monthly-subscriptions/:id/refund
   *  Return money to a leaving student. Unlike void (a mistake reset, which
   *  deletes the money), a refund leaves the collected amount and its installment
   *  rows alone — the cash really was taken on those days — and books the return
   *  as a refunds row dated when it was handed back, which every revenue read
   *  subtracts. Records the amount + note and marks the bill REFUNDED.
   *  Optionally stops the underlying subscription (HOLD or CANCEL).
   *    body: { type: 'FULL'|'PARTIAL', amount?, note?, subscriptionAction? }
   */
  refund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne<any>(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_FOUND', 'Payment record not found');
      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const currentPaid = parseFloat(row.amount_paid || 0);
      if (currentPaid <= 0) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOTHING_TO_REFUND', 'There is no paid amount to refund');
      }

      const type = body?.type === 'PARTIAL' ? 'PARTIAL' : 'FULL';
      let refundAmt: number;
      if (type === 'FULL') {
        refundAmt = currentPaid;
      } else {
        refundAmt = parseFloat(body?.amount);
        if (!isFinite(refundAmt) || refundAmt <= 0) {
          return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.INVALID_REFUND_AMOUNT', 'Refund amount must be greater than zero');
        }
        if (refundAmt > currentPaid) {
          return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.REFUND_EXCEEDS_PAID', 'Refund amount cannot exceed the amount paid');
        }
      }

      const newRefunded = Math.round((parseFloat(row.refunded_amount || 0) + refundAmt) * 100) / 100;
      const note = body?.note ? String(body.note).slice(0, 500) : null;
      const refundDate = new Date().toISOString().split('T')[0];

      // amount_paid is left UNCHANGED (gross collected revenue) — the same rule
      // enrollment refunds follow: revenue queries sum amount_paid and subtract
      // the refunds table separately (by refund_date). refunded_amount tracks the
      // returned total for display, like enrollments.total_refunded.
      await query(
        `UPDATE monthly_subscription_payments
         SET payment_status = 'REFUNDED', refunded_amount = $1,
             refund_note = $2, refunded_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [newRefunded, note, params.id]
      );

      // Record in the polymorphic refunds table so the refund shows on the
      // Refunds page, the dashboard, and the P&L reports. enrollment_id ties it
      // to the enrollment (source = ENROLLMENT); monthly_payment_id links the
      // exact bill (and makes the backfill idempotent).
      await query(
        `INSERT INTO refunds (company_id, enrollment_id, monthly_payment_id, branch_id, student_id, amount, refund_date, type, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [context.companyId, row.enrollment_id, params.id, row.branch_id, row.student_id, refundAmt, refundDate, type, note]
      );

      // Optionally stop the subscription so no further bills are generated.
      const action = body?.subscriptionAction;
      if (action === 'CANCEL') {
        await query(
          `UPDATE enrollments SET status = 'DROPPED', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
          [row.enrollment_id, context.companyId]
        );
      } else if (action === 'HOLD') {
        const now = new Date();
        await query(
          `UPDATE enrollments
           SET status = 'ON_HOLD', hold_start_month = $2, hold_start_year = $3, hold_months = NULL, updated_at = NOW()
           WHERE id = $1 AND company_id = $4 AND status <> 'ON_HOLD'`,
          [row.enrollment_id, now.getMonth() + 1, now.getFullYear(), context.companyId]
        );
      }

      const updated = await queryOne('SELECT * FROM monthly_subscription_payments WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapPaymentFromDB(updated) };
    } catch (error) {
      console.error('Refund monthly payment error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.REFUND_FAILED', 'Failed to refund payment', 400);
    }
  },

  /** GET /api/monthly-subscriptions/by-token/:qrToken
   *  Resolve a scanned student barcode (QR token) to that student and their
   *  still-outstanding monthly bills (anything not fully paid), oldest first.
   *  Powers the "scan barcode → pick a due month → record payment" flow.
   */
  byToken: async ({ params, headers }: { params: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const token = (params.qrToken || '').trim();
      if (!token) {
        return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.STUDENT_NOT_FOUND', 'Student not found for this code');
      }

      // Scan a card in July and July must be on offer. The due list can only return
      // rows that exist, so make sure THIS month's bills exist before reading them —
      // otherwise the picker shows June and takes the money for the wrong month.
      const { year, month } = await currentPeriod();
      await ensureBillsForMonth(context.companyId, year, month);

      // Scope the lookup to the caller's company — a token from another company
      // must not resolve.
      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne<any>(
        `SELECT s.id, s.name FROM students s
         WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2 AND s.is_active = true`,
        [token, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.STUDENT_NOT_FOUND', 'Student not found for this code');
      }

      const rows = await query(
        `SELECT
           msp.*,
           s.name AS student_name,
           s.student_code AS student_code,
           COALESCE(c.name, mc.name) AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN courses c ON msp.course_id = c.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         LEFT JOIN master_enrollments me ON msp.master_enrollment_id = me.id
         LEFT JOIN master_courses mc     ON mc.id = me.master_course_id
         WHERE msp.company_id = $1
           AND msp.student_id = $2
           AND msp.payment_status <> 'REFUNDED'
           AND (msp.amount_due - msp.amount_paid) > 0
         ORDER BY msp.billing_year ASC, msp.billing_month ASC, c.name`,
        [context.companyId, student.id]
      );

      // Respect branch scoping for branch-limited users.
      const dueMonths = rows
        .filter((r: any) => canAccessBranch(context, r.branch_id))
        .map((r: any) => ({
          ...mapPaymentWithDetailsFromDB(r),
          paymentStatus: resolveStatus(r),
        }));

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentName: student.name,
          dueMonths,
        },
      };
    } catch (error) {
      console.error('Monthly by-token lookup error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to load due months for this code');
    }
  },

  /** GET /api/monthly-subscriptions/course/:courseId */
  listByCourse: async ({ params, query: q, headers }: { params: { courseId: string }; query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const conditions: string[] = ['msp.company_id = $1', 'msp.course_id = $2'];
      const sqlParams: any[] = [context.companyId, params.courseId];

      if (q.billingYear) {
        sqlParams.push(parseInt(q.billingYear, 10));
        conditions.push(`msp.billing_year = $${sqlParams.length}`);
      }
      if (q.billingMonth) {
        sqlParams.push(parseInt(q.billingMonth, 10));
        conditions.push(`msp.billing_month = $${sqlParams.length}`);
      }

      const rows = await query(
        `SELECT
           msp.*,
           s.name AS student_name,
           s.student_code AS student_code,
           COALESCE(c.name, mc.name) AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN courses c ON msp.course_id = c.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         LEFT JOIN master_enrollments me ON msp.master_enrollment_id = me.id
         LEFT JOIN master_courses mc     ON mc.id = me.master_course_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, s.name`,
        sqlParams
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          ...mapPaymentWithDetailsFromDB(r),
          paymentStatus: resolveStatus(r),
        })),
      };
    } catch (error) {
      console.error('List by course error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to list payments by course');
    }
  },

  /** GET /api/monthly-subscriptions/student/:studentId
   *  Every monthly bill for one student (newest month first), grouped by
   *  enrollment on the client. Powers the monthly-subscription panel on the
   *  student detail page.
   */
  listByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query(
        `SELECT
           msp.*,
           s.name AS student_name,
           s.student_code AS student_code,
           COALESCE(c.name, mc.name) AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN courses c ON msp.course_id = c.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         LEFT JOIN master_enrollments me ON msp.master_enrollment_id = me.id
         LEFT JOIN master_courses mc     ON mc.id = me.master_course_id
         WHERE msp.company_id = $1
           AND msp.student_id = $2
           -- Same guard as every monthly billing/dues query: converting a course
           -- to per-session keeps its old monthly bills as history (their debt
           -- lives on as bundles), and this is what stops them reading as unpaid
           -- months on the student page. Master-bundle bills have no course row
           -- and are always genuinely monthly.
           AND (msp.master_enrollment_id IS NOT NULL OR c.payment_type = 'MONTHLY_SUBSCRIPTION')
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, COALESCE(c.name, mc.name)`,
        [context.companyId, params.studentId]
      );

      // Respect branch scoping for branch-limited users.
      const result = rows
        .filter((r: any) => canAccessBranch(context, r.branch_id))
        .map((r: any) => ({
          ...mapPaymentWithDetailsFromDB(r),
          paymentStatus: resolveStatus(r),
        }));

      return { status: 200 as const, body: result };
    } catch (error) {
      console.error('List by student error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to list payments by student');
    }
  },

  /**
   * GET /api/monthly-subscriptions/student/:studentId/unpaid
   *
   * What this student still owes, for the prompt shown when they are marked as
   * having left. Split by whether any money was ever collected, because that is
   * the line between "a bill nobody should chase" and "a debt someone part-paid":
   *
   *   clearable — nothing collected. Safe to drop; nothing is lost but a row
   *               that was going to sit in the dues report forever.
   *   keeping   — money changed hands. Never offered for deletion here; writing
   *               off a part-paid month is a decision with a receipt behind it.
   */
  unpaidForStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query<any>(
        `SELECT msp.id, msp.billing_year, msp.billing_month, msp.amount_due, msp.amount_paid,
                msp.payment_status, msp.branch_id,
                COALESCE(c.name, mc.name) AS course_name
           FROM monthly_subscription_payments msp
           LEFT JOIN courses c ON c.id = msp.course_id
           LEFT JOIN master_enrollments me ON msp.master_enrollment_id = me.id
           LEFT JOIN master_courses mc     ON mc.id = me.master_course_id
          WHERE msp.company_id = $1
            AND msp.student_id = $2
            AND msp.amount_due - COALESCE(msp.amount_paid, 0) > 0
          ORDER BY msp.billing_year, msp.billing_month`,
        [context.companyId, params.studentId]
      );

      const visible = rows.filter((r) => canAccessBranch(context, r.branch_id));
      const money = (v: any) => (v === null || v === undefined ? 0 : parseFloat(v));
      const bills = visible.map((r) => {
        const due = money(r.amount_due);
        const paid = money(r.amount_paid);
        return {
          id: r.id,
          courseName: r.course_name,
          billingYear: Number(r.billing_year),
          billingMonth: Number(r.billing_month),
          amountDue: due,
          amountPaid: paid,
          outstanding: Math.round((due - paid) * 100) / 100,
          paymentStatus: r.payment_status,
          /** Nothing collected — this one may be cleared with the student. */
          clearable: paid === 0,
        };
      });

      return {
        status: 200 as const,
        body: {
          bills,
          clearableCount: bills.filter((b) => b.clearable).length,
          keepingCount: bills.filter((b) => !b.clearable).length,
          clearableTotal: Math.round(bills.filter((b) => b.clearable).reduce((a, b) => a + b.outstanding, 0) * 100) / 100,
          keepingTotal: Math.round(bills.filter((b) => !b.clearable).reduce((a, b) => a + b.outstanding, 0) * 100) / 100,
        },
      };
    } catch (error) {
      console.error('Unpaid for student error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.LIST_FAILED', 'Failed to load unpaid bills');
    }
  },

  /**
   * POST /api/monthly-subscriptions/student/:studentId/clear-unpaid
   *
   * Drop the bills nobody will collect, after a student has been marked as left.
   *
   * Three guards, all server-side, because this deletes rows and the client is
   * not the authority on any of them:
   *   - the student must already be INACTIVE. Clearing bills for someone still
   *     attending is never right, whatever a caller asks for.
   *   - only rows with nothing collected. A part-paid month has a receipt behind
   *     it and is a human's decision, so it cannot be reached from here.
   *   - company- and branch-scoped like every other read.
   */
  clearUnpaidForStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const student = await queryOne<any>(
        `SELECT id, is_active, branch_id FROM students WHERE id = $1 AND company_id = $2`,
        [params.studentId, context.companyId]
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      if (!canAccessBranch(context, student.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      // The whole point of the prompt is that they have gone. If they are still
      // active, this is a mis-click or a stale page, not an instruction.
      if (student.is_active !== false) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.STUDENT_STILL_ACTIVE', 'Student is still active');
      }

      const deleted = await query<any>(
        `DELETE FROM monthly_subscription_payments
          WHERE company_id = $1
            AND student_id = $2
            AND COALESCE(amount_paid, 0) = 0
            AND amount_due - COALESCE(amount_paid, 0) > 0
          RETURNING id`,
        [context.companyId, params.studentId]
      );

      return { status: 200 as const, body: { cleared: deleted.length } };
    } catch (error) {
      console.error('Clear unpaid for student error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.VOID_FAILED', 'Failed to clear unpaid bills');
    }
  },

  // ── Monthly Price Overrides ─────────────────────────────────────────────────

  /** POST /api/monthly-subscriptions/price-override
   *  Upsert an override price for a course+month. Recalculates all non-PAID
   *  bills proportionally: new_amount = override_price * (student_fee / course_price).
   */
  setPriceOverride: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { courseId, masterCourseId, billingYear, billingMonth, overridePrice } = body;

      // One subject or the other, never both — the same pairing the bills use.
      if (!courseId === !masterCourseId) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_SUBJECT',
          'Give either a course or a master course, not both');
      }

      let row: any;
      let updatedBills: number;

      if (masterCourseId) {
        // Only a master sold per month has a monthly fee to override; a one-off
        // bundle has a price paid once and no month to attach this to.
        const master = await queryOne<any>(
          `SELECT id, default_price FROM master_courses
            WHERE id = $1 AND company_id = $2 AND payment_type = 'MONTHLY_SUBSCRIPTION'`,
          [masterCourseId, context.companyId]
        );
        if (!master) {
          return apiError(404, 'ERRORS.MASTER_COURSES.NOT_FOUND', 'Per-month master course not found');
        }

        row = await queryOne<any>(
          `INSERT INTO course_monthly_price_overrides
             (master_course_id, company_id, billing_year, billing_month, override_price)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (master_course_id, billing_year, billing_month)
             WHERE master_course_id IS NOT NULL
           DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = NOW()
           RETURNING *`,
          [masterCourseId, context.companyId, billingYear, billingMonth, overridePrice]
        );
        updatedBills = await recalcBillsForMasterMonth(
          context.companyId, masterCourseId, billingYear, billingMonth, overridePrice
        );
      } else {
        // Verify course exists and belongs to this company
        const course = await queryOne<any>(
          'SELECT id, price FROM courses WHERE id = $1 AND company_id = $2',
          [courseId, context.companyId]
        );
        if (!course) {
          return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
        }

        // Upsert the override
        row = await queryOne<any>(
          `INSERT INTO course_monthly_price_overrides
             (course_id, company_id, billing_year, billing_month, override_price)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (course_id, billing_year, billing_month)
           DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = NOW()
           RETURNING *`,
          [courseId, context.companyId, billingYear, billingMonth, overridePrice]
        );

        // Recalculate all non-PAID bills for this course+month
        updatedBills = await recalcBillsForCourseMonth(
          context.companyId, courseId, billingYear, billingMonth, overridePrice
        );
      }

      return {
        status: 200 as const,
        body: {
          override: mapOverrideFromDB(row),
          updatedBills,
        },
      };
    } catch (error) {
      console.error('Set price override error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_FAILED', 'Failed to set price override', 400);
    }
  },

  /** GET /api/monthly-subscriptions/price-override?courseId=&billingYear=&billingMonth= */
  getPriceOverride: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const subjectColumn = q.masterCourseId ? 'master_course_id' : 'course_id';
      const row = await queryOne<any>(
        `SELECT * FROM course_monthly_price_overrides
         WHERE ${subjectColumn} = $1 AND company_id = $2
           AND billing_year = $3 AND billing_month = $4`,
        [q.masterCourseId || q.courseId, context.companyId,
         parseInt(q.billingYear, 10), parseInt(q.billingMonth, 10)]
      );

      return {
        status: 200 as const,
        body: row ? mapOverrideFromDB(row) : null,
      };
    } catch (error) {
      console.error('Get price override error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_FAILED', 'Failed to get price override');
    }
  },

  /** DELETE /api/monthly-subscriptions/price-override/:id
   *  Remove an override and revert all non-PAID bills back to the normal course price.
   */
  deletePriceOverride: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne<any>(
        'SELECT * FROM course_monthly_price_overrides WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) {
        return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_NOT_FOUND', 'Price override not found');
      }

      // Delete the override
      await query('DELETE FROM course_monthly_price_overrides WHERE id = $1', [params.id]);

      // Revert non-PAID bills to the standing price of whichever subject this
      // override belonged to.
      const year = parseInt(row.billing_year, 10);
      const month = parseInt(row.billing_month, 10);
      let updatedBills = 0;

      if (row.master_course_id) {
        const master = await queryOne<any>(
          'SELECT default_price FROM master_courses WHERE id = $1', [row.master_course_id]
        );
        const basePrice = master ? parseFloat(master.default_price) : 0;
        if (basePrice > 0) {
          updatedBills = await recalcBillsForMasterMonth(
            context.companyId, row.master_course_id, year, month, basePrice
          );
        }
      } else {
        const course = await queryOne<any>('SELECT price FROM courses WHERE id = $1', [row.course_id]);
        const basePrice = course ? parseFloat(course.price) : 0;
        if (basePrice > 0) {
          updatedBills = await recalcBillsForCourseMonth(
            context.companyId, row.course_id, year, month, basePrice
          );
        }
      }

      return {
        status: 200 as const,
        body: { deleted: true, updatedBills },
      };
    } catch (error) {
      console.error('Delete price override error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_FAILED', 'Failed to delete price override', 400);
    }
  },

  /** GET /api/monthly-subscriptions/price-overrides/:courseId — list all overrides for a course */
  listPriceOverrides: async ({ params, headers }: { params: { courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query(
        `SELECT * FROM course_monthly_price_overrides
         WHERE course_id = $1 AND company_id = $2
         ORDER BY billing_year DESC, billing_month DESC`,
        [params.courseId, context.companyId]
      );

      return {
        status: 200 as const,
        body: rows.map(mapOverrideFromDB),
      };
    } catch (error) {
      console.error('List price overrides error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_FAILED', 'Failed to list price overrides');
    }
  },

  /**
   * POST /api/monthly-subscriptions/student-month-price
   *
   * The price ONE student pays for ONE month — a prorated first month for
   * someone who joined mid-month, a discounted last one. Absolute, unlike the
   * course-wide override which scales everyone. Stored as an override so a
   * FUTURE month never needs a materialised bill: the projection reads it, and
   * the bill is born with this figure whenever it does materialise. A bill
   * that already exists is restated in place, keeping whatever was paid and
   * re-deriving its status. `price: null` clears the override and puts an
   * existing bill back on the standard fee.
   */
  setStudentMonthPrice: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensureEnrollmentMonthOverrides();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const { enrollmentId, billingYear, billingMonth, price } = body;
      if (!Number.isInteger(billingYear) || !Number.isInteger(billingMonth) || billingMonth < 1 || billingMonth > 12) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.BAD_PERIOD', 'Invalid billing month');
      }
      const newPrice = price === null || price === undefined ? null : Math.round(parseFloat(price) * 100) / 100;
      if (newPrice !== null && !(newPrice >= 0)) {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.BAD_AMOUNT', 'Price must be zero or more');
      }

      const enr = await queryOne<any>(
        `SELECT e.id, e.branch_id, e.final_price, e.course_id, c.price AS course_price, c.payment_type
           FROM enrollments e JOIN courses c ON c.id = e.course_id
          WHERE e.id = $1 AND e.company_id = $2`,
        [enrollmentId, context.companyId]
      );
      if (!enr) return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_FOUND', 'Enrollment not found');
      if (!canAccessBranch(context, enr.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      if (enr.payment_type !== 'MONTHLY_SUBSCRIPTION') {
        return apiError(400, 'ERRORS.MONTHLY_SUBSCRIPTIONS.NOT_MONTHLY', 'Not a monthly subscription');
      }

      if (newPrice === null) {
        await query(
          `DELETE FROM enrollment_monthly_price_overrides
            WHERE enrollment_id = $1 AND billing_year = $2 AND billing_month = $3 AND company_id = $4`,
          [enrollmentId, billingYear, billingMonth, context.companyId]
        );
      } else {
        await query(
          `INSERT INTO enrollment_monthly_price_overrides
             (company_id, enrollment_id, billing_year, billing_month, override_price)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (enrollment_id, billing_year, billing_month)
           DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = NOW()`,
          [context.companyId, enrollmentId, billingYear, billingMonth, newPrice]
        );
      }

      // Restate the bill that already exists (nothing to do when the month has
      // not materialised — it will be born with the right figure). Clearing
      // recomputes the standard amount the same way ensureBillsForMonth would.
      // REFUNDED bills are terminal and stay untouched.
      const updated = await query(
        `UPDATE monthly_subscription_payments msp
            SET amount_due = COALESCE($5::numeric, CASE
                  WHEN ov.override_price IS NOT NULL AND c.price > 0
                    THEN ROUND(ov.override_price * (COALESCE(e.final_price, c.price) / c.price), 2)
                  ELSE COALESCE(e.final_price, c.price)
                END),
                payment_status = CASE
                  WHEN COALESCE($5::numeric, CASE
                        WHEN ov.override_price IS NOT NULL AND c.price > 0
                          THEN ROUND(ov.override_price * (COALESCE(e.final_price, c.price) / c.price), 2)
                        ELSE COALESCE(e.final_price, c.price)
                      END) <= msp.amount_paid THEN 'PAID'
                  WHEN msp.amount_paid > 0 THEN 'PARTIAL'
                  ELSE 'PENDING'
                END,
                paid_date = CASE
                  WHEN COALESCE($5::numeric, 999999999) <= msp.amount_paid THEN COALESCE(msp.paid_date, CURRENT_DATE)
                  ELSE msp.paid_date
                END,
                updated_at = NOW()
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           LEFT JOIN course_monthly_price_overrides ov
             ON ov.course_id = e.course_id AND ov.billing_year = $2 AND ov.billing_month = $3
          WHERE e.id = msp.enrollment_id
            AND msp.enrollment_id = $1 AND msp.billing_year = $2 AND msp.billing_month = $3
            AND msp.company_id = $4 AND msp.payment_status <> 'REFUNDED'
          RETURNING msp.id`,
        [enrollmentId, billingYear, billingMonth, context.companyId, newPrice]
      );

      return { status: 200 as const, body: { updatedBill: (updated as any[]).length > 0 } };
    } catch (error) {
      console.error('Set student month price error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.OVERRIDE_FAILED', 'Failed to set the month price');
    }
  },
};
