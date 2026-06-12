"""
Runs migration 033 (refunds.restock_quantity column) against BOTH the dev and
prod Aurora clusters via the RDS Data API. Idempotent (ADD COLUMN IF NOT EXISTS).
Usage: python scripts/run_033_refund_restock.py
"""
import boto3
import re
import os
import time

TARGETS = [
    {
        'name': 'DEV',
        'cluster': 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-dev-automatemagicauroradbef2379-yqb2wihdkbe8',
        'secret':  'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/dev/automate-magic/db-credentials-i8zzeQ',
        'database': 'automative',
    },
    {
        'name': 'PROD',
        'cluster': 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd',
        'secret':  'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9',
        'database': 'automative_prod',
    },
]

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
MIGRATION = os.path.join(SCRIPTS_DIR, '..', 'sql', 'migrations', '033_refund_restock.sql')


def split_sql(sql: str) -> list:
    sql = re.sub(r'--[^\n]*', '', sql)
    return [s.strip() for s in sql.split(';') if s.strip() and not s.isspace()]


def run(target: dict, sql: str, idx: int) -> bool:
    try:
        res = client.execute_statement(
            resourceArn=target['cluster'],
            secretArn=target['secret'],
            database=target['database'],
            sql=sql,
        )
        print(f"  [ok] {target['name']} stmt {idx} (rows affected: {res.get('numberOfRecordsUpdated', 0)})")
        return True
    except Exception as e:
        print(f"  [ERROR] {target['name']} stmt {idx}: {str(e)[:200]}")
        return False


if __name__ == '__main__':
    with open(MIGRATION, 'r', encoding='utf-8') as f:
        statements = split_sql(f.read())
    total_errors = 0
    for target in TARGETS:
        print(f"\n=== {target['name']} ({target['database']}) ===")
        for i, stmt in enumerate(statements, 1):
            if not run(target, stmt, i):
                total_errors += 1
            time.sleep(0.05)
    print(f"\n{'OK migration 033 applied to dev + prod' if total_errors == 0 else f'Done with {total_errors} errors'}")
