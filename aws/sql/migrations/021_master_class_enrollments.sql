-- Migration 021: Create master_class_enrollments table
-- Tracks which specific class a student attends within a master enrollment bundle.

CREATE TABLE IF NOT EXISTS master_class_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    master_enrollment_id UUID NOT NULL REFERENCES master_enrollments(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    enrolled_at DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'DROPPED')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mce_master_enrollment ON master_class_enrollments(master_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_mce_student ON master_class_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_mce_class ON master_class_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_mce_company ON master_class_enrollments(company_id);

CREATE TRIGGER update_master_class_enrollments_updated_at
    BEFORE UPDATE ON master_class_enrollments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
