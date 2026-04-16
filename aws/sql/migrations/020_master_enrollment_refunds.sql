-- Migration 020: Refunds for master enrollments
--
-- The same `refunds` table now accepts either a regular enrollment refund or
-- a master-enrollment (bundle) refund. `enrollment_id` becomes nullable and a
-- new `master_enrollment_id` column is added; exactly one of the two must be
-- set for every refund row.

ALTER TABLE refunds
    ALTER COLUMN enrollment_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS master_enrollment_id UUID
        REFERENCES master_enrollments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_refunds_master_enrollment_id
    ON refunds(master_enrollment_id);

ALTER TABLE refunds
    DROP CONSTRAINT IF EXISTS refunds_source_check,
    ADD CONSTRAINT refunds_source_check CHECK (
        (enrollment_id IS NOT NULL AND master_enrollment_id IS NULL) OR
        (enrollment_id IS NULL AND master_enrollment_id IS NOT NULL)
    );

-- Track how much has already been refunded per master enrollment so we can
-- enforce the "can't refund more than was paid" rule.
ALTER TABLE master_enrollments
    ADD COLUMN IF NOT EXISTS total_refunded DECIMAL(10, 2) NOT NULL DEFAULT 0;
