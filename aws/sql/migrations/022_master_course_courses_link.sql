-- Migration 022: Replace courses.master_course_id with a proper junction table
--
-- A course can now belong to multiple master courses simultaneously.
-- The old model stored a single master_course_id FK on the courses row,
-- which prevented a course from being shared across bundles.

CREATE TABLE IF NOT EXISTS master_course_courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    master_course_id UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (master_course_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_mcc_master_course ON master_course_courses(master_course_id);
CREATE INDEX IF NOT EXISTS idx_mcc_course ON master_course_courses(course_id);

-- Migrate existing links
INSERT INTO master_course_courses (master_course_id, course_id)
SELECT c.master_course_id, c.id
FROM courses c
WHERE c.master_course_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Drop old column
ALTER TABLE courses DROP COLUMN IF EXISTS master_course_id;
