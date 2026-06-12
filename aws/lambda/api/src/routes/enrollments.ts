import { insert, update, findById, query, queryOne, getClient } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { insertProductSaleWithClient } from './product-sales';

function mapEnrollmentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    studentId: row.student_id,
    classId: row.class_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    enrollmentDate: row.enrollment_date,
    status: row.status,
    originalPrice: parseFloat(row.original_price),
    discountPercent: parseFloat(row.discount_percent || 0),
    discountAmount: parseFloat(row.discount_amount || 0),
    finalPrice: parseFloat(row.final_price),
    paymentMode: row.payment_mode || 'FULL',
    paymentType: row.payment_type || 'ONE_TIME',
    downPayment: parseFloat(row.down_payment || 0),
    amountPaid: parseFloat(row.amount_paid || 0),
    totalRefunded: parseFloat(row.total_refunded || 0),
    paymentStatus: row.payment_status,
    completionDate: row.completion_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computePaymentStatus(finalPrice: number, amountPaid: number): string {
  if (amountPaid <= 0) return 'PENDING';
  if (amountPaid >= finalPrice) return 'PAID';
  return 'PARTIAL';
}

/**
 * Monthly-subscription enrollment. The course is billed per calendar month rather
 * than as a one-time price / installment plan.
 *  - `final_price` stores the discounted monthly fee — the per-subscription discount
 *    persists and is applied to every month's bill (see monthly-subscriptions.generate).
 *  - Bills are generated from the start month (enrollment_date) through the current
 *    month, so a backdated enrollment immediately shows its outstanding/overdue months.
 *  - If `payFirstMonth` is set, the start month's bill is marked PAID and a revenue row
 *    is recorded; otherwise nothing is collected up-front.
 */
async function createMonthlySubscriptionEnrollment(context: any, body: any, course: any) {
  const coursePrice = course?.price != null ? parseFloat(course.price) : (body.originalPrice || 0);
  const originalPrice = body.originalPrice != null ? body.originalPrice : coursePrice;
  const discountPercent = body.discountPercent || 0;
  const discountAmount = body.discountAmount || 0;
  // Discounted monthly fee — what every monthly bill charges.
  const monthlyFee = body.finalPrice != null ? body.finalPrice : originalPrice;
  const payFirstMonth = !!body.payFirstMonth;
  const notes = body.notes || null;

  // The enrollment row itself carries no collected money for monthly subscriptions
  // (amount_paid stays 0 / PENDING). Each month's payment lives in
  // monthly_subscription_payments, which is the single source of truth for both
  // status and revenue — this keeps monthly revenue out of the enrollment-based
  // revenue sums (which only count PAID/PARTIAL enrollments) so nothing is
  // double-counted.
  const enrollment = await insert('enrollments', {
    company_id: context.companyId,
    student_id: body.studentId,
    class_id: body.classId,
    course_id: body.courseId,
    branch_id: body.branchId,
    enrollment_date: body.enrollmentDate,
    status: body.status,
    original_price: originalPrice,
    discount_percent: discountPercent,
    discount_amount: discountAmount,
    final_price: monthlyFee,
    payment_mode: 'FULL',
    down_payment: 0,
    amount_paid: 0,
    payment_status: 'PENDING',
    payment_type: 'MONTHLY_SUBSCRIPTION',
    completion_date: null,
    notes,
  });

  // Generate one bill per calendar month from the start month → current month.
  const start = new Date(body.enrollmentDate);
  const startY = start.getFullYear();
  const startM = start.getMonth() + 1; // 1-based
  const now = new Date();
  const endY = now.getFullYear();
  const endM = now.getMonth() + 1;

  let y = startY;
  let m = startM;
  let firstBillId: string | null = null;
  let guard = 0; // safety bound: never loop more than 120 months
  while ((y < endY || (y === endY && m <= endM)) && guard < 120) {
    const due = new Date(y, m, 0); // day 0 of next month = last day of month m
    const dueStr = due.toISOString().split('T')[0];
    const row = await queryOne(
      `INSERT INTO monthly_subscription_payments
         (enrollment_id, company_id, student_id, course_id, branch_id,
          billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'PENDING',$9)
       ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING
       RETURNING id`,
      [enrollment.id, context.companyId, body.studentId, body.courseId, body.branchId, y, m, monthlyFee, dueStr]
    );
    if (y === startY && m === startM) firstBillId = row?.id || null;
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }

  // Collect the first month up-front if requested. The payment (and its revenue)
  // lives entirely in the monthly_subscription_payments row.
  if (payFirstMonth && monthlyFee > 0 && firstBillId) {
    await query(
      `UPDATE monthly_subscription_payments
       SET amount_paid = $1, payment_status = 'PAID', paid_date = $2,
           notes = 'First month paid at enrollment', updated_at = NOW()
       WHERE id = $3`,
      [monthlyFee, body.enrollmentDate, firstBillId]
    );
  }

  return {
    status: 201 as const,
    body: mapEnrollmentFromDB(enrollment),
  };
}

