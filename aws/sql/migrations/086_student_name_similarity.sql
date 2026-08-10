-- =============================================================================
-- 086: find a student who is already on the books, by name
--
-- Backs the hint raised while a new student's name is typed. Two things make a
-- plain equality check useless here:
--
--   * Arabic spells one name several ways and staff type whichever comes to
--     hand — أحمد/احمد, فاطمة/فاطمه, مصطفى/مصطفي — with or without tashkeel or
--     a tatweel stretching a letter. So names are compared NORMALIZED: hamza
--     forms folded to bare alef, ة→ه, ى→ي, ؤ→و, ئ→ي, diacritics and tatweel
--     dropped, punctuation collapsed to single spaces, Latin lowercased.
--   * The same person gets entered with their words the other way round
--     ("دنيا حجازي" / "حجازي دنيا"), which character trigrams score far too low
--     to catch. The API compares sorted words for that case — exact, so it
--     cannot produce a false positive.
--
-- pg_trgm supplies the fuzzy tier on top (عمر / عمرو, ياسين / ياسمين). The
-- threshold lives in the API and was measured, not guessed: in the largest
-- tenant (2,015 students) 0.5 flags 13,302 pairs and 0.7 flags 787, and the
-- pairs below 0.7 are plainly different people (ياسين عبد الرحمن vs
-- ياسين عبد الحميد). A "shares two or more words" rule was tried and rejected —
-- عبد alone appears in enough names to flag 13,666 pairs.
--
-- The index is on the SAME normalized expression the query uses; every function
-- in it is IMMUTABLE, which is what makes it indexable at all.
--
-- Idempotent, and the API applies it at runtime too (ensureNameSearchSchema),
-- which also degrades gracefully: without pg_trgm the lookup still answers on
-- exact and reordered matches instead of failing.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_students_name_trgm
    ON students USING gin (
        (lower(btrim(regexp_replace(
            translate(name, 'أإآٱىةؤئـًٌٍَُِّْٰ', 'اااايهوي'),
            '[^[:alnum:]]+', ' ', 'g'))))
        gin_trgm_ops
    );
