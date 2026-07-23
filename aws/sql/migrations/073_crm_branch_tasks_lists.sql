-- ============================================================
-- Migration 073 – CRM tasks & lists can be tied to a branch
-- ============================================================
-- Leads (crm_leads) already carry an optional branch_id. This extends the same
-- optional branch link to the other CRM entities:
--   • tasks/activities (crm_activities.branch_id),
--   • lists (crm_lists.branch_id).
-- A NULL branch means the task/list is company-wide (not tied to any branch),
-- so nothing is forced onto a branch. ON DELETE SET NULL keeps rows alive if the
-- branch is removed. Mirrors ensureCrmSchema() in routes/crm.ts. Idempotent.
-- ============================================================

ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crm_act_branch ON crm_activities(branch_id);

ALTER TABLE crm_lists ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_crm_lists_branch ON crm_lists(branch_id);
