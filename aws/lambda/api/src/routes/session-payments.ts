import { query, queryOne } from '../db/connection';
import {
  applySessionInstallmentLedger,
  recordSessionInstallment,
  recordPackageInstallment,
  clearSessionInstallments,
} from '../db/payment-ledger';
import { ensureQrCardSchema, qrStudentMatch } from './qr-cards';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { issueReceipt, voidReceiptsFor } from '../db/receipts';

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
        // Constraint DDL runs inside DO blocks that skip work when the constraint
        // is already in the desired state and swallow duplicate_object: concurrent
        // cold-starting containers otherwise race between DROP and ADD and the
        // loser dies with "constraint ... already exists".
        await query(`DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'courses_payment_type_check' AND conrelid = 'courses'::regclass
                AND pg_get_constraintdef(oid) LIKE '%PER_SESSION%'
            ) THEN
              ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_payment_type_check;
              BEGIN
                ALTER TABLE courses ADD CONSTRAINT courses_payment_type_check
                  CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'));
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END IF;
          END $$`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS session_package_size INTEGER`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS session_package_price DECIMAL(10, 2)`);
        await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS charge_absent_sessions BOOLEAN NOT NULL DEFAULT FALSE`);

        // enrollments: widen payment_type CHECK
        await query(`DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'enrollments_payment_type_check' AND conrelid = 'enrollments'::regclass
                AND pg_get_constraintdef(oid) LIKE '%PER_SESSION%'
            ) THEN
              ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_payment_type_check;
              BEGIN
                ALTER TABLE enrollments ADD CONSTRAINT enrollments_payment_type_check
                  CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'));
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END IF;
          END $$`);

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
          amount_due DECIMAL(10, 2) NOT NULL DEFAULT 0,
          amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
          status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REFUNDED')),
          purchased_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`);
        // amount_due may be missing on packages created before this column existed.
        await query(`ALTER TABLE session_packages ADD COLUMN IF NOT EXISTS amount_due DECIMAL(10, 2) NOT NULL DEFAULT 0`);
        // Refund tracking (mirrors monthly_subscription_payments): amount_paid
        // stays gross, refunded_amount records what was returned.
        await query(`ALTER TABLE session_packages ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10, 2) NOT NULL DEFAULT 0`);
        await query(`ALTER TABLE session_packages ADD COLUMN IF NOT EXISTS refund_note TEXT`);
        await query(`ALTER TABLE session_packages ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_enrollment_id ON session_packages(enrollment_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_company_id ON session_packages(company_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_student_id ON session_packages(student_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_course_id ON session_packages(course_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_branch_id ON session_packages(branch_id)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_spkg_status ON session_packages(status)`);
        // Migration 072: this enrollment pays session by session, so stop
        // prompting for the next bundle. Billing is unchanged — attendance
        // already raises a charge whenever there's no bundle credit to consume.
        await query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS session_packages_opted_out BOOLEAN NOT NULL DEFAULT FALSE`);

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

        // refunds link (polymorphic). Skip when the FK already exists — the old
        // unconditional DROP+ADD both re-validated every refunds row on each cold
        // start and raced against other containers ("fk_refunds_session_payment
        // already exists" in production).
        await query(`ALTER TABLE refunds ADD COLUMN IF NOT EXISTS session_payment_id UUID`);
        await query(`DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'fk_refunds_session_payment' AND conrelid = 'refunds'::regclass
            ) THEN
              BEGIN
                ALTER TABLE refunds ADD CONSTRAINT fk_refunds_session_payment
                  FOREIGN KEY (session_payment_id) REFERENCES session_payments(id) ON DELETE CASCADE;
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END IF;
          END $$`);
        // Migration 079: per-collection money ledger for session_payments. Must
        // come after the table above — it carries the FK. Read paths rely on this
        // guard for the table's existence, same as for session_payments itself.
        await applySessionInstallmentLedger();

        await query(`ALTER TABLE refunds ADD COLUMN IF NOT EXISTS session_package_id UUID`);
        await query(`DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'fk_refunds_session_package' AND conrelid = 'refunds'::regclass
            ) THEN
              BEGIN
                ALTER TABLE refunds ADD CONSTRAINT fk_refunds_session_package
                  FOREIGN KEY (session_package_id) REFERENCES session_packages(id) ON DELETE CASCADE;
              EXCEPTION WHEN duplicate_object THEN NULL;
              END;
            END IF;
          END $$`);
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
    studentName: row.student_name,
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
    enrollmentStatus: row.enrollment_status || null,
    pkgSessionsTotal: row.pkg_sessions_total != null ? Number(row.pkg_sessions_total) : null,
    pkgSessionsUsed: row.pkg_sessions_used != null ? Number(row.pkg_sessions_used) : null,
    hadPackage: row.had_package === true,
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
    amountDue: parseFloat(row.amount_due || 0),
    amountPaid: parseFloat(row.amount_paid || 0),
    status: row.status,
    refundedAmount: parseFloat(row.refunded_amount || 0),
    refundNote: row.refund_note || null,
    refundedAt: row.refunded_at || null,
    purchasedAt: row.purchased_at || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPackageWithDetailsFromDB(row: any) {
  return {
    ...mapPackageFromDB(row),
    studentName: row.student_name,
    courseName: row.course_name,
    branchName: row.branch_name,
  };
}

// Columns + joins used to return "with details" rows.
const DETAILS_SELECT = `
  sp.*,
  s.name AS student_name,
  s.phone        AS student_phone,
  s.parent_phone AS parent_phone,
  s.parent_name  AS parent_name,
  c.name         AS course_name,
  c.session_package_size  AS course_package_size,
  c.session_package_price AS course_package_price,
  b.name         AS branch_name,
  cl.name        AS class_name,
  se.session_number AS session_number,
  se.start_date  AS session_date,
  e.status       AS enrollment_status,
  pkg.sessions_total AS pkg_sessions_total,
  pkg.sessions_used  AS pkg_sessions_used,
  EXISTS (
    SELECT 1 FROM session_packages spk2 WHERE spk2.enrollment_id = sp.enrollment_id
  ) AS had_package
