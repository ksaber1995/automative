-- ============================================================
-- Migration 035 – Exams & per-student grade recording
-- ============================================================
-- An exam belongs to a Course. It carries a name, a date and a status
-- (SCHEDULED -> DONE). Grades are recorded one-per-student-per-exam, typically
-- by scanning the student's QR code (students.qr_token). A student may be graded
-- only if enrolled in the exam's course in ANY class (enforced in the API).
--
-- Idempotent (IF NOT EXISTS guards). Branch_id/company_id are denormalised from
-- the course for fast, branch-scoped listing.
-- ============================================================

-- ------------------------------------------------------------
-- 1. exams
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
    course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    exam_date   DATE NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED'
                  CHECK (status IN ('SCHEDULED', 'DONE')),
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exams_company   ON exams(company_id);
CREATE INDEX IF NOT EXISTS idx_exams_branch    ON exams(branch_id);
CREATE INDEX IF NOT EXISTS idx_exams_course    ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date);

-- ------------------------------------------------------------
-- 2. exam_results  (one grade per student per exam)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_results (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id   UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    student_id  UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
    grade       VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_results_exam    ON exam_results(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_student ON exam_results(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_results_company ON exam_results(company_id);

-- ------------------------------------------------------------
-- 3. updated_at triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS update_exams_updated_at ON exams;
CREATE TRIGGER update_exams_updated_at
    BEFORE UPDATE ON exams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_exam_results_updated_at ON exam_results;
CREATE TRIGGER update_exam_results_updated_at
    BEFORE UPDATE ON exam_results
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
