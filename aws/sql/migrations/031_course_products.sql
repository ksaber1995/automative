-- 031_course_products.sql
-- Educational Books = course-linked products. A course can link one or more
-- products (usually books); a sale can be attributed to a student/course/enrollment
-- so we can show "who bought / who didn't" per course. Reuses product_sales.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS course_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    course_id  UUID NOT NULL REFERENCES courses(id)  ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT true,
    default_discount_type  VARCHAR(20) NOT NULL DEFAULT 'NONE' CHECK (default_discount_type IN ('NONE', 'PERCENTAGE', 'FIXED_AMOUNT')),
    default_discount_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
    added_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT course_products_course_product_key UNIQUE (course_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_course_products_course  ON course_products(course_id);
CREATE INDEX IF NOT EXISTS idx_course_products_product ON course_products(product_id);
CREATE INDEX IF NOT EXISTS idx_course_products_company ON course_products(company_id);

ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS student_id UUID REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE SET NULL;
ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS enrollment_id UUID REFERENCES enrollments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_sales_student    ON product_sales(student_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_course     ON product_sales(course_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_enrollment ON product_sales(enrollment_id);
