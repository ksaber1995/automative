-- Migration 017: Master Enrollments
--
-- A master course is a bundle: students pay the bundle price once and then
-- enroll in any course inside the bundle without additional payment. This
-- table records the "paid for the bundle" fact per student.
--
-- Individual course enrollments (the `enrollments` table) that happen under
-- an active master enrollment carry `master_enrollment_id` pointing here, and
-- have `final_price = 0` / `payment_status = 'PAID'`.

CREATE TABLE IF NOT EXISTS master_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    master_course_id UUID NOT NULL REFERENCES master_courses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    enrollment_date DATE NOT NULL,
    amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50),
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_enrollments_student ON master_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_master_enrollments_master ON master_enrollments(master_course_id);
CREATE INDEX IF NOT EXISTS idx_master_enrollments_company ON master_enrollments(company_id);

-- At most one ACTIVE master enrollment per (student, master) pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_enrollments_active
    ON master_enrollments(student_id, master_course_id)
    WHERE status = 'ACTIVE';

ALTER TABLE enrollments
    ADD COLUMN IF NOT EXISTS master_enrollment_id UUID REFERENCES master_enrollments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_master_enrollment ON enrollments(master_enrollment_id);

CREATE TRIGGER update_master_enrollments_updated_at
    BEFORE UPDATE ON master_enrollments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
