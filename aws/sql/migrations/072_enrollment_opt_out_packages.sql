-- ============================================================
-- Migration 072 – Paying per session instead of by bundle
-- ============================================================
-- A PER_SESSION student on a course that sells bundles is assumed to want the
-- next bundle: once their prepaid sessions run out they appear on the Bundles
-- tab as "renewal due", and stay there. There was no way to say "this one pays
-- session by session now" — so a student who chose that reappeared as a debt
-- forever, and the renewal list slowly filled with people nobody was chasing.
--
-- This flag records that choice on the enrollment. It changes no billing:
-- attendance already raises an individual charge whenever no bundle credit is
-- available, which is exactly what paying per session means. All it stops is
-- the renewal prompt.
--
-- Buying a bundle clears the flag again (routes/session-payments.ts →
-- buyPackage), so opting out is not a one-way door — a student can go back to
-- bundles simply by buying one.
--
-- Existing rows default to FALSE: everyone stays on bundles until somebody
-- decides otherwise, which is the behaviour before this migration.
-- ============================================================

ALTER TABLE enrollments
    ADD COLUMN IF NOT EXISTS session_packages_opted_out BOOLEAN NOT NULL DEFAULT FALSE;
