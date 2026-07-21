-- The room a class is scheduled in, chosen when the class is set up.
--
-- Sessions keep their own room_id: that is where the class ACTUALLY ran on a
-- given day, which can differ from the plan. The timetable shows the session's
-- room when there is one and falls back to this.
--
-- ON DELETE SET NULL so retiring a room never takes classes with it.
--
-- Applied idempotently at runtime by ensureClassStatusColumns() in
-- aws/lambda/api/src/routes/classes.ts; this file is the equivalent for fresh
-- installs and for running by hand.

ALTER TABLE classes ADD COLUMN IF NOT EXISTS room_id UUID;
CREATE INDEX IF NOT EXISTS idx_classes_room_id ON classes(room_id);

DO $$
BEGIN
  IF to_regclass('public.rooms') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_room_id_fkey') THEN
    ALTER TABLE classes
      ADD CONSTRAINT classes_room_id_fkey
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;
  END IF;
END $$;
