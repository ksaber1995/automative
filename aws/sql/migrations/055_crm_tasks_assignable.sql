-- ============================================================
-- Migration 055 – CRM tasks become first-class & assignable
-- ============================================================
-- Tasks (crm_activities with type='TASK') can now be:
--   • assigned to an employee (assigned_employee_id) — for the mobile app,
--   • prioritized (priority LOW/MEDIUM/HIGH),
--   • standalone (lead_id is now nullable).
-- Mirrors ensureCrmSchema() in routes/crm.ts. Idempotent.
-- ============================================================

ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS priority VARCHAR(10) NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE crm_activities ALTER COLUMN lead_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_act_assignee ON crm_activities(assigned_employee_id);
