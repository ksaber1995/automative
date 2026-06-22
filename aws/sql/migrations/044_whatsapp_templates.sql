-- 044: Replace Meta Cloud API messaging with click-to-chat (wa.me) templates.
--
-- The old central-number messaging feature (message_settings / message_log /
-- messaging_quota / message_templates) is removed. Messages are now sent from
-- each staff member's own WhatsApp via wa.me deep links; the server only stores
-- the editable template bodies.
--
-- Mirrors migrationsRoutes.setupWhatsappTemplates in routes/migrations.ts.

DROP TABLE IF EXISTS message_log CASCADE;
DROP TABLE IF EXISTS messaging_quota CASCADE;
DROP TABLE IF EXISTS message_settings CASCADE;
DROP TABLE IF EXISTS message_templates CASCADE;

CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                  CHECK (type IN ('QR_STUDENT', 'FOLLOWUP_PARENT', 'ABSENCE', 'PAYMENT_DELAY', 'EXAM_RESULTS')),
    body        TEXT NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_company ON whatsapp_templates(company_id);

CREATE TRIGGER update_whatsapp_templates_updated_at
    BEFORE UPDATE ON whatsapp_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
