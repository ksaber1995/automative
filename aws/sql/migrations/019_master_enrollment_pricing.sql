-- Migration 019: Pricing + installments on master enrollments
--
-- Master enrollments get the same rich pricing model as regular enrollments:
-- original price (copied from master_courses.default_price at enroll time),
-- optional discount, a final price, and a FULL/INSTALLMENTS payment mode so
-- students can pay bundle down-payment now and the rest later.

ALTER TABLE master_enrollments
    ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS final_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(20) NOT NULL DEFAULT 'FULL',
    ADD COLUMN IF NOT EXISTS down_payment DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING';

-- Backfill: for existing rows, assume the amount_paid was the full price.
UPDATE master_enrollments
SET
    final_price = COALESCE(NULLIF(final_price, 0), amount_paid),
    original_price = COALESCE(NULLIF(original_price, 0), amount_paid),
    payment_status = CASE
        WHEN amount_paid <= 0 THEN 'PENDING'
        WHEN amount_paid >= COALESCE(NULLIF(final_price, 0), amount_paid) THEN 'PAID'
        ELSE 'PARTIAL'
    END
WHERE original_price = 0 AND final_price = 0;

ALTER TABLE master_enrollments
    DROP CONSTRAINT IF EXISTS master_enrollments_payment_mode_check,
    ADD CONSTRAINT master_enrollments_payment_mode_check CHECK (payment_mode IN ('FULL', 'INSTALLMENTS'));

ALTER TABLE master_enrollments
    DROP CONSTRAINT IF EXISTS master_enrollments_payment_status_check,
    ADD CONSTRAINT master_enrollments_payment_status_check CHECK (payment_status IN ('PENDING', 'PARTIAL', 'PAID'));
