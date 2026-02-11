#!/bin/bash

# Database Verification Script for Multi-Tenant Migration
# This script checks the database state before and after migration

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

echo -e "${BLUE}==================================================${NC}"
echo -e "${BLUE}Multi-Tenant Database Verification${NC}"
echo -e "${BLUE}==================================================${NC}"
echo ""

# Function to run SQL query
run_query() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "$1"
}

# Function to print section header
section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to print success
success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print warning
warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Function to print info
info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if database is accessible
section "1. Database Connection"
if run_query "SELECT 1" > /dev/null 2>&1; then
    success "Connected to database: $DB_NAME@$DB_HOST"
else
    error "Cannot connect to database. Check connection settings."
    exit 1
fi

# Check if companies table exists
section "2. Companies Table"
COMPANIES_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'companies')")
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    success "Companies table exists"

    COMPANY_COUNT=$(run_query "SELECT COUNT(*) FROM companies" | xargs)
    info "Total companies: $COMPANY_COUNT"

    if [ "$COMPANY_COUNT" -gt 0 ]; then
        echo "Companies:"
        run_query "SELECT id, name, code, subscription_tier, subscription_status FROM companies"
    fi
else
    warning "Companies table does not exist (migration not yet run)"
fi

# Check company_id column in all tables
section "3. Company ID Columns"
TABLES=("branches" "users" "courses" "classes" "students" "enrollments" "employees" "expenses" "revenues" "withdrawals" "debts" "products" "product_sales" "cash_state")

for table in "${TABLES[@]}"; do
    TABLE_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table')")
    if [[ $TABLE_EXISTS == *"t"* ]]; then
        COLUMN_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id')")
        if [[ $COLUMN_EXISTS == *"t"* ]]; then
            success "$table: company_id column exists"
        else
            warning "$table: company_id column MISSING"
        fi
    else
        info "$table: table does not exist"
    fi
done

# Check for NULL company_id values
section "4. NULL Company ID Check"
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    info "Checking for NULL company_id values..."

    for table in "${TABLES[@]}"; do
        TABLE_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table')")
        if [[ $TABLE_EXISTS == *"t"* ]]; then
            COLUMN_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id')")
            if [[ $COLUMN_EXISTS == *"t"* ]]; then
                NULL_COUNT=$(run_query "SELECT COUNT(*) FROM $table WHERE company_id IS NULL" | xargs)
                if [ "$NULL_COUNT" -eq 0 ]; then
                    success "$table: No NULL company_id values"
                else
                    error "$table: Found $NULL_COUNT rows with NULL company_id"
                fi
            fi
        fi
    done
else
    warning "Skipping NULL check (companies table not yet created)"
fi

# Check foreign key constraints
section "5. Foreign Key Constraints"
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    FK_COUNT=$(run_query "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND constraint_name LIKE '%company_id%'" | xargs)

    if [ "$FK_COUNT" -gt 0 ]; then
        success "Found $FK_COUNT company_id foreign key constraints"
        echo "Foreign keys:"
        run_query "SELECT table_name, constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND constraint_name LIKE '%company_id%' ORDER BY table_name"
    else
        warning "No company_id foreign key constraints found"
    fi
else
    warning "Skipping foreign key check (companies table not yet created)"
fi

# Check indexes
section "6. Indexes on company_id"
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    INDEX_COUNT=$(run_query "SELECT COUNT(*) FROM pg_indexes WHERE indexname LIKE '%company_id%'" | xargs)

    if [ "$INDEX_COUNT" -gt 0 ]; then
        success "Found $INDEX_COUNT indexes on company_id"
        echo "Indexes:"
        run_query "SELECT tablename, indexname FROM pg_indexes WHERE indexname LIKE '%company_id%' ORDER BY tablename"
    else
        warning "No indexes found on company_id columns"
    fi
else
    warning "Skipping index check (companies table not yet created)"
fi

# Check unique constraints
section "7. Unique Constraints"
if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    info "Checking company-scoped unique constraints..."

    # Check courses unique constraint
    COURSES_CONSTRAINT=$(run_query "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_company_id_code_key')")
    if [[ $COURSES_CONSTRAINT == *"t"* ]]; then
        success "courses: company_id + code unique constraint exists"
    else
        warning "courses: company-scoped unique constraint MISSING"
    fi

    # Check classes unique constraint
    CLASSES_CONSTRAINT=$(run_query "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_company_id_code_key')")
    if [[ $CLASSES_CONSTRAINT == *"t"* ]]; then
        success "classes: company_id + code unique constraint exists"
    else
        warning "classes: company-scoped unique constraint MISSING"
    fi

    # Check products unique constraint
    PRODUCTS_CONSTRAINT=$(run_query "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_company_id_code_key')")
    if [[ $PRODUCTS_CONSTRAINT == *"t"* ]]; then
        success "products: company_id + code unique constraint exists"
    else
        warning "products: company-scoped unique constraint MISSING"
    fi
