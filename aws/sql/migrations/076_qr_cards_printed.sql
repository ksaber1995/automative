-- 076: track which QR cards have been sent to the printer.
--
-- Printing is a physical batch job: you generate a run, download it as a ZIP,
-- send that to the printer, and the next download must contain ONLY what has
-- not been printed yet. Without a marker every download re-exports the whole
-- pool and you either reprint cards that are already in a pocket or hand-diff
-- serial ranges by eye.
--
-- A TIMESTAMPTZ, not a boolean: it records WHEN a run went to the printer,
-- which is what makes "the previous order" identifiable afterwards. A boolean
-- answers "printed?" and throws away "which run" — and the runs are exactly
-- what the user reasons about. NULL = not printed yet.
--
-- Deliberately NOT set automatically on download: downloading a ZIP is not
-- proof it reached a printer (wrong file, cancelled order, reprint of a damaged
-- sheet). Marking is an explicit act, so the flag means what it says.
--
-- Idempotent — matches ensureQrCardSchema() in
-- aws/lambda/api/src/routes/qr-cards.ts, which self-applies the same DDL.

ALTER TABLE qr_cards ADD COLUMN IF NOT EXISTS printed_at TIMESTAMP WITH TIME ZONE;

-- The pool page's default view is "what still needs printing", so that filter
-- runs on every load.
CREATE INDEX IF NOT EXISTS idx_qr_cards_unprinted
    ON qr_cards (company_id, serial)
    WHERE printed_at IS NULL;

-- Backfill: EVERY card that exists today is already physically printed
-- (confirmed with the owner, 2026-07-24). That matches how the pool works — a
-- run is printed blank and then linked as cards are handed out — so a free card
-- is one sitting in a box, not one waiting for the printer.
--
-- The alternative (only marking linked cards) would have put all 1,445 free
-- cards into the next download and reprinted a pool that already exists.
--
-- Dated from the card's own history rather than NOW(), so the stamp reads as
-- when the run actually happened instead of when this migration ran.
UPDATE qr_cards
   SET printed_at = COALESCE(assigned_at, created_at)
 WHERE printed_at IS NULL;
