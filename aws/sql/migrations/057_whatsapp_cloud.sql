-- ============================================================
-- Migration 057 – WhatsApp Cloud API foundation
-- ============================================================
-- Per-tenant WhatsApp Cloud API: each academy connects its own number, with
-- auto-send settings, templates mapped to approved Meta templates, and a
-- two-way conversation store (inbox). Named wa_* to avoid colliding with the
-- existing click-to-chat `whatsapp_templates` table (migration 044).
-- Secrets (tokens) live in AWS Secrets Manager, NOT here.
-- Mirrors ensureWaSchema() in routes/wa-cloud.ts. Idempotent.
-- ============================================================

-- Per-tenant connected number (non-secret status + linkage)
CREATE TABLE IF NOT EXISTS wa_accounts (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id           UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    waba_id              VARCHAR(64),
    phone_number_id      VARCHAR(64) UNIQUE,      -- routes inbound webhooks -> tenant
    display_phone_number VARCHAR(32),
    verified_name        VARCHAR(200),
    status               VARCHAR(20) NOT NULL DEFAULT 'NOT_CONNECTED'
                           CHECK (status IN ('NOT_CONNECTED', 'CONNECTING', 'ACTIVE', 'ERROR')),
    quality_rating       VARCHAR(16),
    connected_at         TIMESTAMP WITH TIME ZONE,
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Auto-send toggles (per company)
CREATE TABLE IF NOT EXISTS wa_settings (
    company_id                 UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    auto_send_on_checkin       BOOLEAN NOT NULL DEFAULT false,
    auto_send_on_absence       BOOLEAN NOT NULL DEFAULT false,
    absence_warning_threshold  INTEGER NOT NULL DEFAULT 3,
    auto_send_absence_warning  BOOLEAN NOT NULL DEFAULT false,
    crm_auto_outreach          BOOLEAN NOT NULL DEFAULT false,
    crm_auto_drip              BOOLEAN NOT NULL DEFAULT false,
    crm_stop_on_reply          BOOLEAN NOT NULL DEFAULT true,
    updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Per-company template bodies mapped to approved Meta templates
CREATE TABLE IF NOT EXISTS wa_templates (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key                VARCHAR(40) NOT NULL,
    meta_template_name VARCHAR(120),
    category           VARCHAR(16) NOT NULL DEFAULT 'UTILITY',
    language           VARCHAR(10) NOT NULL DEFAULT 'ar',
    body               TEXT NOT NULL DEFAULT '',
    is_active          BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, key)
);

-- Two-way conversations + messages
CREATE TABLE IF NOT EXISTS wa_conversations (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_phone    VARCHAR(32) NOT NULL,
    contact_name     VARCHAR(200),
    student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id          UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    last_message_at  TIMESTAMP WITH TIME ZONE,
    last_inbound_at  TIMESTAMP WITH TIME ZONE,
    unread_count     INTEGER NOT NULL DEFAULT 0,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_company ON wa_conversations(company_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS wa_messages (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    conversation_id  UUID NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
    direction        VARCHAR(4) NOT NULL CHECK (direction IN ('OUT', 'IN')),
    type             VARCHAR(20) NOT NULL DEFAULT 'text',
    template_key     VARCHAR(40),
    body             TEXT,
    meta_message_id  VARCHAR(120),
    status           VARCHAR(16),
    error_message    TEXT,
    student_id       UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id          UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    sent_by          UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_wa_msg_conversation ON wa_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_msg_meta ON wa_messages(meta_message_id);
