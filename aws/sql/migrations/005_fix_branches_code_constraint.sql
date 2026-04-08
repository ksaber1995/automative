-- Migration 005: Fix branches.code unique constraint to be company-scoped
-- Problem: branches.code had a global UNIQUE constraint, so 'MAIN' could only
-- exist once across ALL companies. Every registration after the first would fail
-- with a 23505 conflict on this constraint.

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_code_key;
ALTER TABLE branches ADD CONSTRAINT branches_company_id_code_key UNIQUE(company_id, code);
