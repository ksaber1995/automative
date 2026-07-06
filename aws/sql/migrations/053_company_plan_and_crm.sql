-- ============================================================
-- Migration 053 – Company feature plan + CRM (Phase 1)
-- ============================================================
-- 1) companies.plan: SIMPLE (core) | ADVANCED (unlocks CRM & future add-ons).
-- 2) crm_leads: a prospective student before enrollment — captured, owned,
--    moved through a fixed pipeline, and converted into a real student on close.
--
-- CRM is gated to ACADEMY companies on the ADVANCED plan (enforced in the API).
-- Mirrors ensureCrmSchema() in aws/lambda/api/src/routes/crm.ts. Idempotent.
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'SIMPLE';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'companies_plan_check'
  ) THEN
    ALTER TABLE companies ADD CONSTRAINT companies_plan_check CHECK (plan IN ('SIMPLE', 'ADVANCED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    full_name VARCHAR(200) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    source VARCHAR(50),
    interested_course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    stage VARCHAR(20) NOT NULL DEFAULT 'NEW'
        CHECK (stage IN ('NEW', 'CONTACTED', 'TRIAL', 'NEGOTIATION', 'WON', 'LOST')),
    owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    lost_reason TEXT,
    next_action_at DATE,
    converted_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_company ON crm_leads(company_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_branch ON crm_leads(branch_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_owner ON crm_leads(owner_user_id);

DROP TRIGGER IF EXISTS update_crm_leads_updated_at ON crm_leads;
CREATE TRIGGER update_crm_leads_updated_at
    BEFORE UPDATE ON crm_leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