else
    warning "Skipping unique constraint check (companies table not yet created)"
fi

# Check data distribution by company
section "8. Data Distribution by Company"
if [[ $COMPANIES_EXISTS == *"t"* ]] && [ "$COMPANY_COUNT" -gt 0 ]; then
    info "Records per company:"

    for table in "${TABLES[@]}"; do
        TABLE_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table')")
        COLUMN_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id')")

        if [[ $TABLE_EXISTS == *"t"* ]] && [[ $COLUMN_EXISTS == *"t"* ]]; then
            echo ""
            echo -e "${YELLOW}$table:${NC}"
            run_query "SELECT c.name as company, COUNT(*) as records FROM $table t JOIN companies c ON c.id = t.company_id GROUP BY c.name ORDER BY c.name"
        fi
    done
else
    warning "Skipping data distribution check (no companies exist)"
fi

# Summary
section "9. Migration Status"

if [[ $COMPANIES_EXISTS == *"t"* ]]; then
    success "Companies table created ✓"

    # Count how many tables have company_id
    TABLES_WITH_COMPANY_ID=0
    for table in "${TABLES[@]}"; do
        TABLE_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table')")
        COLUMN_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id')")
        if [[ $TABLE_EXISTS == *"t"* ]] && [[ $COLUMN_EXISTS == *"t"* ]]; then
            TABLES_WITH_COMPANY_ID=$((TABLES_WITH_COMPANY_ID + 1))
        fi
    done

    if [ "$TABLES_WITH_COMPANY_ID" -eq "${#TABLES[@]}" ]; then
        success "All tables have company_id column ✓"
    else
        warning "$TABLES_WITH_COMPANY_ID/${#TABLES[@]} tables have company_id column"
    fi

    # Check for NULL values
    TABLES_WITH_NULLS=0
    for table in "${TABLES[@]}"; do
        TABLE_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '$table')")
        COLUMN_EXISTS=$(run_query "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = '$table' AND column_name = 'company_id')")
        if [[ $TABLE_EXISTS == *"t"* ]] && [[ $COLUMN_EXISTS == *"t"* ]]; then
            NULL_COUNT=$(run_query "SELECT COUNT(*) FROM $table WHERE company_id IS NULL" | xargs)
            if [ "$NULL_COUNT" -gt 0 ]; then
                TABLES_WITH_NULLS=$((TABLES_WITH_NULLS + 1))
            fi
        fi
    done

    if [ "$TABLES_WITH_NULLS" -eq 0 ]; then
        success "No NULL company_id values ✓"
        echo ""
        echo -e "${GREEN}==================================================${NC}"
        echo -e "${GREEN}✓ MIGRATION SUCCESSFUL${NC}"
        echo -e "${GREEN}All checks passed. Database is ready for multi-tenant operation.${NC}"
        echo -e "${GREEN}==================================================${NC}"
    else
        error "$TABLES_WITH_NULLS tables have NULL company_id values"
        echo ""
        echo -e "${RED}==================================================${NC}"
        echo -e "${RED}✗ MIGRATION INCOMPLETE${NC}"
        echo -e "${RED}Please run migration 003 to populate company_id values.${NC}"
        echo -e "${RED}==================================================${NC}"
    fi
else
    warning "Migration not yet started"
    echo ""
    echo -e "${YELLOW}==================================================${NC}"
    echo -e "${YELLOW}⚠ MIGRATION NEEDED${NC}"
    echo -e "${YELLOW}Run the following migration files in order:${NC}"
    echo -e "${YELLOW}1. 001_create_companies_table.sql${NC}"
    echo -e "${YELLOW}2. 002_add_company_id_to_all_tables.sql${NC}"
    echo -e "${YELLOW}3. 003_migrate_existing_data.sql${NC}"
    echo -e "${YELLOW}4. 004_enforce_company_id_constraints.sql${NC}"
    echo -e "${YELLOW}==================================================${NC}"
fi

echo ""
