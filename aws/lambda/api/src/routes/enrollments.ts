import { insert, update, findById, query, queryOne, getClient } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { insertProductSaleWithClient } from './product-sales';
import { ensurePerSessionSchema } from './session-payments';

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
    holdStartMonth: row.hold_start_month != null ? Number(row.hold_start_month) : null,
    holdStartYear: row.hold_start_year != null ? Number(row.hold_start_year) : null,
    holdMonths: row.hold_months != null ? Number(row.hold_months) : null,
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
  const buyProducts = Array.isArray(body.products) ? body.products.filter((p: any) => p && p.productId && (p.quantity ?? 1) > 0) : [];

  // Use a transaction when products are involved (atomic enrollment + product sales).
  const client = buyProducts.length > 0 ? await getClient() : null;
  try {
    if (client) await client.query('BEGIN');

    const queryFn = client ? (sql: string, params: any[]) => client.query(sql, params) : null;

    // The enrollment row itself carries no collected money for monthly subscriptions
    // (amount_paid stays 0 / PENDING). Each month's payment lives in
    // monthly_subscription_payments, which is the single source of truth for both
    // status and revenue.
    let enrollment: any;
    if (client) {
      const enrRes = await client.query(
        `INSERT INTO enrollments
           (company_id, student_id, class_id, course_id, branch_id, enrollment_date, status,
            original_price, discount_percent, discount_amount, final_price, payment_mode,
            down_payment, amount_paid, payment_status, payment_type, completion_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'FULL',0,0,'PENDING','MONTHLY_SUBSCRIPTION',NULL,$12) RETURNING *`,
        [context.companyId, body.studentId, body.classId, body.courseId, body.branchId,
         body.enrollmentDate, body.status, originalPrice, discountPercent, discountAmount,
         monthlyFee, notes]
      );
      enrollment = enrRes.rows[0];
    } else {
      enrollment = await insert('enrollments', {
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
    }

    // Process linked products (books) if any.
    if (client) {
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
    }

    // Generate one bill per calendar month from the start month → current month.
    // A future enrollment (the class starts next month) still needs its FIRST month
    // billed, so the up-front payment has a bill to land on — never end before the
    // start month.
    const start = new Date(body.enrollmentDate);
    const startY = start.getFullYear();
    const startM = start.getMonth() + 1; // 1-based
    const now = new Date();
    let endY = now.getFullYear();
    let endM = now.getMonth() + 1;
    if (startY > endY || (startY === endY && startM > endM)) {
      endY = startY;
      endM = startM;
    }

    let y = startY;
    let m = startM;
    let firstBillId: string | null = null;
    let guard = 0; // safety bound: never loop more than 120 months
    while ((y < endY || (y === endY && m <= endM)) && guard < 120) {
      // Due date is the first day of the billing month (y = year, m = 1-based month).
      // Built as a plain string so it is never shifted a day by a UTC conversion.
      const dueStr = `${y}-${String(m).padStart(2, '0')}-01`;
      const qFn = client || { query: (s: string, p: any[]) => query(s, p).then(r => ({ rows: r })) };
      const billRes = await (qFn as any).query(
        `INSERT INTO monthly_subscription_payments
           (enrollment_id, company_id, student_id, course_id, branch_id,
            billing_year, billing_month, amount_due, amount_paid, payment_status, due_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'PENDING',$9)
         ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING
         RETURNING id`,
        [enrollment.id, context.companyId, body.studentId, body.courseId, body.branchId, y, m, monthlyFee, dueStr]
      );
      const billRow = billRes?.rows?.[0] || null;
      if (y === startY && m === startM) firstBillId = billRow?.id || null;
      m++;
      if (m > 12) { m = 1; y++; }
      guard++;
    }

    // Collect the first month up-front — in full, or in part.
    //
    // A part payment leaves the bill PARTIAL with the remainder still owing, so it
    // shows up on the monthly dashboard exactly like any other half-paid month. It
    // is clamped to the fee: paying "more than the month" would otherwise book a
    // credit that nothing in the system knows how to give back.
    const downPayment = Number((body as any).firstMonthDownPayment ?? 0);
    const collect = payFirstMonth
      ? monthlyFee
      : (Number.isFinite(downPayment) && downPayment > 0 ? Math.min(downPayment, monthlyFee) : 0);

    if (collect > 0 && monthlyFee > 0 && firstBillId) {
      const status = collect >= monthlyFee ? 'PAID' : 'PARTIAL';
      const note = status === 'PAID' ? 'First month paid at enrollment' : 'Part of the first month paid at enrollment';
      // paid_date is WHEN the money was collected — that is now, at enrollment
      // creation, NOT body.enrollmentDate. For a class that starts in a future
      // month the enrollment (and its billing) is dated to the class start, so
      // stamping paid_date with it would book a payment on a day that hasn't
      // happened yet — e.g. "paid Jul 31" for cash taken on Jul 15.
      const payQuery = `UPDATE monthly_subscription_payments
       SET amount_paid = $1, payment_status = $3, paid_date = CURRENT_DATE,
           notes = $4, updated_at = NOW()
       WHERE id = $2`;
      const args = [collect, firstBillId, status, note];
      if (client) {
        await client.query(payQuery, args);
      } else {
        await query(payQuery, args);
      }
    }

    if (client) await client.query('COMMIT');

    return {
      status: 201 as const,
      body: mapEnrollmentFromDB(enrollment),
    };
  } catch (error: any) {
    if (client) await client.query('ROLLBACK');
    console.error('Create monthly subscription enrollment error:', error);
    if (error?.statusCode && error?.code) {
      return apiError(error.statusCode, error.code, error.message);
    }
    return mapThrownError(error, 'ERRORS.ENROLLMENTS.CREATE_FAILED', 'Failed to create enrollment', 400);
  } finally {
    if (client) client.release();
  }
}

/**
 * Per-session enrollment (PER_SESSION course). The student is billed for each
 * session they attend; charges are created when attendance is taken (see
 * routes/attendance.ts → sessionPayments.chargeAttendance). The enrollment row
 * itself carries no collected money (amount_paid stays 0 / PENDING); money lives
 * in session_payments (per session) and session_packages (prepaid blocks).
 *  - `final_price` stores the discounted per-session fee for reference.
 *  - If the student chose to prepay a package (buyPackage / sessionBillingMode
 *    = PACKAGE) and the course offers one, an initial session_packages row is
 *    created and paid up-front.
 */
async function createPerSessionEnrollment(context: any, body: any, course: any) {
  const coursePrice = course?.price != null ? parseFloat(course.price) : (body.originalPrice || 0);
  const originalPrice = body.originalPrice != null ? body.originalPrice : coursePrice;
  const discountPercent = body.discountPercent || 0;
  const discountAmount = body.discountAmount || 0;
  // Discounted per-session fee — what each session charge bills.
  const sessionFee = body.finalPrice != null ? body.finalPrice : originalPrice;
  const notes = body.notes || null;
  const wantsPackage = body.buyPackage === true || body.sessionBillingMode === 'PACKAGE';
  const packageSize = course?.session_package_size != null ? Number(course.session_package_size) : null;
  const packagePrice = course?.session_package_price != null ? parseFloat(course.session_package_price) : null;
  // Package payment mode: FULL (pay now), PARTIAL (down payment now), LATER (pay nothing now).
  const packagePayMode: 'FULL' | 'PARTIAL' | 'LATER' = body.sessionPackagePayMode || 'FULL';
  // The package charge honours a discount applied at enrollment (the discount is
  // on the package, not the per-session fee). Falls back to the course list price.
  const packageDue =
    body.sessionPackageFinalPrice != null ? parseFloat(body.sessionPackageFinalPrice) : (packagePrice || 0);
  let packagePaid = packageDue; // FULL default
  if (packagePayMode === 'LATER') packagePaid = 0;
  else if (packagePayMode === 'PARTIAL') {
    const dp = body.sessionPackageDownPayment != null ? parseFloat(body.sessionPackageDownPayment) : 0;
    packagePaid = Math.max(0, Math.min(dp, packageDue));
  }
  const buyProducts = Array.isArray(body.products) ? body.products.filter((p: any) => p && p.productId && (p.quantity ?? 1) > 0) : [];

  await ensurePerSessionSchema();
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const enrRes = await client.query(
      `INSERT INTO enrollments
         (company_id, student_id, class_id, course_id, branch_id, enrollment_date, status,
          original_price, discount_percent, discount_amount, final_price, payment_mode,
          down_payment, amount_paid, payment_status, payment_type, completion_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'FULL',0,0,'PENDING','PER_SESSION',NULL,$12) RETURNING *`,
      [context.companyId, body.studentId, body.classId, body.courseId, body.branchId,
       body.enrollmentDate, body.status, originalPrice, discountPercent, discountAmount,
       sessionFee, notes]
    );
    const enrollment = enrRes.rows[0];

    // Prepaid package (pay X sessions in advance), if chosen and offered.
    // amount_due = full package price; amount_paid depends on the chosen pay mode
    // (full now / part now / later). Any remainder is collectible from the
    // Session Payments dashboard's Packages view.
    if (wantsPackage && packageSize && packageSize > 0) {
      await client.query(
        `INSERT INTO session_packages
           (enrollment_id, company_id, student_id, course_id, branch_id,
            sessions_total, sessions_used, amount_due, amount_paid, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'ACTIVE',$9)`,
        [enrollment.id, context.companyId, body.studentId, body.courseId, body.branchId,
         packageSize, packageDue, packagePaid, 'Package purchased at enrollment']
      );
    }

    // Linked products (books), if any.
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
    console.error('Create per-session enrollment error:', error);
    if (error?.statusCode && error?.code) {
      return apiError(error.statusCode, error.code, error.message);
    }
    return mapThrownError(error, 'ERRORS.ENROLLMENTS.CREATE_FAILED', 'Failed to create enrollment', 400);
  } finally {
    client.release();
  }
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
        'SELECT id, payment_type, price, session_package_size, session_package_price FROM courses WHERE id = $1 AND company_id = $2',
        [body.courseId, context.companyId]
      );
      const paymentType: string = course?.payment_type || body.paymentType || 'ONE_TIME';
      if (paymentType === 'MONTHLY_SUBSCRIPTION') {
        return await createMonthlySubscriptionEnrollment(context, body, course);
      }
      if (paymentType === 'PER_SESSION') {
        return await createPerSessionEnrollment(context, body, course);
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

      // A student added to the wrong class must be able to disappear completely —
      // dropping them leaves a subscription on the profile forever. But deleting
      // the row CASCADES to enrollment_payments, refunds, monthly bills and
      // session payments, so it is only safe when no money ever touched it.
      // Same rule as deleting a class: money means keep the record.
      const footprint = await queryOne<{ has_money: boolean }>(
        `SELECT (
            COALESCE(e.amount_paid, 0) > 0
         OR COALESCE(e.down_payment, 0) > 0
         OR COALESCE(e.total_refunded, 0) > 0
         OR e.master_enrollment_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM enrollment_payments p WHERE p.enrollment_id = e.id)
         OR EXISTS (SELECT 1 FROM refunds r WHERE r.enrollment_id = e.id)
         OR EXISTS (SELECT 1 FROM monthly_subscription_payments m
                     WHERE m.enrollment_id = e.id AND COALESCE(m.amount_paid, 0) > 0)
         OR EXISTS (SELECT 1 FROM session_payments sp WHERE sp.enrollment_id = e.id)
         OR EXISTS (SELECT 1 FROM session_packages spk WHERE spk.enrollment_id = e.id)
         OR EXISTS (SELECT 1 FROM revenues rv WHERE rv.enrollment_id = e.id)
         ) AS has_money
         FROM enrollments e WHERE e.id = $1`,
        [params.id]
      );

      if (footprint?.has_money) {
        // Money is involved: keep the row and its records, just take it out of use.
        const enrollment = await update('enrollments', params.id, { status: 'DROPPED' });
        if (!enrollment) {
          return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
        }
        return {
          status: 200 as const,
          body: { message: 'Enrollment dropped', code: 'ENROLLMENTS.DROPPED' },
        };
      }

      // Nothing was ever paid: remove it outright. The FKs cascade its (unpaid)
      // bills away with it, so no phantom debt or stale row is left behind.
      await query('DELETE FROM enrollments WHERE id = $1', [params.id]);

      return {
        status: 200 as const,
        body: { message: 'Enrollment deleted successfully', code: 'ENROLLMENTS.DELETED' },
      };
    } catch (error) {
      console.error('Delete enrollment error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.DELETE_FAILED', 'Failed to delete enrollment', 404);
    }
  },

  holdSubscription: async ({ params, headers }: { params: { id: string }; body?: { months?: number }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        `SELECT * FROM enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      if (enrollment.payment_type !== 'MONTHLY_SUBSCRIPTION') {
        return apiError(400, 'ERRORS.ENROLLMENTS.NOT_MONTHLY', 'Only monthly subscriptions can be held');
      }
      if (enrollment.status === 'ON_HOLD') {
        return apiError(400, 'ERRORS.ENROLLMENTS.ALREADY_ON_HOLD', 'Subscription is already on hold');
      }
      if (enrollment.status !== 'ACTIVE') {
        return apiError(400, 'ERRORS.ENROLLMENTS.NOT_ACTIVE', 'Only active subscriptions can be held');
      }

      // Indefinite hold: billing skips ON_HOLD enrollments every month until
      // resumed. We record when the hold started (informational); hold_months
      // stays null — the hold has no fixed end.
      const now = new Date();
      const updated = await update('enrollments', params.id, {
        status: 'ON_HOLD',
        hold_start_month: now.getMonth() + 1,
        hold_start_year: now.getFullYear(),
        hold_months: null,
      });

      return { status: 200 as const, body: mapEnrollmentFromDB(updated) };
    } catch (error) {
      console.error('Hold subscription error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.HOLD_FAILED', 'Failed to hold subscription');
    }
  },

  resumeSubscription: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        `SELECT * FROM enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      if (enrollment.status !== 'ON_HOLD') {
        return apiError(400, 'ERRORS.ENROLLMENTS.NOT_ON_HOLD', 'Subscription is not on hold');
      }

      const updated = await update('enrollments', params.id, {
        status: 'ACTIVE',
        hold_start_month: null,
        hold_start_year: null,
        hold_months: null,
      });

      return { status: 200 as const, body: mapEnrollmentFromDB(updated) };
    } catch (error) {
      console.error('Resume subscription error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.RESUME_FAILED', 'Failed to resume subscription');
    }
  },

  /**
   * POST /api/enrollments/:id/change-class
   * Move a student to a DIFFERENT class of the SAME course. Capacity is not
   * enforced here (the UI warns when the target is full but allows the move).
   */
  changeClass: async ({ params, body, headers }: { params: { id: string }; body: { classId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne(
        `SELECT * FROM enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');

      // Target class must exist in this company, belong to the SAME course, and not be finished.
      const targetClass = await queryOne(
        `SELECT c.id, c.course_id, c.is_finished
           FROM classes c
           INNER JOIN courses co ON c.course_id = co.id
          WHERE c.id = $1 AND co.company_id = $2`,
        [body.classId, context.companyId]
      );
      if (!targetClass) return apiError(404, 'ERRORS.ENROLLMENTS.CLASS_NOT_FOUND', 'Class not found');
      if (targetClass.course_id !== enrollment.course_id) {
        return apiError(400, 'ERRORS.ENROLLMENTS.CLASS_DIFFERENT_COURSE', 'You can only move to a class in the same course');
      }
      if (targetClass.is_finished) {
        return apiError(400, 'ERRORS.ENROLLMENTS.CLASS_FINISHED', 'This class is finished. Enrollment is closed.');
      }

      const updated = await update('enrollments', params.id, { class_id: body.classId });
      return { status: 200 as const, body: mapEnrollmentFromDB(updated) };
    } catch (error) {
      console.error('Change class error:', error);
      return mapThrownError(error, 'ERRORS.ENROLLMENTS.CHANGE_CLASS_FAILED', 'Failed to change class');
    }
  },
};
