-- Phase 1 of the online-exams feature (see online_exams.md): the LESSONS a course
-- is taught in, and the per-tenant flag that keeps the whole feature dark.
--
-- Nothing here is exam behaviour yet. A lesson is a curriculum entry on a course,
-- ordered, which later phases hang a question bank and an online exam off.
--
-- The API applies these same statements idempotently at runtime
-- (ensureOnlineExamsColumn in routes/companies.ts, ensureLessonSchema in
-- routes/lessons.ts), so deploying the API is enough; this file is the equivalent
-- for fresh installs.

-- ─── The gate ────────────────────────────────────────────────────────────────
-- Online exams (lessons, question bank, the student portal) are gated per tenant
-- and OFF by default: the feature ships dark and is switched on for the vendor's
-- test tenant first, from the admin console. The API enforces it on every
-- lessons endpoint, so a tenant without the flag cannot reach any of it.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS online_exams_enabled BOOLEAN NOT NULL DEFAULT false;

-- ─── Lessons ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lessons (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,   -- denormalised from the course
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    -- Position in the course. Drives "all lessons up to here" and the ordering of
    -- the lesson list. Not unique on purpose: reordering would fight a unique
    -- index, and two lessons sharing a position is a display quirk, not corruption.
    order_index INTEGER NOT NULL DEFAULT 0,
    -- Soft-delete. A hard delete would take the question bank with it, and later
    -- the exams drawn from it, so retiring a lesson hides it instead.
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lessons_company ON lessons(company_id);
CREATE INDEX IF NOT EXISTS idx_lessons_course  ON lessons(course_id, order_index);

DROP TRIGGER IF EXISTS update_lessons_updated_at ON lessons;
CREATE TRIGGER update_lessons_updated_at
    BEFORE UPDATE ON lessons
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
