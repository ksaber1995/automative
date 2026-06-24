-- ============================================================
-- Migration 047 – Telegram bot pool (platform-owned bots)
-- ============================================================
-- A pool of bots the PLATFORM creates once (via @BotFather) and hands out: when
-- an academy enables Telegram, the backend claims a free bot from this pool,
-- assigns it to that company, points its webhook at us, and renames it to the
-- academy's name. Academies never create a bot or paste a token.
--
-- assigned_company_id IS NULL  → bot is available to claim.
-- All statements are idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_bot_pool (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bot_token           VARCHAR(255) NOT NULL UNIQUE,
  bot_username        VARCHAR(64) NOT NULL,
  assigned_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  assigned_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tg_pool_assigned ON telegram_bot_pool(assigned_company_id);
