#!/bin/bash

# RDS Data API Migration Runner
# Runs migrations using AWS RDS Data API

set -e

CLUSTER_ARN="arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-nmlmuhgtiaqh"
SECRET_ARN="arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-qJtTxN"
DATABASE="automative"
PROFILE="personal"

echo "Running Multi-Tenant Migrations via RDS Data API..."
echo ""

# Function to execute SQL
execute_sql() {
    local sql="$1"
    local description="$2"
    echo "→ $description"
    aws rds-data execute-statement \
        --resource-arn "$CLUSTER_ARN" \
        --secret-arn "$SECRET_ARN" \
        --database "$DATABASE" \
        --sql "$sql" \
        --profile "$PROFILE" \
        --output json > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        echo "  ✓ Success"
    else
        echo "  ✗ Failed"
        return 1
    fi
}

echo "Migration 002: Adding company_id columns..."
echo ""

# Add company_id to branches
execute_sql "ALTER TABLE branches ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to branches"

# Add company_id to users
execute_sql "ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to users"

# Add company_id to courses
execute_sql "ALTER TABLE courses ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to courses"

# Add company_id to classes
execute_sql "ALTER TABLE classes ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to classes"

# Add company_id to students
execute_sql "ALTER TABLE students ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to students"

# Add company_id to enrollments
execute_sql "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to enrollments"

# Add company_id to employees
execute_sql "ALTER TABLE employees ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to employees"

# Add company_id to expenses
execute_sql "ALTER TABLE expenses ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to expenses"

# Add company_id to withdrawals
execute_sql "ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to withdrawals"

# Add company_id to debts (if table exists)
execute_sql "ALTER TABLE IF EXISTS debts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to debts"

# Add company_id to products
execute_sql "ALTER TABLE products ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to products"

# Add company_id to product_sales
execute_sql "ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to product_sales"

# Add company_id to cash_state (if table exists)
execute_sql "ALTER TABLE IF EXISTS cash_state ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id) ON DELETE CASCADE;" "Add company_id to cash_state"

echo ""
echo "Migration 003: Migrating existing data..."
echo ""

# Create default company if data exists
execute_sql "DO \$\$ DECLARE default_company_id UUID; BEGIN IF EXISTS (SELECT 1 FROM branches LIMIT 1) THEN IF NOT EXISTS (SELECT 1 FROM companies WHERE code = 'LEGACY-001') THEN INSERT INTO companies (name, code, email, subscription_tier, subscription_status, onboarding_completed, is_active) VALUES ('Legacy Company (Migrated)', 'LEGACY-001', 'admin@legacy.com', 'ENTERPRISE', 'ACTIVE', true, true) RETURNING id INTO default_company_id; ELSE SELECT id INTO default_company_id FROM companies WHERE code = 'LEGACY-001'; END IF; UPDATE branches SET company_id = default_company_id WHERE company_id IS NULL; UPDATE users SET company_id = default_company_id WHERE company_id IS NULL; UPDATE courses SET company_id = default_company_id WHERE company_id IS NULL; UPDATE classes SET company_id = default_company_id WHERE company_id IS NULL; UPDATE students SET company_id = default_company_id WHERE company_id IS NULL; UPDATE enrollments SET company_id = default_company_id WHERE company_id IS NULL; UPDATE employees SET company_id = default_company_id WHERE company_id IS NULL; UPDATE expenses SET company_id = default_company_id WHERE company_id IS NULL; UPDATE withdrawals SET company_id = default_company_id WHERE company_id IS NULL; UPDATE products SET company_id = default_company_id WHERE company_id IS NULL; UPDATE product_sales SET company_id = default_company_id WHERE company_id IS NULL; END IF; END \$\$;" "Migrate existing data to default company"

echo ""
echo "Migration 004: Enforcing NOT NULL constraints..."
echo ""

# Make company_id NOT NULL on all tables
execute_sql "ALTER TABLE branches ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on branches"
execute_sql "ALTER TABLE users ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on users"
execute_sql "ALTER TABLE courses ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on courses"
execute_sql "ALTER TABLE classes ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on classes"
execute_sql "ALTER TABLE students ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on students"
execute_sql "ALTER TABLE enrollments ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on enrollments"
execute_sql "ALTER TABLE employees ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on employees"
execute_sql "ALTER TABLE expenses ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on expenses"
execute_sql "ALTER TABLE withdrawals ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on withdrawals"
execute_sql "ALTER TABLE products ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on products"
execute_sql "ALTER TABLE product_sales ALTER COLUMN company_id SET NOT NULL;" "Enforce NOT NULL on product_sales"

echo ""
echo "✅ All migrations completed successfully!"
echo ""
echo "Verifying migration..."
execute_sql "SELECT COUNT(*) FROM companies;" "Count companies"

echo ""
echo "Migration complete! Database is ready for multi-tenant operation."
