"""
Bulk-enroll all active, not-yet-enrolled students of the netrofit tenant into the
3 Arabic courses, divided equally, and round-robin across each course's groups
(classes). Mirrors the app's MONTHLY_SUBSCRIPTION enrollment path: creates the
enrollment row (ACTIVE / PENDING / final_price = monthly fee) AND one
monthly_subscription_payments bill for the current month.

Every created row is tagged notes='bulk-assign 2026-06-22' so it can be rolled
back with a single DELETE.

Usage:
  python scripts/bulk_enroll_tenant.py            # dry-run (prints distribution)
  python scripts/bulk_enroll_tenant.py --apply    # write to PROD
"""
import sys
import uuid
import boto3

CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
CID         = 'b6420df6-74fc-4d9d-ab56-78106b376f06'
BRANCH      = 'fb5a38e1-1e09-4f58-a8d4-5360d89504ad'
ENROLL_DATE = '2026-06-22'
BILL_YEAR   = 2026
BILL_MONTH  = 6
DUE_DATE    = '2026-06-30'
TAG         = 'bulk-assign 2026-06-22'

s = boto3.Session(profile_name='personal', region_name='eu-west-1').client('rds-data')


def q(sql):
    return s.execute_statement(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)['records']


def u(v):
    return {'value': {'stringValue': v}, 'typeHint': 'UUID'}


def d(v):
    return {'value': {'stringValue': v}, 'typeHint': 'DATE'}


def batch(sql, param_sets, chunk=100):
    for i in range(0, len(param_sets), chunk):
        s.batch_execute_statement(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN,
                                  database=DATABASE, sql=sql, parameterSets=param_sets[i:i + chunk])


# --- Load courses, their groups (excluding test group), price ---
courses = []  # [(course_id, name, price, [group_ids...])]
for r in q(f"SELECT id::text, name, price FROM courses WHERE company_id='{CID}' AND is_active ORDER BY created_at"):
    cid, name, price = r[0]['stringValue'], r[1]['stringValue'], float(r[2]['stringValue'])
    groups = []
    for g in q("SELECT id::text, name FROM classes WHERE course_id='%s' AND is_active "
               "AND name NOT LIKE '%%اختبار%%' ORDER BY created_at" % cid):
        groups.append(g[0]['stringValue'])
    courses.append((cid, name, price, groups))

# --- Pool: active students with no existing enrollment ---
pool = [r[0]['stringValue'] for r in q(
    f"SELECT id::text FROM students WHERE company_id='{CID}' AND is_active "
    f"AND id NOT IN (SELECT student_id FROM enrollments WHERE company_id='{CID}') ORDER BY id")]

# --- Assign: round-robin across courses, round-robin within each course's groups ---
gidx = [0] * len(courses)
assign = []  # (student_id, course_id, class_id, price)
for n, sid in enumerate(pool):
    ci = n % len(courses)
    cid, name, price, groups = courses[ci]
    grp = groups[gidx[ci] % len(groups)]
    gidx[ci] += 1
    assign.append((sid, cid, grp, price))

# --- Report ---
from collections import Counter
per_course = Counter(a[1] for a in assign)
per_group = Counter(a[2] for a in assign)
print(f'Pool: {len(pool)} students -> {len(courses)} courses\n')
for cid, name, price, groups in courses:
    print(f'{name}  [{price:.0f} EGP/mo]  -> {per_course[cid]} students across {len(groups)} groups')
    gc = [per_group[g] for g in groups]
    print(f'    per-group: min {min(gc)} max {max(gc)} (groups: {len(groups)})')
print(f'\nTotal enrollments to create: {len(assign)}  (+ {len(assign)} monthly bills for {BILL_YEAR}-{BILL_MONTH:02d})')

if '--apply' not in sys.argv:
    print('\nDRY RUN — nothing written. Re-run with --apply.')
    sys.exit(0)

# --- Build enrollment + bill rows (client-generated UUIDs so bills link to enrollments) ---
enr_sql = ("INSERT INTO enrollments (id, company_id, student_id, class_id, course_id, branch_id, "
           "enrollment_date, status, original_price, discount_percent, discount_amount, final_price, "
           "payment_mode, down_payment, amount_paid, payment_status, payment_type, completion_date, notes) "
           "VALUES (:id, :cid, :sid, :clid, :coid, :bid, :edate, 'ACTIVE', :price, 0, 0, :price, "
           "'FULL', 0, 0, 'PENDING', 'MONTHLY_SUBSCRIPTION', NULL, :notes)")
bill_sql = ("INSERT INTO monthly_subscription_payments (id, enrollment_id, company_id, student_id, course_id, "
            "branch_id, billing_year, billing_month, amount_due, amount_paid, payment_status, due_date, notes) "
            "VALUES (:id, :eid, :cid, :sid, :coid, :bid, :by, :bm, :amt, 0, 'PENDING', :due, :notes) "
            "ON CONFLICT (enrollment_id, billing_year, billing_month) DO NOTHING")

enr_sets, bill_sets = [], []
for sid, cid, grp, price in assign:
    eid = str(uuid.uuid4())
    enr_sets.append([
        {'name': 'id', **u(eid)}, {'name': 'cid', **u(CID)}, {'name': 'sid', **u(sid)},
        {'name': 'clid', **u(grp)}, {'name': 'coid', **u(cid)}, {'name': 'bid', **u(BRANCH)},
        {'name': 'edate', **d(ENROLL_DATE)}, {'name': 'price', 'value': {'doubleValue': price}},
        {'name': 'notes', 'value': {'stringValue': TAG}},
    ])
    bill_sets.append([
        {'name': 'id', **u(str(uuid.uuid4()))}, {'name': 'eid', **u(eid)}, {'name': 'cid', **u(CID)},
        {'name': 'sid', **u(sid)}, {'name': 'coid', **u(cid)}, {'name': 'bid', **u(BRANCH)},
        {'name': 'by', 'value': {'longValue': BILL_YEAR}}, {'name': 'bm', 'value': {'longValue': BILL_MONTH}},
        {'name': 'amt', 'value': {'doubleValue': price}}, {'name': 'due', **d(DUE_DATE)},
        {'name': 'notes', 'value': {'stringValue': TAG}},
    ])

print(f'\nWriting {len(enr_sets)} enrollments...')
batch(enr_sql, enr_sets)
print(f'Writing {len(bill_sets)} monthly bills...')
batch(bill_sql, bill_sets)

# --- Refresh classes.current_enrollment to actual active counts ---
s.execute_statement(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=(
    "UPDATE classes cl SET current_enrollment = (SELECT COUNT(*) FROM enrollments e "
    "WHERE e.class_id = cl.id AND e.status='ACTIVE'), updated_at = NOW() "
    f"WHERE cl.course_id IN (SELECT id FROM courses WHERE company_id='{CID}')"))
print('Refreshed classes.current_enrollment.')
print('\nDONE.')
