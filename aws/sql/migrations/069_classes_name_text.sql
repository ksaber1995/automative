-- 069: let a class name be any length.
--
-- classes.name was VARCHAR(255). Anything longer came back from Postgres as
-- 22001, which mapClassDbError() in routes/classes.ts turns into
-- ERRORS.CLASSES.VALUE_TOO_LONG ("The class name is too long") — the only thing
-- rejecting long names. Nothing else caps it: CreateClassSchema/UpdateClassSchema
-- use a bare z.string(), the form only validates minLength(2), and no other
-- table denormalises the name.
--
-- TEXT has no length limit and performs identically to VARCHAR in Postgres, and
-- varchar->text is binary-coercible so this needs no table rewrite.
--
-- Safe and idempotent. Widening only — no existing value can fail to fit.
-- Note it is not cleanly reversible once a name over 255 chars exists.

ALTER TABLE classes ALTER COLUMN name TYPE TEXT;
