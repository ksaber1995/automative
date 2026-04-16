-- Migration 018: Demo Leads (public contact form from landing page)
--
-- Collects "book a demo" submissions from the marketing landing page.
-- No tenant scope — leads are pre-customer, reviewed by Netrofit staff.

CREATE TABLE IF NOT EXISTS demo_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    company VARCHAR(255),
    country VARCHAR(10),
    branch_count INTEGER,
    message TEXT,
    source VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED')),
    user_agent TEXT,
    ip VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_demo_leads_created ON demo_leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demo_leads_status ON demo_leads(status);
CREATE INDEX IF NOT EXISTS idx_demo_leads_email ON demo_leads(email);

DROP TRIGGER IF EXISTS update_demo_leads_updated_at ON demo_leads;
CREATE TRIGGER update_demo_leads_updated_at
    BEFORE UPDATE ON demo_leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
