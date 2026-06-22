#!/usr/bin/env python3
"""
Backfill ~2 months of history for one tenant (default: karimali201094@gmail.com).

What it does (in order):
  1. Shifts every class's start_date 2 months earlier (so the backfilled period
     falls inside each class's active window). end_date is left untouched.
  2. Generates one session per scheduled class-day across the last 2 months and
     marks a random ~90% of each class's enrolled students PRESENT (a NORMAL
     session_attendance row; absence = no row, per the app's model).
  3. Creates 5 exams ("tests") per course with a random grade for every student
     enrolled in that course (grade out of EXAM_MAX_GRADE).

SAFETY:
  - Dry-run by default. Pass --apply to actually write.
  - Created sessions are tagged notes='backfill <stamp>'; if any such rows
    already exist the script aborts (re-running would double-shift start dates
    and duplicate data) unless --force is given.
  - Uses the AWS RDS Data API (profile 'personal', prod Aurora), same as the
    other scripts in this folder.
"""
import sys
import uuid
import random
import datetime as dt

import boto3

# ── Prod connection (same constants as the other scripts in this folder) ──────
CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
EMAIL       = 'karimali201094@gmail.com'

# ── Tunables ──────────────────────────────────────────────────────────────────
MONTHS_BACK      = 2
ATTENDANCE_RATE  = 0.90      # ~90% of enrolled students present per session
EXAMS_PER_COURSE = 5
EXAM_MAX_GRADE   = 100       # exams.max_grade ("out of")
GRADE_MIN        = 50        # random grade range for exam_results.grade
GRADE_MAX        = 100
DEFAULT_START    = dt.time(16, 0)   # fallback if a class has no start_time
DEFAULT_DUR_MIN  = 60               # fallback session length if no end_time

APPLY = '--apply' in sys.argv
FORCE = '--force' in sys.argv

random.seed(42)  # reproducible run

session = boto3.Session(profile_name='personal', region_name='eu-west-1')
client = session.client('rds-data')

DAY_TO_WEEKDAY = {
    'MONDAY': 0, 'TUESDAY': 1, 'WEDNESDAY': 2, 'THURSDAY': 3,
    'FRIDAY': 4, 'SATURDAY': 5, 'SUNDAY': 6,
    # tolerate 3-letter forms just in case
    'MON': 0, 'TUE': 1, 'WED': 2, 'THU': 3, 'FRI': 4, 'SAT': 5, 'SUN': 6,
}


