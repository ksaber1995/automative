-- 098: SMS sending — per-tenant opt-in per message type, and an audit of every
-- message the platform paid for.
--
-- Entitlement (may this tenant send at all) is migration 097 on companies.
-- This file is about WHAT they send and WHETHER each kind is switched on, which
-- is a separate decision: a tenant can be entitled and still want only absence
-- messages.
--
-- Idempotent, and also applied at runtime by ensureSmsSchema().

-- One row per company per message type: is this kind switched on, and what does
-- it say. Both facts live together because they are edited together — a tenant
-- turning ABSENCE on immediately wants to see the wording that will go out.
--
-- A missing row means "off, using the default body". Rows are only written when
-- someone changes something, so a tenant who has never opened the screen costs
-- nothing to store.
CREATE TABLE IF NOT EXISTS sms_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- MANUAL is the free-text send; the rest mirror the WhatsApp template types.
    type        VARCHAR(32) NOT NULL,
    -- Automatic sending for this type. MANUAL ignores it — an explicit click is
    -- its own opt-in.
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    body        TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, type)
);

-- Every message, whether it went out or not.
--
-- This is the money trail: the platform holds one gateway account and pays for
-- all of it, so "who sent what, when, and did the gateway take it" has to be
-- answerable per tenant. Failures are rows too — a message that was refused is
-- the thing you most need to see.
CREATE TABLE IF NOT EXISTS sms_messages (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id    UUID REFERENCES students(id) ON DELETE SET NULL,
    type          VARCHAR(32) NOT NULL,
    -- Normalised to 20XXXXXXXXXX before the gateway ever sees it.
    to_phone      VARCHAR(20) NOT NULL,
    body          TEXT NOT NULL,
    -- What this cost: Arabic is UCS-2, so 70 characters per segment, and a
    -- three-line template is three or four paid messages.
    segments      SMALLINT NOT NULL DEFAULT 1,
    status        VARCHAR(16) NOT NULL DEFAULT 'SENT'
                    CHECK (status IN ('SENT', 'FAILED')),
    provider      VARCHAR(32),
    provider_message_id VARCHAR(64),
    provider_code VARCHAR(16),
    error         TEXT,
    -- NULL for anything the system sent on a schedule or a trigger.
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- The day this was sent, stored rather than derived. See the dedupe index.
    sent_on       DATE NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS sent_on DATE NOT NULL DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_sms_messages_company_date ON sms_messages (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_student ON sms_messages (student_id);

-- Stops an automatic trigger sending the same thing twice — the same student,
-- the same kind of message, on the same day. Firing an absence SMS again because
-- someone re-saved the register is the failure mode that costs money and annoys
-- parents, and it is much easier to prevent here than to remember everywhere.
--
-- On the stored sent_on, NOT created_at::date: casting timestamptz to date
-- depends on the session TimeZone, so it is only STABLE, and Postgres rejects it
-- outright in an index expression ("functions in index expression must be marked
-- IMMUTABLE"). A DATE column defaulting to CURRENT_DATE sidesteps that — column
-- defaults are evaluated once, on insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_daily_dedupe
    ON sms_messages (company_id, student_id, type, sent_on)
    WHERE student_id IS NOT NULL AND status = 'SENT' AND type <> 'MANUAL';
