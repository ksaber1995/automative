-- Migration 012: Events
--
-- Events are company-level occasions (trip, competition, workshop, etc.) that
-- have their own mini P&L. Existing financial rows (expenses, revenues,
-- refunds, product_sales) can be optionally linked to an event so totals can
-- be aggregated per event.

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    event_type VARCHAR(32) NOT NULL DEFAULT 'OTHER',
    description TEXT,
    location VARCHAR(255),
    start_date DATE,
    end_date DATE,
    budget DECIMAL(12, 2),
    status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_company ON events(company_id);
CREATE INDEX IF NOT EXISTS idx_events_branch ON events(branch_id);

ALTER TABLE expenses      ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE revenues      ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE refunds       ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE products      ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_event      ON expenses(event_id);
CREATE INDEX IF NOT EXISTS idx_revenues_event      ON revenues(event_id);
CREATE INDEX IF NOT EXISTS idx_refunds_event       ON refunds(event_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_event ON product_sales(event_id);
CREATE INDEX IF NOT EXISTS idx_products_event      ON products(event_id);