def q(sql, params=None):
    kwargs = dict(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
    if params:
        kwargs['parameters'] = params
    return client.execute_statement(**kwargs)


def run_batch(sql, parameter_sets, chunk=200):
    total = 0
    for i in range(0, len(parameter_sets), chunk):
        client.batch_execute_statement(
            resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE,
            sql=sql, parameterSets=parameter_sets[i:i + chunk],
        )
        total += len(parameter_sets[i:i + chunk])
    return total


# ── RDS Data API param helpers ────────────────────────────────────────────────
def p_str(name, v):
    return {'name': name, 'value': {'stringValue': v}}

def p_uuid(name, v):
    return {'name': name, 'value': {'stringValue': v}, 'typeHint': 'UUID'}

def p_long(name, v):
    return {'name': name, 'value': {'longValue': int(v)}}

def p_double(name, v):
    return {'name': name, 'value': {'doubleValue': float(v)}}

def p_date(name, v):  # v: 'YYYY-MM-DD'
    return {'name': name, 'value': {'stringValue': v}, 'typeHint': 'DATE'}

def p_ts(name, v):    # v: 'YYYY-MM-DD HH:MM:SS'
    return {'name': name, 'value': {'stringValue': v}, 'typeHint': 'TIMESTAMP'}

def p_uuid_or_null(name, v):
    if v is None:
        return {'name': name, 'value': {'isNull': True}}
    return p_uuid(name, v)


def cell_str(c):
    if c.get('isNull'):
        return None
    return c.get('stringValue')


# ── Date helpers ────────────────────────────────────────────────────────────
def months_ago(d, m):
    month = d.month - m
    year = d.year
    while month <= 0:
        month += 12
        year -= 1
    # clamp day to the target month's length
    if month == 12:
        nxt = dt.date(year + 1, 1, 1)
    else:
        nxt = dt.date(year, month + 1, 1)
    last_day = (nxt - dt.timedelta(days=1)).day
    return dt.date(year, month, min(d.day, last_day))


def parse_time(s):
    if not s:
        return None
    parts = s.split(':')
    return dt.time(int(parts[0]), int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)


def main():
    today = dt.date.today()
    window_start = months_ago(today, MONTHS_BACK)
    stamp = today.isoformat()
    print(f"=== Backfill history for {EMAIL} ===")
    print(f"mode: {'APPLY (writing)' if APPLY else 'DRY-RUN (no writes)'}")
    print(f"window: {window_start} .. {today}  (last {MONTHS_BACK} months)\n")

    # Resolve tenant
    r = q("SELECT u.company_id::text, c.name, c.type "
          "FROM users u JOIN companies c ON c.id = u.company_id "
          "WHERE LOWER(u.email) = LOWER(:e)", [p_str('e', EMAIL)])
    if not r['records']:
        print("!! No user/company for that email. Aborting.")
        sys.exit(1)
    company_id = cell_str(r['records'][0][0])
    company_name = cell_str(r['records'][0][1])
    print(f"company: {company_name} ({company_id})")

    # A branch_id for sessions (NOT NULL). Prefer the courses' branch.
    rb = q("SELECT DISTINCT branch_id::text FROM courses WHERE company_id = :cid AND branch_id IS NOT NULL LIMIT 1",
           [p_uuid('cid', company_id)])
    branch_id = cell_str(rb['records'][0][0]) if rb['records'] else None
    if not branch_id:
        print("!! No branch found for this company's courses. Aborting.")
        sys.exit(1)
    print(f"branch: {branch_id}\n")

    # Guard against a previous backfill (would double-shift / duplicate).
    rg = q("SELECT COUNT(*) FROM sessions WHERE company_id = :cid AND notes LIKE 'backfill%'",
           [p_uuid('cid', company_id)])
    prior = int(rg['records'][0][0]['longValue'])
    if prior > 0 and not FORCE:
        print(f"!! Found {prior} sessions already tagged 'backfill%'. This script is one-shot.")
        print("   Re-running would shift start dates AGAIN and duplicate data. Aborting.")
        print("   (pass --force only if you know what you're doing)")
        sys.exit(1)

    # Courses for this company
    rc = q("SELECT id::text, name, branch_id::text, default_room_id::text "
           "FROM courses WHERE company_id = :cid AND is_active ORDER BY created_at",
           [p_uuid('cid', company_id)])
    courses = []
    for row in rc['records']:
        courses.append({
            'id': cell_str(row[0]),
            'name': cell_str(row[1]),
            'branch_id': cell_str(row[2]) or branch_id,
            'default_room_id': cell_str(row[3]),
        })
    print(f"courses: {len(courses)}")
    course_ids = [c['id'] for c in courses]
    if not courses:
        print("!! No active courses. Aborting.")
        sys.exit(1)

    # Classes for those courses (classes has no company_id; scope via course)
    in_list = ", ".join(f"'{cid}'" for cid in course_ids)
    rcl = q(f"SELECT c.id::text, c.course_id::text, c.name, c.start_time::text, c.end_time::text, "
            f"c.days_of_week, c.start_date::text, c.end_date::text "
            f"FROM classes c WHERE c.course_id IN ({in_list})")
    classes = []
    for row in rcl['records']:
        classes.append({
            'id': cell_str(row[0]),
            'course_id': cell_str(row[1]),
            'name': cell_str(row[2]),
            'start_time': parse_time(cell_str(row[3])),
            'end_time': parse_time(cell_str(row[4])),
            'days': [d.strip().upper() for d in (cell_str(row[5]) or '').split(',') if d.strip()],
            'start_date': cell_str(row[6]),
            'end_date': cell_str(row[7]),
            'default_room_id': None,
        })
    print(f"classes: {len(classes)}\n")

    # course_id -> default_room
    course_room = {c['id']: c['default_room_id'] for c in courses}
    course_branch = {c['id']: c['branch_id'] for c in courses}

    # Enrolled students per class (active in either enrollment table)
    def students_for_class(class_id):
        rs = q("SELECT student_id::text FROM ("
               "  SELECT student_id FROM enrollments "
               "    WHERE class_id = :clid AND company_id = :cid AND status NOT IN ('DROPPED','CANCELLED') "
               "  UNION "
               "  SELECT student_id FROM master_class_enrollments "
               "    WHERE class_id = :clid AND company_id = :cid AND status != 'DROPPED'"
               ") e",
               [p_uuid('clid', class_id), p_uuid('cid', company_id)])
        return [cell_str(x[0]) for x in rs['records']]

    # Enrolled active students per course
    def students_for_course(course_id):
        rs = q("SELECT s.id::text FROM students s JOIN ("
               "  SELECT student_id FROM enrollments "
               "    WHERE course_id = :coid AND company_id = :cid AND status NOT IN ('DROPPED','CANCELLED') "
               "  UNION "
               "  SELECT student_id FROM master_class_enrollments "
               "    WHERE course_id = :coid AND company_id = :cid AND status != 'DROPPED'"
               ") en ON en.student_id = s.id "
               "WHERE s.company_id = :cid AND s.is_active = true",
               [p_uuid('coid', course_id), p_uuid('cid', company_id)])
        return [cell_str(x[0]) for x in rs['records']]

    # Existing max session_number per course (to continue numbering)
    def max_session_number(course_id):
        rs = q("SELECT COALESCE(MAX(s.session_number), 0) FROM sessions s "
               "JOIN classes c ON c.id = s.class_id WHERE c.course_id = :coid",
               [p_uuid('coid', course_id)])
        return int(rs['records'][0][0].get('longValue', 0) or 0)

    # ── Build the session + attendance plan ─────────────────────────────────
    # Per course: collect (date, class) occurrences, sort by date, number them.
    occurrences = []  # dicts
    class_students_cache = {}
    for cl in classes:
        if not cl['days'] or not cl['start_time']:
            continue  # no schedule to expand
        post_shift_start = dt.date.fromisoformat(cl['start_date']) - dt.timedelta(days=0)
        post_shift_start = months_ago(dt.date.fromisoformat(cl['start_date']), MONTHS_BACK)
        end_date = dt.date.fromisoformat(cl['end_date']) if cl['end_date'] else None
        weekdays = {DAY_TO_WEEKDAY[d] for d in cl['days'] if d in DAY_TO_WEEKDAY}
        d = window_start
        while d <= today:
            if d.weekday() in weekdays and d >= post_shift_start and (end_date is None or d <= end_date):
                occurrences.append({'date': d, 'class': cl})
            d += dt.timedelta(days=1)

    # number per course chronologically, continuing from existing max
    per_course_counter = {}
    for coid in course_ids:
        per_course_counter[coid] = max_session_number(coid)
    occurrences.sort(key=lambda o: (o['class']['course_id'], o['date']))

    session_rows = []      # for INSERT
    attendance_rows = []   # for INSERT
    sessions_planned = 0
    att_planned = 0
    for occ in occurrences:
        cl = occ['class']
        coid = cl['course_id']
        per_course_counter[coid] += 1
        num = per_course_counter[coid]
        sid = str(uuid.uuid4())
        st = cl['start_time'] or DEFAULT_START
        if cl['end_time']:
            et = cl['end_time']
        else:
            et = (dt.datetime.combine(occ['date'], st) + dt.timedelta(minutes=DEFAULT_DUR_MIN)).time()
        start_ts = dt.datetime.combine(occ['date'], st).strftime('%Y-%m-%d %H:%M:%S')
        end_ts = dt.datetime.combine(occ['date'], et).strftime('%Y-%m-%d %H:%M:%S')
        room = cl['default_room_id'] or course_room.get(coid)
        session_rows.append([
            p_uuid('id', sid),
            p_uuid('cid', company_id),
            p_uuid('bid', course_branch.get(coid, branch_id)),
            p_uuid_or_null('rid', room),
            p_uuid('clid', cl['id']),
            p_long('num', num),
            p_ts('sd', start_ts),
            p_ts('ed', end_ts),
            p_str('notes', f'backfill {stamp}'),
        ])
        sessions_planned += 1

        if cl['id'] not in class_students_cache:
            class_students_cache[cl['id']] = students_for_class(cl['id'])
        for stid in class_students_cache[cl['id']]:
            if random.random() < ATTENDANCE_RATE:
                attendance_rows.append([p_uuid('sid', sid), p_uuid('stid', stid)])
                att_planned += 1

    # ── Build the exams + results plan ───────────────────────────────────────
    exam_rows = []
    result_rows = []
    span = max((today - window_start).days, EXAMS_PER_COURSE)
    course_student_cache = {}
    for c in courses:
        course_student_cache[c['id']] = students_for_course(c['id'])
    for c in courses:
        for i in range(1, EXAMS_PER_COURSE + 1):
            eid = str(uuid.uuid4())
            edate = (window_start + dt.timedelta(days=int(span * i / (EXAMS_PER_COURSE + 1)))).isoformat()
            exam_rows.append([
                p_uuid('id', eid),
                p_uuid('cid', company_id),
                p_uuid('bid', c['branch_id']),
                p_uuid('coid', c['id']),
                p_str('name', f'اختبار {i}'),
                p_date('edate', edate),
                p_double('maxg', EXAM_MAX_GRADE),
            ])
            for stid in course_student_cache[c['id']]:
                grade = str(random.randint(GRADE_MIN, GRADE_MAX))
                result_rows.append([
                    p_uuid('eid', eid),
                    p_uuid('cid', company_id),
                    p_uuid('coid', c['id']),
                    p_uuid('stid', stid),
                    p_str('grade', grade),
                ])

    # ── Summary ──────────────────────────────────────────────────────────────
    print("── PLAN ───────────────────────────────────────────────")
    print(f"1. Shift start_date -{MONTHS_BACK} months for {len(classes)} classes")
    print(f"2. Create {sessions_planned} sessions; ~{att_planned} attendance rows "
          f"(~{int(ATTENDANCE_RATE*100)}% of enrolled per session)")
    print(f"3. Create {len(exam_rows)} exams ({EXAMS_PER_COURSE}/course) out of {EXAM_MAX_GRADE}; "
          f"{len(result_rows)} grades (random {GRADE_MIN}-{GRADE_MAX})")
    print("───────────────────────────────────────────────────────\n")

    if not APPLY:
        print("DRY-RUN — nothing written. Re-run with --apply to commit.")
        return

    # ── Apply ──────────────────────────────────────────────────────────────────
    print("Applying...")
    # 1) shift class start dates
    q(f"UPDATE classes SET start_date = start_date - INTERVAL '{MONTHS_BACK} months', "
      f"updated_at = NOW() WHERE course_id IN ({in_list})")
    print(f"  shifted {len(classes)} classes")

    # 2) sessions then attendance
    if session_rows:
        run_batch(
            "INSERT INTO sessions (id, company_id, branch_id, room_id, class_id, session_number, "
            "start_date, end_date, started, notes) "
            "VALUES (:id, :cid, :bid, :rid, :clid, :num, :sd, :ed, true, :notes)",
            session_rows)
        print(f"  inserted {len(session_rows)} sessions")
    if attendance_rows:
        run_batch(
            "INSERT INTO session_attendance (session_id, student_id, attendance_type) "
            "VALUES (:sid, :stid, 'NORMAL') ON CONFLICT (session_id, student_id) DO NOTHING",
            attendance_rows)
        print(f"  inserted {len(attendance_rows)} attendance rows")

    # 3) exams then results
    if exam_rows:
        run_batch(
            "INSERT INTO exams (id, company_id, branch_id, course_id, name, exam_date, status, is_active, max_grade) "
            "VALUES (:id, :cid, :bid, :coid, :name, :edate, 'DONE', true, :maxg)",
            exam_rows)
        print(f"  inserted {len(exam_rows)} exams")
    if result_rows:
        run_batch(
            "INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade) "
            "VALUES (:eid, :cid, :coid, :stid, :grade) "
            "ON CONFLICT (exam_id, student_id) DO UPDATE SET grade = EXCLUDED.grade, "
            "recorded_at = NOW(), updated_at = NOW()",
            result_rows)
        print(f"  inserted {len(result_rows)} exam results")

    print("\nDone.")


if __name__ == '__main__':
    main()
