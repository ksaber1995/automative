-- Migration 002: Add company_id to All Tables
-- Description: Links all tables to companies for proper multi-tenant data isolation

-- =============================================
-- Add company_id column to all tables
-- =============================================

-- 1. BRANCHES TABLE (Critical: Links companies to branches)
ALTER TABLE branches
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_branches_company_id ON branches(company_id);
COMMENT ON COLUMN branches.company_id IS 'Company that owns this branch';

-- 2. USERS TABLE
ALTER TABLE users
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_users_company_id ON users(company_id);
COMMENT ON COLUMN users.company_id IS 'Company the user belongs to';

-- 3. COURSES TABLE
ALTER TABLE courses
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_courses_company_id ON courses(company_id);

-- Update unique constraint to be company-scoped
ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_branch_id_code_key;
ALTER TABLE courses ADD CONSTRAINT courses_company_id_code_key UNIQUE(company_id, code);
COMMENT ON COLUMN courses.company_id IS 'Company that owns this course';

-- 4. CLASSES TABLE
ALTER TABLE classes
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_classes_company_id ON classes(company_id);

-- Update unique constraint to be company-scoped
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_branch_id_code_key;
ALTER TABLE classes ADD CONSTRAINT classes_company_id_code_key UNIQUE(company_id, code);
COMMENT ON COLUMN classes.company_id IS 'Company that owns this class';

-- 5. STUDENTS TABLE
ALTER TABLE students
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_students_company_id ON students(company_id);
COMMENT ON COLUMN students.company_id IS 'Company the student belongs to';

-- 6. ENROLLMENTS TABLE
ALTER TABLE enrollments
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_enrollments_company_id ON enrollments(company_id);
COMMENT ON COLUMN enrollments.company_id IS 'Company this enrollment belongs to';

-- 7. EMPLOYEES TABLE
ALTER TABLE employees
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_employees_company_id ON employees(company_id);
COMMENT ON COLUMN employees.company_id IS 'Company the employee works for';

-- 8. REVENUES TABLE
ALTER TABLE revenues
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_revenues_company_id ON revenues(company_id);
COMMENT ON COLUMN revenues.company_id IS 'Company this revenue belongs to';

-- 9. EXPENSES TABLE
ALTER TABLE expenses
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_expenses_company_id ON expenses(company_id);
COMMENT ON COLUMN expenses.company_id IS 'Company this expense belongs to';

-- 10. WITHDRAWALS TABLE
ALTER TABLE withdrawals
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_withdrawals_company_id ON withdrawals(company_id);
COMMENT ON COLUMN withdrawals.company_id IS 'Company this withdrawal belongs to';

-- 11. DEBTS TABLE
ALTER TABLE debts
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_debts_company_id ON debts(company_id);
COMMENT ON COLUMN debts.company_id IS 'Company this debt belongs to';

-- 12. PRODUCTS TABLE
ALTER TABLE products
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_products_company_id ON products(company_id);

-- Update unique constraint to be company-scoped
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_branch_id_code_key;
ALTER TABLE products ADD CONSTRAINT products_company_id_code_key UNIQUE(company_id, code);

-- Update CHECK constraint for global products
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_check;
ALTER TABLE products ADD CONSTRAINT products_check
    CHECK ((is_global = true AND branch_id IS NULL AND company_id IS NOT NULL)
        OR (is_global = false AND branch_id IS NOT NULL AND company_id IS NOT NULL));

COMMENT ON COLUMN products.company_id IS 'Company that owns this product';

-- 13. PRODUCT_SALES TABLE
ALTER TABLE product_sales
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_product_sales_company_id ON product_sales(company_id);
COMMENT ON COLUMN product_sales.company_id IS 'Company this sale belongs to';

-- 14. CASH_STATE TABLE (becomes company-specific instead of global)
ALTER TABLE cash_state
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX idx_cash_state_company_id ON cash_state(company_id);
COMMENT ON COLUMN cash_state.company_id IS 'Company this cash state belongs to';

-- Note: debt_payments table inherits company_id through its foreign key to debts table
-- No need to add company_id directly to debt_payments
