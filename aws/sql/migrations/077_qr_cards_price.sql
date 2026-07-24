-- 077: what a print run cost.
--
-- A bundle is minted with a price and a type. The type already exists
-- (pool_type, migration 066); the price did not, so there was no record of what
-- a client was charged for a run — the only trace was whatever the owner
-- remembered.
--
-- Stored PER CARD rather than on a separate batch table: cards are already
-- grouped by their serial run and pool_type, a batch table would need
-- backfilling for every historic run, and per-card price answers both questions
-- ("what did this card cost" and "what did this bundle cost", via SUM) while a
-- bundle-level row only answers the second.
--
-- NULL = minted before prices were recorded, which is honestly different from
-- zero. Nothing sums NULL into a total by accident.
--
-- Idempotent — matches ensureQrCardSchema() in
-- aws/lambda/api/src/routes/qr-cards.ts.

ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2);
