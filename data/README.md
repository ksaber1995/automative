# Data Directory

This directory contains JSON files that serve as the data storage for the Automate-Magic platform.

## Files

- **users.json** - User accounts and authentication data
- **branches.json** - Robotics academy branch information
- **courses.json** - Course catalog with pricing and details
- **students.json** - Student records and contact information
- **enrollments.json** - Course enrollments with payment and status
- **employees.json** - Employee records and salary information
- **revenues.json** - Revenue records from course payments
- **expenses.json** - Expense records (fixed, variable, and shared)

## Structure

Each JSON file follows this pattern:

```json
{
  "entityName": [
    {
      "id": "uuid",
      ...other fields
    }
  ]
}
```

## Seed Data

The `seed/` directory contains scripts to populate initial data for development and testing.

## Backup

The DataStoreService automatically creates backups before write operations:
- Backup files are named: `{original-file}.backup`
- Located in the same directory as the original file

## Safety

- File locking prevents concurrent write conflicts
- Atomic writes ensure data integrity
- Automatic backups prevent data loss

## Important

These JSON files should not be committed to version control with real data. Add them to .gitignore for production use.
