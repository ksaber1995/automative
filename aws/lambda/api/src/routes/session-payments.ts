import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard (migration 050 self-applied).
// Mirrors ensureAttendanceMagicColumns in sessions.ts: the DDL is additive and
// guarded so it is a no-op once applied and safe under concurrent containers.
// ============================================================
let perSessionSchemaInitPromise: Promise<void> | null = null;
export async function ensurePerSessionSchema(): Promise<void> {
  if (!perSessionSchemaInitPromise) {
    perSessionSchemaInitPromise = (async () => {
      try {
        // courses: widen payment_type CHECK + per-session settings
        await query(`ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_payment_type_check`);
        await query(`ALTER TABLE courses ADD CONSTRAINT courses_payment_type_check
          CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'))`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS session_package_size INTEGER`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS session_package_price DECIMAL(10, 2)`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS charge_absent_sessions BOOLEAN NOT NULL DEFAULT FALSE`);

        // enrollments: widen payment_type CHECK
        await query(`ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_payment_type_check`);
        await query(`ALTER TABLE enrollments ADD CONSTRAINT enrollments_payment_type_check
          CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'))`);

        // session_packages
        await query(`CREATE TABLE IF NOT EXISTS session_packages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          sessions_total INTEGER NOT NULL,
          sessions_used INTEGER NOT NULL DEFAULT 0,
          amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REFUNDED')),
          purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_enrollment_id ON session_packages(enrollment_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_company_id ON session_packages(company_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_student_id ON session_packages(student_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_course_id ON session_packages(course_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_branch_id ON session_packages(branch_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_status ON session_packages(status)`);

        // session_payments
        await query(`CREATE TABLE IF NOT EXISTS session_payments (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
          session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
          course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
          branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
          package_id UUID REFERENCES session_packages(id) ON DELETE SET NULL,
          attendance_state VARCHAR(10) NOT NULL DEFAULT 'PRESENT' CHECK (attendance_state IN ('PRESENT', 'ABSENT')),
          amount_due DECIMAL(10, 2) NOT NULL DEFAULT 0,
          amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
          payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
            CHECK (payment_status IN ('PENDING', 'PAID', 'COVERED', 'WAIVED', 'REFUNDED')),
          paid_date DATE,
          notes TEXT,
          refunded_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
          refund_note TEXT,
          refunded_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (enrollment_id, session_id)
        )`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_enrollment_id ON session_payments(enrollment_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_session_id ON session_payments(session_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_company_id ON session_payments(company_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_student_id ON session_payments(student_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_course_id ON session_payments(course_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_branch_id ON session_payments(branch_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_package_id ON session_payments(package_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_sp_payment_status ON session_payments(payment_status)`);

        // refunds link (polymorphic)
        await query(`ALTER TABLE refunds ADD COLUMN IF NOT EXISTS session_payment_id UUID`);
        await query(`ALTER TABLE refunds DROP CONSTRAINT IF EXISTS fk_refunds_session_payment`);
        await query(`ALTER TABLE refunds ADD CONSTRAINT fk_refunds_session_payment
          FOREIGN KEY (session_payment_id) REFERENCES session_payments(id) ON DELETE CASCADE`);
      } catch (e) {
        perSessionSchemaInitPromise = null;
        throw e;
      }
    })();
  }
  return perSessionSchemaInitPromise;
}

// ============================================================
// Mappers
// ============================================================
function mapSessionPaymentFromDB(row: any) {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    sessionId: row.session_id,
    companyId: row.company_id,
    studentId: row.student_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    packageId: row.package_id || null,
    attendanceState: row.attendance_state,
    amountDue: parseFloat(row.amount_due),
    amountPaid: parseFloat(row.amount_paid || 0),
    paymentStatus: row.payment_status,
    paidDate: row.paid_date || null,
    notes: row.notes || null,
    refundedAmount: parseFloat(row.refunded_amount || 0),
    refundNote: row.refund_note || null,
    refundedAt: row.refunded_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionPaymentWithDetailsFromDB(row: any) {
  return {
    ...mapSessionPaymentFromDB(row),
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    courseName: row.course_name,
    branchName: row.branch_name,
    className: row.class_name || null,
    sessionNumber: row.session_number != null ? Number(row.session_number) : null,
    sessionDate: row.session_date || null,
    studentPhone: row.student_phone || null,
    parentPhone: row.parent_phone || null,
    parentName: row.parent_name || null,
    coursePackageSize: row.course_package_size != null ? Number(row.course_package_size) : null,
    coursePackagePrice: row.course_package_price != null ? parseFloat(row.course_package_price) : null,
  };
}

function mapPackageFromDB(row: any) {
  return {
    id: row.id,
    enrollmentId: row.enrollment_id,
    companyId: row.company_id,
    studentId: row.student_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    sessionsTotal: Number(row.sessions_total),
    sessionsUsed: Number(row.sessions_used),
    amountPaid: parseFloat(row.amount_paid || 0),
    status: row.status,
    purchasedAt: row.purchased_at || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPackageWithDetailsFromDB(row: any) {
  return {
    ...mapPackageFromDB(row),
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    courseName: row.course_name,
    branchName: row.branch_name,
  };
}

// Columns + joins used to return "with details" rows.
const DETAILS_SELECT = `
  sp.*,
  s.first_name   AS student_first_name,
  s.last_name    AS student_last_name,
  s.phone        AS student_phone,
  s.parent_phone AS parent_phone,
  s.parent_name  AS parent_name,
  c.name         AS course_name,
  c.session_package_size  AS course_package_size,
  c.session_package_price AS course_package_price,
  b.name         AS branch_name,
  cl.name        AS class_name,
  se.session_number AS session_number,
  se.start_date  AS session_date
`;
const DETAILS_FROM = `
  FROM session_payments sp
  JOIN students s  ON sp.student_id = s.id
  JOIN courses  c  ON sp.course_id  = c.id
  JOIN branches b  ON sp.branch_id  = b.id
  JOIN sessions se ON sp.session_id = se.id
  LEFT JOIN enrollments e ON sp.enrollment_id = e.id
  LEFT JOIN classes cl    ON e.class_id = cl.id
`;

async function fetchDetailsByIds(companyId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
     WHERE sp.company_id = $1 AND sp.id = ANY($2::uuid[])`,
    [companyId, ids]
  );
  return rows.map(mapSessionPaymentWithDetailsFromDB);
}

// ============================================================
// Core: charge attendance for PER_SESSION courses.
// Called from routes/attendance.ts when attendance is taken.
// ============================================================

interface ChargeResult {
  id: string;
  isNew: boolean;
  status: string;
  packageRemaining: number | null;
}

/**
 * Create/ensure a session charge for one enrollment+session. Idempotent on
 * (enrollment_id, session_id): a re-save never double-charges or double-consumes
 * a package credit (INSERT ... ON CONFLICT DO NOTHING; the package is only
 * decremented when a NEW row is actually inserted).
 */
async function chargeOneEnrollment(
  companyId: string,
  session: any,
  enrollment: any,
  courseFee: number,
  state: 'PRESENT' | 'ABSENT',
): Promise<ChargeResult | null> {
  const fee = enrollment.final_price && parseFloat(enrollment.final_price) > 0
    ? parseFloat(enrollment.final_price)
    : courseFee;

  // Try to cover from the oldest active prepaid package with credit left.
  const pkg = await queryOne<any>(
    `SELECT * FROM session_packages
     WHERE enrollment_id = $1 AND status = 'ACTIVE' AND sessions_used < sessions_total
     ORDER BY purchased_at ASC LIMIT 1`,
    [enrollment.id]
  );

  const status = pkg ? 'COVERED' : 'PENDING';
  const packageId = pkg ? pkg.id : null;

  const inserted = await query(
    `INSERT INTO session_payments
       (enrollment_id, session_id, company_id, student_id, course_id, branch_id,
        package_id, attendance_state, amount_due, amount_paid, payment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10)
     ON CONFLICT (enrollment_id, session_id) DO NOTHING
     RETURNING id`,
    [enrollment.id, session.id, companyId, enrollment.student_id, session.course_id ?? enrollment.course_id,
     enrollment.branch_id, packageId, state, fee, status]
  );

  if (inserted.length === 0) {
    // Row already existed. Keep it idempotent, but promote an ABSENT/PENDING row
    // to PRESENT if the student turned out to attend after all.
    if (state === 'PRESENT') {
      await query(
        `UPDATE session_payments SET attendance_state = 'PRESENT', updated_at = NOW()
         WHERE enrollment_id = $1 AND session_id = $2 AND attendance_state = 'ABSENT'
           AND payment_status IN ('PENDING')`,
        [enrollment.id, session.id]
      );
    }
    const existing = await queryOne<any>(
      'SELECT id, payment_status FROM session_payments WHERE enrollment_id = $1 AND session_id = $2',
      [enrollment.id, session.id]
    );
    return existing ? { id: existing.id, isNew: false, status: existing.payment_status, packageRemaining: null } : null;
  }

  const newId = inserted[0].id;
  let packageRemaining: number | null = null;

  // Consume one credit only for the freshly-inserted COVERED row.
  if (pkg) {
    await query(
      `UPDATE session_packages
       SET sessions_used = sessions_used + 1,
           status = CASE WHEN sessions_used + 1 >= sessions_total THEN 'EXHAUSTED' ELSE 'ACTIVE' END,
           updated_at = NOW()
       WHERE id = $1`,
      [pkg.id]
    );
    packageRemaining = Number(pkg.sessions_total) - Number(pkg.sessions_used) - 1;
  }

  return { id: newId, isNew: true, status, packageRemaining };
}

/**
 * Charge an attendance save for the students marked PRESENT. Absent students are
 * NOT charged here — attendance saves are incremental/debounced, so a student not
 * yet ticked is not truly "absent". Absence charging happens at session end (see
 * chargeAbsencesAtSessionEnd). Returns the newly-created PENDING charges (with
 * details) that need collection.
 */
export async function chargeSessionAttendance(
  companyId: string,
  session: any,
  presentStudentIds: string[],
): Promise<any[]> {
  const ids = presentStudentIds || [];
  if (ids.length === 0) return [];

  const course = await queryOne<any>(
    `SELECT co.id, co.payment_type, co.price
     FROM classes cl JOIN courses co ON cl.course_id = co.id
     WHERE cl.id = $1`,
    [session.class_id]
  );
  if (!course || course.payment_type !== 'PER_SESSION') return [];
  await ensurePerSessionSchema();

  const courseFee = parseFloat(course.price || 0);

  const enrollments = await query(
    `SELECT id, student_id, branch_id, course_id, final_price
     FROM enrollments
     WHERE class_id = $1 AND company_id = $2 AND student_id = ANY($3::uuid[])
       AND payment_type = 'PER_SESSION' AND status NOT IN ('DROPPED', 'CANCELLED', 'ON_HOLD')`,
    [session.class_id, companyId, ids]
  );

  const newPendingIds: string[] = [];
  for (const enr of enrollments) {
    const res = await chargeOneEnrollment(companyId, { ...session, course_id: enr.course_id }, enr, courseFee, 'PRESENT');
    if (res && res.isNew && res.status === 'PENDING') newPendingIds.push(res.id);
  }

  return fetchDetailsByIds(companyId, newPendingIds);
}

/**
 * Charge absent students when a session ends (roster is final). Only runs for
 * PER_SESSION courses with charge_absent_sessions = true. An enrolled student
 * with no attendance row and no existing charge for this session gets an ABSENT
 * charge (covered by a package if credits remain, else PENDING/due). Silent — no
 * popups at session end. Best-effort; never throws to the caller.
 */
export async function chargeAbsencesAtSessionEnd(companyId: string, session: any): Promise<void> {
  // Cheap pre-check on existing columns; bail before the guard for non-PER_SESSION.
  const base = await queryOne<any>(
    `SELECT co.id, co.payment_type, co.price
     FROM classes cl JOIN courses co ON cl.course_id = co.id
     WHERE cl.id = $1`,
    [session.class_id]
  );
  if (!base || base.payment_type !== 'PER_SESSION') return;
  await ensurePerSessionSchema();
  // Now the charge_absent_sessions column is guaranteed to exist.
  const flag = await queryOne<any>(`SELECT charge_absent_sessions FROM courses WHERE id = $1`, [base.id]);
  if (!flag || flag.charge_absent_sessions !== true) return;

  const courseFee = parseFloat(base.price || 0);

  // Enrolled PER_SESSION students who were NOT marked present for this session.
  const absentees = await query(
    `SELECT e.id, e.student_id, e.branch_id, e.course_id, e.final_price
     FROM enrollments e
     WHERE e.class_id = $1 AND e.company_id = $2 AND e.payment_type = 'PER_SESSION'
       AND e.status NOT IN ('DROPPED', 'CANCELLED', 'ON_HOLD')
       AND NOT EXISTS (
         SELECT 1 FROM session_attendance sa WHERE sa.session_id = $3 AND sa.student_id = e.student_id
       )`,
    [session.class_id, companyId, session.id]
  );

  for (const enr of absentees) {
    await chargeOneEnrollment(companyId, { ...session, course_id: enr.course_id }, enr, courseFee, 'ABSENT');
  }
}

/**
 * Charge a single QR/manual check-in for one present student. Returns the charge
 * (with details) so the caller can prompt for payment (PENDING) or toast that it
 * was covered by a package (COVERED). Returns null if not a PER_SESSION course.
 */
export async function chargeSingleCheckin(
  companyId: string,
  session: any,
  studentId: string,
): Promise<any | null> {
  const course = await queryOne<any>(
    `SELECT co.id, co.payment_type, co.price
     FROM classes cl JOIN courses co ON cl.course_id = co.id
     WHERE cl.id = $1`,
    [session.class_id]
  );
  if (!course || course.payment_type !== 'PER_SESSION') return null;
  await ensurePerSessionSchema();

  const enrollment = await queryOne<any>(
    `SELECT id, student_id, branch_id, course_id, final_price
     FROM enrollments
     WHERE class_id = $1 AND company_id = $2 AND student_id = $3
       AND payment_type = 'PER_SESSION' AND status NOT IN ('DROPPED', 'CANCELLED', 'ON_HOLD')
     LIMIT 1`,
    [session.class_id, companyId, studentId]
  );
  if (!enrollment) return null;

  const res = await chargeOneEnrollment(
    companyId, { ...session, course_id: enrollment.course_id }, enrollment, parseFloat(course.price || 0), 'PRESENT'
  );
  if (!res) return null;
  const [details] = await fetchDetailsByIds(companyId, [res.id]);
  return details ? { ...details, packageRemaining: res.packageRemaining, isNew: res.isNew } : null;
}

// ============================================================
// HTTP routes
// ============================================================
export const sessionPaymentsRoutes = {
  /** GET /api/session-payments?from=&to=&branchId=&courseId=&sessionId=&studentId=&status= */
  list: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      q = q || {};

      const conditions: string[] = ['sp.company_id = $1'];
      const params: any[] = [context.companyId];

      if (q.from) { params.push(q.from); conditions.push(`se.start_date >= $${params.length}`); }
      if (q.to)   { params.push(q.to);   conditions.push(`se.start_date <= $${params.length}`); }

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`sp.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'sp.branch_id');
        if (branchClause) conditions.push(branchClause);
      }

      if (q.courseId)  { params.push(q.courseId);  conditions.push(`sp.course_id = $${params.length}`); }
      if (q.sessionId) { params.push(q.sessionId); conditions.push(`sp.session_id = $${params.length}`); }
      if (q.studentId) { params.push(q.studentId); conditions.push(`sp.student_id = $${params.length}`); }
      if (q.status && q.status !== 'ALL') { params.push(q.status); conditions.push(`sp.payment_status = $${params.length}`); }

      const rows = await query(
        `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
         WHERE ${conditions.join(' AND ')}
         ORDER BY se.start_date DESC NULLS LAST, s.first_name, s.last_name`,
        params
      );

      return { status: 200 as const, body: rows.map(mapSessionPaymentWithDetailsFromDB) };
    } catch (error) {
      console.error('List session payments error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list session payments');
    }
  },

  /** GET /api/session-payments/summary?from=&to=&branchId=&courseId= */
  summary: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      q = q || {};

      const conditions: string[] = ['sp.company_id = $1'];
      const params: any[] = [context.companyId];

      if (q.from) { params.push(q.from); conditions.push(`se.start_date >= $${params.length}`); }
      if (q.to)   { params.push(q.to);   conditions.push(`se.start_date <= $${params.length}`); }

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`sp.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'sp.branch_id');
        if (branchClause) conditions.push(branchClause);
      }
      if (q.courseId) { params.push(q.courseId); conditions.push(`sp.course_id = $${params.length}`); }

      const rows = await query(
        `SELECT sp.payment_status, sp.amount_due, sp.amount_paid, sp.refunded_amount
         FROM session_payments sp
         JOIN sessions se ON sp.session_id = se.id
         WHERE ${conditions.join(' AND ')}`,
        params
      );

      let paidCount = 0, coveredCount = 0, pendingCount = 0, refundedCount = 0;
      let totalRevenue = 0, totalExpected = 0;
      for (const r of rows) {
        const status = r.payment_status;
        if (status === 'REFUNDED') {
          refundedCount++;
          totalRevenue += parseFloat(r.amount_paid || 0) - parseFloat(r.refunded_amount || 0);
          continue;
        }
        if (status === 'WAIVED') continue;
        totalExpected += parseFloat(r.amount_due || 0);
        totalRevenue += parseFloat(r.amount_paid || 0);
        if (status === 'PAID') paidCount++;
        else if (status === 'COVERED') coveredCount++;
        else pendingCount++;
      }

      return {
        status: 200 as const,
        body: {
          totalCharges: rows.length,
          paidCount, coveredCount, pendingCount, refundedCount,
          totalRevenue, totalExpected,
        },
      };
    } catch (error) {
      console.error('Session payments summary error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.SUMMARY_FAILED', 'Failed to get summary');
    }
  },

  /** GET /api/session-payments/overdue?branchId= — all PENDING charges */
  overdue: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const conditions: string[] = ['sp.company_id = $1', `sp.payment_status = 'PENDING'`];
      const params: any[] = [context.companyId];

      if (q?.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`sp.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'sp.branch_id');
        if (branchClause) conditions.push(branchClause);
      }

      const rows = await query(
        `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
         WHERE ${conditions.join(' AND ')}
         ORDER BY se.start_date ASC NULLS LAST, s.first_name, s.last_name`,
        params
      );
      return { status: 200 as const, body: rows.map(mapSessionPaymentWithDetailsFromDB) };
    } catch (error) {
      console.error('Session payments overdue error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list overdue charges');
    }
  },

  /** POST /api/session-payments/:id/pay */
  recordPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne<any>(
        'SELECT * FROM session_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.SESSION_PAYMENTS.NOT_FOUND', 'Charge not found');
      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const amountDue = parseFloat(row.amount_due);
      const newPaid = parseFloat(row.amount_paid || 0) + parseFloat(body.amount);
      const newStatus = newPaid >= amountDue ? 'PAID' : 'PENDING';
      const paidDate = newStatus === 'PAID' ? body.paymentDate : null;

      await query(
        `UPDATE session_payments
         SET amount_paid = $1, payment_status = $2, paid_date = $3, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $5`,
        [newPaid, newStatus, paidDate, body.notes || null, params.id]
      );

      const updated = await queryOne('SELECT * FROM session_payments WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapSessionPaymentFromDB(updated) };
    } catch (error) {
      console.error('Record session payment error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.PAY_FAILED', 'Failed to record payment', 400);
    }
  },

  /** POST /api/session-payments/:id/void — reset a recorded payment back to unpaid */
  voidPayment: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const row = await queryOne<any>(
        'SELECT * FROM session_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.SESSION_PAYMENTS.NOT_FOUND', 'Charge not found');
      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      const reason = body?.reason ? String(body.reason).slice(0, 500) : null;
      await query(
        `UPDATE session_payments
         SET amount_paid = 0, payment_status = 'PENDING', paid_date = NULL, notes = $2, updated_at = NOW()
         WHERE id = $1`,
        [params.id, reason ? 'Voided: ' + reason : 'Payment voided']
      );
      const updated = await queryOne('SELECT * FROM session_payments WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapSessionPaymentFromDB(updated) };
    } catch (error) {
      console.error('Void session payment error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.VOID_FAILED', 'Failed to void payment', 400);
    }
  },

  /** POST /api/session-payments/:id/refund — return money for a paid session charge */
  refund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const row = await queryOne<any>(
        'SELECT * FROM session_payments WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.SESSION_PAYMENTS.NOT_FOUND', 'Charge not found');
      if (!canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const currentPaid = parseFloat(row.amount_paid || 0);
      if (currentPaid <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.NOTHING_TO_REFUND', 'There is no paid amount to refund');
      }
      const refundAmt = parseFloat(body?.amount);
      if (!isFinite(refundAmt) || refundAmt <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.INVALID_REFUND_AMOUNT', 'Refund amount must be greater than zero');
      }
      if (refundAmt > currentPaid - parseFloat(row.refunded_amount || 0)) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.REFUND_EXCEEDS_PAID', 'Refund amount cannot exceed the amount paid');
      }

      const newRefunded = Math.round((parseFloat(row.refunded_amount || 0) + refundAmt) * 100) / 100;
      const type = newRefunded >= currentPaid ? 'FULL' : 'PARTIAL';
      const note = body?.note ? String(body.note).slice(0, 500) : null;
      const refundDate = new Date().toISOString().split('T')[0];

      await query(
        `UPDATE session_payments
         SET payment_status = 'REFUNDED', refunded_amount = $1, refund_note = $2, refunded_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [newRefunded, note, params.id]
      );

      await query(
        `INSERT INTO refunds (company_id, enrollment_id, session_payment_id, branch_id, student_id, amount, refund_date, type, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [context.companyId, row.enrollment_id, params.id, row.branch_id, row.student_id, refundAmt, refundDate, type, note]
      );

      const updated = await queryOne('SELECT * FROM session_payments WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapSessionPaymentFromDB(updated) };
    } catch (error) {
      console.error('Refund session payment error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.REFUND_FAILED', 'Failed to refund payment', 400);
    }
  },

  /** POST /api/session-payments/packages — buy a prepaid session package */
  buyPackage: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne<any>(
        `SELECT e.*, co.session_package_size, co.session_package_price
         FROM enrollments e JOIN courses co ON e.course_id = co.id
         WHERE e.id = $1 AND e.company_id = $2`,
        [body.enrollmentId, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      if (!canAccessBranch(context, enrollment.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const sessionsTotal = body.sessionsTotal || (enrollment.session_package_size != null ? Number(enrollment.session_package_size) : null);
      if (!sessionsTotal || sessionsTotal <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.NO_PACKAGE_CONFIGURED', 'No package size configured for this course');
      }
      const amount = body.amount != null ? parseFloat(body.amount)
        : (enrollment.session_package_price != null ? parseFloat(enrollment.session_package_price) : 0);

      const inserted = await query(
        `INSERT INTO session_packages
           (enrollment_id, company_id, student_id, course_id, branch_id,
            sessions_total, sessions_used, amount_paid, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,'ACTIVE',$8) RETURNING *`,
        [enrollment.id, context.companyId, enrollment.student_id, enrollment.course_id, enrollment.branch_id,
         sessionsTotal, amount, body.notes || null]
      );
      const pkg = inserted[0];

      // Back-cover existing PENDING charges (oldest first) up to the credits bought.
      const pending = await query(
        `SELECT id FROM session_payments
         WHERE enrollment_id = $1 AND payment_status = 'PENDING'
         ORDER BY created_at ASC LIMIT $2`,
        [enrollment.id, sessionsTotal]
      );
      if (pending.length > 0) {
        const ids = pending.map((r: any) => r.id);
        await query(
          `UPDATE session_payments
           SET payment_status = 'COVERED', package_id = $1, updated_at = NOW()
           WHERE id = ANY($2::uuid[])`,
          [pkg.id, ids]
        );
        const used = pending.length;
        await query(
          `UPDATE session_packages
           SET sessions_used = $1, status = CASE WHEN $1 >= sessions_total THEN 'EXHAUSTED' ELSE 'ACTIVE' END, updated_at = NOW()
           WHERE id = $2`,
          [used, pkg.id]
        );
        pkg.sessions_used = used;
      }

      const fresh = await queryOne('SELECT * FROM session_packages WHERE id = $1', [pkg.id]);
      return { status: 201 as const, body: mapPackageFromDB(fresh) };
    } catch (error) {
      console.error('Buy session package error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.PACKAGE_FAILED', 'Failed to buy package', 400);
    }
  },

  /** GET /api/session-payments/packages?branchId=&courseId=&studentId=&status= */
  listPackages: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      q = q || {};
      const conditions: string[] = ['spkg.company_id = $1'];
      const params: any[] = [context.companyId];

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`spkg.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'spkg.branch_id');
        if (branchClause) conditions.push(branchClause);
      }
      if (q.courseId)  { params.push(q.courseId);  conditions.push(`spkg.course_id = $${params.length}`); }
      if (q.studentId) { params.push(q.studentId); conditions.push(`spkg.student_id = $${params.length}`); }
      if (q.status && q.status !== 'ALL') { params.push(q.status); conditions.push(`spkg.status = $${params.length}`); }

      const rows = await query(
        `SELECT spkg.*,
                s.first_name AS student_first_name,
                s.last_name  AS student_last_name,
                c.name       AS course_name,
                b.name       AS branch_name
         FROM session_packages spkg
         JOIN students s ON spkg.student_id = s.id
         JOIN courses  c ON spkg.course_id  = c.id
         JOIN branches b ON spkg.branch_id  = b.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY spkg.purchased_at DESC`,
        params
      );
      return { status: 200 as const, body: rows.map(mapPackageWithDetailsFromDB) };
    } catch (error) {
      console.error('List session packages error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list packages');
    }
  },

  /** GET /api/session-payments/course/:courseId */
  listByCourse: async ({ params, headers }: { params: { courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const params2: any[] = [context.companyId, params.courseId];
      const conditions = ['sp.company_id = $1', 'sp.course_id = $2'];
      const branchClause = appendBranchSqlFilter(context, params2, 'sp.branch_id');
      if (branchClause) conditions.push(branchClause);

      const rows = await query(
        `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
         WHERE ${conditions.join(' AND ')}
         ORDER BY se.start_date DESC NULLS LAST`,
        params2
      );
      return { status: 200 as const, body: rows.map(mapSessionPaymentWithDetailsFromDB) };
    } catch (error) {
      console.error('List session payments by course error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list charges');
    }
  },

  /** GET /api/session-payments/student/:studentId */
  listByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const params2: any[] = [context.companyId, params.studentId];
      const conditions = ['sp.company_id = $1', 'sp.student_id = $2'];
      const branchClause = appendBranchSqlFilter(context, params2, 'sp.branch_id');
      if (branchClause) conditions.push(branchClause);

      const rows = await query(
        `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
         WHERE ${conditions.join(' AND ')}
         ORDER BY se.start_date DESC NULLS LAST`,
        params2
      );
      return { status: 200 as const, body: rows.map(mapSessionPaymentWithDetailsFromDB) };
    } catch (error) {
      console.error('List session payments by student error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list charges');
    }
  },

  /** GET /api/session-payments/by-token/:qrToken — scan → student's due sessions */
  byToken: async ({ params, headers }: { params: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const token = (params.qrToken || '').trim();
      if (!token) {
        return apiError(404, 'ERRORS.SESSION_PAYMENTS.STUDENT_NOT_FOUND', 'Student not found for this code');
      }
      const student = await queryOne<any>(
        'SELECT id, first_name, last_name FROM students WHERE qr_token = $1 AND company_id = $2 AND is_active = true',
        [token, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.SESSION_PAYMENTS.STUDENT_NOT_FOUND', 'Student not found for this code');
      }

      const rows = await query(
        `SELECT ${DETAILS_SELECT} ${DETAILS_FROM}
         WHERE sp.company_id = $1 AND sp.student_id = $2 AND sp.payment_status = 'PENDING'
         ORDER BY se.start_date ASC NULLS LAST, c.name`,
        [context.companyId, student.id]
      );
      const dueSessions = rows
        .filter((r: any) => canAccessBranch(context, r.branch_id))
        .map(mapSessionPaymentWithDetailsFromDB);

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
          dueSessions,
        },
      };
    } catch (error) {
      console.error('Session payments by-token lookup error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to load due sessions for this code');
    }
  },
};
