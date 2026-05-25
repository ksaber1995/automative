"""
Runs the full schema + all migrations against the prod Aurora cluster via RDS Data API.
Usage: python scripts/run_prod_migrations.py
"""
import boto3
import re
import os
import time

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE = 'automative_prod'

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
SQL_DIR = os.path.join(SCRIPTS_DIR, '..', 'sql')

# Files to run in order
FILES = [
    os.path.join(SQL_DIR, 'schema.sql'),
    os.path.join(SQL_DIR, 'migrations', '021_master_class_enrollments.sql'),
    os.path.join(SQL_DIR, 'migrations', '022_master_course_courses_link.sql'),
    os.path.join(SQL_DIR, 'migrations', '023_rooms_and_sessions.sql'),
    os.path.join(SQL_DIR, 'migrations', '024_product_sales_nullable_branch.sql'),
    os.path.join(SQL_DIR, 'migrations', '025_stock_purchases.sql'),
    os.path.join(SQL_DIR, 'migrations', 'add_instructor_to_courses.sql'),
    os.path.join(SQL_DIR, 'migrations', 'add_instructor_to_classes.sql'),
    os.path.join(SQL_DIR, 'migrations', 'update_classes_table_structure.sql'),
]


def split_sql(sql: str) -> list[str]:
    """Split SQL into individual statements, skipping comments and blanks."""
    # Remove single-line comments
    sql = re.sub(r'--[^\n]*', '', sql)
    # Split on semicolons
    statements = [s.strip() for s in sql.split(';')]
    return [s for s in statements if s and not s.isspace()]


def run_statement(sql: str, file_label: str, idx: int) -> bool:
    try:
        client.execute_statement(
            resourceArn=CLUSTER_ARN,
            secretArn=SECRET_ARN,
            database=DATABASE,
            sql=sql,
        )
        return True
    except Exception as e:
        msg = str(e)
        # Ignore "already exists" style errors — idempotent re-runs are fine
        ignore_patterns = [
            'already exists',
            'duplicate column',
            'DuplicateColumn',
            'relation.*already exists',
            'index.*already exists',
            'constraint.*already exists',
        ]
        for pat in ignore_patterns:
            if re.search(pat, msg, re.IGNORECASE):
                print(f'  [skip] stmt {idx}: {msg[:80]}')
                return True
        print(f'  [ERROR] stmt {idx} in {file_label}: {msg[:200]}')
        print(f'  SQL: {sql[:200]}')
        return False


def run_file(path: str) -> int:
    label = os.path.basename(path)
    if not os.path.exists(path):
        print(f'[skip] {label} — file not found')
        return 0
    print(f'\n=== {label} ===')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    statements = split_sql(content)
    errors = 0
    for i, stmt in enumerate(statements, 1):
        ok = run_statement(stmt, label, i)
        if not ok:
            errors += 1
        # Small delay to avoid throttling
        time.sleep(0.05)
    print(f'  Done: {len(statements)} statements, {errors} errors')
    return errors


if __name__ == '__main__':
    total_errors = 0
    for f in FILES:
        total_errors += run_file(f)
    print(f'\n{"✅ All done" if total_errors == 0 else f"⚠️  Done with {total_errors} errors"}')
