-- ============================================================
-- Migration 079: per-installment money ledgers
--
-- monthly_subscription_payments, session_payments and session_packages each
-- hold ONE cumulative amount_paid and ONE date, so a second collection
-- mis-dated the whole amount. Two shapes of the same bug:
--   * bills/charges overwrote paid_date, moving the whole amount forward: 100
--     taken on the 19th and 200 on the 26th read as 300 on the 26th, and the
--     19th lost its 100;
--   * packages date from purchased_at, which never moves, so a top-up was
--     booked back onto the purchase day — growing a day already reported.
-- All-time totals were correct; every by-day / by-month / cross-month figure
-- (revenues list, dashboard, P&L reports, session cash) was not.
--
-- These tables record one row per collection, with its own date. Every
-- date-bucketed revenue read now sums them. The bills keep amount_paid /
-- paid_date as denormalised status ("how much is settled", "when was it last
-- paid"), so status, dues and all-time cash reads are unchanged.
--
-- Refunds do NOT touch these tables: amount_paid stays gross and refunds are
-- subtracted from the refunds table by refund_date, exactly as before.
--
-- This migration is applied automatically at runtime by
-- ensureMonthlyInstallmentLedger() / ensurePerSessionSchema()
-- (aws/lambda/api/src/db/payment-ledger.ts) — it is kept here for fresh
-- installs and for running explicitly via the RDS Data API. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Monthly subscription installments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS monthly_subscription_installments (
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
    -- TRUE only for the row synthesised from a bill that was already paid when
    -- this migration ran (amount = the whole amount_paid, date = paid_date).
    is_backfill        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_msi_payment_id   ON monthly_subscription_installments(monthly_payment_id);
CREATE INDEX IF NOT EXISTS idx_msi_company_date ON monthly_subscription_installments(company_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_msi_branch_id    ON monthly_subscription_installments(branch_id);
CREATE INDEX IF NOT EXISTS idx_msi_student_id   ON monthly_subscription_installments(student_id);
CREATE INDEX IF NOT EXISTS idx_msi_course_id    ON monthly_subscription_installments(course_id);
-- One synthesised row per bill, ever: makes the backfill re-runnable and safe
-- when two API containers cold-start at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_msi_backfill
    ON monthly_subscription_installments(monthly_payment_id) WHERE is_backfill;

-- ------------------------------------------------------------
-- 2. Per-session charge installments
--    session_payments is created lazily per install (migration 050 /
--    ensurePerSessionSchema), so guard on it existing.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.session_payments') IS NULL THEN
    RAISE NOTICE 'session_payments not present — skipping session_payment_installments';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS session_payment_installments (
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
  );

  CREATE INDEX IF NOT EXISTS idx_spi_payment_id   ON session_payment_installments(session_payment_id);
  CREATE INDEX IF NOT EXISTS idx_spi_company_date ON session_payment_installments(company_id, payment_date);
  CREATE INDEX IF NOT EXISTS idx_spi_branch_id    ON session_payment_installments(branch_id);
  CREATE INDEX IF NOT EXISTS idx_spi_student_id   ON session_payment_installments(student_id);
  CREATE INDEX IF NOT EXISTS idx_spi_course_id    ON session_payment_installments(course_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_spi_backfill
      ON session_payment_installments(session_payment_id) WHERE is_backfill;
END $$;

-- ------------------------------------------------------------
-- 2b. Prepaid package installments (purchase payment + later top-ups)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.session_packages') IS NULL THEN
    RAISE NOTICE 'session_packages not present — skipping session_package_installments';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS session_package_installments (
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
  );

  CREATE INDEX IF NOT EXISTS idx_pki_package_id   ON session_package_installments(session_package_id);
  CREATE INDEX IF NOT EXISTS idx_pki_company_date ON session_package_installments(company_id, payment_date);
  CREATE INDEX IF NOT EXISTS idx_pki_branch_id    ON session_package_installments(branch_id);
  CREATE INDEX IF NOT EXISTS idx_pki_student_id   ON session_package_installments(student_id);
  CREATE INDEX IF NOT EXISTS idx_pki_course_id    ON session_package_installments(course_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_pki_backfill
      ON session_package_installments(session_package_id) WHERE is_backfill;
END $$;

-- ------------------------------------------------------------
-- 3. Backfill — one row per already-paid bill/charge, carrying the whole
--    cumulative amount on the single date the old reads used. The true
--    per-collection dates were never recorded, so no existing figure moves.
--    The one exception is money with no paid_date at all: it fell out of every
--    date-ranged read before and is dated to created_at here, so it surfaces.
-- ------------------------------------------------------------
INSERT INTO monthly_subscription_installments
  (monthly_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
   amount, payment_date, notes, is_backfill, created_at)
SELECT msp.id, msp.company_id, msp.enrollment_id, msp.student_id, msp.course_id, msp.branch_id,
       msp.amount_paid, COALESCE(msp.paid_date, msp.created_at::date), msp.notes, TRUE, msp.created_at
  FROM monthly_subscription_payments msp
 WHERE msp.amount_paid > 0
   AND NOT EXISTS (SELECT 1 FROM monthly_subscription_installments i
                    WHERE i.monthly_payment_id = msp.id)
ON CONFLICT DO NOTHING;

-- COVERED charges carry amount_paid = 0 (their money lives on the package row),
-- so the > 0 guard keeps package-covered sessions out of the ledger.
DO $$
BEGIN
  IF to_regclass('public.session_payment_installments') IS NULL THEN RETURN; END IF;

  INSERT INTO session_payment_installments
    (session_payment_id, company_id, enrollment_id, student_id, course_id, branch_id,
     amount, payment_date, notes, is_backfill, created_at)
  SELECT sp.id, sp.company_id, sp.enrollment_id, sp.student_id, sp.course_id, sp.branch_id,
         sp.amount_paid, COALESCE(sp.paid_date, sp.created_at::date), sp.notes, TRUE, sp.created_at
    FROM session_payments sp
   WHERE sp.amount_paid > 0
     AND NOT EXISTS (SELECT 1 FROM session_payment_installments i
                      WHERE i.session_payment_id = sp.id)
  ON CONFLICT DO NOTHING;
END $$;

DO $$
BEGIN
  IF to_regclass('public.session_package_installments') IS NULL THEN RETURN; END IF;

  INSERT INTO session_package_installments
    (session_package_id, company_id, enrollment_id, student_id, course_id, branch_id,
     amount, payment_date, notes, is_backfill, created_at)
  SELECT spkg.id, spkg.company_id, spkg.enrollment_id, spkg.student_id, spkg.course_id, spkg.branch_id,
         spkg.amount_paid, COALESCE(spkg.purchased_at::date, spkg.created_at::date), spkg.notes, TRUE, spkg.created_at
    FROM session_packages spkg
   WHERE spkg.amount_paid > 0
     AND NOT EXISTS (SELECT 1 FROM session_package_installments i
                      WHERE i.session_package_id = spkg.id)
  ON CONFLICT DO NOTHING;
END $$;
