-- =============================================================================
-- 092 — Auto-confirm per-session payments taken at attendance time
--
-- A PER_SESSION course bills each student every time they attend. Today that
-- charge lands PENDING and a staff member has to open the pay dialog and click
-- through it one student at a time — fine for a handful, unworkable for a
-- class of 50 where most students actually paid at the door (a QR scan or a
-- quick nod) and the "payment" is really just bookkeeping.
--
-- This is a per-company opt-in switch. When on, a PER_SESSION charge created by
-- marking a student PRESENT (bulk attendance save or a QR check-in) is written
-- straight to PAID for the full course fee — no manual confirmation step. It
-- does NOT apply to charges raised for an ABSENT student at session end
-- (chargeAbsencesAtSessionEnd) — an absentee did not pay at the door, so there
-- is nothing to auto-confirm.
--
-- Applied automatically at runtime by ensureAutoConfirmSessionPaymentsColumn()
-- in aws/lambda/api/src/routes/companies.ts — kept here for fresh installs and
-- for running explicitly via the RDS Data API. Idempotent.
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS auto_confirm_session_payments BOOLEAN NOT NULL DEFAULT FALSE;
