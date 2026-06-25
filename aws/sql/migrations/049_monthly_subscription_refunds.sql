-- ============================================================
-- Migration 049 – Monthly subscription refunds
-- ============================================================
-- Adds genuine "refund" support to monthly_subscription_payments, distinct from
-- "void" (void = recorded by mistake; refund = money actually returned and the
-- student is leaving). A refund reduces amount_paid (so revenue, which sums
-- amount_paid, nets out automatically) and is recorded with an amount + note.
--
--   refunded_amount  cumulative money returned for this bill
--   refund_note      free-text reason shown on the dashboard
--   refunded_at      when the (last) refund was issued
--
-- payment_status gains 'REFUNDED' as a terminal state (full or partial refund).
-- All statements are idempotent.
-- ============================================================

ALTER TABLE monthly_subscription_payments
  ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE monthly_subscription_payments
  ADD COLUMN IF NOT EXISTS refund_note TEXT;
ALTER TABLE monthly_subscription_payments
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMP WITH TIME ZONE;

-- Widen the payment_status CHECK to allow REFUNDED.
ALTER TABLE monthly_subscription_payments
  DROP CONSTRAINT IF EXISTS monthly_subscription_payments_payment_status_check;
ALTER TABLE monthly_subscription_payments
  ADD CONSTRAINT monthly_subscription_payments_payment_status_check
  CHECK (payment_status IN ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'REFUNDED'));
