import { query } from './connection';

/**
 * Per-installment money ledger for the three "one bill, many collections"
 * tables: monthly_subscription_payments (a month's fee), session_payments (one
 * session's charge) and session_packages (a prepaid bundle).
 *
 * Each carries a single cumulative amount_paid and a single date, so every later
 * installment mis-dated the WHOLE collected amount. Two shapes of the same bug:
 *  - monthly bills / session charges move their date forward, so 100 taken on
 *    the 19th and 200 on the 26th surfaced as 300 on the 26th and the 19th lost
 *    its 100;
 *  - packages date from purchased_at, which never moves, so a top-up collected
 *    weeks later was booked back onto the purchase day — a past day's revenue
 *    silently growing after the fact.
 * All-time totals were right; every by-day, by-month and cross-month figure
 * was not.
 *
 * A ledger row records ONE collection with its own date. Every date-bucketed
 * revenue read (revenues list/summary, dashboard, P&L reports, session cash)
 * sums these rows; the parent keeps amount_paid and its date column as
 * denormalised status — "how much is settled" and "when was it last paid" — so
 * status, dues, remaining balances and all-time cash reads are untouched.
 *
 * Invariants:
 *  - SUM(installments.amount) for a bill == bill.amount_paid.
 *  - Refunds never touch the ledger. amount_paid stays gross and refunds are
 *    subtracted separately from the refunds table by refund_date, exactly as
 *    before (see monthly-subscriptions refund()).
 *  - Voiding a payment deletes the bill's ledger rows, so the money leaves
 *    revenue on the days it was booked.
 *  - Deleting a bill/charge cascades to its rows (FK ON DELETE CASCADE), which
 *    covers per-session charge reversal (reverseChargeRow) for free.
 *
 * is_backfill marks the one row synthesised per already-paid parent when the
 * ledger was introduced: its amount is the whole cumulative amount_paid and its
 * date is the parent's own date column, i.e. exactly the (possibly wrong) single
 * date the old reads used — the true per-collection dates were never stored, so
 * they cannot be recovered. Existing figures therefore do not move, and only
 * payments taken from now on are split per collection. (One deliberate
 * exception: a bill with money but no paid_date fell out of every date-ranged
 * read entirely; it is backfilled to created_at, so that money now shows up.)
 * The partial unique index makes the backfill safe to re-run and safe under two
 * containers cold-starting at once.
 */

/** Runs a statement, optionally inside a caller's open transaction. */
type Exec = (sql: string, params: any[]) => Promise<any>;
const defaultExec: Exec = (sql, params) => query(sql, params);

/** The bill/charge columns a ledger row copies (denormalised so revenue reads
 *  can filter by branch/course/student without joining back to the parent). */
interface LedgerParent {
  id: string;
  company_id: string;
  enrollment_id: string;
  student_id: string;
  course_id: string;
  branch_id: string;
}

/**
 * Who keyed this collection in. Nullable on purpose: every row written before
 * this column existed genuinely has no answer, and inventing one would be worse
 * than admitting it. ON DELETE SET NULL because a staff member can leave without
 * their day's takings disappearing from the books.
 *
 * The point is separation of duties — the money tables were the only ones that
 * could not answer "who took this?", while cash adjustments and withdrawals
 * always could.
 */
const RECORDED_BY_COLUMN = (table: string) =>
  `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`;

