-- =============================================================================
-- 094 — Educational Stages for SCHOOL tenants: a new `school.levels` table
--
-- A SCHOOL-type company (migration 093) files its grade/class-year ladder
-- under "Educational Stages", never "Levels" — that's academy vocabulary and
-- carries an age range a school's ladder doesn't need. Rather than overload
-- the existing `levels` table with a school-specific shape, this is a
-- deliberately separate table, and — a first for this codebase — deliberately
-- lives in its OWN Postgres schema (`school`) rather than `public`. The
-- starting shape mirrors `levels` minimally (id/company_id/name/timestamps,
-- no age columns) and is expected to diverge further once the real School
-- feature set is designed — hence starting in its own namespace instead of
-- wedged into an existing table.
--
-- Every query against this table MUST schema-qualify it (`school.levels`) —
-- the connection pool sets no custom `search_path`, so a bare `levels`
-- reference resolves to `public.levels`, not this table.
--
-- Applied automatically at runtime by ensureSchoolLevelsSchema() in
-- aws/lambda/api/src/routes/school-levels.ts — kept here for fresh installs
-- and for running explicitly via the RDS Data API. Idempotent.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS school;

CREATE TABLE IF NOT EXISTS school.levels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_school_levels_company_id ON school.levels(company_id);
