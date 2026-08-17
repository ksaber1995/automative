-- 099: print-shop links.
--
-- A link you can send to an outside printer. They get three things — the cards,
-- the shipping address, and a contact number — and nothing else about the
-- tenant. No login: the token IS the credential, which is why it is 32 random
-- bytes and why the public route answers 404 identically for missing, revoked
-- and expired links.
--
-- The card set is a SNAPSHOT, pinned when the link is made. Resolving it live
-- would mean minting another run tomorrow silently enlarges a job the printer
-- has already quoted for, and marking a batch printed would empty a link that is
-- still open on their screen.
--
-- Idempotent, and also applied at runtime by ensurePrintJobSchema().

CREATE TABLE IF NOT EXISTS qr_card_print_jobs (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    token         VARCHAR(64) NOT NULL UNIQUE,
    note          VARCHAR(200),
    -- An array rather than a join table: a run is capped at 2000 cards and this
    -- is only ever read whole.
    card_ids      UUID[] NOT NULL DEFAULT '{}',
    -- Free text: admin-portal users are not rows in the users table.
    created_by    VARCHAR(255),
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at    TIMESTAMP WITH TIME ZONE,
    -- So the office can answer "did the printer actually get it?" two days later.
    first_opened_at    TIMESTAMP WITH TIME ZONE,
    last_downloaded_at TIMESTAMP WITH TIME ZONE,
    download_count     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_company ON qr_card_print_jobs (company_id, created_at DESC);

-- NOTE for whoever reads this next: the public route filters out any card that
-- has since been LINKED to a student. A card's token is the credential to that
-- student's public profile (/p/s/<token> — name, courses, attendance, no login),
-- so a job created last month must never hand over a card that was given to
-- someone since. Eligibility at creation is unprinted AND unlinked; eligibility
-- at read time is unlinked, checked again.
