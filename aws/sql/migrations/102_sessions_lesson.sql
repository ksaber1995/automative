-- Phase 3 of the online-exams feature (see online_exams.md): which LESSON a taught
-- session actually covered.
--
-- Lessons belong to a course, so every class of a course shares the same
-- curriculum — but classes move through it at their own pace. This column is what
-- makes "everything taught so far in THIS class" answerable, which is how a teacher
-- scopes an exam without ticking lessons by hand.
--
-- Nullable and optional: existing sessions have no lesson, and a teacher who never
-- tags one still gets the manual lesson picker on the exam form. ON DELETE SET NULL
-- because retiring a lesson must never delete a taught session.
--
-- The API applies this idempotently at runtime (ensureLessonSessionColumn in
-- aws/lambda/api/src/routes/sessions.ts), so deploying the API is enough; this file
-- is the equivalent for fresh installs.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_lesson ON sessions(lesson_id);
