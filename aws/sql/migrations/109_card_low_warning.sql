-- 109: The "you are nearly out of QR cards, order more" nudge.
--
--   card_low_warning_enabled    off by default. Switched on per tenant from the
--                               admin console, because the nudge tells an academy
--                               to order more cards FROM US — it only makes sense
--                               for the clients who buy printed cards, and for
--                               anyone else it is a dialog about something they
--                               cannot act on.
--   card_low_warning_threshold  the remaining-card count it fires at. Stored per
--                               tenant rather than a constant: "nearly out" is a
--                               different number for an academy handing out 5
--                               cards a month and one handing out 200.
--
-- "Remaining" is counted as cards nobody holds yet (qr_cards.student_id IS NULL),
-- printed or not — running out means having no card left to give a new student,
-- and whether it has been through the printer is our logistics, not theirs.
--
-- Applied idempotently at runtime by ensureQrCardSchema() in
-- aws/lambda/api/src/routes/qr-cards.ts; this file is the reference copy for
-- fresh installs. The nudge also requires qr_cards_enabled — a tenant with no
-- pool is never warned about it.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS card_low_warning_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS card_low_warning_threshold INTEGER NOT NULL DEFAULT 10;
