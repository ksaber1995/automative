-- =============================================================================
-- 096 — Classes for SCHOOL tenants: room + educational stage, nothing else
--
-- Continues migration 094/095's `school` schema. The academy `classes` table
-- is built around a course and a weekly schedule (start/end time, days of
-- week, timetable); a school's class is deliberately none of that — it's just
-- a name, which room it meets in, and which educational stage it belongs to
-- (one-to-many under school.levels, same as school.subjects). No course link,
-- no timetable.
--
-- room_id references the EXISTING company-wide `rooms` table (not a new
-- school-scoped one) — a school's rooms are the same physical rooms every
-- other feature already tracks. ON DELETE SET NULL: a room being retired
-- shouldn't take the class down with it, unlike level_id's CASCADE (a class
-- has no meaning once its stage is gone).
--
-- Applied automatically at runtime by ensureSchoolClassesSchema() in
-- aws/lambda/api/src/routes/school-classes.ts — kept here for fresh installs
-- and for running explicitly via the RDS Data API. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS school.classes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    level_id UUID NOT NULL REFERENCES school.levels(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_school_classes_company_id ON school.classes(company_id);
CREATE INDEX IF NOT EXISTS idx_school_classes_level_id ON school.classes(level_id);
CREATE INDEX IF NOT EXISTS idx_school_classes_room_id ON school.classes(room_id);
