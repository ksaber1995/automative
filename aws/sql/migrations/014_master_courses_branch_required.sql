-- Migration 014: Require branch_id on master_courses
--
-- Master courses are now always scoped to a specific branch. Any pre-existing
-- rows (possibly created before the branch-scope feature or for companies that
-- had zero branches at backfill time) are removed so the NOT NULL constraint
-- can be applied. Linked courses use FK `ON DELETE SET NULL`, so their
-- master_course_id is nulled and the courses themselves remain intact.

DELETE FROM master_courses;

ALTER TABLE master_courses
    ALTER COLUMN branch_id SET NOT NULL;
