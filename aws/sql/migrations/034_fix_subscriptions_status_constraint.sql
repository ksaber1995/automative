-- Migration 034: Allow 'ACTIVE' in subscriptions status check constraint
-- The admin "Activate" action (POST /api/karim-admin-secret/companies/:id/activate)
-- sets subscriptions.status = 'ACTIVE', but the live DB constraint only permitted
-- TRIAL/MONTHLY/ANNUAL/EXPIRED, causing:
--   new row for relation "subscriptions" violates check constraint "subscriptions_status_check"

ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('TRIAL', 'ACTIVE', 'MONTHLY', 'ANNUAL', 'EXPIRED'));
