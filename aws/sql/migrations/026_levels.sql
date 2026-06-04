-- Migration 026: Levels
--
-- Company-wide catalog of skill/age levels (simple name + age). Courses and
-- master courses may optionally be tagged with one level. The link is optional
-- and ON DELETE SET NULL so removing a level never deletes courses.

CREATE TABLE IF NOT EXISTS levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    age INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_levels_company_id ON levels(company_id);

DROP TRIGGER IF EXISTS update_levels_updated_at ON levels;
CREATE TRIGGER update_levels_updated_at
    BEFORE UPDATE ON levels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Optional link from courses to a level.
ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES levels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_courses_level_id ON courses(level_id);

-- Optional link from master courses to a level.
ALTER TABLE master_courses
    ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES levels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_master_courses_level_id ON master_courses(level_id);
