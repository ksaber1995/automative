#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enroll every seeded student of the karimsaber@gmail.com tenant into one class at
their OWN branch (round-robin across that branch's classes), marked ACTIVE/PAID
(ONE_TIME courses). Also writes one enrollment_payments row per enrollment and
refreshes classes.current_enrollment.

Prerequisite: run seed_tenant_karimsaber.py first. Rows tagged notes='seed-karimsaber'.

Usage:
  python scripts/enroll_karimsaber.py            # dry-run
  python scripts/enroll_karimsaber.py --apply    # write to PROD
"""
import sys
import uuid
import random
import datetime as dt
from collections import defaultdict, Counter

import boto3

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
CID         = '07d91513-9a21-478c-ba46-4a8d6aa84150'
TAG         = 'seed-karimsaber'
ENROLL_DATE = '2026-04-01'

APPLY = '--apply' in sys.argv
random.seed(20260701)
client = boto3.Session(profile_name='personal', region_name='eu-west-1').client('rds-data')


def q(sql, params=None):
    k = dict(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
    if params:
        k['parameters'] = params
    return client.execute_statement(**k)


def run_batch(sql, sets, chunk=100):
    for i in range(0, len(sets), chunk):
        client.batch_execute_statement(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN,
                                       database=DATABASE, sql=sql, parameterSets=sets[i:i + chunk])


def p_uuid(n, v): return {'name': n, 'value': {'stringValue': v}, 'typeHint': 'UUID'}
def p_dbl(n, v):  return {'name': n, 'value': {'doubleValue': float(v)}}
def p_date(n, v): return {'name': n, 'value': {'stringValue': v}, 'typeHint': 'DATE'}
def p_str(n, v):  return {'name': n, 'value': {'stringValue': v}}
def cell(x): return None if x.get('isNull') else x.get('stringValue', x.get('longValue'))


def main():
    print("=== Enroll karimsaber tenant students ===")
    print(f"mode: {'APPLY (writing)' if APPLY else 'DRY-RUN'}\n")

    # Guard against double-enroll
    prior = int(q("SELECT COUNT(*) FROM enrollments WHERE company_id=:c AND notes=:t",
                  [p_uuid('c', CID), p_str('t', TAG)])['records'][0][0]['longValue'])
    if prior > 0:
        print(f"!! {prior} enrollments already tagged '{TAG}'. Aborting.")
        sys.exit(1)

    # classes with their course, branch, price  (branch via course)
    rows = q(f"SELECT cl.id::text, co.id::text, co.branch_id::text, co.price "
             f"FROM classes cl JOIN courses co ON co.id=cl.course_id "
             f"WHERE co.company_id='{CID}' AND cl.is_active ORDER BY co.branch_id, co.created_at, cl.created_at")['records']
    branch_classes = defaultdict(list)  # branch_id -> [(class_id, course_id, price)]
    for r in rows:
        branch_classes[cell(r[2])].append((cell(r[0]), cell(r[1]), float(cell(r[3]))))
    print("classes per branch:", {b: len(v) for b, v in branch_classes.items()})

    # students per branch (already enrolled excluded)
    srows = q(f"SELECT id::text, branch_id::text FROM students WHERE company_id='{CID}' AND is_active "
              f"AND id NOT IN (SELECT student_id FROM enrollments WHERE company_id='{CID}') "
              f"ORDER BY branch_id, student_code")['records']
    branch_students = defaultdict(list)
    for r in srows:
        branch_students[cell(r[1])].append(cell(r[0]))
    print("students per branch:", {b: len(v) for b, v in branch_students.items()})

    # round-robin each branch's students across that branch's classes
    enr = []  # (student_id, class_id, course_id, branch_id, price)
    for bid, studs in branch_students.items():
        cls = branch_classes.get(bid, [])
        if not cls:
            print(f"  !! branch {bid} has no classes; skipping {len(studs)} students")
            continue
        for i, sid in enumerate(studs):
            clid, coid, price = cls[i % len(cls)]
            enr.append((sid, clid, coid, bid, price))

    per_class = Counter(e[1] for e in enr)
    print(f"\nTotal enrollments: {len(enr)}  | classes used: {len(per_class)} "
          f"| per-class min {min(per_class.values())} max {max(per_class.values())}")
    print(f"Also: {len(enr)} enrollment_payments rows (PAID).")

    if not APPLY:
        print("\nDRY-RUN — nothing written.")
        return

    enr_sets, pay_sets = [], []
    for sid, clid, coid, bid, price in enr:
        eid = str(uuid.uuid4())
        enr_sets.append([
            p_uuid('id', eid), p_uuid('sid', sid), p_uuid('clid', clid), p_uuid('coid', coid),
            p_uuid('bid', bid), p_uuid('cid', CID), p_date('edate', ENROLL_DATE),
            p_dbl('price', price), p_str('notes', TAG),
        ])
        pay_sets.append([
            p_uuid('id', str(uuid.uuid4())), p_uuid('eid', eid), p_uuid('cid', CID),
            p_dbl('amt', price), p_date('pdate', ENROLL_DATE), p_str('notes', TAG),
        ])

    print("\nApplying...")
    run_batch("INSERT INTO enrollments (id, student_id, class_id, course_id, branch_id, company_id, "
              "enrollment_date, status, original_price, discount_percent, discount_amount, final_price, "
              "payment_mode, down_payment, amount_paid, payment_status, payment_type, notes) "
              "VALUES (:id, :sid, :clid, :coid, :bid, :cid, :edate, 'ACTIVE', :price, 0, 0, :price, "
              "'FULL', 0, :price, 'PAID', 'ONE_TIME', :notes)", enr_sets)
    print(f"  inserted {len(enr_sets)} enrollments")
    run_batch("INSERT INTO enrollment_payments (id, enrollment_id, company_id, amount, payment_date, notes) "
              "VALUES (:id, :eid, :cid, :amt, :pdate, :notes)", pay_sets)
    print(f"  inserted {len(pay_sets)} payments")

    q("UPDATE classes cl SET current_enrollment=(SELECT COUNT(*) FROM enrollments e "
      "WHERE e.class_id=cl.id AND e.status='ACTIVE'), updated_at=NOW() "
      f"WHERE cl.course_id IN (SELECT id FROM courses WHERE company_id='{CID}')")
    print("  refreshed classes.current_enrollment")
    print("\nDone.")


if __name__ == '__main__':
    main()
