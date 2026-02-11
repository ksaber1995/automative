#!/bin/bash

# Setup Script - Make all scripts executable

echo "Making scripts executable..."

chmod +x test-multi-tenant.sh
chmod +x verify-database.sh
chmod +x run-migrations.sh
chmod +x setup-scripts.sh

echo "✓ All scripts are now executable"
echo ""
echo "Available scripts:"
echo "  ./setup-scripts.sh      - Make all scripts executable (this script)"
echo "  ./verify-database.sh    - Verify database migration status"
echo "  ./run-migrations.sh     - Run all migration files in order"
echo "  ./test-multi-tenant.sh  - Test multi-tenant isolation"
echo ""
