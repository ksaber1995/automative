# Data seed

Reusable population harness for Netrofit. Seeds **branches, employees, courses,
and students** into a target tenant's company. Does **not** seed products,
enrollments, or expenses — those are left for real testing.

Re-runnable: every insert uses `ON CONFLICT (id) DO NOTHING`, so running the
seed twice is a no-op on the second run.

## Files

| File | Role |
|---|---|
| `seed.js` | Runnable script. Reads the JSON files, resolves the target company, inserts rows. |
| `branches.json` | 3 branches (Nasr City, Maadi, New Cairo). |
| `master_courses.json` | 5 bundle packages (English Track, Programming Career, French, Math, Junior STEM). |
| `employees.json` | 8 employees distributed across branches. |
| `courses.json` | 11 courses. Each links into a bundle via `master_course_ref`. |
| `classes.json` | 11 class cohorts (one per course) with realistic schedules. |
| `students.json` | 15 students spread across all branches. |
| `package.json` | Declares deps (`@aws-sdk/client-rds-data`, `credential-providers`). |

Foreign keys are resolved by **name** inside the JSON — `branch_ref`,
`instructor_ref`, `master_course_ref`, `course_ref`. The script builds
name→id maps and injects the correct UUIDs at insert time.

## First-time setup

```bash
cd data
npm install
```

## Running

```bash
# Seed everything for the default user (k@gmail.com)
npm run seed

# Seed for a different user
node seed.js --email=someone@example.com

# Seed just one entity (useful after editing one JSON file)
npm run seed:branches
npm run seed:master-courses
npm run seed:employees
npm run seed:courses        # also re-links courses to their master on every run
npm run seed:classes
npm run seed:students
```

Output looks like:

```
Netrofit seed
  target user : k@gmail.com
  db          : automative
  entities    : all (branches, employees, courses, students)
  company_id  : 7c1df4c0-c0f0-4dd3-9b31-80b98098f785

[branches]  ...
[employees] ........
[courses]   ...........
[students]  ...............

Summary ("." = inserted, "-" = already exists / skipped):
  branches    inserted=3   skipped=0
  employees   inserted=8   skipped=0
  courses     inserted=11  skipped=0
  students    inserted=15  skipped=0
```

## Configuration

AWS credentials use the `personal` profile by default. Override via env vars:

```bash
AWS_PROFILE=otherprofile AWS_REGION=us-east-1 \
DB_CLUSTER_ARN=arn:... DB_SECRET_ARN=arn:... DB_NAME=automative \
node seed.js
```

## Editing the data

Open the JSON files and add / remove / change rows as you like. The script
uses the `id` field as the conflict key, so:

- **New row** (fresh UUID) → inserted on next run
- **Existing row** (same `id`) → skipped
- **Removed row** → NOT deleted from the DB (delete manually if needed)

If you want to change a field on an existing row, delete that row from the DB
first (or change the `id` so it's treated as new).

## Dependency order

The seed runs in this order, so references resolve:

```
branches  →  master_courses  →  employees
                             →  courses  (needs branches + employees + master_courses)
                                      →  classes  (needs courses + employees)
                             →  students
```

The `courses` seed also runs a second "relink" pass that sets
`master_course_id` on existing rows — so if you add `master_course_ref` to a
course JSON entry later, re-running the seed will pick up the link without
needing to delete the course row first.

## What is NOT seeded

By design:

- Products
- Product sales
- **Enrollments (regular & master)** — bundles exist but no student has bought one
- Revenues, refunds
- Expenses, withdrawals
- Debts

Those are meant to be exercised manually from the UI so you can test the real
flows end-to-end.
