import boto3
import time
import sys

# ---------------------------------------------------------------------------
# Migration 027 – Monthly Subscription Payments
#
# Usage:
#   python migrate_027_monthly_subscriptions.py          # → dev
#   python migrate_027_monthly_subscriptions.py --prod   # → prod
#
# What this migration does:
#   1. Adds courses.payment_type  (ONE_TIME | MONTHLY_SUBSCRIPTION)
#      NOTE: price column is reused as the monthly fee when MONTHLY_SUBSCRIPTION
#   2. Adds enrollments.payment_type  (denormalised copy for fast queries)
#   3. Creates monthly_subscription_payments table
#   4. Creates 9 indexes on monthly_subscription_payments
#   5. Creates updated_at trigger on monthly_subscription_payments
# ---------------------------------------------------------------------------

PROD = '--prod' in sys.argv

# ── Connection config ───────────────────────────────────────────────────────
if PROD:
    CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-1ireakzkdszq'
    SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
    DATABASE    = 'automative_prod'
    ENV_LABEL   = 'PROD'
else:
    CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-yqb2wihdkbe8'
    SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-i8zzeQ'
    DATABASE    = 'automative'
    ENV_LABEL   = 'DEV'

session = boto3.Session(profile_name='personal')
client  = session.client('rds-data', region_name='eu-west-1')

# ── SQL statements ──────────────────────────────────────────────────────────
statements = [
    # 1. Add payment_type to courses
    (
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME' "
        "CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION'))",
        "Add courses.payment_type"
    ),

    # 2. Add payment_type to enrollments (denormalised)
    (
        "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME' "
        "CHECK (payment_type IN ('ONE_TIME', 'MONTHLY_SUBSCRIPTION'))",
        "Add enrollments.payment_type"
    ),

    # 3. Create monthly_subscription_payments table
    (
        """CREATE TABLE IF NOT EXISTS monthly_subscription_payments (
            id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            enrollment_id    UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
            company_id       UUID NOT NULL REFERENCES companies(id)   ON DELETE CASCADE,
            student_id       UUID NOT NULL REFERENCES students(id)    ON DELETE CASCADE,
            course_id        UUID NOT NULL REFERENCES courses(id)     ON DELETE CASCADE,
            branch_id        UUID NOT NULL REFERENCES branches(id)    ON DELETE CASCADE,
            billing_year     INTEGER NOT NULL,
            billing_month    INTEGER NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
            amount_due       DECIMAL(10, 2) NOT NULL DEFAULT 0,
            amount_paid      DECIMAL(10, 2) NOT NULL DEFAULT 0,
            payment_status   VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                                 CHECK (payment_status IN ('PENDING', 'PAID', 'PARTIAL', 'OVERDUE')),
            due_date         DATE NOT NULL,
            paid_date        DATE,
            notes            TEXT,
            created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (enrollment_id, billing_year, billing_month)
        )""",
        "Create monthly_subscription_payments table"
    ),

    # 4a–4i. Indexes
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_enrollment_id  ON monthly_subscription_payments(enrollment_id)",
        "Index msp.enrollment_id"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_company_id     ON monthly_subscription_payments(company_id)",
        "Index msp.company_id"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_student_id     ON monthly_subscription_payments(student_id)",
        "Index msp.student_id"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_course_id      ON monthly_subscription_payments(course_id)",
        "Index msp.course_id"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_branch_id      ON monthly_subscription_payments(branch_id)",
        "Index msp.branch_id"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_billing_year   ON monthly_subscription_payments(billing_year)",
        "Index msp.billing_year"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_billing_month  ON monthly_subscription_payments(billing_month)",
        "Index msp.billing_month"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_payment_status ON monthly_subscription_payments(payment_status)",
        "Index msp.payment_status"
    ),
    (
        "CREATE INDEX IF NOT EXISTS idx_msp_due_date       ON monthly_subscription_payments(due_date)",
        "Index msp.due_date"
    ),

    # 6. updated_at trigger (drop first so re-runs are idempotent)
    (
        "DROP TRIGGER IF EXISTS update_monthly_subscription_payments_updated_at ON monthly_subscription_payments",
        "Drop old msp updated_at trigger (if exists)"
    ),
    (
        "CREATE TRIGGER update_monthly_subscription_payments_updated_at "
        "BEFORE UPDATE ON monthly_subscription_payments "
        "FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()",
        "Create msp updated_at trigger"
    ),
]

# ── Runner ──────────────────────────────────────────────────────────────────
errors = []

def run(sql, desc):
    try:
        client.execute_statement(
            resourceArn=CLUSTER_ARN,
            secretArn=SECRET_ARN,
            database=DATABASE,
            sql=sql.strip()
        )
        print('  ✓  ' + desc)
    except Exception as e:
        print('  ✗  ' + desc)
        print('     ERROR: ' + str(e))
        errors.append((desc, str(e)))

# ── Main ────────────────────────────────────────────────────────────────────
print('')
print('=' * 65)
print('  Migration 027 – Monthly Subscription Payments  [' + ENV_LABEL + ']')
print('=' * 65)

for sql, desc in statements:
    run(sql, desc)
    time.sleep(0.1)   # small pause to avoid throttling

print('=' * 65)

if errors:
    print('\nCompleted with ' + str(len(errors)) + ' error(s):')
    for label, err in errors:
        print('  - ' + label + ': ' + err)
    sys.exit(1)
else:
    print('\n✅  Migration 027 completed successfully on ' + ENV_LABEL + '!')
    print('')
