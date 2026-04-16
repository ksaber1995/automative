-- Migration 011: Master Courses
--
-- Adds a company-wide catalog of course templates that can be linked to
-- branch-level course instances. Updates to a master can be applied in bulk
-- to every linked course. A master can also be instantiated across branches
-- in one operation.

CREATE TABLE IF NOT EXISTS master_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description TEXT,
    default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
    default_duration INTEGER NOT NULL DEFAULT 8,
    default_max_students INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_master_courses_company ON master_courses(company_id);

ALTER TABLE courses
    ADD COLUMN IF NOT EXISTS master_course_id UUID REFERENCES master_courses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_master_course ON courses(master_course_id);
