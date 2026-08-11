-- =============================================================================
-- 089 — A percentage teacher can be paid a different rate per course
--
-- employees.percentage_rate is one number applied to everything the teacher
-- brings in. Real arrangements are not always one number: a teacher may take 90%
-- of one course and 80% of another, because the courses were negotiated
-- separately, or one of them uses the academy's materials and the other does not.
--
-- The global rate stays, and stays the answer for every course without a row
-- here. A row is an exception to it, not a replacement for it — so "X% of
-- everything" is still just the global rate with no rows, and a teacher on
-- mixed terms has one row per course that differs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS employee_course_percentages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    course_id       UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
    -- Same precision as employees.percentage_rate: 0.00–100.00.
    percentage_rate DECIMAL(5, 2) NOT NULL CHECK (percentage_rate >= 0 AND percentage_rate <= 100),
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    -- One rate per teacher per course. Two would make the payslip a coin toss.
    UNIQUE (employee_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_ecp_employee ON employee_course_percentages(employee_id);
CREATE INDEX IF NOT EXISTS idx_ecp_company  ON employee_course_percentages(company_id);
CREATE INDEX IF NOT EXISTS idx_ecp_course   ON employee_course_percentages(course_id);
