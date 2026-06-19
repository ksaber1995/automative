-- 044: Messaging feature (WhatsApp via Meta Cloud API)

-- Message templates per company (fixed types, editable body)
CREATE TABLE IF NOT EXISTS message_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL
                  CHECK (type IN ('ABSENCE', 'PAYMENT_DELAY', 'ABSENCE_WARNING', 'EXAM_RESULTS')),
    body        TEXT NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

CREATE INDEX IF NOT EXISTS idx_message_templates_company ON message_templates(company_id);

-- Company-level messaging settings
CREATE TABLE IF NOT EXISTS message_settings (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    messaging_status            VARCHAR(20) NOT NULL DEFAULT 'DISABLED'
                                  CHECK (messaging_status IN ('DISABLED', 'PENDING', 'ACTIVE', 'REJECTED', 'REVOKED')),
    absence_warning_threshold   INTEGER NOT NULL DEFAULT 3,
    auto_send_absence           BOOLEAN NOT NULL DEFAULT false,
    auto_send_payment_delay     BOOLEAN NOT NULL DEFAULT false,
    auto_send_absence_warning   BOOLEAN NOT NULL DEFAULT true,
    auto_send_exam_results      BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id)
);

-- Message log / audit trail
CREATE TABLE IF NOT EXISTS message_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    type            VARCHAR(30) NOT NULL,
    recipient_phone VARCHAR(50) NOT NULL,
    recipient_name  VARCHAR(200),
    student_id      UUID REFERENCES students(id) ON DELETE SET NULL,
    body            TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
    meta_message_id VARCHAR(100),
    error_message   TEXT,
    sent_at         TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_message_log_company    ON message_log(company_id);
CREATE INDEX IF NOT EXISTS idx_message_log_student    ON message_log(student_id);
CREATE INDEX IF NOT EXISTS idx_message_log_type       ON message_log(type);
CREATE INDEX IF NOT EXISTS idx_message_log_status     ON message_log(status);
CREATE INDEX IF NOT EXISTS idx_message_log_created_at ON message_log(created_at);

-- Monthly quota tracking per company
CREATE TABLE IF NOT EXISTS messaging_quota (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    month           VARCHAR(7) NOT NULL,
    messages_sent   INTEGER NOT NULL DEFAULT 0,
    quota_limit     INTEGER NOT NULL,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, month)
);

-- Triggers for updated_at
CREATE TRIGGER update_message_templates_updated_at
    BEFORE UPDATE ON message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_message_settings_updated_at
    BEFORE UPDATE ON message_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_messaging_quota_updated_at
    BEFORE UPDATE ON messaging_quota
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
