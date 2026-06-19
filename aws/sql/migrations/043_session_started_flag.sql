-- Add 'started' flag to sessions table.
-- Pre-attendance can create a session with started=false; the teacher
-- formally starts it later. Existing sessions default to true.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS started BOOLEAN NOT NULL DEFAULT TRUE;
