-- Migration 051: drop duration and max_students from courses.
-- Classes carry their own schedule length and max_students; the course-level
-- copies were never used for anything and only duplicated data entry.
ALTER TABLE courses DROP COLUMN IF EXISTS duration;
ALTER TABLE courses DROP COLUMN IF EXISTS max_students;
