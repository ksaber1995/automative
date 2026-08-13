-- =============================================================================
-- 093 — Recognise SCHOOL as a company registration type
--
-- companies.type has been a free VARCHAR(20) since migration 028 — ACADEMY or
-- TEACHER by convention, never actually enforced at the DB layer. This adds a
-- real CHECK constraint (safe: production only ever holds ACADEMY/TEACHER
-- today) and widens it to include SCHOOL ahead of that signup flow shipping.
--
-- SCHOOL is deliberately NOT reachable from registration yet: the login page
-- shows it as a disabled "Coming soon" card, and the register endpoint
-- explicitly rejects `type: 'SCHOOL'` (aws/lambda/api/src/routes/auth.ts).
-- This migration only makes the value legal to STORE — via the admin console's
-- setCompanyType endpoint, or once the real signup flow is built — not
-- reachable through self-serve signup.
--
-- Guarded like courses_payment_type_check (session-payments.ts): skip when
-- already in the desired state, and swallow duplicate_object so concurrent
-- cold-starting containers can't race each other into an error.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_type_check' AND conrelid = 'companies'::regclass
      AND pg_get_constraintdef(oid) LIKE '%SCHOOL%'
  ) THEN
    ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_type_check;
    BEGIN
      ALTER TABLE companies ADD CONSTRAINT companies_type_check
        CHECK (type IN ('ACADEMY', 'TEACHER', 'SCHOOL'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
