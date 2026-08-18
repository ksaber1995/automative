-- Phase 5 of the online-exams feature (see online_exams.md §0.5): student
-- credentials for the exam portal at exams.netrofit.com.
--
-- Credentials live in their OWN table, never as columns on `students`:
-- routes/students.ts reads `SELECT s.*` / `SELECT * FROM students` in seven
-- places, so a password_hash column there would be serialised into staff API
-- responses sooner or later. A separate table cannot leak that way.
--
-- The API applies this idempotently at runtime (ensureStudentAuthSchema in
-- aws/lambda/api/src/routes/student-auth.ts), so deploying the API is enough;
-- this file is the equivalent for fresh installs.

CREATE TABLE IF NOT EXISTS student_auth (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id    UUID NOT NULL UNIQUE REFERENCES students(id)  ON DELETE CASCADE,
    company_id    UUID NOT NULL        REFERENCES companies(id) ON DELETE CASCADE,
    -- What the student types to sign in. A phone number IS a valid username —
    -- "username or phone" is one field, not two, so there is one unique index
    -- and one lookup. Stored lower-cased; anything phone-shaped is canonicalised
    -- first (digits only, country code and leading zero stripped), so
    -- 01001234567 and +201001234567 can't become two accounts.
    username      VARCHAR(60)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,       -- bcryptjs, cost 10, as everywhere else
    -- Lockout, so a guessable student username isn't a free brute-force target.
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until  TIMESTAMP WITH TIME ZONE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    -- Audit of the card scans that created and last reset this credential. The
    -- teacher sees these: an unexpected reset is the only visible symptom of a
    -- lost or borrowed card.
    claimed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reset_at      TIMESTAMP WITH TIME ZONE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- GLOBALLY unique, not per company: the portal is one hostname with one login
-- form, so "ahmed" has to resolve to exactly one student. Collisions are handled
-- at claim time ("that name is taken, pick another"), which is why the student
-- chooses the name rather than being assigned one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_auth_username ON student_auth(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_student_auth_company ON student_auth(company_id);

DROP TRIGGER IF EXISTS update_student_auth_updated_at ON student_auth;
CREATE TRIGGER update_student_auth_updated_at BEFORE UPDATE ON student_auth
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
