-- 066: a type on each pool of pre-printed QR cards.
--
-- The vendor stamps a run with 1, 2 or 3 when minting it from the admin console.
-- Nothing in the app branches on the value yet — it exists so a print run can be
-- told apart later. The meaning of each number is deliberately not encoded here.
--
-- A "pool" has never been an entity: it is just the qr_cards rows for a company,
-- and a "batch" was only ever visible as a run of contiguous serials minted at
-- the same second. This is the first per-batch attribute, so it lives on the card.
--
-- Serials stay a single continuous per-company sequence — the type does NOT
-- partition them. Card serials become student_code when a card is linked, and
-- uq_qr_cards_serial is (company_id, serial), so a serial can never repeat across
-- types anyway.
--
-- Existing cards become type 1 rather than NULL: whatever consumes this can then
-- always group by a value instead of carrying a "no type" branch, and 1 is the
-- honest name for the only kind of run that has existed so far.
--
-- Applied idempotently at runtime by ensureQrCardSchema() in
-- aws/lambda/api/src/routes/qr-cards.ts — deploying the API is what applies it.
-- This file is for fresh installs and reference.

ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS pool_type SMALLINT NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE qr_cards ADD CONSTRAINT qr_cards_pool_type_check CHECK (pool_type IN (1, 2, 3));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