`;
const DETAILS_FROM = `
  FROM session_payments sp
  JOIN students s  ON sp.student_id = s.id
  JOIN courses  c  ON sp.course_id  = c.id
  JOIN branches b  ON sp.branch_id  = b.id
  JOIN sessions se ON sp.session_id = se.id
  LEFT JOIN enrollments e ON sp.enrollment_id = e.id
  LEFT JOIN classes cl    ON e.class_id = cl.id
  LEFT JOIN session_packages pkg ON sp.package_id = pkg.id
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
 *
 * FREE SESSIONS (migration 071): every public entry point above bails on
 * `session.is_free` before reaching here, so a trial lesson never produces a
 * session_payments row at all. The guard is repeated at each entry point rather
 * than centralised here on purpose — some of them do work (package lookups,
 * course reads) before they would ever call this function, and a free session
 * should cost nothing, not even a query. Nothing needs to reverse those charges
 * later because none were ever written.
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
  if (session.is_free) return [];   // free session — see chargeOneEnrollment's note
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
  if (session.is_free) return;   // free session — see chargeOneEnrollment's note
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

// ============================================================
// Reverse a PER_SESSION attendance charge when a student is un-marked present.
// Deletes their PRESENT session_payments row(s) for the session and gives back
// any prepaid-package credit the row consumed. Paid rows are removed too — the
// student didn't attend, so the session shouldn't be charged; the delete
// cascades to any linked refund. ABSENT charges (session-end absence billing)
// are intentionally left alone. Best-effort; callers wrap in try/catch.
// ============================================================

// Is this session's class a PER_SESSION course?
async function isPerSessionClass(classId: string): Promise<boolean> {
  const course = await queryOne<any>(
    `SELECT co.payment_type FROM classes cl JOIN courses co ON cl.course_id = co.id WHERE cl.id = $1`,
    [classId]
  );
  return !!course && course.payment_type === 'PER_SESSION';
}

