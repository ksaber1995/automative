-- 110: Exam MODELS (variants / forms) for online exams.
--
-- Until now an online exam stored a POOL — the lessons in exam_lessons plus
-- "draw N" — and every student got their own random paper at attempt start.
-- That is still supported and unchanged: an exam with no rows in exam_models
-- behaves exactly as before.
--
-- A model is a FIXED paper. "Test 1" can carry Model A / B / C, each with its
-- own question list in its own order, and every student who sits Model A sees
-- exactly those questions. Models are handed out either at random (balanced,
-- so the models come out roughly evenly used) or one model per class.
--
-- Models may differ in length. Nothing needed for that: exam_attempts.total is
-- already per-attempt and db/exam-grading.ts re-derives it from the paper the
-- student actually sat, so a 20-question model scores out of 20 and an
-- 18-question one out of 18 without any special case.
--
-- Applied idempotently at runtime by ensureExamModelSchema() in
-- aws/lambda/api/src/routes/exam-models.ts; this file is the reference copy for
-- fresh installs.

-- How this exam hands its models out. NULL = it has no models (pooled random
-- draw, the original behaviour).
ALTER TABLE exams ADD COLUMN IF NOT EXISTS model_distribution VARCHAR(16);
DO $$ BEGIN
  ALTER TABLE exams ADD CONSTRAINT exams_model_distribution_check
    CHECK (model_distribution IN ('RANDOM', 'BY_CLASS'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One row per model of an exam. Names are the tenant's ("Model A", "نموذج ١").
CREATE TABLE IF NOT EXISTS exam_models (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        VARCHAR(64) NOT NULL,
    order_index INTEGER NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, order_index)
);

CREATE INDEX IF NOT EXISTS idx_exam_models_exam ON exam_models(exam_id, order_index);

-- The model's paper, in order. A REFERENCE to the bank question, not a snapshot:
-- a model is a plan, not history, so fixing a typo in the bank should fix it
-- here too. The sat paper is snapshotted separately into
-- exam_attempt_questions at attempt start, which is what protects a paper
-- somebody has already answered.
--
-- No denormalised count column: the length is COUNT(*) on read. A stored count
-- would go stale the moment a bank question is deleted underneath it.
CREATE TABLE IF NOT EXISTS exam_model_questions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id    UUID NOT NULL REFERENCES exam_models(id)      ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
    -- Provenance for the UI (which lesson this came from). SET NULL so retiring
    -- a lesson does not empty the model.
    lesson_id   UUID REFERENCES lessons(id) ON DELETE SET NULL,
    order_index INTEGER NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (model_id, order_index),
    -- A model must not ask the same question twice.
    UNIQUE (model_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_emq_model    ON exam_model_questions(model_id, order_index);
CREATE INDEX IF NOT EXISTS idx_emq_question ON exam_model_questions(question_id);

-- Which class sits which model, for model_distribution = 'BY_CLASS'.
-- exam_id is carried (not just derived through model_id) so one class can be
-- pinned to exactly one model per exam by a UNIQUE constraint.
CREATE TABLE IF NOT EXISTS exam_model_classes (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id    UUID NOT NULL REFERENCES exams(id)       ON DELETE CASCADE,
    model_id   UUID NOT NULL REFERENCES exam_models(id) ON DELETE CASCADE,
    class_id   UUID NOT NULL REFERENCES classes(id)     ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_emc_exam  ON exam_model_classes(exam_id);
CREATE INDEX IF NOT EXISTS idx_emc_model ON exam_model_classes(model_id);

-- What this student's paper was out of. Only meaningful once models can differ
-- in length: exams.max_grade is a single number, so a 15 off an 18-question
-- model would otherwise display as 15/20. Equals max_grade for a pooled exam,
-- so nothing about existing exams changes. Written by db/exam-grading.ts.
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS out_of INTEGER;

-- Which model this student was given. SET NULL, not CASCADE: the sat paper is
-- already frozen in exam_attempt_questions, and deleting a model must never
-- delete somebody's sitting.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS model_id UUID;
DO $$ BEGIN
  ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_model_id_fkey
    FOREIGN KEY (model_id) REFERENCES exam_models(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_attempts_model ON exam_attempts(model_id);

DO $$ BEGIN
  CREATE TRIGGER update_exam_models_updated_at
    BEFORE UPDATE ON exam_models
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
