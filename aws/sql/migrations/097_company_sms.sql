-- 097: SMS entitlement, per tenant.
--
-- Sold per tenant and switched on from the admin console, the same shape as the
-- QR card pool: off until someone turns it on.
--
-- Two columns rather than one because "activated" and "paid up to" are different
-- facts. A tenant whose date has passed keeps the flag, so re-selling is a date
-- change rather than a re-activation, and we can still see who used to have it.
--
-- sms_expiration NULL means NO END DATE, not expired: a tenant switched on
-- without one stays on until someone switches them off. Anything deciding
-- whether SMS may be sent must therefore test the pair —
--
--   sms_activated = true AND (sms_expiration IS NULL OR sms_expiration >= CURRENT_DATE)
--
-- which is what smsIsActive() in aws/lambda/api/src/routes/companies.ts emits.
-- Never test the date on its own.
--
-- Idempotent, and also applied at runtime by ensureCompanySmsColumns() so a
-- database that has not had this file run against it repairs itself on the first
-- request that needs the columns.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_activated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sms_expiration DATE;

-- Finding everyone currently entitled is the one query this will be asked a lot,
-- and it is a small, highly selective set.
CREATE INDEX IF NOT EXISTS idx_companies_sms_activated
  ON companies (sms_expiration) WHERE sms_activated = true;
