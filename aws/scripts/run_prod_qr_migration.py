"""
Runs migration 029 (students.qr_token) against the PROD Aurora cluster via the
RDS Data API. Idempotent — safe to re-run. Cluster/secret confirmed from the
live AutomateMagicStack-prod CloudFormation outputs.
Usage: python scripts/run_prod_qr_migration.py
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

SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sql')
FILES = [os.path.join(SQL_DIR, 'migrations', '029_student_qr.sql')]


def split_sql(sql: str) -> list:
    sql = re.sub(r'--[^\n]*', '', sql)
    return [s.strip() for s in sql.split(';') if s.strip() and not s.isspace()]


def run_statement(sql: str, idx: int) -> bool:
    try:
        client.execute_statement(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
        print(f'  [ok] stmt {idx}')
        return True
    except Exception as e:
        msg = str(e)
        for pat in ['already exists', 'duplicate column', 'DuplicateColumn',
                    r'relation.*already exists', r'index.*already exists', r'constraint.*already exists']:
            if re.search(pat, msg, re.IGNORECASE):
                print(f'  [skip] stmt {idx}: {msg[:80]}')
                return True
        print(f'  [ERROR] stmt {idx}: {msg[:200]}')
        return False


if __name__ == '__main__':
    errors = 0
    for path in FILES:
        print(f'\n=== {os.path.basename(path)} (PROD: {DATABASE}) ===')
        with open(path, 'r', encoding='utf-8') as f:
            stmts = split_sql(f.read())
        for i, s in enumerate(stmts, 1):
            if not run_statement(s, i):
                errors += 1
            time.sleep(0.05)
        print(f'  Done: {len(stmts)} statements, {errors} errors')
    print(f'\n{"OK migration 029 applied to PROD" if errors == 0 else f"Done with {errors} errors"}')
