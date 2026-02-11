-- Migration 004: Enforce company_id NOT NULL Constraints
-- Description: Makes company_id mandatory on all tables after data migration is complete
-- IMPORTANT: This should only be run after migration 003 has successfully populated all company_id values

-- Verify no NULL values before enforcing constraints
DO $$
DECLARE
    null_count INTEGER;
    table_name TEXT;
    tables TEXT[] := ARRAY['branches', 'users', 'courses', 'classes', 'students', 'enrollments',
                           'employees', 'revenues', 'expenses', 'withdrawals', 'debts',
                           'products', 'product_sales', 'cash_state'];
    total_nulls INTEGER := 0;
BEGIN
    RAISE NOTICE '=== Pre-constraint verification ===';

    FOREACH table_name IN ARRAY tables
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE company_id IS NULL', table_name) INTO null_count;
        IF null_count > 0 THEN
            RAISE WARNING 'Found % rows with NULL company_id in table: %', null_count, table_name;
            total_nulls := total_nulls + null_count;
        END IF;
    END LOOP;

    IF total_nulls > 0 THEN
        RAISE EXCEPTION 'Cannot enforce NOT NULL constraints: % rows still have NULL company_id. Run migration 003 first.', total_nulls;
    ELSE
        RAISE NOTICE '✓ All tables ready for NOT NULL constraints';
    END IF;
END $$;

-- Make company_id mandatory on all tables
ALTER TABLE branches ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE users ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE courses ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE classes ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE students ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE enrollments ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE employees ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE revenues ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE withdrawals ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE debts ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE product_sales ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE cash_state ALTER COLUMN company_id SET NOT NULL;

-- Update views to be company-aware
-- Drop existing views if they exist
DROP VIEW IF EXISTS revenue_summary_by_branch CASCADE;
DROP VIEW IF EXISTS expense_summary_by_branch CASCADE;
DROP VIEW IF EXISTS student_enrollment_stats CASCADE;

-- Create company-aware revenue summary view
CREATE VIEW revenue_summary_by_branch AS
SELECT
    c.id as company_id,
    c.name as company_name,
    b.id as branch_id,
    b.name as branch_name,
    DATE_TRUNC('month', r.date) as month,
    SUM(r.amount) as total_revenue,
    COUNT(r.id) as transaction_count
FROM companies c
JOIN branches b ON c.id = b.company_id
LEFT JOIN revenues r ON b.id = r.branch_id AND c.id = r.company_id
GROUP BY c.id, c.name, b.id, b.name, DATE_TRUNC('month', r.date);

COMMENT ON VIEW revenue_summary_by_branch IS 'Company and branch-scoped revenue summary';

-- Create company-aware expense summary view
CREATE VIEW expense_summary_by_branch AS
SELECT
    c.id as company_id,
    c.name as company_name,
    b.id as branch_id,
    b.name as branch_name,
    DATE_TRUNC('month', e.date) as month,
    e.type,
    e.category,
    SUM(e.amount) as total_expense,
    COUNT(e.id) as transaction_count
FROM companies c
JOIN branches b ON c.id = b.company_id
LEFT JOIN expenses e ON b.id = e.branch_id AND c.id = e.company_id
GROUP BY c.id, c.name, b.id, b.name, DATE_TRUNC('month', e.date), e.type, e.category;

COMMENT ON VIEW expense_summary_by_branch IS 'Company and branch-scoped expense summary';

-- Create company-aware student enrollment stats view
CREATE VIEW student_enrollment_stats AS
SELECT
    c.id as company_id,
    c.name as company_name,
    b.id as branch_id,
    b.name as branch_name,
    COUNT(DISTINCT s.id) as total_students,
    COUNT(DISTINCT CASE WHEN s.is_active = true THEN s.id END) as active_students,
    COUNT(DISTINCT CASE WHEN s.churn_date IS NOT NULL THEN s.id END) as churned_students,
    COUNT(DISTINCT e.id) as total_enrollments,
    COUNT(DISTINCT CASE WHEN e.status = 'ACTIVE' THEN e.id END) as active_enrollments
FROM companies c
JOIN branches b ON c.id = b.company_id
LEFT JOIN students s ON b.id = s.branch_id AND c.id = s.company_id
LEFT JOIN enrollments e ON s.id = e.student_id AND c.id = e.company_id
GROUP BY c.id, c.name, b.id, b.name;

COMMENT ON VIEW student_enrollment_stats IS 'Company and branch-scoped student and enrollment statistics';

-- Final verification
DO $$
BEGIN
    RAISE NOTICE '=== Migration 004 Complete ===';
    RAISE NOTICE 'company_id is now mandatory on all tables';
    RAISE NOTICE 'Views have been updated to be company-aware';
    RAISE NOTICE 'Multi-tenant data isolation is now enforced at the database level';
END $$;
