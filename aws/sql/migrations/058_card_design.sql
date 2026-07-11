-- Student ID card: the shared back face, configured once per company.
-- Applied idempotently at runtime by ensureCardDesignColumn() in
-- aws/lambda/api/src/routes/companies.ts; this file is the equivalent for
-- fresh installs. NULL means "never configured" -> the API serves defaults.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS card_design JSONB;
