-- =============================================================================
-- 085: what an academy calls things
--
-- A "sports academy" is an advanced academy in every respect that matters — same
-- tables, same permissions, same CRM and Cash — but its people are coaches and
-- trainees, not teachers and students, and they train in groups on a pitch
-- rather than in classes in a room. That is a vocabulary, not a feature.
--
-- So it is NOT a new `type` and NOT a new `plan`:
--   * `type` would have switched CRM and Cash OFF, because both gate on
--     `type = 'ACADEMY' AND plan = 'ADVANCED'` (routes/crm.ts, routes/cash.ts),
--     and the whole point is that nothing behaves differently.
--   * `plan` is what a tenant pays for; a sports academy pays for ADVANCED and
--     is registered as ADVANCED.
--
-- The client reads this off the login payload and merges a vocabulary overlay
-- over the base translations (assets/i18n/*.sports.json) — only the keys whose
-- wording differs, so the ~95% of text that is identical cannot drift.
--
-- GENERAL is the default, so every existing tenant keeps the wording it has.
-- Idempotent, and the API applies it at runtime too (ensureVerticalColumn).
-- =============================================================================

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS vertical VARCHAR(16) NOT NULL DEFAULT 'GENERAL';
