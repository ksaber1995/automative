-- ============================================================
-- Migration 054 – CRM activities/tasks (Phase 2)
-- ============================================================
-- Timeline entries on a lead: notes, calls, WhatsApp, meetings, trials, and
-- dated follow-up TASKs. done_at set = completed. Powers the lead timeline and
-- the "My day" task queue. Mirrors ensureCrmSchema() in routes/crm.ts. Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS crm_activities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL DEFAULT 'NOTE'
        CHECK (type IN ('NOTE', 'CALL', 'WHATSAPP', 'MEETING', 'TASK', 'TRIAL')),
    subject VARCHAR(300),
    body TEXT,
    due_at TIMESTAMP WITH TIME ZONE,
    done_at TIMESTAMP WITH TIME ZONE,
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_act_lead ON crm_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_act_company ON crm_activities(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_act_owner ON crm_activities(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_act_due ON crm_activities(due_at);

DROP TRIGGER IF EXISTS update_crm_activities_updated_at ON crm_activities;
CREATE TRIGGER update_crm_activities_updated_at
    BEFORE UPDATE ON crm_activities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
