-- ============================================================
-- Migration 050 – Pay-by-Session (PER_SESSION) courses
-- ============================================================
-- Run this file against the target database (dev or prod) via
-- the RDS Query Editor, psql, or any SQL client.
--
-- What this migration does:
--   1. Adds PER_SESSION to courses.payment_type CHECK
--      NOTE: price column is reused as the per-session fee when PER_SESSION
--   2. Adds courses.session_package_size / session_package_price / charge_absent_sessions
--   3. Adds PER_SESSION to enrollments.payment_type CHECK
--   4. Creates session_packages table (prepaid credit balance)
--   5. Creates session_payments table (per-session billing ledger / dues)
--   6. Creates indexes + updated_at triggers
--   7. Links refunds.session_payment_id -> session_payments(id)
--
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS guards).
-- Enum widening = drop & re-add the CHECK constraint (see migration 049).
-- ============================================================

-- ------------------------------------------------------------
-- 1 & 2. courses: widen payment_type + per-session settings
-- ------------------------------------------------------------
ALTER TABLE courses
    DROP CONSTRAINT IF EXISTS courses_payment_type_check;
ALTER TABLE courses
    ADD CONSTRAINT courses_payment_type_check
    CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'));

ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS session_package_size INTEGER;                    -- e.g. 8 (null = no advance package offered)
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS session_package_price DECIMAL(10, 2);           -- e.g. 700 (block price, paid upfront)
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS charge_absent_sessions BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 3. enrollments: widen payment_type CHECK (denormalised from course)
-- ------------------------------------------------------------
ALTER TABLE enrollments
    DROP CONSTRAINT IF EXISTS enrollments_payment_type_check;
ALTER TABLE enrollments
    ADD CONSTRAINT enrollments_payment_type_check
    CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION', 'PER_SESSION'));

-- ------------------------------------------------------------
-- 4. session_packages – prepaid credit balance ("pay X in advance")
--    One row per package a student buys upfront. Attendance consumes credits.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_packages (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    company_id         UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    student_id         UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id          UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id          UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    sessions_total     INTEGER NOT NULL,
    sessions_used      INTEGER NOT NULL DEFAULT 0,
    amount_paid        DECIMAL(10, 2) NOT NULL DEFAULT 0,          -- block price paid upfront
    status             VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
                           CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'REFUNDED')),
    purchased_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    notes              TEXT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spkg_enrollment_id ON session_packages(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_spkg_company_id    ON session_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_spkg_student_id    ON session_packages(student_id);
CREATE INDEX IF NOT EXISTS idx_spkg_course_id     ON session_packages(course_id);
CREATE INDEX IF NOT EXISTS idx_spkg_branch_id     ON session_packages(branch_id);
CREATE INDEX IF NOT EXISTS idx_spkg_status        ON session_packages(status);

DROP TRIGGER IF EXISTS update_session_packages_updated_at ON session_packages;
CREATE TRIGGER update_session_packages_updated_at
    BEFORE UPDATE ON session_packages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 5. session_payments – per-session billing ledger / dues
--    One row per billable (enrollment, session). Created when attendance is
--    taken for a PER_SESSION course. Prevents double billing via UNIQUE.
--
--    payment_status:
--      COVERED   = paid via a prepaid package credit
--      PAID      = paid directly at attendance
--      PENDING   = owed (a due)
--      WAIVED    = absence not charged (audit only)
--      REFUNDED  = reversed
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_payments (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    enrollment_id    UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
    session_id       UUID NOT NULL REFERENCES sessions(id)    ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
    course_id        UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
    branch_id        UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
    package_id       UUID REFERENCES session_packages(id) ON DELETE SET NULL,  -- set when covered by a package
    attendance_state VARCHAR(10) NOT NULL DEFAULT 'PRESENT'
                         CHECK (attendance_state IN ('PRESENT', 'ABSENT')),
    amount_due       DECIMAL(10, 2) NOT NULL DEFAULT 0,          -- per-session price
    amount_paid      DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                         CHECK (payment_status IN ('PENDING', 'PAID', 'COVERED', 'WAIVED', 'REFUNDED')),
    paid_date        DATE,
    notes            TEXT,
    refunded_amount  DECIMAL(10, 2) NOT NULL DEFAULT 0,
    refund_note      TEXT,
    refunded_at      TIMESTAMP WITH TIME ZONE,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (enrollment_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sp_enrollment_id  ON session_payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sp_session_id     ON session_payments(session_id);
CREATE INDEX IF NOT EXISTS idx_sp_company_id     ON session_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_sp_student_id     ON session_payments(student_id);
CREATE INDEX IF NOT EXISTS idx_sp_course_id      ON session_payments(course_id);
CREATE INDEX IF NOT EXISTS idx_sp_branch_id      ON session_payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_sp_package_id     ON session_payments(package_id);
CREATE INDEX IF NOT EXISTS idx_sp_payment_status ON session_payments(payment_status);

DROP TRIGGER IF EXISTS update_session_payments_updated_at ON session_payments;
CREATE TRIGGER update_session_payments_updated_at
    BEFORE UPDATE ON session_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 6. refunds link (polymorphic refunds table, same pattern as migration 049)
-- ------------------------------------------------------------
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS session_payment_id UUID;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS fk_refunds_session_payment;
ALTER TABLE refunds ADD CONSTRAINT fk_refunds_session_payment
    FOREIGN KEY (session_payment_id) REFERENCES session_payments(id) ON DELETE CASCADE;
