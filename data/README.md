# Database Population Scripts

This folder contains SQL scripts to populate the Automate Magic database with sample data for development and testing.

## Overview

The scripts create realistic sample data including:
- **3 Branches**: Downtown (Cairo), Alexandria, Giza
- **6 Users**: Admin, branch managers, accountants
- **9 Courses**: Web dev, Python, Mobile apps, Design, Marketing, etc.
- **17 Students**: Enrolled across different branches
- **16 Enrollments**: Active, completed, and dropped statuses
- **14 Employees**: Global and branch-specific staff
- **Revenue & Expenses**: 3 months of financial transactions
- **Products & Sales**: Educational materials and accessories
- **Debts & Payments**: Realistic financial obligations

## Prerequisites

1. **Database Schema**: Run the schema first
   ```bash
   # Using AWS RDS Query Editor (Recommended)
   - Copy contents of aws/sql/schema.sql
   - Paste into Query Editor
   - Execute
   ```

2. **AWS Aurora Cluster**: Ensure your Aurora Serverless v2 database is running

## Quick Start

### Option 1: Using AWS RDS Query Editor (Easiest)

1. Go to [AWS RDS Console](https://console.aws.amazon.com/rds/)
2. Click **Query Editor** in the left sidebar
3. Connect to your database:
   - Cluster: `automatemagicstack-dev-automatemagicauroradbef2379-*`
   - Secret: `/dev/automate-magic/db-credentials`
   - Database: `automative`
4. Copy and paste the contents of `00-populate-all.sql`
5. Execute the script

### Option 2: Using psql Command Line

If you have psql installed and can connect to the database:

```bash
# From the data directory
psql -h YOUR-CLUSTER-ENDPOINT \
     -U automative_admin \
     -d automative \
     -f 00-populate-all.sql
```

### Option 3: Individual Scripts

Run each script in order (respecting dependencies):

```bash
psql ... -f 01-branches.sql
psql ... -f 02-users.sql
psql ... -f 03-courses.sql
# ... and so on
```

## Script Files

| File | Table | Dependencies | Records |
|------|-------|--------------|---------|
| `01-branches.sql` | branches | None | 3 |
| `02-users.sql` | users | branches | 6 |
| `03-courses.sql` | courses | branches | 9 |
| `04-classes.sql` | classes | courses, branches | 9 |
| `05-students.sql` | students | branches | 17 |
| `06-enrollments.sql` | enrollments | students, classes, courses, branches | 16 |
| `07-employees.sql` | employees | branches | 14 |
| `08-revenues.sql` | revenues | branches, courses, enrollments, students | 20+ |
| `09-expenses.sql` | expenses | branches | 40+ |
| `10-products.sql` | products | branches | 15 |
| `11-product-sales.sql` | product_sales | products, branches | 17 |
| `12-withdrawals.sql` | withdrawals | branches, users | 9 |
| `13-debts.sql` | debts | branches | 8 |
| `14-debt-payments.sql` | debt_payments | debts | 12 |

## Sample Data Details

### Users & Authentication
- **Email**: All users follow pattern `role.branch@automatemagic.com`
- **Password**: All users have password `password123` (hashed)
- **Roles**: ADMIN, BRANCH_MANAGER, ACCOUNTANT

#### Login Credentials:
```
Admin:
- Email: admin@automatemagic.com
- Password: password123

Downtown Manager:
- Email: manager.dt@automatemagic.com
- Password: password123

Alexandria Manager:
- Email: manager.alx@automatemagic.com
- Password: password123
```

### Branches
1. **Downtown Branch** (DT001) - Cairo
2. **Alexandria Branch** (ALX001) - Alexandria
3. **Giza Branch** (GZ001) - Giza

### Courses by Branch

**Downtown (Cairo)**:
- Web Development Basics (3,000 EGP)
- Advanced Python Programming (4,500 EGP)
- Mobile App Development (5,000 EGP)

**Alexandria**:
- Digital Marketing Essentials (2,500 EGP)
- Graphic Design Pro (3,500 EGP)
- UI/UX Design Masterclass (4,000 EGP)

**Giza**:
- Data Analytics with Excel (2,800 EGP)
- Cloud Computing AWS (5,500 EGP)
- Cybersecurity Basics (4,200 EGP)

### Financial Data

**Revenue Period**: January - March 2024
- Course enrollment payments
- Product sales
- Registration and material fees

**Expense Period**: January - March 2024
- Fixed: Rent, salaries, utilities
- Variable: Supplies, marketing, maintenance
- Shared: Company-wide marketing and software

**Payment Methods**: Bank Transfer, Cash, Credit Card, Check

## Testing Scenarios

After population, you can test:

1. **Authentication**
   - Login with different user roles
   - Test JWT token generation

2. **Branch Analytics**
   - Revenue by branch
   - Expense breakdown
   - Profit margins

3. **Student Management**
   - Active vs churned students
   - Enrollment statistics
   - Payment statuses

4. **Financial Reports**
   - Monthly revenue trends
   - Expense categories
   - Debt management
   - Product sales analysis

5. **Multi-branch Operations**
   - Cross-branch queries
   - Shared vs branch-specific expenses
   - Global employee allocation

## Verification Queries

Check if data was populated correctly:

```sql
-- Count records in each table
SELECT 'branches' AS table_name, COUNT(*) AS count FROM branches
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'courses', COUNT(*) FROM courses
UNION ALL
SELECT 'students', COUNT(*) FROM students
UNION ALL
SELECT 'enrollments', COUNT(*) FROM enrollments
UNION ALL
SELECT 'employees', COUNT(*) FROM employees
UNION ALL
SELECT 'revenues', COUNT(*) FROM revenues
UNION ALL
SELECT 'expenses', COUNT(*) FROM expenses
UNION ALL
SELECT 'products', COUNT(*) FROM products
UNION ALL
SELECT 'product_sales', COUNT(*) FROM product_sales
UNION ALL
SELECT 'withdrawals', COUNT(*) FROM withdrawals
UNION ALL
SELECT 'debts', COUNT(*) FROM debts
UNION ALL
SELECT 'debt_payments', COUNT(*) FROM debt_payments;

-- Check revenue by branch
SELECT b.name, SUM(r.amount) as total_revenue
FROM branches b
LEFT JOIN revenues r ON b.id = r.branch_id
GROUP BY b.name
ORDER BY total_revenue DESC;

-- Check active students by branch
SELECT b.name, COUNT(s.id) as student_count
FROM branches b
LEFT JOIN students s ON b.id = s.branch_id AND s.is_active = true
GROUP BY b.name
ORDER BY student_count DESC;
```

## Resetting Data

To clear all data and start fresh:

```sql
-- WARNING: This deletes all data!
TRUNCATE TABLE debt_payments CASCADE;
TRUNCATE TABLE debts CASCADE;
TRUNCATE TABLE withdrawals CASCADE;
TRUNCATE TABLE product_sales CASCADE;
TRUNCATE TABLE products CASCADE;
TRUNCATE TABLE expenses CASCADE;
TRUNCATE TABLE revenues CASCADE;
TRUNCATE TABLE employees CASCADE;
TRUNCATE TABLE enrollments CASCADE;
TRUNCATE TABLE students CASCADE;
TRUNCATE TABLE classes CASCADE;
TRUNCATE TABLE courses CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE branches CASCADE;

-- Reset cash state
UPDATE cash_state SET current_balance = 0;
```

Then re-run the population scripts.

## Notes

- All UUIDs are fixed for consistency and easier testing
- Dates are set to Q1 2024 (January-March)
- Financial amounts are in Egyptian Pounds (EGP)
- Phone numbers follow Egyptian format (+20-XX-XXXX-XXXX)
- All data is fictional and for testing purposes only

## Support

If you encounter issues:
1. Verify schema was created successfully
2. Check foreign key constraints
3. Review error messages for specific table issues
4. Ensure you're running scripts in the correct order
