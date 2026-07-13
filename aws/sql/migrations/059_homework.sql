-- Homework rides on the exams table behind a flag, so it inherits the whole
-- grading stack that already exists there: QR/code recording, per-student upsert,
-- max-grade denominators and the student results feed.
--
-- A homework belongs to a CLASS (an exam is course-wide). session_id is nullable
-- on purpose: a teacher records homework when they want to, not necessarily on
-- every session. Both FKs are ON DELETE SET NULL so removing a session or class
-- never destroys the marks that were recorded against it.
--
-- The API applies these same statements idempotently at runtime
-- (ensureExamTables in aws/lambda/api/src/routes/exams.ts), so deploying the API
-- is enough; this file is the equivalent for fresh installs.

ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_homework BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS class_id    UUID REFERENCES classes(id)  ON DELETE SET NULL;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exams_class    ON exams(class_id);
CREATE INDEX IF NOT EXISTS idx_exams_session  ON exams(session_id);
CREATE INDEX IF NOT EXISTS idx_exams_homework ON exams(company_id, is_homework);
