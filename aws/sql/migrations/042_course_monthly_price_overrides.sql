-- Migration 042: Course Monthly Price Overrides
-- Allows teachers to override the price of a monthly-subscription course
-- for a specific month. Student amounts scale proportionally.

CREATE TABLE IF NOT EXISTS course_monthly_price_overrides (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id        UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    billing_year     INTEGER NOT NULL,
    billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    override_price   DECIMAL(10, 2) NOT NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, billing_year, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_cmpo_course_id   ON course_monthly_price_overrides(course_id);
CREATE INDEX IF NOT EXISTS idx_cmpo_company_id  ON course_monthly_price_overrides(company_id);

CREATE TRIGGER update_course_monthly_price_overrides_updated_at
    BEFORE UPDATE ON course_monthly_price_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
