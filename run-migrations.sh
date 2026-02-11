#!/bin/bash

# Multi-Tenant Migration Runner
# Runs all migration files in the correct order with verification

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Database connection (override with environment variables)
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-automate_magic}"
DB_USER="${DB_USER:-postgres}"

MIGRATION_DIR="aws/sql/migrations"

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}Multi-Tenant Migration Runner${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""

# Check if migration directory exists
if [ ! -d "$MIGRATION_DIR" ]; then
    echo -e "${RED}Error: Migration directory not found: $MIGRATION_DIR${NC}"
    exit 1
fi

# Function to run SQL file
run_migration() {
    local file=$1
    local description=$2

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$description${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Running: $file${NC}"

    if [ ! -f "$file" ]; then
        echo -e "${RED}✗ File not found: $file${NC}"
        return 1
    fi

    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$file"; then
        echo -e "${GREEN}✓ Migration successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Migration failed${NC}"
        return 1
    fi
}

# Function to prompt for confirmation
confirm() {
    local prompt=$1
    echo ""
    echo -e "${YELLOW}$prompt${NC}"
    read -p "Type 'yes' to continue: " confirmation
    if [ "$confirmation" != "yes" ]; then
        echo -e "${RED}Aborted.${NC}"
        exit 1
    fi
}

# Check database connection
echo -e "${YELLOW}Testing database connection...${NC}"
if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Connected to: $DB_NAME@$DB_HOST${NC}"
else
    echo -e "${RED}✗ Cannot connect to database${NC}"
    echo "Please check your database credentials and connection settings."
    exit 1
fi

# Warning message
echo ""
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${RED}⚠  WARNING: DATABASE MIGRATION${NC}"
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "This will modify your database schema by:"
echo "  1. Creating a new 'companies' table"
echo "  2. Adding 'company_id' columns to 14 existing tables"
echo "  3. Migrating existing data to a default company"
echo "  4. Enforcing NOT NULL constraints on company_id"
echo ""
echo -e "${YELLOW}IMPORTANT:${NC}"
echo "  • This is a BREAKING CHANGE"
echo "  • All existing JWT tokens will become invalid"
echo "  • Users must re-login after deployment"
echo "  • Estimated time: 5-15 minutes"
echo ""
echo -e "${YELLOW}BEFORE PROCEEDING:${NC}"
echo "  • Create a full database backup"
echo "  • Test in staging environment first"
echo "  • Schedule maintenance window"
echo "  • Notify users of downtime"
echo ""

confirm "⚠  Have you created a database backup?"

# Migration files
MIGRATION_001="$MIGRATION_DIR/001_create_companies_table.sql"
MIGRATION_002="$MIGRATION_DIR/002_add_company_id_to_all_tables.sql"
MIGRATION_003="$MIGRATION_DIR/003_migrate_existing_data.sql"
MIGRATION_004="$MIGRATION_DIR/004_enforce_company_id_constraints.sql"

# Run migrations
echo ""
echo -e "${BLUE}Starting multi-tenant migration...${NC}"

# Migration 001: Create companies table
if ! run_migration "$MIGRATION_001" "Migration 001: Create Companies Table"; then
    echo -e "${RED}Failed at migration 001. Stopping.${NC}"
    exit 1
fi

# Verify companies table
COMPANIES_EXISTS=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'companies')")
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    echo -e "${GREEN}✓ Verified: companies table created${NC}"
else
    echo -e "${RED}✗ Verification failed: companies table not found${NC}"
    exit 1
fi

# Migration 002: Add company_id columns
if ! run_migration "$MIGRATION_002" "Migration 002: Add company_id Columns"; then
    echo -e "${RED}Failed at migration 002. Stopping.${NC}"
    exit 1
fi

# Verify company_id columns added
echo -e "${YELLOW}Verifying company_id columns...${NC}"
COLUMNS_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.columns WHERE column_name = 'company_id'")
COLUMNS_COUNT=$(echo $COLUMNS_COUNT | xargs)
echo -e "${GREEN}✓ Found company_id column in $COLUMNS_COUNT tables${NC}"

# Migration 003: Migrate existing data
if ! run_migration "$MIGRATION_003" "Migration 003: Migrate Existing Data"; then
    echo -e "${RED}Failed at migration 003. Stopping.${NC}"
    exit 1
fi

# Verify data migration
COMPANY_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM companies")
COMPANY_COUNT=$(echo $COMPANY_COUNT | xargs)
echo -e "${GREEN}✓ Companies created: $COMPANY_COUNT${NC}"

# Check for NULL company_id values
echo -e "${YELLOW}Checking for NULL company_id values...${NC}"
TABLES=("branches" "users" "courses" "classes" "students" "enrollments" "employees" "expenses" "revenues" "withdrawals" "debts" "products" "product_sales" "cash_state")
HAS_NULLS=false

for table in "${TABLES[@]}"; do
    NULL_COUNT=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM $table WHERE company_id IS NULL" 2>/dev/null || echo "0")
    NULL_COUNT=$(echo $NULL_COUNT | xargs)

    if [ "$NULL_COUNT" -gt 0 ]; then
        echo -e "${RED}✗ $table: Found $NULL_COUNT rows with NULL company_id${NC}"
        HAS_NULLS=true
    else
        echo -e "${GREEN}✓ $table: No NULL values${NC}"
    fi
done

if [ "$HAS_NULLS" = true ]; then
    echo -e "${RED}Cannot proceed: Some tables have NULL company_id values${NC}"
    exit 1
fi

# Migration 004: Enforce NOT NULL constraints
if ! run_migration "$MIGRATION_004" "Migration 004: Enforce NOT NULL Constraints"; then
    echo -e "${RED}Failed at migration 004. Stopping.${NC}"
    exit 1
fi

# Final verification
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Final Verification${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Verify NOT NULL constraints
echo -e "${YELLOW}Verifying NOT NULL constraints...${NC}"
for table in "${TABLES[@]}"; do
    IS_NOT_NULL=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT is_nullable FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id'" 2>/dev/null || echo "YES")
    IS_NOT_NULL=$(echo $IS_NOT_NULL | xargs)

    if [ "$IS_NOT_NULL" = "NO" ]; then
        echo -e "${GREEN}✓ $table: company_id is NOT NULL${NC}"
    else
        echo -e "${RED}✗ $table: company_id is still nullable${NC}"
    fi
done

# Success message
echo ""
echo -e "${GREEN}==================================================${NC}"
echo -e "${GREEN}✓ MIGRATION COMPLETED SUCCESSFULLY${NC}"
echo -e "${GREEN}==================================================${NC}"
echo ""
echo "Migration summary:"
echo "  ✓ Companies table created"
echo "  ✓ company_id columns added to all tables"
echo "  ✓ Existing data migrated"
echo "  ✓ NOT NULL constraints enforced"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Run verification script: ./verify-database.sh"
echo "  2. Deploy updated backend API"
echo "  3. Deploy updated frontend"
echo "  4. Run multi-tenant tests: ./test-multi-tenant.sh"
echo "  5. Notify users to re-login"
echo ""
echo -e "${BLUE}For rollback instructions, see DEPLOYMENT_GUIDE.md${NC}"
echo ""
