import { insert, query, queryOne } from '../db/connection';
import { ensureQrCardSchema, qrStudentMatch } from './qr-cards';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapPaymentFromDB(row: any) {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
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
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    courseName: row.course_name,
    branchName: row.branch_name,
    className: row.class_name || null,
    studentPhone: row.student_phone || null,
    parentPhone: row.parent_phone || null,
    parentName: row.parent_name || null,
    enrollmentStatus: row.enrollment_status || null,
  };
}

function mapOverrideFromDB(row: any) {
  return {
    id: row.id,
    courseId: row.course_id,
    companyId: row.company_id,
    billingYear: parseInt(row.billing_year, 10),
    billingMonth: parseInt(row.billing_month, 10),
    overridePrice: parseFloat(row.override_price),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resolve overdue status on-read: any PENDING row past its due_date becomes OVERDUE */
function resolveStatus(row: any): string {
  // REFUNDED is terminal — never re-derive it to OVERDUE on read.
  if (row.payment_status === 'REFUNDED') return 'REFUNDED';
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
            COALESCE(NULLIF(e.final_price, 0), $5) AS enrollment_fee
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

      // due_date = last day of the billing month
      const dueDate = new Date(billingYear, billingMonth, 0); // day 0 = last day of prev month
      const dueDateStr = dueDate.toISOString().split('T')[0];

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
          COALESCE(NULLIF(e.final_price, 0), c.price) AS enrollment_fee,
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

      const conditions: string[] = [
        'msp.company_id = $1',
        '(msp.billing_year * 12 + msp.billing_month) BETWEEN $2 AND $3',
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
           s.first_name   AS student_first_name,
           s.last_name    AS student_last_name,
           s.phone        AS student_phone,
           s.parent_phone AS parent_phone,
           s.parent_name  AS parent_name,
           c.name       AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name,
           e.status     AS enrollment_status
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN courses  c  ON msp.course_id  = c.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, s.first_name, s.last_name`,
        params
      );

      // Apply on-read overdue resolution and optional status filter
      let result = rows.map((r: any) => ({
        ...mapPaymentWithDetailsFromDB(r),
        paymentStatus: resolveStatus(r),
      }));

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
           s.first_name   AS student_first_name,
           s.last_name    AS student_last_name,
           c.name         AS course_name,
           b.name         AS branch_name,
           cl.name        AS class_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         JOIN courses  c ON e.course_id  = c.id
         JOIN branches b ON e.branch_id  = b.id
         LEFT JOIN classes cl ON e.class_id = cl.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY s.first_name, s.last_name`,
        params
      );

      const result = rows.map((r: any) => ({
        enrollmentId: r.enrollment_id,
        studentId: r.student_id,
        courseId: r.course_id,
        branchId: r.branch_id,
        studentFirstName: r.student_first_name,
        studentLastName: r.student_last_name,
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

      const conditions: string[] = [
        'msp.company_id = $1',
        '(msp.billing_year * 12 + msp.billing_month) BETWEEN $2 AND $3',
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

      const rows = await query(
        `SELECT payment_status, due_date, amount_due, amount_paid
         FROM monthly_subscription_payments msp
         WHERE ${conditions.join(' AND ')}`,
        params
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let paidCount = 0, pendingCount = 0, overdueCount = 0, partialCount = 0;
      let totalRevenue = 0, totalExpected = 0;

      for (const r of rows) {
        const status = resolveStatus(r);
        // Refunded bills count only their net retained revenue (gross amount_paid
        // minus what was refunded); they are not "expected" and don't belong in
        // the pending/overdue buckets.
        if (status === 'REFUNDED') {
          totalRevenue += parseFloat(r.amount_paid || 0) - parseFloat(r.refunded_amount || 0);
          continue;
        }
        totalExpected += parseFloat(r.amount_due);
        totalRevenue += parseFloat(r.amount_paid || 0);
        if (status === 'PAID') paidCount++;
        else if (status === 'PARTIAL') partialCount++;
        else if (status === 'OVERDUE') overdueCount++;
        else pendingCount++;
      }

      return {
        status: 200 as const,
        body: {
          // Echo the range end so the client can label the period.
          billingYear: parseInt(q.toYear, 10),
          billingMonth: parseInt(q.toMonth, 10),
          totalStudents: rows.length,
          paidCount,
          pendingCount,
          overdueCount,
          partialCount,
          totalRevenue,
          totalExpected,
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
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
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

      const amountDue = parseFloat(row.amount_due);
      const currentPaid = parseFloat(row.amount_paid || 0);
      const newPaid = currentPaid + parseFloat(body.amount);

      let newStatus: string;
      let paidDate: string | null = null;
      if (newPaid >= amountDue) {
        newStatus = 'PAID';
        paidDate = body.paymentDate;
      } else if (newPaid > 0) {
        newStatus = 'PARTIAL';
      } else {
        newStatus = 'PENDING';
      }

      await query(
        `UPDATE monthly_subscription_payments
         SET amount_paid = $1, payment_status = $2, paid_date = $3, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $5`,
        [newPaid, newStatus, paidDate, body.notes || null, params.id]
      );

      // No separate revenues row is written: the monthly_subscription_payments row
      // is the single source of truth and is summed directly into dashboard/report
      // revenue (bucketed by paid_date). This also makes voiding a no-side-effect reset.

      const updated = await queryOne(
        'SELECT * FROM monthly_subscription_payments WHERE id = $1',
        [params.id]
      );

      return { status: 200 as const, body: mapPaymentFromDB(updated) };
    } catch (error) {
      console.error('Record monthly payment error:', error);
      return mapThrownError(error, 'ERRORS.MONTHLY_SUBSCRIPTIONS.PAY_FAILED', 'Failed to record payment', 400);
    }
  },

  /** POST /api/monthly-subscriptions/:id/void
   *  Reverse a recorded payment: clears amount_paid and resets the bill to unpaid.
   *  Because revenue is derived from amount_paid, this removes it from revenue too.
   */
  voidPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
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
   *  Return money to a leaving student. Unlike void (a mistake reset), a refund
   *  reduces amount_paid by the refunded amount — so revenue (which sums
   *  amount_paid) nets out — and records the amount + note, marking the bill
   *  REFUNDED. Optionally stops the underlying subscription (HOLD or CANCEL).
   *    body: { type: 'FULL'|'PARTIAL', amount?, note?, subscriptionAction? }
   */
  refund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
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

      // Scope the lookup to the caller's company — a token from another company
      // must not resolve.
      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne<any>(
        `SELECT s.id, s.first_name, s.last_name FROM students s
         WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2 AND s.is_active = true`,
        [token, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.MONTHLY_SUBSCRIPTIONS.STUDENT_NOT_FOUND', 'Student not found for this code');
      }

      const rows = await query(
        `SELECT
           msp.*,
           s.first_name AS student_first_name,
           s.last_name  AS student_last_name,
           c.name       AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN courses  c  ON msp.course_id  = c.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
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
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
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
           s.first_name AS student_first_name,
           s.last_name  AS student_last_name,
           c.name       AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN courses  c  ON msp.course_id  = c.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, s.first_name`,
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
           s.first_name AS student_first_name,
           s.last_name  AS student_last_name,
           c.name       AS course_name,
           b.name       AS branch_name,
           cl.name      AS class_name
         FROM monthly_subscription_payments msp
         JOIN students s  ON msp.student_id = s.id
         JOIN courses  c  ON msp.course_id  = c.id
         JOIN branches b  ON msp.branch_id  = b.id
         LEFT JOIN enrollments e ON msp.enrollment_id = e.id
         LEFT JOIN classes cl    ON e.class_id = cl.id
         WHERE msp.company_id = $1
           AND msp.student_id = $2
         ORDER BY msp.billing_year DESC, msp.billing_month DESC, c.name`,
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

      const { courseId, billingYear, billingMonth, overridePrice } = body;

      // Verify course exists and belongs to this company
      const course = await queryOne<any>(
        'SELECT id, price FROM courses WHERE id = $1 AND company_id = $2',
        [courseId, context.companyId]
      );
      if (!course) {
        return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      // Upsert the override
      const row = await queryOne<any>(
        `INSERT INTO course_monthly_price_overrides
           (course_id, company_id, billing_year, billing_month, override_price)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (course_id, billing_year, billing_month)
         DO UPDATE SET override_price = EXCLUDED.override_price, updated_at = NOW()
         RETURNING *`,
        [courseId, context.companyId, billingYear, billingMonth, overridePrice]
      );

      // Recalculate all non-PAID bills for this course+month
      const updatedBills = await recalcBillsForCourseMonth(
        context.companyId, courseId, billingYear, billingMonth, overridePrice
      );

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

      const row = await queryOne<any>(
        `SELECT * FROM course_monthly_price_overrides
         WHERE course_id = $1 AND company_id = $2
           AND billing_year = $3 AND billing_month = $4`,
        [q.courseId, context.companyId, parseInt(q.billingYear, 10), parseInt(q.billingMonth, 10)]
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

      // Get the course base price to revert bills
      const course = await queryOne<any>('SELECT price FROM courses WHERE id = $1', [row.course_id]);
      const basePrice = course ? parseFloat(course.price) : 0;

      // Revert non-PAID bills back to normal pricing
      let updatedBills = 0;
      if (basePrice > 0) {
        updatedBills = await recalcBillsForCourseMonth(
          context.companyId, row.course_id,
          parseInt(row.billing_year, 10), parseInt(row.billing_month, 10),
          basePrice
        );
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
};
