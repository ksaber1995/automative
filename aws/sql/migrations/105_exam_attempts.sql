-- Phase 6 of the online-exams feature (see online_exams.md §1.6/§1.7): the
-- student's sitting — one attempt per student, and the frozen paper they drew.
--
-- The paper is SNAPSHOTTED at start: question text and the full option list
-- (already in that student's shuffled order, each option under a fresh local id
-- with the correct flag) are copied in, so editing or retiring a bank question
-- later never rewrites what a student was actually asked, and a running attempt
-- cannot break under the teacher's edits.
--
-- The API applies these statements idempotently at runtime (ensureExamTables in
-- aws/lambda/api/src/routes/exams.ts); this file is the equivalent for fresh
-- installs.

CREATE TABLE IF NOT EXISTS exam_attempts (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id      UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    -- No attempt token and no shareable id in any URL: an attempt is reached
    -- only as "the signed-in student's attempt at this exam".
    status       VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS'
                   CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
    started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Server-owned deadline = LEAST(started_at + duration, exams.closes_at).
    -- The client countdown is decoration; this is what grading trusts.
    expires_at   TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    score        INTEGER,     -- correct answers, filled on submit/expiry
    total        INTEGER,     -- questions on THIS paper (can be < question_count
                              -- if questions were retired after the exam was saved)
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id)          -- one attempt; signing back in resumes it
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam    ON exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id);

CREATE TABLE IF NOT EXISTS exam_attempt_questions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attempt_id  UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
    -- Provenance, for "which questions do students keep failing" later. SET NULL
    -- so deleting a bank question never deletes a sat paper.
    question_id UUID REFERENCES lesson_questions(id) ON DELETE SET NULL,
    lesson_id   UUID REFERENCES lessons(id)          ON DELETE SET NULL,
    order_index INTEGER NOT NULL,                    -- this student's question order
    -- The snapshot. `options` is [{ id, text, isCorrect }] in presentation order;
    -- the correct flag lives here and is NEVER serialised to the student API
    -- before submit (one mapping function strips it — see routes/student-exams.ts).
    question_text TEXT NOT NULL,
    options     JSONB NOT NULL,
    selected_option_id UUID,      -- null = unanswered
    is_correct  BOOLEAN,          -- null until graded
    answered_at TIMESTAMP WITH TIME ZONE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (attempt_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_eaq_attempt  ON exam_attempt_questions(attempt_id, order_index);
CREATE INDEX IF NOT EXISTS idx_eaq_question ON exam_attempt_questions(question_id);

DROP TRIGGER IF EXISTS update_exam_attempts_updated_at ON exam_attempts;
CREATE TRIGGER update_exam_attempts_updated_at BEFORE UPDATE ON exam_attempts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
