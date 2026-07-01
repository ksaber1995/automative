#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Populate rooms for the karimsaber@gmail.com tenant: 4 Arabic-named rooms per
branch (5 branches = 20 rooms). Then:
  - assign each course a default_room_id (round-robin among its branch's rooms)
  - point existing room-less sessions at their course's default room

Usage:
  python scripts/rooms_karimsaber.py            # dry-run
  python scripts/rooms_karimsaber.py --apply    # write to PROD
"""
import sys
import uuid
from collections import defaultdict

import boto3

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
CID         = '07d91513-9a21-478c-ba46-4a8d6aa84150'

# (code, description) per branch
ROOMS = [
    ('قاعة أ', 'قاعة تدريب عامة'),
    ('قاعة ب', 'قاعة تدريب عامة'),
    ('معمل الروبوتات', 'معمل مجهز بأدوات ومجموعات الروبوتات'),
    ('معمل البرمجة', 'معمل حاسبات للبرمجة والتصميم'),
]

APPLY = '--apply' in sys.argv
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
def p_str(n, v):  return {'name': n, 'value': {'stringValue': v}}
def cell(x): return None if x.get('isNull') else x.get('stringValue', x.get('longValue'))


def main():
    print("=== Populate rooms for karimsaber tenant ===")
    print(f"mode: {'APPLY (writing)' if APPLY else 'DRY-RUN'}\n")

    prior = int(q(f"SELECT COUNT(*) FROM rooms WHERE company_id='{CID}'")['records'][0][0]['longValue'])
    if prior > 0:
        print(f"!! {prior} rooms already exist for this tenant. Aborting.")
        sys.exit(1)

    branches = [(cell(r[0]), cell(r[1])) for r in
                q(f"SELECT id::text, code FROM branches WHERE company_id='{CID}' ORDER BY code")['records']]
    print("branches:", [b[1] for b in branches])

    # build rooms; remember room ids per branch
    room_sets = []
    branch_rooms = defaultdict(list)  # branch_id -> [room_id...]
    for bid, bcode in branches:
        for code, desc in ROOMS:
            rid = str(uuid.uuid4())
            branch_rooms[bid].append(rid)
            room_sets.append([p_uuid('id', rid), p_uuid('cid', CID), p_uuid('bid', bid),
                              p_str('code', code), p_str('desc', desc)])

    # course -> branch (to assign a default room in the same branch)
    courses = [(cell(r[0]), cell(r[1])) for r in
               q(f"SELECT id::text, branch_id::text FROM courses WHERE company_id='{CID}' ORDER BY branch_id, created_at")['records']]
    idx = defaultdict(int)
    course_room = []  # (course_id, room_id)
    for coid, bid in courses:
        rooms = branch_rooms.get(bid, [])
        if not rooms:
            continue
        rid = rooms[idx[bid] % len(rooms)]
        idx[bid] += 1
        course_room.append((coid, rid))

    print(f"\nWould create {len(room_sets)} rooms ({len(ROOMS)} per branch)")
    print(f"Would assign default_room_id to {len(course_room)} courses")
    print("Would set room_id on existing room-less sessions to their course's default room")

    if not APPLY:
        print("\nDRY-RUN — nothing written.")
        return

    print("\nApplying...")
    run_batch("INSERT INTO rooms (id, company_id, branch_id, code, description, is_active) "
              "VALUES (:id, :cid, :bid, :code, :desc, true)", room_sets)
    print(f"  inserted {len(room_sets)} rooms")

    for coid, rid in course_room:
        q("UPDATE courses SET default_room_id=:rid, updated_at=NOW() WHERE id=:coid",
          [p_uuid('rid', rid), p_uuid('coid', coid)])
    print(f"  set default_room_id on {len(course_room)} courses")

    # backfill session rooms from the course default room
    r = q(f"UPDATE sessions s SET room_id = co.default_room_id "
          f"FROM classes cl JOIN courses co ON co.id = cl.course_id "
          f"WHERE s.class_id = cl.id AND s.company_id='{CID}' "
          f"AND s.room_id IS NULL AND co.default_room_id IS NOT NULL")
    print(f"  set room_id on {r['numberOfRecordsUpdated']} existing sessions")
    print("\nDone.")


if __name__ == '__main__':
    main()
