-- The day an enrollment landed in its CURRENT class.
--
-- change-class moves used to update class_id and nothing else, so the join-day
-- logic (enrollment-start.ts) kept reading enrollment_date — the day the student
-- joined the COURSE. Absence is derived (a lesson with no attendance row reads
-- as a miss from the join day on), so a moved student was marked absent for
-- every lesson the new class ran before they arrived.
--
-- NULL means the enrollment never moved: the join day falls back to
-- enrollment_date, which is exactly the old behavior. No backfill is possible —
-- there is no record of when historical moves happened; moving a student out
-- and back in (or setting this by hand) heals an already-affected enrollment.

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS class_joined_on DATE;
