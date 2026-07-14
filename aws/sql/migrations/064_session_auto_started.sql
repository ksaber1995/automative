-- The automation may only close sessions it OWNS.
--
-- Auto-end used to sweep up every running session whose class's scheduled end time
-- had passed. It never asked who started the session, nor whether the class even
-- ran today — so a make-up lesson on an unscheduled day, or a session started after
-- a schedule change, was closed by the next poll (5 minutes) in the middle of the
-- lesson.
--
-- auto_started marks a session as the automation's: set when the automation starts
-- one, and set by "adoption" when a human starts a session INSIDE its own scheduled
-- window (the teacher pressing Start at 10:05 for the 10:00 class is exactly what
-- the automation would have done itself). Anything started outside the window is
-- never adopted, so auto-end can never touch it.
--
-- Existing rows default to false. That is deliberate: a session already running when
-- this ships is left for a human to end rather than being closed under them.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auto_started BOOLEAN NOT NULL DEFAULT FALSE;
