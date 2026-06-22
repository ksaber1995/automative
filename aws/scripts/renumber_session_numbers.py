#!/usr/bin/env python3
"""
Renumber existing sessions so each CLASS has a consecutive 1,2,3,… sequence
ordered chronologically (by start_date, then created_at).

Why: the auto session-number used to be MAX(session_number)+1 across every class
in the same COURSE, so sibling classes shared one counter (Class A → 1, Class B → 2,
Class A again → 3, …). The correct behaviour is per-class numbering. The API is
fixed going forward (aws/lambda/api/src/routes/sessions.ts); this script repairs the
rows already written.

What it does:
  - For every session, computes ROW_NUMBER() OVER (PARTITION BY class_id
    ORDER BY start_date, created_at, id) and writes it to session_number.
  - Teacher overrides are NOT preserved — the request is strictly consecutive.

SAFETY:
  - Dry-run by default. Pass --apply to actually write.
  - Scoped to one tenant by default (EMAIL). Pass --all-companies to sweep every
    company (the bug affected all tenants; per-class numbering is correct for all).
  - Uses the AWS RDS Data API (profile 'personal', prod Aurora), same as the
    other scripts in this folder.

Usage:
  python renumber_session_numbers.py                 # dry-run, this tenant
  python renumber_session_numbers.py --apply         # write, this tenant
  python renumber_session_numbers.py --all-companies --apply   # write, all tenants
"""
import sys

import boto3

# ── Prod connection (same constants as the other scripts in this folder) ──────
CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
EMAIL       = 'karimali201094@gmail.com'

APPLY = '--apply' in sys.argv
ALL_COMPANIES = '--all-companies' in sys.argv

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')

# Chronological per-class ordering. NULLS LAST keeps any number-less / future rows
# at the end; id is the final deterministic tie-breaker.
ROW_NUMBER = ("ROW_NUMBER() OVER (PARTITION BY class_id "
              "ORDER BY start_date ASC NULLS LAST, created_at ASC NULLS LAST, id ASC)")


def q(sql, params=None):
    kwargs = dict(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
    if params:
        kwargs['parameters'] = params
    return client.execute_statement(**kwargs)


def p_uuid(name, v):
    return {'name': name, 'value': {'stringValue': v}, 'typeHint': 'UUID'}


def p_str(name, v):
    return {'name': name, 'value': {'stringValue': v}}


def cell_str(c):
    return None if c.get('isNull') else c.get('stringValue')


def cell_long(c):
    return int(c.get('longValue', 0) or 0)


def main():
    print("=== Renumber session_number per class ===")
    print(f"mode:  {'APPLY (writing)' if APPLY else 'DRY-RUN (no writes)'}")
    print(f"scope: {'ALL companies' if ALL_COMPANIES else EMAIL}\n")

    where = ""
    params = None
    if not ALL_COMPANIES:
        r = q("SELECT u.company_id::text, c.name "
              "FROM users u JOIN companies c ON c.id = u.company_id "
              "WHERE LOWER(u.email) = LOWER(:e)", [p_str('e', EMAIL)])
        if not r['records']:
            print("!! No user/company for that email. Aborting.")
            sys.exit(1)
        company_id = cell_str(r['records'][0][0])
        print(f"company: {cell_str(r['records'][0][1])} ({company_id})\n")
        where = "WHERE company_id = :cid"
        params = [p_uuid('cid', company_id)]

    # ── Preview: how many rows change, and a sample class before/after ──────────
    preview = q(
        f"SELECT count(*) AS total, "
        f"       count(*) FILTER (WHERE session_number IS DISTINCT FROM rn) AS changed "
        f"FROM (SELECT id, session_number, {ROW_NUMBER} AS rn FROM sessions {where}) t",
        params)
    total = cell_long(preview['records'][0][0])
    changed = cell_long(preview['records'][0][1])
    print(f"sessions in scope: {total}")
    print(f"rows to renumber:  {changed}\n")

    sample = q(
        f"SELECT class_id::text, session_number, rn FROM ("
        f"  SELECT class_id, session_number, {ROW_NUMBER} AS rn FROM sessions {where}"
        f") t WHERE session_number IS DISTINCT FROM rn "
        f"ORDER BY class_id, rn LIMIT 15",
        params)
    if sample['records']:
        print("sample changes (class_id : old# -> new#):")
        for row in sample['records']:
            cid = cell_str(row[0])
            old = 'NULL' if row[1].get('isNull') else cell_long(row[1])
            new = cell_long(row[2])
            print(f"  {cid} : {old} -> {new}")
        print()

    if not APPLY:
        print("DRY-RUN — nothing written. Re-run with --apply to commit.")
        return

    if changed == 0:
        print("Nothing to do.")
        return

    print("Applying...")
    res = q(
        f"UPDATE sessions s SET session_number = t.rn, updated_at = NOW() "
        f"FROM (SELECT id, {ROW_NUMBER} AS rn FROM sessions {where}) t "
        f"WHERE s.id = t.id AND s.session_number IS DISTINCT FROM t.rn",
        params)
    print(f"  updated {res.get('numberOfRecordsUpdated', '?')} sessions")
    print("\nDone.")


if __name__ == '__main__':
    main()