const MONTHLY_LEDGER_DDL = [
  `CREATE TABLE IF NOT EXISTS monthly_subscription_installments (
     id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     monthly_payment_id UUID NOT NULL REFERENCES monthly_subscription_payments(id) ON DELETE CASCADE,
     company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
     enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
     student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
     course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
     branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
     amount             DECIMAL(10, 2) NOT NULL,
     payment_date       DATE NOT NULL,
     notes              TEXT,
     is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
     created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_msi_payment_id   ON monthly_subscription_installments(monthly_payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msi_company_date ON monthly_subscription_installments(company_id, payment_date)`,
  `CREATE INDEX IF NOT EXISTS idx_msi_branch_id    ON monthly_subscription_installments(branch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msi_student_id   ON monthly_subscription_installments(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_msi_course_id    ON monthly_subscription_installments(course_id)`,
  // One synthesised row per bill, ever — makes the backfill below idempotent.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_msi_backfill
     ON monthly_subscription_installments(monthly_payment_id) WHERE is_backfill`,
  RECORDED_BY_COLUMN('monthly_subscription_installments'),
];

const MONTHLY_LEDGER_BACKFILL = `
  INSERT INTO monthly_subscription_installments
    (monthly_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
     amount, payment_date, notes, is_backfill, created_at)
  SELECT msp.id, msp.company_id, msp.enrollment_id, msp.student_id, msp.course_id, msp.branch_id,
         msp.amount_paid, COALESCE(msp.paid_date, msp.created_at::date), msp.notes, TRUE, msp.created_at
    FROM monthly_subscription_payments msp
   WHERE msp.amount_paid > 0
     AND NOT EXISTS (SELECT 1 FROM monthly_subscription_installments i
                      WHERE i.monthly_payment_id = msp.id)
  ON CONFLICT DO NOTHING`;

const SESSION_LEDGER_DDL = [
  `CREATE TABLE IF NOT EXISTS session_payment_installments (
     id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     session_payment_id UUID NOT NULL REFERENCES session_payments(id) ON DELETE CASCADE,
     company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
     enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
     student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
     course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
     branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
     amount             DECIMAL(10, 2) NOT NULL,
     payment_date       DATE NOT NULL,
     notes              TEXT,
     is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
     created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_spi_payment_id   ON session_payment_installments(session_payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spi_company_date ON session_payment_installments(company_id, payment_date)`,
  `CREATE INDEX IF NOT EXISTS idx_spi_branch_id    ON session_payment_installments(branch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spi_student_id   ON session_payment_installments(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spi_course_id    ON session_payment_installments(course_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_spi_backfill
     ON session_payment_installments(session_payment_id) WHERE is_backfill`,
  RECORDED_BY_COLUMN('session_payment_installments'),
];

// A COVERED charge carries amount_paid = 0 (its money sits on the package row),
// so the > 0 guard keeps package-covered sessions out of the ledger.
const SESSION_LEDGER_BACKFILL = `
  INSERT INTO session_payment_installments
    (session_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
     amount, payment_date, notes, is_backfill, created_at)
  SELECT sp.id, sp.company_id, sp.enrollment_id, sp.student_id, sp.course_id, sp.branch_id,
         sp.amount_paid, COALESCE(sp.paid_date, sp.created_at::date), sp.notes, TRUE, sp.created_at
    FROM session_payments sp
   WHERE sp.amount_paid > 0
     AND NOT EXISTS (SELECT 1 FROM session_payment_installments i
                      WHERE i.session_payment_id = sp.id)
  ON CONFLICT DO NOTHING`;

const PACKAGE_LEDGER_DDL = [
  `CREATE TABLE IF NOT EXISTS session_package_installments (
     id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     session_package_id UUID NOT NULL REFERENCES session_packages(id) ON DELETE CASCADE,
     company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
     enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
     student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
     course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
     branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
     amount             DECIMAL(10, 2) NOT NULL,
     payment_date       DATE NOT NULL,
     notes              TEXT,
     is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
     created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS idx_pki_package_id   ON session_package_installments(session_package_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pki_company_date ON session_package_installments(company_id, payment_date)`,
  `CREATE INDEX IF NOT EXISTS idx_pki_branch_id    ON session_package_installments(branch_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pki_student_id   ON session_package_installments(student_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pki_course_id    ON session_package_installments(course_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_pki_backfill
     ON session_package_installments(session_package_id) WHERE is_backfill`,
  RECORDED_BY_COLUMN('session_package_installments'),
];

// A package's own date is purchased_at, which never moved — so a top-up was
// booked back onto the purchase day. The backfill keeps that (wrong-for-top-ups
// but unrecoverable) date so no existing figure shifts; only collections taken
// from now on get their real date.
const PACKAGE_LEDGER_BACKFILL = `
  INSERT INTO session_package_installments
    (session_package_id, company_id, enrollment_id, student_id, course_id, branch_id,
     amount, payment_date, notes, is_backfill, created_at)
  SELECT spkg.id, spkg.company_id, spkg.enrollment_id, spkg.student_id, spkg.course_id, spkg.branch_id,
         spkg.amount_paid, COALESCE(spkg.purchased_at::date, spkg.created_at::date), spkg.notes, TRUE, spkg.created_at
    FROM session_packages spkg
   WHERE spkg.amount_paid > 0
     AND NOT EXISTS (SELECT 1 FROM session_package_installments i
                      WHERE i.session_package_id = spkg.id)
  ON CONFLICT DO NOTHING`;

// ============================================================
// Schema guards (self-applying, mirrors ensurePerSessionSchema)
// ============================================================

let monthlyLedgerPromise: Promise<void> | null = null;

/**
 * Create + backfill the monthly ledger. Idempotent and safe to call from every
 * handler that reads or writes subscription money — the promise is cached per
 * container, so it costs one round-trip per cold start. Reads MUST call it:
 * the revenue queries reference the table, and it does not exist until this
 * has run once.
 */
export async function ensureMonthlyInstallmentLedger(): Promise<void> {
  if (!monthlyLedgerPromise) {
    monthlyLedgerPromise = (async () => {
      try {
        for (const ddl of MONTHLY_LEDGER_DDL) await query(ddl);
        await query(MONTHLY_LEDGER_BACKFILL);
      } catch (e) {
        monthlyLedgerPromise = null;   // let the next caller retry
        throw e;
      }
    })();
  }
  return monthlyLedgerPromise;
}

/**
 * Create + backfill the two per-session ledgers (pay-as-you-go charges and
 * prepaid packages). Called from ensurePerSessionSchema, which owns the caching
 * and creates session_payments / session_packages first — the FKs need them —
 * never on its own.
 */
export async function applySessionInstallmentLedger(): Promise<void> {
  for (const ddl of SESSION_LEDGER_DDL) await query(ddl);
  await query(SESSION_LEDGER_BACKFILL);
  for (const ddl of PACKAGE_LEDGER_DDL) await query(ddl);
  await query(PACKAGE_LEDGER_BACKFILL);
}

let recorderColumnsPromise: Promise<void> | null = null;

/**
 * enrollment_payments and master_enrollment_payments predate this ledger and
 * have no schema guard of their own, so they get one here: the same attribution
 * column the three installment tables carry. Called by the handlers that write
 * them; cached per container like the ledger guards above.
 */
export async function ensurePaymentRecorderColumns(): Promise<void> {
  if (!recorderColumnsPromise) {
    recorderColumnsPromise = (async () => {
      try {
        await query(RECORDED_BY_COLUMN('enrollment_payments'));
        await query(RECORDED_BY_COLUMN('master_enrollment_payments'));
      } catch (e) {
        recorderColumnsPromise = null;   // let the next caller retry
        throw e;
      }
    })();
  }
  return recorderColumnsPromise;
}

// ============================================================
// Writes
// ============================================================

/** Round to cents the same way the money handlers do. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Record one collection against a monthly bill. `paymentDate` null means "the
 * server's today" (CURRENT_DATE) — used by the enrollment-time down payment,
 * which stamps the bill the same way. Non-positive/NaN amounts are ignored so a
 * malformed request can never write a bogus revenue line.
 */
export async function recordMonthlyInstallment(
  bill: LedgerParent,
  amount: number,
  paymentDate: string | null,
  notes: string | null = null,
  recordedBy: string | null = null,
  exec: Exec = defaultExec,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await exec(
    `INSERT INTO monthly_subscription_installments
       (monthly_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
        amount, payment_date, notes, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10)`,
    [bill.id, bill.company_id, bill.enrollment_id, bill.student_id, bill.course_id, bill.branch_id,
     cents(amount), paymentDate, notes, recordedBy],
  );
}

/** Record one collection against a per-session charge. */
export async function recordSessionInstallment(
  charge: LedgerParent,
  amount: number,
  paymentDate: string | null,
  notes: string | null = null,
  recordedBy: string | null = null,
  exec: Exec = defaultExec,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await exec(
    `INSERT INTO session_payment_installments
       (session_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
        amount, payment_date, notes, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10)`,
    [charge.id, charge.company_id, charge.enrollment_id, charge.student_id, charge.course_id, charge.branch_id,
     cents(amount), paymentDate, notes, recordedBy],
  );
}

/**
 * Record one collection against a prepaid package — the up-front purchase money
 * and every later top-up alike. Unlike the other two, a package has no "last
 * paid" column at all: purchased_at stays the purchase day, so without this the
 * top-up was booked onto that day retroactively.
 */
export async function recordPackageInstallment(
  pkg: LedgerParent,
  amount: number,
  paymentDate: string | null,
  notes: string | null = null,
  recordedBy: string | null = null,
  exec: Exec = defaultExec,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  await exec(
    `INSERT INTO session_package_installments
       (session_package_id, company_id, enrollment_id, student_id, course_id, branch_id,
        amount, payment_date, notes, recorded_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10)`,
    [pkg.id, pkg.company_id, pkg.enrollment_id, pkg.student_id, pkg.course_id, pkg.branch_id,
     cents(amount), paymentDate, notes, recordedBy],
  );
}

/** Drop every collection recorded against a monthly bill (void = never happened). */
export async function clearMonthlyInstallments(billId: string, exec: Exec = defaultExec): Promise<void> {
  await exec('DELETE FROM monthly_subscription_installments WHERE monthly_payment_id = $1', [billId]);
}

/** Drop every collection recorded against a per-session charge. */
export async function clearSessionInstallments(chargeId: string, exec: Exec = defaultExec): Promise<void> {
  await exec('DELETE FROM session_payment_installments WHERE session_payment_id = $1', [chargeId]);
}