// Delete one PRESENT charge row and, if it was package-covered, restore the credit.
async function reverseChargeRow(row: { id: string; package_id: string | null }): Promise<void> {
  if (row.package_id) {
    await query(
      `UPDATE session_packages
       SET sessions_used = GREATEST(sessions_used - 1, 0),
           status = CASE WHEN status = 'EXHAUSTED' THEN 'ACTIVE' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [row.package_id]
    );
  }
  await query(`DELETE FROM session_payments WHERE id = $1`, [row.id]);
}

/** Reverse PRESENT charges for every student in this session NOT in keepStudentIds. */
export async function reverseUnattendedCharges(companyId: string, session: any, keepStudentIds: string[]): Promise<void> {
  if (!(await isPerSessionClass(session.class_id))) return;
  await ensurePerSessionSchema();
  const rows = await query<any>(
    `SELECT id, package_id FROM session_payments
     WHERE session_id = $1 AND company_id = $2 AND attendance_state = 'PRESENT'
       AND NOT (student_id = ANY($3::uuid[]))`,
    [session.id, companyId, keepStudentIds || []]
  );
  for (const r of rows) await reverseChargeRow(r);
}

/** Reverse a single student's PRESENT charge for this session (used on un-check). */
export async function reverseStudentCharge(companyId: string, session: any, studentId: string): Promise<void> {
  if (!(await isPerSessionClass(session.class_id))) return;
  await ensurePerSessionSchema();
  const rows = await query<any>(
    `SELECT id, package_id FROM session_payments
     WHERE session_id = $1 AND company_id = $2 AND student_id = $3 AND attendance_state = 'PRESENT'`,
    [session.id, companyId, studentId]
  );
  for (const r of rows) await reverseChargeRow(r);
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
  if (session.is_free) return null;   // free session — see chargeOneEnrollment's note
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

      // Compare by calendar day so the `to` day is fully inclusive regardless of
      // the session's time-of-day component.
      if (q.from) { params.push(q.from); conditions.push(`se.start_date::date >= $${params.length}::date`); }
      if (q.to)   { params.push(q.to);   conditions.push(`se.start_date::date <= $${params.length}::date`); }

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
         ORDER BY se.start_date DESC NULLS LAST, s.name`,
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

      // Compare by calendar day so the `to` day is fully inclusive regardless of
      // the session's time-of-day component.
      if (q.from) { params.push(q.from); conditions.push(`se.start_date::date >= $${params.length}::date`); }
      if (q.to)   { params.push(q.to);   conditions.push(`se.start_date::date <= $${params.length}::date`); }

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
        `SELECT sp.payment_status, sp.amount_due, sp.amount_paid, sp.refunded_amount,
                pkg.amount_paid AS pkg_amount, pkg.sessions_total AS pkg_total
         FROM session_payments sp
         JOIN sessions se ON sp.session_id = se.id
         LEFT JOIN session_packages pkg ON sp.package_id = pkg.id
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
        if (status === 'COVERED') {
          // A covered session's money was collected up-front in its package. Recognise
          // its share (package price / package size) so package revenue is reflected
          // per consumed session, not left at 0.
          coveredCount++;
          const pkgTotal = parseInt(r.pkg_total || 0, 10);
          const pkgAmount = parseFloat(r.pkg_amount || 0);
          totalRevenue += pkgTotal > 0 ? pkgAmount / pkgTotal : 0;
        } else {
          totalRevenue += parseFloat(r.amount_paid || 0);
          if (status === 'PAID') paidCount++;
          else pendingCount++;
        }
      }

      // ── Cash collected — money that actually arrived within the range, dated
      // by PAYMENT date (not session date). A package purchase counts in full on
      // the day it was paid (800 paid today = 800 today), unlike totalRevenue
      // which spreads it across attended sessions (price ÷ package size each).
      const cashConds: string[] = ['company_id = $1'];
      const cashParams: any[] = [context.companyId];
      if (q.branchId) { cashParams.push(q.branchId); cashConds.push(`branch_id = $${cashParams.length}`); }
      else {
        const bc = appendBranchSqlFilter(context, cashParams, 'branch_id');
        if (bc) cashConds.push(bc);
      }
      if (q.courseId) { cashParams.push(q.courseId); cashConds.push(`course_id = $${cashParams.length}`); }
      let spDate = '';
      let pkgDate = '';
      if (q.from) {
        cashParams.push(q.from);
        spDate += ` AND payment_date >= $${cashParams.length}::date`;
        pkgDate += ` AND payment_date >= $${cashParams.length}::date`;
      }
      if (q.to) {
        cashParams.push(q.to);
        spDate += ` AND payment_date <= $${cashParams.length}::date`;
        pkgDate += ` AND payment_date <= $${cashParams.length}::date`;
      }
      // Split the cash into per-session-charge money and prepaid-package money so
      // the dashboard can show "cash for packages only" and a session/package/all
      // breakdown. cashCollected (total) = sessionCash + packageCashCollected.
      const cashRow = await queryOne<any>(
        // Per-session charge cash comes from the installment ledger: one row per
        // collection, on the day it was collected. Summing the charge's cumulative
        // amount_paid instead would move a split payment's earlier half onto the
        // later date (see db/payment-ledger.ts).
        `SELECT
           COALESCE((SELECT SUM(amount) FROM session_payment_installments
                     WHERE ${cashConds.join(' AND ')} AND amount > 0 ${spDate}), 0) AS session_cash,
           COALESCE((SELECT SUM(amount) FROM session_package_installments
                     WHERE ${cashConds.join(' AND ')} AND amount > 0 ${pkgDate}), 0) AS package_cash`,
        cashParams
      );
      const packageCashCollected = parseFloat(cashRow?.package_cash || 0);
      const cashCollected = parseFloat(cashRow?.session_cash || 0) + packageCashCollected;

      // Same split as the monthly summary: the counts are how the desk works and
      // ride on enrollments:read, while what the academy takes stays behind
      // revenues:read. Omitted rather than zeroed — a zero would read as "took
      // nothing", and the redaction is here rather than in the UI because a
      // hidden tile still ships its number in the response.
      const canSeeMoney = checkGranularPermission(context, 'revenues', 'read');

      return {
        status: 200 as const,
        body: {
          totalCharges: rows.length,
          paidCount, coveredCount, pendingCount, refundedCount,
          ...(canSeeMoney ? { totalRevenue, totalExpected, cashCollected, packageCashCollected } : {}),
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
         ORDER BY se.start_date ASC NULLS LAST, s.name`,
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
      const pay = parseFloat(body.amount);
      // Guarded so a malformed request can never desync amount_paid from the
      // installment ledger below.
      if (!isFinite(pay) || pay <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.INVALID_AMOUNT', 'Amount must be greater than zero');
      }
      const newPaid = parseFloat(row.amount_paid || 0) + pay;
      const newStatus = newPaid >= amountDue ? 'PAID' : 'PENDING';
      // paid_date is now only "when was this charge last paid" for display —
      // revenue comes from the installment rows, each on its own date. Stamped for
      // a part payment too (it used to stay null, so the charge looked unpaid) and
      // defaulted to today when the client omits the date.
      const effectiveDate = body.paymentDate || new Date().toISOString().split('T')[0];

      await query(
        `UPDATE session_payments
         SET amount_paid = $1, payment_status = $2, paid_date = $3, notes = COALESCE($4, notes), updated_at = NOW()
         WHERE id = $5`,
        [newPaid, newStatus, effectiveDate, body.notes || null, params.id]
      );

      await recordSessionInstallment(row, pay, effectiveDate, body.notes || null, context.userId);

      const receipt = await issueReceipt({
        companyId: context.companyId,
        sourceType: 'SESSION',
        sourceId: row.id,
        studentId: row.student_id,
        courseId: row.course_id,
        branchId: row.branch_id,
        amount: pay,
        paymentDate: effectiveDate,
        totalDue: amountDue,
        paidToDate: newPaid,
        notes: body.notes || null,
        recordedByUserId: context.userId,
      });

      const updated = await queryOne('SELECT * FROM session_payments WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { ...mapSessionPaymentFromDB(updated), receipt } };
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
      if (!checkGranularPermission(context, 'refunds', 'write')) {
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
      // The money never happened — drop the days it was booked on with it.
      await clearSessionInstallments(params.id);
      // The printed slip stays resolvable, but now reads "cancelled".
      await voidReceiptsFor('SESSION', params.id);
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
      if (!checkGranularPermission(context, 'refunds', 'write')) {
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
      const remaining = Math.round((currentPaid - parseFloat(row.refunded_amount || 0)) * 100) / 100;
      if (remaining <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.NOTHING_TO_REFUND', 'There is no paid amount to refund');
      }
      // FULL = the whole remaining paid amount; PARTIAL (or legacy amount-only
      // bodies from cached clients) = the requested amount.
      let refundAmt: number;
      if (body?.type === 'FULL' || (body?.type == null && body?.amount == null)) {
        refundAmt = remaining;
      } else {
        refundAmt = parseFloat(body?.amount);
        if (!isFinite(refundAmt) || refundAmt <= 0) {
          return apiError(400, 'ERRORS.SESSION_PAYMENTS.INVALID_REFUND_AMOUNT', 'Refund amount must be greater than zero');
        }
        if (refundAmt > remaining) {
          return apiError(400, 'ERRORS.SESSION_PAYMENTS.REFUND_EXCEEDS_PAID', 'Refund amount cannot exceed the amount paid');
        }
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

  /**
   * POST /api/session-payments/enrollments/:id/pay-per-session
   *
   * Switch this enrollment off bundles: it pays for each session it attends
   * instead of buying the next prepaid block. Nothing is billed or written off
   * here — the sessions attended since the last bundle ran out already exist as
   * individual charges, and stay exactly as they are, payable on the Charges
   * tab. The only change is that the student stops being asked to renew.
   *
   * Reversible: buying a bundle for them clears the flag again.
   */
  payPerSession: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const enrollment = await queryOne<any>(
        `SELECT id, branch_id, payment_type FROM enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!enrollment) return apiError(404, 'ERRORS.ENROLLMENTS.NOT_FOUND', 'Enrollment not found');
      if (!canAccessBranch(context, enrollment.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      if (enrollment.payment_type !== 'PER_SESSION') {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.NOT_PER_SESSION', 'This enrollment is not billed per session');
      }

      await query(
        `UPDATE enrollments SET session_packages_opted_out = TRUE, updated_at = NOW() WHERE id = $1`,
        [enrollment.id]
      );

      // Report what is now owed session by session, so the caller can point the
      // user straight at it rather than leaving them to hunt for it.
      const owed = await queryOne<any>(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_due - amount_paid), 0) AS total
         FROM session_payments
         WHERE enrollment_id = $1 AND company_id = $2 AND payment_status = 'PENDING'`,
        [enrollment.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: {
          enrollmentId: enrollment.id,
          unpaidSessions: parseInt(owed?.count ?? '0', 10),
          unpaidAmount: parseFloat(owed?.total ?? 0),
        },
      };
    } catch (error) {
      console.error('Switch to per-session error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.PAY_PER_SESSION_FAILED', 'Failed to switch to per-session payment');
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
      // amount_due = full package price; amount = collected now (defaults to full).
      const price = enrollment.session_package_price != null ? parseFloat(enrollment.session_package_price) : 0;
      const amountDue = body.amountDue != null ? parseFloat(body.amountDue) : price;
      const amountPaid = body.amount != null ? parseFloat(body.amount) : amountDue;

      // Buying a bundle is the clearest possible statement that this student is
      // back on bundles, so it undoes any earlier "pays per session" choice.
      // Without this, they'd own an active package and still never be prompted
      // to renew it when it ran out.
      await query(
        `UPDATE enrollments SET session_packages_opted_out = FALSE WHERE id = $1`,
        [enrollment.id]
      );

      const inserted = await query(
        `INSERT INTO session_packages
           (enrollment_id, company_id, student_id, course_id, branch_id,
            sessions_total, sessions_used, amount_due, amount_paid, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'ACTIVE',$9) RETURNING *`,
        [enrollment.id, context.companyId, enrollment.student_id, enrollment.course_id, enrollment.branch_id,
         sessionsTotal, amountDue, amountPaid, body.notes || null]
      );
      const pkg = inserted[0];

      // Whatever was collected at purchase is the package's first installment
      // (skipped when the bundle is bought to be paid later, amount 0). Dated
      // today, matching the purchased_at the INSERT above defaulted to.
      await recordPackageInstallment(pkg, amountPaid, null, body.notes || null, context.userId);

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

  /** POST /api/session-payments/packages/:id/pay — collect (part of) a package's balance */
  payPackage: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const pkg = await queryOne<any>(
        'SELECT * FROM session_packages WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!pkg) return apiError(404, 'ERRORS.SESSION_PAYMENTS.PACKAGE_NOT_FOUND', 'Package not found');
      if (!canAccessBranch(context, pkg.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      const amount = parseFloat(body.amount);
      if (!isFinite(amount) || amount <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.INVALID_AMOUNT', 'Amount must be greater than zero');
      }
      const newPaid = parseFloat(pkg.amount_paid || 0) + amount;
      await query(
        `UPDATE session_packages SET amount_paid = $1, updated_at = NOW() WHERE id = $2`,
        [newPaid, params.id]
      );

      // The top-up is its own dated collection. purchased_at deliberately stays
      // the purchase day — before the ledger, summing amount_paid against it
      // booked this money onto a day that had already been reported.
      await recordPackageInstallment(pkg, amount, body.paymentDate || null, body.notes || null, context.userId);

      const receipt = await issueReceipt({
        companyId: context.companyId,
        sourceType: 'PACKAGE',
        sourceId: pkg.id,
        studentId: pkg.student_id,
        courseId: pkg.course_id,
        branchId: pkg.branch_id,
        amount,
        paymentDate: body.paymentDate || null,
        totalDue: parseFloat(pkg.amount_due ?? 0) || null,
        paidToDate: newPaid,
        periodLabel: pkg.sessions_total ? `${pkg.sessions_total} sessions` : null,
        notes: body.notes || null,
        recordedByUserId: context.userId,
      });

      const fresh = await queryOne('SELECT * FROM session_packages WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { ...mapPackageFromDB(fresh), receipt } };
    } catch (error) {
      console.error('Pay session package error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.PACKAGE_PAY_FAILED', 'Failed to record package payment', 400);
    }
  },

  /** POST /api/session-payments/packages/:id/refund — return prepaid package money.
   *  Mirrors the monthly-subscription refund: amount_paid stays gross,
   *  refunded_amount tracks the returned total, a refunds row carries the money
   *  out of revenue, and the package goes REFUNDED (no further coverage). */
  refundPackage: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const pkg = await queryOne<any>(
        'SELECT * FROM session_packages WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!pkg) return apiError(404, 'ERRORS.SESSION_PAYMENTS.PACKAGE_NOT_FOUND', 'Package not found');
      if (!canAccessBranch(context, pkg.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const currentPaid = parseFloat(pkg.amount_paid || 0);
      const remaining = Math.round((currentPaid - parseFloat(pkg.refunded_amount || 0)) * 100) / 100;
      if (remaining <= 0) {
        return apiError(400, 'ERRORS.SESSION_PAYMENTS.NOTHING_TO_REFUND', 'There is no paid amount to refund');
      }

      let refundAmt: number;
      if (body?.type === 'FULL' || (body?.type == null && body?.amount == null)) {
        refundAmt = remaining;
      } else {
        refundAmt = parseFloat(body?.amount);
        if (!isFinite(refundAmt) || refundAmt <= 0) {
          return apiError(400, 'ERRORS.SESSION_PAYMENTS.INVALID_REFUND_AMOUNT', 'Refund amount must be greater than zero');
        }
        if (refundAmt > remaining) {
          return apiError(400, 'ERRORS.SESSION_PAYMENTS.REFUND_EXCEEDS_PAID', 'Refund amount cannot exceed the amount paid');
        }
      }

      const newRefunded = Math.round((parseFloat(pkg.refunded_amount || 0) + refundAmt) * 100) / 100;
      const type = newRefunded >= currentPaid ? 'FULL' : 'PARTIAL';
      const note = body?.note ? String(body.note).slice(0, 500) : null;
      const refundDate = new Date().toISOString().split('T')[0];

      await query(
        `UPDATE session_packages
         SET status = 'REFUNDED', refunded_amount = $1, refund_note = $2, refunded_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [newRefunded, note, params.id]
      );

      // enrollment_id ties the refund to a branch for P&L attribution;
      // session_package_id links the exact package (and its net on the revenues page).
      await query(
        `INSERT INTO refunds (company_id, enrollment_id, session_package_id, branch_id, student_id, amount, refund_date, type, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [context.companyId, pkg.enrollment_id, params.id, pkg.branch_id, pkg.student_id, refundAmt, refundDate, type, note]
      );

      const fresh = await queryOne('SELECT * FROM session_packages WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapPackageFromDB(fresh) };
    } catch (error) {
      console.error('Refund session package error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.REFUND_FAILED', 'Failed to refund package', 400);
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
                s.name AS student_name,
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

  /** GET /api/session-payments/renewals-due?branchId=&courseId= — package customers
   *  whose prepaid sessions ran out: last package fully used (or all credit gone)
   *  and no active package left. They owe the NEXT package. */
  renewalsDue: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      q = q || {};
      const conditions: string[] = [
        `e.company_id = $1`,
        `e.payment_type = 'PER_SESSION'`,
        `e.status NOT IN ('DROPPED', 'CANCELLED', 'ON_HOLD')`,
        `c.session_package_size IS NOT NULL AND c.session_package_size > 0`,
        // Students who chose to pay session by session aren't waiting to renew
        // anything, so they don't belong on this list (migration 072).
        `e.session_packages_opted_out = FALSE`,
        // No usable credit anywhere on this enrollment…
        `NOT EXISTS (
           SELECT 1 FROM session_packages ap
           WHERE ap.enrollment_id = e.id AND ap.status = 'ACTIVE' AND ap.sessions_used < ap.sessions_total
         )`,
        // …and the most recent package ended by being used up, not refunded.
        `lastpkg.status <> 'REFUNDED'`,
      ];
      const params: any[] = [context.companyId];

      if (q.branchId) {
        if (!canAccessBranch(context, q.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(q.branchId);
        conditions.push(`e.branch_id = $${params.length}`);
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchClause) conditions.push(branchClause);
      }
      if (q.courseId) { params.push(q.courseId); conditions.push(`e.course_id = $${params.length}`); }

      const rows = await query(
        `SELECT
           e.id AS enrollment_id,
           e.student_id, e.branch_id, e.course_id,
           s.name AS student_name,
           c.name       AS course_name,
           c.session_package_size  AS package_size,
           c.session_package_price AS package_price,
           b.name       AS branch_name,
           lastpkg.sessions_total AS last_sessions_total,
           lastpkg.sessions_used  AS last_sessions_used,
           lastpkg.updated_at     AS exhausted_at,
           -- Sessions this student attended that are still unpaid (a per-session
           -- charge exists but wasn't covered by a package) — the overflow they
           -- racked up after the bundle ran out.
           (SELECT COUNT(*) FROM session_payments spp
             WHERE spp.enrollment_id = e.id AND spp.payment_status = 'PENDING') AS unpaid_sessions
         FROM enrollments e
         JOIN courses c  ON e.course_id = c.id
         JOIN students s ON e.student_id = s.id
         JOIN branches b ON e.branch_id = b.id
         JOIN LATERAL (
           SELECT * FROM session_packages sp
           WHERE sp.enrollment_id = e.id
           ORDER BY sp.purchased_at DESC NULLS LAST LIMIT 1
         ) lastpkg ON true
         WHERE ${conditions.join(' AND ')}
         ORDER BY lastpkg.updated_at DESC`,
        params
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          enrollmentId: r.enrollment_id,
          studentId: r.student_id,
          branchId: r.branch_id,
          courseId: r.course_id,
          studentName: r.student_name,
          courseName: r.course_name,
          branchName: r.branch_name,
          packageSize: r.package_size != null ? Number(r.package_size) : null,
          packagePrice: r.package_price != null ? parseFloat(r.package_price) : null,
          lastSessionsTotal: Number(r.last_sessions_total),
          lastSessionsUsed: Number(r.last_sessions_used),
          unpaidSessions: Number(r.unpaid_sessions || 0),
          exhaustedAt: r.exhausted_at || null,
        })),
      };
    } catch (error) {
      console.error('Session package renewals-due error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to list due renewals');
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
      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne<any>(
        `SELECT s.id, s.name FROM students s
         WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2 AND s.is_active = true`,
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
          studentName: student.name,
          dueSessions,
        },
      };
    } catch (error) {
      console.error('Session payments by-token lookup error:', error);
      return mapThrownError(error, 'ERRORS.SESSION_PAYMENTS.LIST_FAILED', 'Failed to load due sessions for this code');
    }
  },
};
