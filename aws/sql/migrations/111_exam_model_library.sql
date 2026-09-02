-- 111: Exam models become a reusable LIBRARY, and an exam declares its type.
--
-- Migration 110 hung models off one exam: you opened an exam and built its
-- variants there. They are now built like the question bank — their own thing in
-- the sidebar, belonging to a COURSE — and an exam picks from that library.
-- The same "Model A / B / C" can then be reused by a retake or a second sitting
-- instead of being rebuilt.
--
--   exams.question_source   RANDOM = draw a fresh random paper per student from
--                           the exam's lessons (the original behaviour, and the
--                           default). FIXED = hand out the models linked below.
--   exam_model_links        which library models this exam uses.
--   exam_models.course_id   the course whose lessons/bank a model draws on.
--                           Replaces exam_id: a library row must not carry one
--                           exam's identity.
--
-- Applied idempotently at runtime by ensureExamModelSchema() in
-- aws/lambda/api/src/routes/exam-models.ts; this file is the reference copy.

-- 1. Models belong to a course.
ALTER TABLE exam_models ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE CASCADE;

UPDATE exam_models m
   SET course_id = e.course_id
  FROM exams e
 WHERE e.id = m.exam_id AND m.course_id IS NULL;

-- 2. Which models an exam hands out.
CREATE TABLE IF NOT EXISTS exam_model_links (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)       ON DELETE CASCADE,
    model_id    UUID NOT NULL REFERENCES exam_models(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_eml_exam  ON exam_model_links(exam_id, order_index);
CREATE INDEX IF NOT EXISTS idx_eml_model ON exam_model_links(model_id);

-- Carry the per-exam models of migration 110 over as links.
INSERT INTO exam_model_links (exam_id, model_id, order_index)
SELECT m.exam_id, m.id, m.order_index
  FROM exam_models m
 WHERE m.exam_id IS NOT NULL
    ON CONFLICT (exam_id, model_id) DO NOTHING;

-- 3. How an exam gets its paper. Default RANDOM, so every exam that exists
--    today keeps doing exactly what it does now.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_source VARCHAR(16) NOT NULL DEFAULT 'RANDOM';
DO $$ BEGIN
  ALTER TABLE exams ADD CONSTRAINT exams_question_source_check
    CHECK (question_source IN ('RANDOM', 'FIXED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE exams e SET question_source = 'FIXED'
 WHERE EXISTS (SELECT 1 FROM exam_model_links l WHERE l.exam_id = e.id);

-- 4. exam_id is now redundant — the link table says which exams use a model.
--    Dropping it also drops UNIQUE (exam_id, order_index), which was the wrong
--    shape for a library (order is per exam now, not per model).
ALTER TABLE exam_models DROP COLUMN IF EXISTS exam_id;

-- Every model must know its course. Guarded: a row that somehow has none would
-- fail the SET NOT NULL and take the whole migration with it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM exam_models WHERE course_id IS NULL) THEN
    ALTER TABLE exam_models ALTER COLUMN course_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_models_course ON exam_models(course_id, order_index);
