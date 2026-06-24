-- ============================================================
-- Migration 046 – Telegram attendance & auto-notifications (Phase 1)
-- ============================================================
-- Adds the four tables that back the Telegram feature:
--   telegram_settings   – per-company bot config + notify toggles
--   telegram_links      – maps a student/parent/staff to a Telegram chat_id
--   telegram_templates  – editable PRESENT/ABSENT/LINK_WELCOME message bodies
--   telegram_outbox     – delivery log + idempotency guard for auto-notify
--
-- The bot token is stored here (server-only; never returned to the browser).
-- All statements are idempotent.
-- ============================================================

-- 1) Per-company bot config & notification settings.
CREATE TABLE IF NOT EXISTS telegram_settings (
  company_id        UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  bot_token         VARCHAR(255),            -- Telegram bot token (server-only)
  bot_username      VARCHAR(64),             -- e.g. 'MyAcademyBot' (for deep links)
  webhook_secret    VARCHAR(64),             -- echoed by Telegram in X-Telegram-Bot-Api-Secret-Token
  enabled           BOOLEAN NOT NULL DEFAULT false,
  notify_on_present BOOLEAN NOT NULL DEFAULT true,
  notify_on_absent  BOOLEAN NOT NULL DEFAULT true,
  notify_target     VARCHAR(16) NOT NULL DEFAULT 'BOTH'
                      CHECK (notify_target IN ('STUDENT','PARENT','BOTH')),
  created_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2) Telegram chat links. A bot can only message a chat it has captured via a
--    /start deep link, so we persist the chat_id per student/parent/staff.
CREATE TABLE IF NOT EXISTS telegram_links (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role              VARCHAR(16) NOT NULL CHECK (role IN ('STUDENT','PARENT','STAFF')),
  student_id        UUID REFERENCES students(id)  ON DELETE CASCADE,
  employee_id       UUID REFERENCES employees(id) ON DELETE CASCADE,
  chat_id           BIGINT NOT NULL,
  telegram_username VARCHAR(64),
  linked_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, role, chat_id),
  CHECK ( (role IN ('STUDENT','PARENT') AND student_id IS NOT NULL)
       OR (role = 'STAFF' AND employee_id IS NOT NULL) )
);
CREATE INDEX IF NOT EXISTS idx_tg_links_student  ON telegram_links(student_id);
CREATE INDEX IF NOT EXISTS idx_tg_links_employee ON telegram_links(employee_id);
CREATE INDEX IF NOT EXISTS idx_tg_links_chat     ON telegram_links(company_id, chat_id);

-- 3) Editable message templates (defaults filled in app code).
CREATE TABLE IF NOT EXISTS telegram_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL CHECK (type IN ('PRESENT','ABSENT','LINK_WELCOME')),
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (company_id, type)
);

-- 4) Outbox: delivery tracking + idempotency. The UNIQUE key guarantees we
--    never notify the same (session, student, recipient, kind) twice.
CREATE TABLE IF NOT EXISTS telegram_outbox (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  student_id   UUID REFERENCES students(id) ON DELETE SET NULL,
  session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  kind         VARCHAR(16) NOT NULL CHECK (kind IN ('PRESENT','ABSENT')),
  body         TEXT NOT NULL,
  status       VARCHAR(12) NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
  error        TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMPTZ,
  UNIQUE (session_id, student_id, chat_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_tg_outbox_company ON telegram_outbox(company_id);
CREATE INDEX IF NOT EXISTS idx_tg_outbox_status  ON telegram_outbox(status);

-- 5) Unguessable token used in a staff member's bot deep link (t.me/Bot?start=t<token>),
--    so a secretary/teacher can link their Telegram to drive the attendance bot.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS telegram_link_token VARCHAR(32);
