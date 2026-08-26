import { query, queryOne } from './connection';
import { pushPayment } from '../utils/push';

/**
 * Printed payment receipts.
 *
 * A receipt is an IMMUTABLE SNAPSHOT, not a view over live rows. Every human
 * detail — student name and phone, course, branch, academy, the amounts — is
 * copied in at the moment money changes hands, and the table carries NO foreign
 * keys at all. That is the whole point: the QR on a printed slip has to keep
 * resolving after the payment is voided, the enrolment deleted, the student
 * removed, even the course dropped. A FK with ON DELETE CASCADE would take the
 * receipt with it; a FK with SET NULL would leave a receipt that can no longer
 * say whose money it was. So: plain uuid columns, joined to nothing.
 *
 * `voided_at` records that the underlying payment was later reversed. The
 * receipt still resolves — it says, truthfully, that this receipt was cancelled.
 * Deleting the row would leave a printed slip in someone's hand pointing at a
 * dead link, which is worse than telling them it was voided.
 */

const RECEIPTS_DDL = [
  `CREATE TABLE IF NOT EXISTS payment_receipts (
     id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     company_id       UUID NOT NULL,
     receipt_number   INTEGER NOT NULL,
     public_token     VARCHAR(64) NOT NULL,

     -- which money this was; source_id is the ledger/payment row, kept as a
     -- plain uuid so deleting that row never touches the receipt
     source_type      VARCHAR(24) NOT NULL,
     source_id        UUID,
     student_id       UUID,

     -- snapshot: what the slip says, frozen
     student_name     TEXT,
     student_phone    TEXT,
     parent_phone     TEXT,
     student_code     INTEGER,
     course_name      TEXT,
     class_name       TEXT,
     branch_name      TEXT,
     company_name     TEXT,
     recorded_by      TEXT,

     amount           NUMERIC(12,2) NOT NULL,
     total_due        NUMERIC(12,2),
     paid_to_date     NUMERIC(12,2),
     remaining        NUMERIC(12,2),
     is_full_payment  BOOLEAN NOT NULL DEFAULT false,
     period_label     TEXT,
     payment_date     DATE NOT NULL,
     notes            TEXT,

     voided_at        TIMESTAMP WITH TIME ZONE,
     created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  // Who taught what was paid for (class instructor, else the course's) —
  // snapshotted like every other name on the slip. NULL on receipts issued
  // before the column existed; the page simply omits the line.
  `ALTER TABLE payment_receipts ADD COLUMN IF NOT EXISTS teacher_name TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_token ON payment_receipts(public_token)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_company_number ON payment_receipts(company_id, receipt_number)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_source ON payment_receipts(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_student ON payment_receipts(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_receipts_company ON payment_receipts(company_id)`,
];

let receiptsPromise: Promise<void> | null = null;

/** Idempotent, cached per container — mirrors the installment-ledger guards. */
export async function ensureReceiptSchema(): Promise<void> {
  if (!receiptsPromise) {
    receiptsPromise = (async () => {
      try {
        for (const ddl of RECEIPTS_DDL) await query(ddl);
      } catch (e) {
        receiptsPromise = null;   // let the next caller retry
        throw e;
      }
    })();
  }
  return receiptsPromise;
}

export type ReceiptSource =
  | 'MONTHLY'        // one collection against a monthly-subscription bill
  | 'SESSION'        // one pay-as-you-go session charge
  | 'PACKAGE'        // a prepaid session package purchase or top-up
  | 'ENROLLMENT'     // a one-time / installment course payment
  | 'MASTER';        // a bundle (master enrolment) payment

export interface IssueReceiptInput {
  companyId: string;
  sourceType: ReceiptSource;
  sourceId?: string | null;
  studentId?: string | null;
  /** Named directly when the caller already has them; otherwise looked up. */
  courseId?: string | null;
  classId?: string | null;
  branchId?: string | null;
  amount: number;
  paymentDate: string | null;
  totalDue?: number | null;
  paidToDate?: number | null;
  /** e.g. "March 2026" for a monthly bill, or the session date. */
  periodLabel?: string | null;
  notes?: string | null;
  recordedByUserId?: string | null;
}

export interface ReceiptRow {
  id: string;
  receiptNumber: number;
  publicToken: string;
  sourceType: string;
  /** The bill/charge/payment this was issued against — lets a caller match a receipt to the thing it paid. */
  sourceId: string | null;
  studentName: string | null;
  studentPhone: string | null;
  parentPhone: string | null;
  studentCode: number | null;
  courseName: string | null;
  className: string | null;
  teacherName: string | null;
  branchName: string | null;
  companyName: string | null;
  recordedBy: string | null;
  amount: number;
  totalDue: number | null;
  paidToDate: number | null;
  remaining: number | null;
  isFullPayment: boolean;
  periodLabel: string | null;
  paymentDate: string;
  notes: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export function mapReceipt(row: any): ReceiptRow {
  const num = (v: any) => (v === null || v === undefined ? null : parseFloat(v));
  return {
    id: row.id,
    receiptNumber: Number(row.receipt_number),
    publicToken: row.public_token,
    sourceType: row.source_type,
    sourceId: row.source_id ?? null,
    studentName: row.student_name ?? null,
    studentPhone: row.student_phone ?? null,
    parentPhone: row.parent_phone ?? null,
    studentCode: row.student_code === null || row.student_code === undefined ? null : Number(row.student_code),
    courseName: row.course_name ?? null,
    className: row.class_name ?? null,
    teacherName: row.teacher_name ?? null,
    branchName: row.branch_name ?? null,
    companyName: row.company_name ?? null,
    recordedBy: row.recorded_by ?? null,
    amount: num(row.amount) as number,
    totalDue: num(row.total_due),
    paidToDate: num(row.paid_to_date),
    remaining: num(row.remaining),
    isFullPayment: row.is_full_payment === true,
    periodLabel: row.period_label ?? null,
    paymentDate: row.payment_date,
    notes: row.notes ?? null,
    voidedAt: row.voided_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Write the receipt for one collection and return it.
 *
 * NEVER throws into the caller's path: a receipt is a printout, and failing to
 * write one must not roll back money that was actually taken. A failure is
 * logged and the payment stands — the money is the record of truth, the slip is
 * a convenience.
 */
export async function issueReceipt(input: IssueReceiptInput): Promise<ReceiptRow | null> {
  try {
    await ensureReceiptSchema();

    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return null;

    // One query for every name on the slip. Each piece is optional — a receipt
    // for a deleted-but-still-payable thing must still print.
    const snap = await queryOne<any>(
      `SELECT
         (SELECT name FROM companies WHERE id = $1)                         AS company_name,
         (SELECT s.name FROM students s WHERE s.id = $2)                    AS student_name,
         (SELECT s.phone FROM students s WHERE s.id = $2)                   AS student_phone,
         (SELECT s.parent_phone FROM students s WHERE s.id = $2)            AS parent_phone,
         (SELECT s.student_code FROM students s WHERE s.id = $2)            AS student_code,
         (SELECT c.name FROM courses c WHERE c.id = $3)                     AS course_name,
         (SELECT cl.name FROM classes cl WHERE cl.id = $4)                  AS class_name,
         (SELECT NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '')
            FROM employees emp
           WHERE emp.id = COALESCE(
             (SELECT cl2.instructor_id FROM classes cl2 WHERE cl2.id = $4),
             (SELECT c2.instructor_id FROM courses c2 WHERE c2.id = $3)
           ))                                                               AS teacher_name,
         (SELECT b.name FROM branches b WHERE b.id = $5)                    AS branch_name,
         (SELECT TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,''))
            FROM users u WHERE u.id = $6)                                   AS recorded_by`,
      [input.companyId, input.studentId || null, input.courseId || null,
       input.classId || null, input.branchId || null, input.recordedByUserId || null],
    );

    const totalDue = input.totalDue == null ? null : Math.round(Number(input.totalDue) * 100) / 100;
    const paidToDate = input.paidToDate == null ? null : Math.round(Number(input.paidToDate) * 100) / 100;
    const remaining = totalDue == null || paidToDate == null
      ? null
      : Math.max(0, Math.round((totalDue - paidToDate) * 100) / 100);
    const isFull = remaining !== null && remaining <= 0;

    // Per-company sequential number. The unique index is the real guard: under a
    // race one insert loses, and one retry gets the next number — the same
    // pattern student_code uses.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const rows = await query(
          `INSERT INTO payment_receipts
             (company_id, receipt_number, public_token, source_type, source_id, student_id,
              student_name, student_phone, parent_phone, student_code,
              course_name, class_name, teacher_name, branch_name, company_name, recorded_by,
              amount, total_due, paid_to_date, remaining, is_full_payment,
              period_label, payment_date, notes)
           VALUES ($1,
                   (SELECT COALESCE(MAX(receipt_number), 0) + 1 FROM payment_receipts WHERE company_id = $1),
                   replace(uuid_generate_v4()::text, '-', ''),
                   $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   $15, $16, $17, $18, $19, $20, COALESCE($21::date, CURRENT_DATE), $22)
           RETURNING *`,
          [
            input.companyId, input.sourceType, input.sourceId || null, input.studentId || null,
            snap?.student_name ?? null, snap?.student_phone ?? null, snap?.parent_phone ?? null,
            snap?.student_code ?? null, snap?.course_name ?? null, snap?.class_name ?? null,
            snap?.teacher_name ?? null, snap?.branch_name ?? null, snap?.company_name ?? null,
            snap?.recorded_by ?? null,
            amount, totalDue, paidToDate, remaining, isFull,
            input.periodLabel || null, input.paymentDate || null, input.notes || null,
          ],
        );
        const receipt = mapReceipt((rows as any[])[0]);
        // Best-effort parent push. The receipt is where every collection
        // converges, whatever billing model took the money — one hook covers
        // them all, and the notification links straight to the slip.
        if (input.studentId) {
          await pushPayment(input.companyId, input.studentId, amount, receipt.courseName, receipt.publicToken);
        }
        return receipt;
      } catch (e: any) {
        if (e?.code === '23505' && attempt < 2) continue;   // number/token race — retry
        throw e;
      }
    }
    return null;
  } catch (e) {
    // Money already moved. Never fail the payment over a printout.
    console.error('issueReceipt failed (payment stands):', e);
    return null;
  }
}

/**
 * Mark every receipt for a payment as void, keeping the rows. Called when a
 * collection is reversed/refunded so a printed slip resolves to "cancelled"
 * rather than to a dead link or, worse, a receipt that still looks valid.
 */
export async function voidReceiptsFor(sourceType: ReceiptSource, sourceId: string): Promise<void> {
  try {
    await ensureReceiptSchema();
    await query(
      `UPDATE payment_receipts SET voided_at = NOW()
       WHERE source_type = $1 AND source_id = $2 AND voided_at IS NULL`,
      [sourceType, sourceId],
    );
  } catch (e) {
    console.error('voidReceiptsFor failed:', e);
  }
}
