"""
Runs migration 031 (course_products + product_sales attribution columns) against
the PROD Aurora cluster via the RDS Data API. Idempotent — safe to re-run.
Cluster/secret are the live AutomateMagicStack-prod values (same as
run_prod_qr_migration.py).
Usage: python scripts/run_prod_educational_books.py
"""
import boto3
import re
import os
import time

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
SQL_DIR = os.path.join(SCRIPTS_DIR, '..', 'sql')

FILES = [
    os.path.join(SQL_DIR, 'migrations', '031_course_products.sql'),
]


def split_sql(sql: str) -> list:
    sql = re.sub(r'--[^\n]*', '', sql)
    return [s.strip() for s in sql.split(';') if s.strip() and not s.isspace()]


def run_statement(sql: str, file_label: str, idx: int) -> bool:
    try:
        client.execute_statement(
            resourceArn=CLUSTER_ARN,
            secretArn=SECRET_ARN,
            database=DATABASE,
            sql=sql,
        )
        print(f'  [ok] stmt {idx}')
        return True
    except Exception as e:
        msg = str(e)
        ignore_patterns = [
            'already exists', 'duplicate column', 'DuplicateColumn',
            r'relation.*already exists', r'index.*already exists',
            r'constraint.*already exists', r'column.*already exists',
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
    print(f'\n=== {label} (PROD: {DATABASE}) ===')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    statements = split_sql(content)
    errors = 0
    for i, stmt in enumerate(statements, 1):
        if not run_statement(stmt, label, i):
            errors += 1
        time.sleep(0.05)
    print(f'  Done: {len(statements)} statements, {errors} errors')
    return errors


if __name__ == '__main__':
    total = 0
    for f in FILES:
        total += run_file(f)
    print(f'\n{"OK migration 031 applied to PROD" if total == 0 else f"Done with {total} errors"}')
