-- Migration 003: Migrate Existing Data
-- Description: Creates a default company for any existing data and links all records to it
-- This script is safe to run even if there's no existing data

DO $$
DECLARE
    default_company_id UUID;
    existing_data_count INTEGER;
BEGIN
    -- Check if there's any existing data in the database
    SELECT COUNT(*) INTO existing_data_count FROM branches;

    IF existing_data_count > 0 THEN
        RAISE NOTICE 'Found % existing branches. Creating default company for migration...', existing_data_count;

        -- Create a default company for existing data
        INSERT INTO companies (
            name,
            code,
            email,
            subscription_tier,
            subscription_status,
            onboarding_completed,
            is_active,
            max_branches,
            max_users
        ) VALUES (
            'Legacy Company (Migrated)',
            'LEGACY-001',
            'admin@legacy.com',
            'ENTERPRISE',  -- Give existing company enterprise tier
            'ACTIVE',
            true,  -- Mark as already onboarded
            true,
            100,   -- No limits for migrated company
            1000
        ) RETURNING id INTO default_company_id;

        RAISE NOTICE 'Created default company with ID: %', default_company_id;

        -- Update all existing records with the default company_id
        -- Order matters due to foreign key dependencies

        UPDATE branches SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % branches', (SELECT COUNT(*) FROM branches WHERE company_id = default_company_id);

        UPDATE users SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % users', (SELECT COUNT(*) FROM users WHERE company_id = default_company_id);

        UPDATE courses SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % courses', (SELECT COUNT(*) FROM courses WHERE company_id = default_company_id);

        UPDATE classes SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % classes', (SELECT COUNT(*) FROM classes WHERE company_id = default_company_id);

        UPDATE students SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % students', (SELECT COUNT(*) FROM students WHERE company_id = default_company_id);

        UPDATE enrollments SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % enrollments', (SELECT COUNT(*) FROM enrollments WHERE company_id = default_company_id);

        UPDATE employees SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % employees', (SELECT COUNT(*) FROM employees WHERE company_id = default_company_id);

        UPDATE revenues SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % revenues', (SELECT COUNT(*) FROM revenues WHERE company_id = default_company_id);

        UPDATE expenses SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % expenses', (SELECT COUNT(*) FROM expenses WHERE company_id = default_company_id);

        UPDATE withdrawals SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % withdrawals', (SELECT COUNT(*) FROM withdrawals WHERE company_id = default_company_id);

        UPDATE debts SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % debts', (SELECT COUNT(*) FROM debts WHERE company_id = default_company_id);

        UPDATE products SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % products', (SELECT COUNT(*) FROM products WHERE company_id = default_company_id);

        UPDATE product_sales SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % product_sales', (SELECT COUNT(*) FROM product_sales WHERE company_id = default_company_id);

        UPDATE cash_state SET company_id = default_company_id WHERE company_id IS NULL;
        RAISE NOTICE 'Updated % cash_state records', (SELECT COUNT(*) FROM cash_state WHERE company_id = default_company_id);

        RAISE NOTICE 'Successfully migrated all existing data to default company';

    ELSE
        RAISE NOTICE 'No existing data found. Skipping migration.';
    END IF;

END $$;

-- Verify migration success
DO $$
DECLARE
    null_count INTEGER;
    table_name TEXT;
    tables TEXT[] := ARRAY['branches', 'users', 'courses', 'classes', 'students', 'enrollments',
                           'employees', 'revenues', 'expenses', 'withdrawals', 'debts',
                           'products', 'product_sales', 'cash_state'];
BEGIN
    RAISE NOTICE '=== Verification: Checking for NULL company_id values ===';

    FOREACH table_name IN ARRAY tables
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I WHERE company_id IS NULL', table_name) INTO null_count;
        IF null_count > 0 THEN
            RAISE WARNING 'Found % rows with NULL company_id in table: %', null_count, table_name;
        ELSE
            RAISE NOTICE '✓ Table % - all rows have company_id', table_name;
        END IF;
    END LOOP;

    RAISE NOTICE '=== Verification complete ===';
END $$;
