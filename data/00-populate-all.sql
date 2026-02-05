-- Master Script to Populate All Tables
-- Run this script to populate the entire database with sample data
--
-- IMPORTANT: Run the schema first (aws/sql/schema.sql) before running this script
--
-- Order of execution respects foreign key dependencies:
-- 1. Branches (no dependencies)
-- 2. Users (depends on branches)
-- 3. Courses (depends on branches)
-- 4. Classes (depends on courses and branches)
-- 5. Students (depends on branches)
-- 6. Enrollments (depends on students, classes, courses, branches)
-- 7. Employees (depends on branches)
-- 8. Revenues (depends on branches, courses, enrollments, students)
-- 9. Expenses (depends on branches)
-- 10. Products (depends on branches)
-- 11. Product Sales (depends on products and branches)
-- 12. Withdrawals (depends on branches and users)
-- 13. Debts (depends on branches)
-- 14. Debt Payments (depends on debts)

\echo 'Starting database population...'
\echo ''

\echo '1. Populating branches table...'
\i 01-branches.sql
\echo 'Branches: DONE'
\echo ''

\echo '2. Populating users table...'
\i 02-users.sql
\echo 'Users: DONE'
\echo ''

\echo '3. Populating courses table...'
\i 03-courses.sql
\echo 'Courses: DONE'
\echo ''

\echo '4. Populating classes table...'
\i 04-classes.sql
\echo 'Classes: DONE'
\echo ''

\echo '5. Populating students table...'
\i 05-students.sql
\echo 'Students: DONE'
\echo ''

\echo '6. Populating enrollments table...'
\i 06-enrollments.sql
\echo 'Enrollments: DONE'
\echo ''

\echo '7. Populating employees table...'
\i 07-employees.sql
\echo 'Employees: DONE'
\echo ''

\echo '8. Populating revenues table...'
\i 08-revenues.sql
\echo 'Revenues: DONE'
\echo ''

\echo '9. Populating expenses table...'
\i 09-expenses.sql
\echo 'Expenses: DONE'
\echo ''

\echo '10. Populating products table...'
\i 10-products.sql
\echo 'Products: DONE'
\echo ''

\echo '11. Populating product_sales table...'
\i 11-product-sales.sql
\echo 'Product Sales: DONE'
\echo ''

\echo '12. Populating withdrawals table...'
\i 12-withdrawals.sql
\echo 'Withdrawals: DONE'
\echo ''

\echo '13. Populating debts table...'
\i 13-debts.sql
\echo 'Debts: DONE'
\echo ''

\echo '14. Populating debt_payments table...'
\i 14-debt-payments.sql
\echo 'Debt Payments: DONE'
\echo ''

\echo '===================================='
\echo 'Database population completed successfully!'
\echo '===================================='
\echo ''
\echo 'Summary:'
\echo '- 3 Branches'
\echo '- 6 Users (1 admin, 3 branch managers, 2 accountants)'
\echo '- 9 Courses across all branches'
\echo '- 9 Classes scheduled'
\echo '- 17 Students (15 active, 2 churned)'
\echo '- 16 Enrollments'
\echo '- 14 Employees (3 global, 11 branch-specific)'
\echo '- 20+ Revenue transactions'
\echo '- 40+ Expense records (fixed, variable, shared)'
\echo '- 15 Products'
\echo '- 17 Product sales'
\echo '- 9 Withdrawal requests'
\echo '- 8 Debts (various statuses)'
\echo '- 12 Debt payment records'
\echo ''
