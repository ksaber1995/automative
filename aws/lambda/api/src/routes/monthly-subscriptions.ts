import { insert, query, queryOne } from '../db/connection';
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
  };
}

/** Resolve overdue status on-read: any PENDING row past its due_date becomes OVERDUE */
function resolveStatus(row: any): string {
  if (row.payment_status === 'PAID' || row.payment_status === 'PARTIAL') return row.payment_status;
  const due = new Date(row.due_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due < today) return 'OVERDUE';
  return row.payment_status;
}

export const monthlySubscriptionsRoutes = {
  /** POST /api/monthly-subscriptions/generate
   *  Idempotent: creates one row per active enrollment in monthly courses for the given month.
   *  Uses ON CONFLICT DO NOTHING so running twice is safe.
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

      // Build query to find active enrollments in monthly-subscription courses
      // The monthly fee is the enrollment's discounted fee (final_price), so the
      // per-subscription discount carries forward to every month. Falls back to the
      // course price for legacy rows whose final_price wasn't set.
      let sql = `
        SELECT
          e.id AS enrollment_id,
          e.student_id,
          e.course_id,
          e.branch_id,
          e.company_id,
          COALESCE(NULLIF(e.final_price, 0), c.price) AS monthly_fee
        FROM enrollments e
        JOIN courses c ON e.course_id = c.id
        WHERE e.company_id = $1
          AND e.status = 'ACTIVE'
          AND c.payment_type = 'MONTHLY_SUBSCRIPTION'
          AND c.is_active = true
      `;
      const params: any[] = [context.companyId];

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
        const monthlyFee = parseFloat(enr.monthly_fee);
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
      const student = await queryOne<any>(
        'SELECT id, first_name, last_name FROM students WHERE qr_token = $1 AND company_id = $2 AND is_active = true',
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
};