export const enrollmentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      if (body.classId) {
        const targetClass = await queryOne(
          `SELECT c.id, c.is_finished
           FROM classes c
           INNER JOIN courses co ON c.course_id = co.id
           WHERE c.id = $1 AND co.company_id = $2`,
          [body.classId, context.companyId]
        );
        if (targetClass && targetClass.is_finished) {
          return apiError(400, 'ERRORS.ENROLLMENTS.CLASS_FINISHED', 'This class is finished. Enrollment is closed.');
        }
      }

      // Monthly-subscription courses follow a per-month billing model, not a
      // one-time price/installment plan. Route them to a dedicated path.
      const course = await queryOne(
        'SELECT id, payment_type, price FROM courses WHERE id = $1 AND company_id = $2',
        [body.courseId, context.companyId]
      );
      const paymentType: string = course?.payment_type || body.paymentType || 'ONE_TIME';
      if (paymentType === 'MONTHLY_SUBSCRIPTION') {
        return await createMonthlySubscriptionEnrollment(context, body, course);
      }

      const paymentMode = body.paymentMode || 'FULL';
      const downPayment = body.downPayment || 0;
      const originalPrice = body.originalPrice;
      const discountPercent = body.discountPercent || 0;
      const discountAmount = body.discountAmount || 0;
      const finalPrice = body.finalPrice;
      const amountPaid = paymentMode === 'FULL' ? finalPrice : downPayment;
      const notes = body.notes || null;

      const paymentStatus = computePaymentStatus(finalPrice, amountPaid);

      // Enroll-and-buy: when linked products are chosen, the enrollment, its
      // payment, and all product sales (stock + COGS) must commit atomically —
      // an out-of-stock book rolls back the whole enrollment.
      const buyProducts = Array.isArray(body.products) ? body.products.filter((p: any) => p && p.productId && (p.quantity ?? 1) > 0) : [];
      if (buyProducts.length > 0) {
        const client = await getClient();
        try {
          await client.query('BEGIN');
          const enrRes = await client.query(
            `INSERT INTO enrollments
               (company_id, student_id, class_id, course_id, branch_id, enrollment_date, status,
                original_price, discount_percent, discount_amount, final_price, payment_mode,
                down_payment, amount_paid, payment_status, payment_type, completion_date, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ONE_TIME',NULL,$16) RETURNING *`,
            [context.companyId, body.studentId, body.classId, body.courseId, body.branchId,
             body.enrollmentDate, body.status, originalPrice, discountPercent, discountAmount,
             finalPrice, paymentMode, downPayment, amountPaid, paymentStatus, notes]
          );
          const enrollment = enrRes.rows[0];

          if (amountPaid > 0) {
            await client.query(
              `INSERT INTO enrollment_payments (enrollment_id, company_id, amount, payment_date, notes)
               VALUES ($1,$2,$3,$4,$5)`,
              [enrollment.id, context.companyId, amountPaid, body.enrollmentDate,
               paymentMode === 'FULL' ? 'Full payment' : 'Down payment']
            );
          }

          for (const p of buyProducts) {
            await insertProductSaleWithClient(client, context.companyId, {
              productId: p.productId,
              branchId: body.branchId,
              quantity: p.quantity ?? 1,
              discountType: p.discountType,
              discountValue: p.discountValue,
              date: body.enrollmentDate,
              paymentMethod: p.paymentMethod || null,
              studentId: body.studentId,
              courseId: body.courseId,
              enrollmentId: enrollment.id,
            });
          }

          await client.query('COMMIT');
          return { status: 201 as const, body: mapEnrollmentFromDB(enrollment) };
        } catch (error: any) {
          await client.query('ROLLBACK');
          console.error('Create enrollment with products error:', error);
          if (error?.statusCode && error?.code) {
            return apiError(error.statusCode, error.code, error.message);
          }
          return mapThrownError(error, 'ERRORS.ENROLLMENTS.CREATE_FAILED', 'Failed to create enrollment', 400);
        } finally {
          client.release();
        }
      }

      const enrollment = await insert('enrollments', {
        company_id: context.companyId,
        student_id: body.studentId,
        class_id: body.classId,
        course_id: body.courseId,
        branch_id: body.branchId,
        enrollment_date: body.enrollmentDate,
        status: body.status,
        original_price: originalPrice,
        discount_percent: discountPercent,
        discount_amount: discountAmount,
        final_price: finalPrice,
        payment_mode: paymentMode,
        down_payment: downPayment,
        amount_paid: amountPaid,
        payment_status: paymentStatus,
        payment_type: 'ONE_TIME',
        completion_date: null,
        notes,
      });

      // Only record a payment row if money actually changed hands.
      if (amountPaid > 0) {
        await insert('enrollment_payments', {
          enrollment_id: enrollment.id,
          company_id: context.companyId,
          amount: amountPaid,
          payment_date: body.enrollmentDate,
          notes: paymentMode === 'FULL' ? 'Full payment' : 'Down payment',
        });
      }

      return {
        status: 201 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Create enrollment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.CREATE_FAILED', 'Failed to create enrollment', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { studentId?: string; courseId?: string; branchId?: string; status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = 'SELECT * FROM enrollments WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        sql += ` AND student_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND course_id = $${params.length}`;
      }

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      if (queryParams.status) {
        params.push(queryParams.status);
        sql += ` AND status = $${params.length}`;
      }

      sql += ' ORDER BY enrollment_date DESC';

      const enrollments = await query(sql, params);
      return {
        status: 200 as const,
        body: enrollments.map(mapEnrollmentFromDB),
      };
    } catch (error) {
      console.error('List enrollments error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.LIST_FAILED', 'Failed to list enrollments');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      if (!canAccessBranch(context, enrollment.branch_id)) {
        return apiError(403, 'ERRORS.ENROLLMENTS.ACCESS_DENIED', 'Access denied to this enrollment');
      }

      return {
        status: 200 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Get enrollment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found', 404);
    }
  },

  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollments = await query(
        'SELECT * FROM enrollments WHERE student_id = $1 AND company_id = $2 ORDER BY enrollment_date DESC',
        [params.studentId, context.companyId]
      );

      return {
        status: 200 as const,
        body: enrollments.map(mapEnrollmentFromDB),
      };
    } catch (error) {
      console.error('Get student enrollments error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.STUDENT_LIST_FAILED', 'Failed to get student enrollments');
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.ENROLLMENTS.ACCESS_DENIED_UPDATE', 'Access denied to update this enrollment');
      }

      const updateData: any = {};

      if (body.status !== undefined) updateData.status = body.status;
      if (body.paymentStatus !== undefined) updateData.payment_status = body.paymentStatus;
      if (body.completionDate !== undefined) updateData.completion_date = body.completionDate;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const enrollment = await update('enrollments', params.id, updateData);

      if (!enrollment) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      return {
        status: 200 as const,
        body: mapEnrollmentFromDB(enrollment),
      };
    } catch (error) {
      console.error('Update enrollment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.UPDATE_FAILED', 'Failed to update enrollment', 404);
    }
  },

  listDues: async ({ query: q, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (q.branchId && !canAccessBranch(context, q.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const eConditions: string[] = ['e.company_id = $1', 'e.amount_paid < e.final_price', 'COALESCE(e.total_refunded, 0) = 0', "e.status != 'DROPPED'"];
      const eParams: any[] = [context.companyId];
      if (q.branchId) {
        eParams.push(q.branchId);
        eConditions.push(`e.branch_id = $${eParams.length}`);
      } else {
        const c = appendBranchSqlFilter(context, eParams, 'e.branch_id');
        if (c) eConditions.push(c);
      }

      const meConditions: string[] = ['me.company_id = $1', 'me.amount_paid < me.final_price', 'COALESCE(me.total_refunded, 0) = 0', "me.status != 'CANCELLED'"];
      const meParams: any[] = [context.companyId];
      if (q.branchId) {
        meParams.push(q.branchId);
        meConditions.push(`me.branch_id = $${meParams.length}`);
      } else {
        const c = appendBranchSqlFilter(context, meParams, 'me.branch_id');
        if (c) meConditions.push(c);
      }

      const [enrollmentRows, masterRows] = await Promise.all([
        query(
          `SELECT e.id, e.student_id, e.course_id AS course_id, e.branch_id, e.enrollment_date,
                  e.final_price, e.amount_paid, e.payment_status, e.status,
                  s.first_name || ' ' || s.last_name AS student_name,
                  c.name AS course_name,
                  b.name AS branch_name
           FROM enrollments e
           JOIN students s ON e.student_id = s.id
           JOIN courses c ON e.course_id = c.id
           JOIN branches b ON e.branch_id = b.id
           WHERE ${eConditions.join(' AND ')}
           ORDER BY e.enrollment_date DESC`,
          eParams
        ),
        query(
          `SELECT me.id, me.student_id, me.master_course_id AS course_id, me.branch_id, me.enrollment_date,
                  me.final_price, me.amount_paid, me.payment_status, me.status,
                  s.first_name || ' ' || s.last_name AS student_name,
                  mc.name AS course_name,
                  b.name AS branch_name
           FROM master_enrollments me
           JOIN students s ON me.student_id = s.id
           JOIN master_courses mc ON me.master_course_id = mc.id
           JOIN branches b ON me.branch_id = b.id
           WHERE ${meConditions.join(' AND ')}
           ORDER BY me.enrollment_date DESC`,
          meParams
        ),
      ]);

      const mapRow = (r: any, type: 'ENROLLMENT' | 'MASTER_ENROLLMENT') => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        courseId: r.course_id,
        courseName: r.course_name,
        branchId: r.branch_id,
        branchName: r.branch_name,
        enrollmentDate: r.enrollment_date,
        finalPrice: parseFloat(r.final_price),
        amountPaid: parseFloat(r.amount_paid || 0),
        remaining: Math.max(0, parseFloat(r.final_price) - parseFloat(r.amount_paid || 0)),
        paymentStatus: r.payment_status,
        status: r.status,
        type,
      });

      const combined = [
        ...enrollmentRows.map((r: any) => mapRow(r, 'ENROLLMENT')),
        ...masterRows.map((r: any) => mapRow(r, 'MASTER_ENROLLMENT')),
      ].sort((a, b) => new Date(b.enrollmentDate).getTime() - new Date(a.enrollmentDate).getTime());

      return { status: 200 as const, body: combined };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.DUES_FAILED', 'Failed to list dues');
    }
  },

  listRefunds: async ({ query: q, headers }: { query: { branchId?: string; studentId?: string; type?: string; source?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const conditions: string[] = ['r.company_id = $1'];
      const params: any[] = [context.companyId];
      let idx = 2;

      // Branch column is a COALESCE across the four refund sources. We can't
      // pass that expression to appendBranchSqlFilter (it only accepts a safe
      // identifier), so we use the `__COL__` template trick like revenues.ts.
      const branchCol = 'COALESCE(e.branch_id, me.branch_id, ev.branch_id, ps.branch_id)';
      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        conditions.push(`${branchCol} = $${idx++}`);
        params.push(q.branchId);
      } else {
        // No explicit branch requested: restrict branch admins/managers to
        // their assigned branches. Global admins get null (no filter).
        const clause = appendBranchSqlFilter(context, params, '__COL__');
        if (clause) {
          conditions.push(clause.replace(/__COL__/g, branchCol));
          idx = params.length + 1;
        }
      }
      if (q.studentId) { conditions.push(`r.student_id = $${idx++}`); params.push(q.studentId); }
      if (q.type) { conditions.push(`r.type = $${idx++}`); params.push(q.type); }
      if (q.startDate) { conditions.push(`r.refund_date >= $${idx++}`); params.push(q.startDate); }
      if (q.endDate) { conditions.push(`r.refund_date <= $${idx++}`); params.push(q.endDate); }

      if (q.source && q.source !== 'ALL') {
        switch (q.source) {
          case 'ENROLLMENT': conditions.push(`r.enrollment_id IS NOT NULL`); break;
          case 'MASTER_ENROLLMENT': conditions.push(`r.master_enrollment_id IS NOT NULL`); break;
          case 'EVENT': conditions.push(`r.event_id IS NOT NULL AND r.enrollment_id IS NULL AND r.master_enrollment_id IS NULL`); break;
          case 'PRODUCT_SALE': conditions.push(`r.product_sale_id IS NOT NULL`); break;
        }
      }

      // LEFT JOINs cover every refund source (enrollment, master enrollment,
      // event-only, or product sale) in a single global list.
      const refunds = await query(
        `SELECT r.*,
                CASE WHEN s.id IS NOT NULL THEN s.first_name || ' ' || s.last_name ELSE NULL END AS student_name,
                COALESCE(c.name, mc.name) AS course_name,
                COALESCE(b.name, mcb.name, evb.name, psb.name) AS branch_name,
                COALESCE(e.branch_id, me.branch_id, ev.branch_id, ps.branch_id) AS branch_id,
                ev.name AS event_name,
                p.name AS product_name,
                ps.customer_name AS customer_name,
                CASE
                  WHEN r.product_sale_id IS NOT NULL THEN 'PRODUCT_SALE'
                  WHEN r.master_enrollment_id IS NOT NULL THEN 'MASTER_ENROLLMENT'
                  WHEN r.enrollment_id IS NOT NULL THEN 'ENROLLMENT'
                  WHEN r.event_id IS NOT NULL THEN 'EVENT'
                  ELSE 'ENROLLMENT'
                END AS source
         FROM refunds r
         LEFT JOIN enrollments e ON r.enrollment_id = e.id
         LEFT JOIN students s ON r.student_id = s.id
         LEFT JOIN courses c ON e.course_id = c.id
         LEFT JOIN branches b ON e.branch_id = b.id
         LEFT JOIN master_enrollments me ON r.master_enrollment_id = me.id
         LEFT JOIN master_courses mc ON me.master_course_id = mc.id
         LEFT JOIN branches mcb ON me.branch_id = mcb.id
         LEFT JOIN events ev ON r.event_id = ev.id
         LEFT JOIN branches evb ON ev.branch_id = evb.id
         LEFT JOIN product_sales ps ON r.product_sale_id = ps.id
         LEFT JOIN products p ON ps.product_id = p.id
         LEFT JOIN branches psb ON ps.branch_id = psb.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY r.refund_date DESC, r.created_at DESC`,
        params
      );

      return {
        status: 200 as const,
        body: refunds.map((r: any) => ({
          id: r.id,
          enrollmentId: r.enrollment_id,
          companyId: r.company_id,
          studentId: r.student_id,
          studentName: r.student_name,
          courseName: r.course_name,
          branchName: r.branch_name,
          branchId: r.branch_id,
          eventId: r.event_id || null,
          eventName: r.event_name || null,
          productSaleId: r.product_sale_id || null,
          productName: r.product_name || null,
          customerName: r.customer_name || null,
          source: r.source,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.LIST_REFUNDS_FAILED', 'Failed to list refunds');
    }
  },

  getRefunds: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const refunds = await query(
        'SELECT * FROM refunds WHERE enrollment_id = $1 AND company_id = $2 ORDER BY refund_date ASC',
        [params.id, context.companyId]
      );
      return {
        status: 200 as const,
        body: refunds.map((r: any) => ({
          id: r.id, enrollmentId: r.enrollment_id, companyId: r.company_id,
          studentId: r.student_id, amount: parseFloat(r.amount),
          refundDate: r.refund_date, type: r.type, reason: r.reason, createdAt: r.created_at,
        })),
      };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.GET_REFUNDS_FAILED', 'Failed to get refunds');
    }
  },

  createRefund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');

      const refundAmount = parseFloat(body.amount);
      const currentAmountPaid = parseFloat(enrollment.amount_paid || 0);
      const currentTotalRefunded = parseFloat(enrollment.total_refunded || 0);
      const refundableAmount = currentAmountPaid - currentTotalRefunded;

      if (refundAmount > refundableAmount) {
        return apiError(400, 'ERRORS.ENROLLMENTS.REFUND_EXCEEDS_REFUNDABLE', `Cannot refund more than refundable amount (${refundableAmount.toFixed(2)})`);
      }

      const refund = await insert('refunds', {
        enrollment_id: params.id,
        company_id: context.companyId,
        student_id: enrollment.student_id,
        amount: refundAmount,
        refund_date: body.refundDate,
        type: body.type,
        reason: body.reason || null,
      });

      // Increment total_refunded; only set REFUNDED if fully refunded, otherwise keep payment_status
      const newTotalRefunded = currentTotalRefunded + refundAmount;
      const isFullyRefunded = newTotalRefunded >= currentAmountPaid;

      await query(
        `UPDATE enrollments SET total_refunded = $1${isFullyRefunded ? ", payment_status = 'REFUNDED'" : ''}, updated_at = NOW() WHERE id = $2`,
        [newTotalRefunded, params.id]
      );

      return {
        status: 201 as const,
        body: {
          id: refund.id, enrollmentId: refund.enrollment_id, companyId: refund.company_id,
          studentId: refund.student_id, amount: parseFloat(refund.amount),
          refundDate: refund.refund_date, type: refund.type, reason: refund.reason, createdAt: refund.created_at,
        },
      };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.CREATE_REFUND_FAILED', 'Failed to create refund', 400);
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      const payments = await query(
        'SELECT * FROM enrollment_payments WHERE enrollment_id = $1 AND company_id = $2 ORDER BY payment_date ASC, created_at ASC',
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: payments.map((p: any) => ({
          id: p.id,
          enrollmentId: p.enrollment_id,
          companyId: p.company_id,
          amount: parseFloat(p.amount),
          paymentDate: p.payment_date,
          notes: p.notes,
          createdAt: p.created_at,
        })),
      };
    } catch (error) {
      console.error('Get payments error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.GET_PAYMENTS_FAILED', 'Failed to get payments');
    }
  },

  addPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!enrollment) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      const currentAmountPaid = parseFloat(enrollment.amount_paid || 0);
      const finalPrice = parseFloat(enrollment.final_price);
      const remaining = finalPrice - currentAmountPaid;

      if (parseFloat(body.amount) > remaining) {
        return apiError(400, 'ERRORS.ENROLLMENTS.PAYMENT_EXCEEDS_BALANCE', `Payment exceeds remaining balance (${remaining.toFixed(2)})`);
      }

      const payment = await insert('enrollment_payments', {
        enrollment_id: params.id,
        company_id: context.companyId,
        amount: body.amount,
        payment_date: body.paymentDate,
        notes: body.notes || null,
      });

      // Update enrollment amount_paid and payment_status
      const newAmountPaid = currentAmountPaid + parseFloat(body.amount);
      const newPaymentStatus = computePaymentStatus(finalPrice, newAmountPaid);

      await query(
        'UPDATE enrollments SET amount_paid = $1, payment_status = $2, updated_at = NOW() WHERE id = $3',
        [newAmountPaid, newPaymentStatus, params.id]
      );

      return {
        status: 201 as const,
        body: {
          id: payment.id,
          enrollmentId: payment.enrollment_id,
          companyId: payment.company_id,
          amount: parseFloat(payment.amount),
          paymentDate: payment.payment_date,
          notes: payment.notes,
          createdAt: payment.created_at,
        },
      };
    } catch (error) {
      console.error('Add payment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.ADD_PAYMENT_FAILED', 'Failed to add payment', 400);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM enrollments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.ENROLLMENTS.ACCESS_DENIED_DELETE', 'Access denied to delete this enrollment');
      }

      // Soft delete by setting status to DROPPED
      const enrollment = await update('enrollments', params.id, { status: 'DROPPED' });

      if (!enrollment) {
        return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      }

      return {
        status: 200 as const,
        body: { message: 'Enrollment deleted successfully', code: 'ENROLLMENTS.DELETED' },
      };
    } catch (error) {
      console.error('Delete enrollment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.DELETE_FAILED', 'Failed to delete enrollment', 404);
    }
  },
};
