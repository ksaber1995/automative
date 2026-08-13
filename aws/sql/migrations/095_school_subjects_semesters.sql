-- =============================================================================
-- 095 — Subjects and Semesters for SCHOOL tenants
--
-- Continues migration 094's `school` schema.
--
-- school.subjects: unlike the academy-wide `subjects` table, a school subject
-- belongs to exactly ONE educational stage (school.levels) — one-to-many,
-- level_id NOT NULL. Creating a subject always means picking a stage first;
-- deleting a stage takes its subjects with it (ON DELETE CASCADE), same as
-- the stage itself disappearing when its company does.
--
-- school.semesters: company-wide, no relation to levels/subjects. Minimal
-- shape (name + optional date range + active flag) — expected to be refined
-- once the real School feature set is designed.
--
-- Applied automatically at runtime by ensureSchoolSubjectsSchema() /
-- ensureSchoolSemestersSchema() in aws/lambda/api/src/routes/school-subjects.ts
-- and school-semesters.ts — kept here for fresh installs and for running
-- explicitly via the RDS Data API. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS school.subjects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    level_id UUID NOT NULL REFERENCES school.levels(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_school_subjects_company_id ON school.subjects(company_id);
CREATE INDEX IF NOT EXISTS idx_school_subjects_level_id ON school.subjects(level_id);

CREATE TABLE IF NOT EXISTS school.semesters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_school_semesters_company_id ON school.semesters(company_id);
