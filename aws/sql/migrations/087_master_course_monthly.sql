-- =============================================================================
-- 087 — Master courses can be sold per month
--
-- Until now a master course was one thing: a bundle sold once for one price
-- (master_enrollments), whose members were then free to the student. That is why
-- only ONE_TIME courses could be linked into one — a monthly or per-session
-- member has no single price to fold into a bundle.
--
-- A master may now instead be a MONTHLY_SUBSCRIPTION: the student pays the
-- master's fee once a month and everything inside it is covered, whether those
-- members bill monthly or per session on their own. The members' own prices stop
-- applying to anyone enrolled through the master — one bill a month, whatever
-- they attend.
--
-- Which means a monthly bill can now belong to a master enrolment rather than a
-- course enrolment, so monthly_subscription_payments grows a second possible
-- subject. Existing rows are untouched and still carry an enrollment_id.
-- =============================================================================

-- ── The master's own payment model ───────────────────────────────────────────
-- default_price keeps its meaning by analogy with courses.price: the one-off
-- bundle price for ONE_TIME, the monthly fee for MONTHLY_SUBSCRIPTION.
ALTER TABLE master_courses
  ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME';

ALTER TABLE master_courses
  DROP CONSTRAINT IF EXISTS master_courses_payment_type_check;
ALTER TABLE master_courses
  ADD CONSTRAINT master_courses_payment_type_check
  CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION'));

-- ── A monthly bill's subject: a course enrolment OR a master enrolment ───────
ALTER TABLE monthly_subscription_payments
  ADD COLUMN IF NOT EXISTS master_enrollment_id UUID
  REFERENCES master_enrollments(id) ON DELETE CASCADE;

-- A master bill has no single course or course enrolment behind it — that is the
-- point of it — so both become optional. The existing UNIQUE
-- (enrollment_id, billing_year, billing_month) still holds for course bills:
-- Postgres does not treat NULLs as equal, so master rows never collide with it.
ALTER TABLE monthly_subscription_payments ALTER COLUMN enrollment_id DROP NOT NULL;
ALTER TABLE monthly_subscription_payments ALTER COLUMN course_id     DROP NOT NULL;

-- Exactly one subject, never both and never neither — the thing every query that
-- reads a bill is entitled to assume.
ALTER TABLE monthly_subscription_payments
  DROP CONSTRAINT IF EXISTS msp_one_subject;
ALTER TABLE monthly_subscription_payments
  ADD CONSTRAINT msp_one_subject
  CHECK (num_nonnulls(enrollment_id, master_enrollment_id) = 1);

-- One bill per master enrolment per month, the mirror of the course-bill unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_msp_master_month
  ON monthly_subscription_payments(master_enrollment_id, billing_year, billing_month)
  WHERE master_enrollment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_msp_master_enrollment
  ON monthly_subscription_payments(master_enrollment_id);

-- ── The payment ledger follows the bill ──────────────────────────────────────
ALTER TABLE monthly_subscription_installments
  ADD COLUMN IF NOT EXISTS master_enrollment_id UUID
  REFERENCES master_enrollments(id) ON DELETE CASCADE;

ALTER TABLE monthly_subscription_installments ALTER COLUMN enrollment_id DROP NOT NULL;
ALTER TABLE monthly_subscription_installments ALTER COLUMN course_id     DROP NOT NULL;

ALTER TABLE monthly_subscription_installments
  DROP CONSTRAINT IF EXISTS msi_one_subject;
ALTER TABLE monthly_subscription_installments
  ADD CONSTRAINT msi_one_subject
  CHECK (num_nonnulls(enrollment_id, master_enrollment_id) = 1);

CREATE INDEX IF NOT EXISTS idx_msi_master_enrollment
  ON monthly_subscription_installments(master_enrollment_id);
