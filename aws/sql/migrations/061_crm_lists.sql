-- CRM lists: named groups of leads, like a WhatsApp broadcast list.
-- A lead can sit in many lists; membership is unique per (list, lead).
--
-- Mirrors ensureCrmSchema() in aws/lambda/api/src/routes/crm.ts. Idempotent, so
-- deploying the API is enough — this file is the equivalent for fresh installs.

CREATE TABLE IF NOT EXISTS crm_lists (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_crm_lists_company ON crm_lists(company_id);

DROP TRIGGER IF EXISTS update_crm_lists_updated_at ON crm_lists;
CREATE TRIGGER update_crm_lists_updated_at
    BEFORE UPDATE ON crm_lists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Membership is append-only (no updated_at, no trigger) — same shape as
-- crm_lead_calls. Deleting a list drops its membership; the leads survive.
CREATE TABLE IF NOT EXISTS crm_list_leads (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    list_id    UUID NOT NULL REFERENCES crm_lists(id) ON DELETE CASCADE,
    lead_id    UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
    added_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- A lead belongs to a list once: re-adding is a no-op, not a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_list_leads ON crm_list_leads(list_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_list_leads_list    ON crm_list_leads(list_id);
CREATE INDEX IF NOT EXISTS idx_crm_list_leads_lead    ON crm_list_leads(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_list_leads_company ON crm_list_leads(company_id);
