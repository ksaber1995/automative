-- Phase 2 of the online-exams feature (see online_exams.md): the MCQ question bank
-- that hangs off a lesson. An online exam later draws its paper at random from the
-- pooled questions of the lessons it covers.
--
-- Still no exam behaviour here — this is the bank filling up.
--
-- The API applies these same statements idempotently at runtime
-- (ensureQuestionSchema in aws/lambda/api/src/routes/lessons.ts), so deploying the
-- API is enough; this file is the equivalent for fresh installs.

CREATE TABLE IF NOT EXISTS lesson_questions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    lesson_id     UUID NOT NULL REFERENCES lessons(id)   ON DELETE CASCADE,
    -- Denormalised from the lesson so the "all questions of these lessons" pool
    -- query an exam draw runs stays a single scan on one index.
    course_id     UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    -- MCQ is the only type for now; the column exists so adding TRUE_FALSE /
    -- MULTI / WRITTEN later is a CHECK change, not a table change.
    question_type VARCHAR(16) NOT NULL DEFAULT 'MCQ' CHECK (question_type IN ('MCQ')),
    -- Optional, shown in the answer review after a student submits.
    explanation   TEXT,
    -- Soft-delete: retires a question from future draws without touching the
    -- papers already sat on it.
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lesson_questions_lesson  ON lesson_questions(lesson_id, is_active);
CREATE INDEX IF NOT EXISTS idx_lesson_questions_company ON lesson_questions(company_id);
CREATE INDEX IF NOT EXISTS idx_lesson_questions_course  ON lesson_questions(course_id, is_active);

-- Options are rows, not JSONB on the question: a shuffled paper has to record
-- WHICH option a student picked, and that needs a stable id per option. Two to six
-- rows per question is nothing.
--
-- "Exactly one is_correct" is enforced in the API, not by a constraint: a question
-- is always written as a whole (text + full option list in one transaction), and a
-- partial write tripping a DB CHECK mid-flight is worse than a 400.
CREATE TABLE IF NOT EXISTS lesson_question_options (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct  BOOLEAN NOT NULL DEFAULT false,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lesson_question_options_q ON lesson_question_options(question_id, order_index);

DROP TRIGGER IF EXISTS update_lesson_questions_updated_at ON lesson_questions;
CREATE TRIGGER update_lesson_questions_updated_at
    BEFORE UPDATE ON lesson_questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
