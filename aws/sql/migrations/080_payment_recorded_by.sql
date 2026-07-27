-- ============================================================
-- Migration 080 – who recorded each payment
-- ============================================================
-- The money-in tables were the only ones that could not answer "who took this?".
-- cash_adjustments has created_by_user_id, cash_state has updated_by, and
-- withdrawals has approved_by — but a payment, the one thing a front desk
-- handles all day, recorded nothing about the person who keyed it in. Separation
-- of duties needs that name: hiding revenue totals from a fee collector is worth
-- little if a missing 300 EGP traces back only to "someone".
--
-- Nullable on purpose. Every row written before this column existed genuinely
-- has no answer, and inventing one would be worse than admitting it — so a NULL
-- reads as "recorded before attribution existed", not as "unknown person".
--
-- ON DELETE SET NULL: a staff member can leave the company without their day's
-- takings disappearing from the books.
--
-- Idempotent, and applied at runtime as well — the ledger DDL in
-- aws/lambda/api/src/db/payment-ledger.ts carries the same ALTERs, so a deploy
-- is enough and this file is here for fresh installs and reference.
-- ============================================================

ALTER TABLE monthly_subscription_installments
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE session_payment_installments
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE session_package_installments
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE enrollment_payments
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE master_enrollment_payments
  ADD COLUMN IF NOT EXISTS recorded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
