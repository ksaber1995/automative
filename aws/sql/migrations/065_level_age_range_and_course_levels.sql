-- Migration 065: Level age range + course-to-many-levels
--
-- 1) Levels gain an optional age range (from_age / to_age). Both are nullable;
--    to_age must be greater than from_age (enforced in the API, not a CHECK, so
--    partially-filled rows are allowed). The legacy single `age` column stays.
-- 2) A course can now be linked to multiple levels via the course_levels join
--    table. courses.level_id is retained and kept in sync with the first level
--    for backward compatibility with older readers.
--
-- Idempotent — matches ensureLevelSchema() in aws/lambda/api/src/routes/levels.ts,
-- which self-applies the same DDL at runtime.

ALTER TABLE levels ADD COLUMN IF NOT EXISTS from_age INTEGER;
ALTER TABLE levels ADD COLUMN IF NOT EXISTS to_age INTEGER;

CREATE TABLE IF NOT EXISTS course_levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    level_id UUID NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (course_id, level_id)
);

CREATE INDEX IF NOT EXISTS idx_course_levels_course ON course_levels(course_id);
CREATE INDEX IF NOT EXISTS idx_course_levels_level ON course_levels(level_id);

-- Backfill the join table from the legacy single link.
INSERT INTO course_levels (course_id, level_id)
    SELECT id, level_id FROM courses WHERE level_id IS NOT NULL
    ON CONFLICT (course_id, level_id) DO NOTHING;
