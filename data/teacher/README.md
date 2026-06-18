# Teacher-tenant data seed

Population harness for **TEACHER**-registration-type companies. A teacher tenant
differs from an academy:

- It has exactly **one branch** — `"<Company> - Main Branch"` (code `MAIN`),
  created automatically at signup. This seed attaches students to that existing
  branch instead of creating its own.
- The teacher is the single instructor; there are no multi-branch employees.

## Files

| File | Role |
|---|---|
| `generate-students.js` | Generates N students deterministically and inserts them, attached to the tenant's existing branch. |
| `package.json` | Declares deps (`@aws-sdk/client-rds-data`, `credential-providers`). |

> The other entities (courses, classes, etc.) are intentionally left out for
> now — to be added once the desired teacher dataset is specified.

## Setup

```bash
cd data/teacher
npm install
```

## Running

```bash
# Dry run — generate + print a sample, NO DB writes. Always do this first.
node generate-students.js --dry-run --count=1000

# Seed 1000 students for the default user (dev cluster):
node generate-students.js --email=karimali201094@gmail.com --count=1000
```

### Targeting PRODUCTION

The script defaults to the **dev** cluster ARN. To seed production you must
supply the prod ARNs (and usually a prod AWS profile) via env vars:

```bash
DB_CLUSTER_ARN=arn:aws:rds:...:cluster:...prod... \
DB_SECRET_ARN=arn:aws:secretsmanager:...:secret:/prod/... \
DB_NAME=automative AWS_PROFILE=prod AWS_REGION=eu-west-1 \
node generate-students.js --email=karimali201094@gmail.com --count=1000
```

The script prints whether it resolved a `dev` or `PRODUCTION` target before
writing, so you can abort if it points at the wrong cluster.

## Idempotency

Each student's UUID is derived from `(company_id, "student-<index>")`, and every
insert uses `ON CONFLICT (id) DO NOTHING`. Re-running with the same `--count`
inserts nothing new. Increasing `--count` adds only the new tail.
