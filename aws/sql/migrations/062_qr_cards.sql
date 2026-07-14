-- A POOL of pre-printed QR cards.
--
-- An academy prints a batch of blank cards up front. Each carries a QR (its own
-- random token) and a printed serial. Nobody owns them yet. Later, a card is
-- handed to a student and linked by scanning it — that is when student_id is set.
--
-- A linked pool card does NOT replace the student's own qr_token: BOTH resolve to
-- that student, so a card printed the old way keeps working. Every QR lookup in
-- the API therefore has to check this table as well as students.qr_token.
--
-- Mirrors ensureQrCardSchema() in aws/lambda/api/src/routes/qr-cards.ts.
-- Idempotent — deploying the API is enough; this file is for fresh installs.

CREATE TABLE IF NOT EXISTS qr_cards (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- What the QR encodes: the same 32-char shape as students.qr_token.
    token       VARCHAR(32) NOT NULL,
    -- What is PRINTED on the card, so a human can find it in a box of a thousand.
    serial      INTEGER NOT NULL,
    -- NULL until the card is handed out and scanned onto a student.
    student_id  UUID REFERENCES students(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- A token must resolve to exactly one card, globally (it is scanned, not typed).
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_cards_token  ON qr_cards(token);
-- Serials are per academy: two academies can both print card #1.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_cards_serial ON qr_cards(company_id, serial);
CREATE INDEX IF NOT EXISTS idx_qr_cards_company ON qr_cards(company_id);
CREATE INDEX IF NOT EXISTS idx_qr_cards_student ON qr_cards(student_id);
