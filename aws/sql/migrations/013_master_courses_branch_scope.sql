-- Migration 013: Branch-Scope Master Courses
--
-- Master courses become branch-owned. Each master lives on a specific branch
-- and can be cloned to other branches (producing a new master with its own id).
-- Linking/instantiation is restricted to the master's branch from now on.
--
-- For existing masters, backfill branch_id to whichever branch already has a
-- linked course, falling back to the first branch of the master's company.

ALTER TABLE master_courses
    ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE CASCADE;

UPDATE master_courses mc
SET branch_id = sub.branch_id
FROM (
    SELECT DISTINCT ON (master_course_id) master_course_id, branch_id
    FROM courses
    WHERE master_course_id IS NOT NULL AND branch_id IS NOT NULL
    ORDER BY master_course_id, created_at ASC
) sub
WHERE mc.id = sub.master_course_id AND mc.branch_id IS NULL;

UPDATE master_courses mc
SET branch_id = sub.branch_id
FROM (
    SELECT DISTINCT ON (company_id) company_id, id AS branch_id
    FROM branches
    ORDER BY company_id, created_at ASC
) sub
WHERE mc.branch_id IS NULL AND mc.company_id = sub.company_id;

-- Any rows still null (company with zero branches) stay nullable for now —
-- they cannot be used until the user assigns a branch.

CREATE INDEX IF NOT EXISTS idx_master_courses_branch ON master_courses(branch_id);

-- Unique code per branch (alongside existing (company_id, code) which we drop
-- so multiple branches in the same company can have the same master code).
ALTER TABLE master_courses DROP CONSTRAINT IF EXISTS master_courses_company_id_code_key;
ALTER TABLE master_courses
    ADD CONSTRAINT master_courses_branch_id_code_key UNIQUE (branch_id, code);
