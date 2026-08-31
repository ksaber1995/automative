-- Migration 107: the auto-homework company setting.
--
-- When companies.auto_create_homework is TRUE, starting a session (by hand or
-- by the auto-schedule) also creates that session's homework — one per session,
-- named "واجب <session number>", out of 5 in RATING marking mode / 10 otherwise.
-- Free (trial) sessions never get one.
--
-- Applied idempotently at runtime by ensureAutoHomeworkColumn()
-- (aws/lambda/api/src/routes/companies.ts); this file mirrors it for fresh
-- installs and the schema record.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_create_homework BOOLEAN NOT NULL DEFAULT FALSE;
