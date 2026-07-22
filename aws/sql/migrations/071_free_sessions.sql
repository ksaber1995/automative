-- ============================================================
-- Migration 071 – Free (trial) sessions
-- ============================================================
-- An academy that charges for every session still needs a way to let a
-- prospective student sit in on a real lesson before they buy. A free session
-- is an ordinary session with two differences:
--
--   1. It bills nobody. No session_payments row is ever created for it, and
--      no absence is charged when it ends — see the guards at the top of every
--      charge function in routes/session-payments.ts. The flag lives on the
--      session (not on the attendance) so the "is this free?" question has a
--      single answer that no caller can get wrong.
--
--   2. Enrolment is not required to attend. Any active student in the company
--      may scan in, because signing them up is the very thing the trial is
--      meant to sell. Those attendees are recorded as attendance_type='TRIAL'.
--
-- 'TRIAL' joins the existing NORMAL/SUBSTITUTION vocabulary rather than adding
-- a boolean, so the attendance row still says in one column *why* a student was
-- in that room. A student attending a free session of a class they ARE enrolled
-- in is still NORMAL — nothing unusual happened, they just weren't charged.
--
-- A free session is also excluded from session-based teacher pay
-- (routes/expenses.ts → getUnpaidSessionIds): it earned the academy nothing.
--
-- Idempotent. Existing sessions default to is_free = FALSE, which is correct:
-- every session that already ran was a paid one.
-- ============================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT FALSE;

-- Widen the attendance_type CHECK to admit TRIAL. Drop & re-add is the
-- established way to widen an enum-as-CHECK here (see migrations 049, 050).
ALTER TABLE session_attendance
    DROP CONSTRAINT IF EXISTS session_attendance_attendance_type_check;
ALTER TABLE session_attendance
    ADD CONSTRAINT session_attendance_attendance_type_check
    CHECK (attendance_type IN ('NORMAL', 'SUBSTITUTION', 'TRIAL'));

-- The free-sessions tab on a class reads "every free session of this class".
CREATE INDEX IF NOT EXISTS idx_sessions_class_is_free ON sessions(class_id, is_free);
