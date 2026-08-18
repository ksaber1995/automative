-- Phase 4 of the online-exams feature (see online_exams.md): an exam a student
-- sits on a screen, defined but not yet sittable.
--
-- An online exam is a row in the SAME `exams` table as the paper exams and the
-- homework, behind a flag — exactly how homework rides there (migration 059). That
-- is deliberate: the whole grading stack already hangs off `exams`/`exam_results`
-- (the student results feed, the roster, mark-remaining-absent, the Telegram/SMS
-- result blast), and an auto-computed mark that lands in `exam_results` inherits all
-- of it for free.
--
-- The API applies these statements idempotently at runtime (ensureExamTables in
-- aws/lambda/api/src/routes/exams.ts), so deploying the API is enough; this file is
-- the equivalent for fresh installs.

-- Sat on a screen, drawing a random paper per student, auto-marked on submit.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false;
-- How many questions to draw from the pooled bank of the selected lessons. Also
-- copied into max_grade, so every existing "out of N" display works unchanged.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_count INTEGER;
-- The per-student clock, counted from when THEY start — not a fixed end time.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
-- The window the exam may be started in. NULL opens_at = open from now.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS opens_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP WITH TIME ZONE;
-- Short code the teacher reveals in class, so nobody starts early. Optional: with
-- student logins shipping in phase 5, identity is established without it.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS access_code VARCHAR(12);
-- Shuffle each student's option order too, not just their question set.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT true;
-- Show the per-question review after submitting. Off = score only, which is what
-- you want when the rest of the class sits the same exam later.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_exams_online ON exams(company_id, is_online);

-- Which lessons an online exam draws from. Resolved at SAVE time, never as a rule:
-- "all lessons taught so far" expands to explicit rows here, so an exam's scope
-- cannot silently grow because another lesson was taught after it was created.
CREATE TABLE IF NOT EXISTS exam_lessons (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id    UUID NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,
    lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_lessons_exam ON exam_lessons(exam_id);
