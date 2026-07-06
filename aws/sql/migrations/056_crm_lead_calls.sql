-- ============================================================
-- Migration 056 – CRM lead call log
-- ============================================================
-- One row per reach/call attempt to a lead, capturing the response and the
-- obstacle to joining. Powers the per-lead reach count, the call history, and
-- the "who I have to call" filter. Mirrors ensureCrmSchema() in routes/crm.ts.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_lead_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    response VARCHAR(24) NOT NULL DEFAULT 'NO_ANSWER',
    obstacle VARCHAR(24),
    notes TEXT,
    called_by UUID REFERENCES users(id) ON DELETE SET NULL,
    called_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_calls_lead ON crm_lead_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_calls_company ON crm_lead_calls(company_id);
