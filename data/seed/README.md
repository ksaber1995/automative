# Seed Data Script

This directory contains the data seeding scripts to populate the SQL database with initial sample data.

## Running the Seed Script

From the root directory:

```bash
npm run seed
```

## What Gets Seeded

The script populates the following data:

### Users (3)
- **Admin** - Full system access
  - Email: admin@automate-magic.com
  - Password: admin123

- **Branch Manager** - Downtown branch manager
  - Email: manager@automate-magic.com
  - Password: manager123

- **Accountant** - Financial data access
  - Email: accountant@automate-magic.com
  - Password: accountant123

### Branches (2)
- Downtown Branch (New York)
- Westside Branch (Los Angeles)

### Courses (3)
- Introduction to Robotics (Beginner)
- Advanced Robotics (Advanced)
- Robot Programming (Intermediate)

### Students (3)
- Alice Johnson
- Bob Smith
- Carol Davis

### Enrollments (3)
- All students enrolled in courses with varying discounts

### Employees (2)
- Lead Instructor (branch-specific)
- Marketing Manager (global)

### Revenues (3)
- Course payment records from student enrollments

### Expenses (5)
- Fixed expenses (rent, utilities)
- Shared expense (marketing)
- Variable expense (supplies)

## Important Notes

- Running the script will **reset** and populate the SQL database with sample data
- All passwords are securely hashed using bcrypt
- UUIDs are generated for all entity IDs
- Timestamps are set to the current date/time
- Financial data is realistic for demonstration purposes

## Requirements

The script requires:
- Node.js with TypeScript support
- SQL database connection configured
- bcrypt package for password hashing
- uuid package for ID generation

These are automatically installed with the project dependencies.
