#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Populate the tenant owned by karimsaber@gmail.com (company "Karim") with a full
Arabic demo dataset:

  - 5 branches   (rename the existing empty MAIN branch to Arabic + 4 new)
  - 8 teachers + 5 secretaries  -> employees rows AND login users (linked)
  - 5 levels
  - 10 courses (2 per branch), instructors divided round-robin across the 8 teachers
  - 50 classes (5 groups per course), each taught by its course's teacher
  - 2000 students, distributed evenly across the 5 branches

All names are realistic Arabic (Egyptian) names. No enrollments are created
(not requested).

SAFETY:
  - Dry-run by default. Pass --apply to write to PROD.
  - Rows carry notes='seed-karimsaber' where a notes column exists (employees,
    classes, students) for easy rollback. Branches/courses/levels/users are
    identifiable because the account was empty before seeding.
  - Uses the AWS RDS Data API (profile 'personal', prod Aurora) like the other
    scripts in this folder.

Login password for every seeded staff account: Karim@12345
"""
import sys
import uuid
import random
import datetime as dt

import boto3
import bcrypt

# ── Prod connection (same constants as sibling scripts) ───────────────────────
CLUSTER_ARN = 'arn:aws:rds:eu-west-1:365729671026:cluster:automatemagicstack-prod-automatemagicauroradbef237-zojss5p60vxd'
SECRET_ARN  = 'arn:aws:secretsmanager:eu-west-1:365729671026:secret:/prod/automate-magic/db-credentials-f5Yvx9'
DATABASE    = 'automative_prod'
EMAIL       = 'karimsaber@gmail.com'

TAG         = 'seed-karimsaber'
TODAY       = dt.date(2026, 7, 1)
STAFF_PASSWORD = 'Karim@12345'
N_STUDENTS  = 2000

APPLY = '--apply' in sys.argv
random.seed(20260701)

client = boto3.Session(profile_name='personal', region_name='eu-west-1').client('rds-data')


# ── RDS Data API helpers ──────────────────────────────────────────────────────
def q(sql, params=None):
    k = dict(resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE, sql=sql)
    if params:
        k['parameters'] = params
    return client.execute_statement(**k)


def run_batch(sql, parameter_sets, chunk=100):
    total = 0
    for i in range(0, len(parameter_sets), chunk):
        client.batch_execute_statement(
            resourceArn=CLUSTER_ARN, secretArn=SECRET_ARN, database=DATABASE,
            sql=sql, parameterSets=parameter_sets[i:i + chunk])
        total += len(parameter_sets[i:i + chunk])
    return total


def p_str(n, v):   return {'name': n, 'value': {'stringValue': v}}
def p_uuid(n, v):  return {'name': n, 'value': {'stringValue': v}, 'typeHint': 'UUID'}
def p_long(n, v):  return {'name': n, 'value': {'longValue': int(v)}}
def p_dbl(n, v):   return {'name': n, 'value': {'doubleValue': float(v)}}
def p_bool(n, v):  return {'name': n, 'value': {'booleanValue': bool(v)}}
def p_date(n, v):  return {'name': n, 'value': {'stringValue': v}, 'typeHint': 'DATE'}
def p_time(n, v):  return {'name': n, 'value': {'stringValue': v}, 'typeHint': 'TIME'}
def p_uuid_null(n, v): return {'name': n, 'value': {'isNull': True}} if v is None else p_uuid(n, v)
def cell(x): return None if x.get('isNull') else x.get('stringValue', x.get('longValue'))


# ── Arabic name pools ─────────────────────────────────────────────────────────
MALE_FIRST = ['محمد','أحمد','محمود','مصطفى','عمر','علي','حسن','حسين','يوسف','إبراهيم',
              'خالد','كريم','عبد الله','عبد الرحمن','زياد','مازن','آدم','عمرو','طارق','سامي',
              'ياسين','مالك','باسل','حمزة','أنس','رامي','هاني','وليد','شريف','فارس',
              'مروان','أيمن','بلال','سيف','عبد العزيز','تامر','هشام','نادر','رأفت','جمال']
FEMALE_FIRST = ['مريم','فاطمة','نور','سارة','هنا','ملك','جنى','ليان','رودينا','حبيبة',
                'سلمى','ندى','دنيا','لينا','تالة','ريم','فرح','ياسمين','أسماء','دينا',
                'مي','هبة','رنا','شهد','لمى','رحمة','آية','إسراء','منة','جميلة',
                'روان','هايدي','نرمين','بسمة','شيماء','عبير','ولاء','مروة','هدير','صفاء']
SURNAME = ['عبد الرحمن','السيد','محمود','إبراهيم','عبد الله','حسن','علي','خليل','منصور','الشناوي',
           'عبد العزيز','فؤاد','رشدان','سليمان','عطية','زكي','ناصر','الحديدي','رشدي','صلاح',
           'فتحي','عبد الحميد','يوسف','كمال','شعبان','غانم','البنا','الديب','عوض','حجازي',
           'سعيد','مرسي','بدوي','الطنطاوي','عبد الفتاح','رمضان','قنديل','الشربيني','متولي','درويش']

TEACHERS = [
    ('أحمد محمود', 'عبد الرحمن'),
    ('محمد سمير', 'الشناوي'),
    ('مصطفى كامل', 'حسين'),
    ('عمر خالد', 'فؤاد'),
    ('منى إبراهيم', 'السيد'),
    ('هبة علي', 'عبد الله'),
    ('كريم ياسر', 'عبد العزيز'),
    ('نورهان أشرف', 'زكي'),
]
SECRETARIES = [
    ('سارة محمد', 'الحديدي'),
    ('دينا عادل', 'رشدي'),
    ('مريم طارق', 'سليمان'),
    ('إسراء حسن', 'عطية'),
    ('فاطمة', 'ناصر'),
]

# ── Static catalog data ───────────────────────────────────────────────────────
# (name, code) — first entry reuses/renames the existing MAIN branch.
BRANCHES = [
    ('فرع مدينة نصر', 'MAIN',  'القاهرة'),
    ('فرع المعادي', 'MAADI',   'القاهرة'),
    ('فرع مصر الجديدة', 'HELIO','القاهرة'),
    ('فرع 6 أكتوبر', 'OCT6',   'الجيزة'),
    ('فرع الإسكندرية', 'ALEX',  'الإسكندرية'),
]

LEVELS = [
    ('المستوى التمهيدي', 6),
    ('المستوى الأول', 8),
    ('المستوى الثاني', 10),
    ('المستوى الثالث', 12),
    ('المستوى المتقدم', 14),
]

COURSES = [
    ('أساسيات الروبوتات', 2000, 12, 18),
    ('الروبوتات المتقدمة', 3000, 16, 15),
    ('البرمجة بلغة سكراتش', 1500, 8, 20),
    ('برمجة بايثون للأطفال', 2500, 12, 18),
    ('الذكاء الاصطناعي للناشئين', 3500, 12, 15),
    ('إنترنت الأشياء IoT', 3000, 12, 15),
    ('الطباعة ثلاثية الأبعاد', 2800, 10, 12),
    ('تصميم الألعاب', 2200, 12, 18),
    ('الإلكترونيات وأردوينو', 2600, 12, 16),
    ('تطوير تطبيقات الويب', 3200, 16, 18),
]

GROUP_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ']
DAY_PATTERNS = [
    'SATURDAY,MONDAY,WEDNESDAY',
    'SUNDAY,TUESDAY,THURSDAY',
    'FRIDAY',
    'SATURDAY,TUESDAY',
    'SUNDAY,WEDNESDAY',
]
TIME_SLOTS = [('14:00:00', '15:30:00'), ('16:00:00', '17:30:00'), ('18:00:00', '19:30:00')]
# Must match ACQUISITION_CHANNELS in shared/interfaces/student.interface.ts (each has a CHANNEL_* i18n key)
ACQ = ['WALK_IN', 'FACEBOOK', 'INSTAGRAM', 'TWITTER', 'TIKTOK', 'REFERRAL', 'OTHER']


def eg_phone():
    return '01' + random.choice('0125') + ''.join(random.choice('0123456789') for _ in range(8))


def main():
    print(f"=== Seed Arabic demo data for {EMAIL} ===")
    print(f"mode: {'APPLY (writing to PROD)' if APPLY else 'DRY-RUN (no writes)'}\n")

    # Resolve tenant
    r = q("SELECT u.company_id::text, c.name FROM users u JOIN companies c ON c.id=u.company_id "
          "WHERE LOWER(u.email)=LOWER(:e)", [p_str('e', EMAIL)])
    if not r['records']:
        print("!! No user/company for that email. Aborting.")
        sys.exit(1)
    cid = cell(r['records'][0][0])
    cname = cell(r['records'][0][1])
    print(f"company: {cname} ({cid})")

    # Guard: refuse to double-seed
    prior = int(q("SELECT COUNT(*) FROM employees WHERE company_id=:c AND notes=:t",
                  [p_uuid('c', cid), p_str('t', TAG)])['records'][0][0]['longValue'])
    if prior > 0:
        print(f"!! Found {prior} employees already tagged '{TAG}'. Already seeded. Aborting.")
        sys.exit(1)

    # Existing MAIN branch (to be renamed, index 0)
    rb = q("SELECT id::text, code FROM branches WHERE company_id=:c ORDER BY created_at", [p_uuid('c', cid)])
    existing = {cell(x[1]): cell(x[0]) for x in rb['records']}
    main_branch_id = existing.get('MAIN') or (cell(rb['records'][0][0]) if rb['records'] else None)

    # ── Build branch rows ─────────────────────────────────────────────────────
    branch_ids = []
    new_branches = []  # (id, name, code, city)
    for i, (name, code, city) in enumerate(BRANCHES):
        if i == 0 and main_branch_id:
            branch_ids.append(main_branch_id)       # rename existing (UPDATE below)
        else:
            bid = str(uuid.uuid4())
            branch_ids.append(bid)
            new_branches.append((bid, name, code, city))

    # ── Build level rows ──────────────────────────────────────────────────────
    level_rows = [(str(uuid.uuid4()), name, age) for name, age in LEVELS]
    level_ids = [lid for lid, _, _ in level_rows]

    # ── Build employees + linked users ────────────────────────────────────────
    emp_rows = []   # params
    user_rows = []  # params
    ub_rows = []    # user_branches params
    staff_accounts = []  # (email, role, name)
    pw_hash = bcrypt.hashpw(STAFF_PASSWORD.encode(), bcrypt.gensalt(10)).decode()

    def add_staff(first, last, position, department, role, salary, idx, prefix):
        eid = str(uuid.uuid4())
        uid = str(uuid.uuid4())
        bidx = idx % len(branch_ids)
        bid = branch_ids[bidx]
        email = f"{prefix}{idx + 1}@karim-academy.com"
        phone = eg_phone()
        emp_rows.append([
            p_uuid('id', eid), p_str('fn', first), p_str('ln', last),
            p_str('email', email), p_str('phone', phone),
            p_str('pos', position), p_str('dep', department),
            p_dbl('sal', salary), p_str('stype', 'MONTHLY'),
            p_date('hire', (TODAY - dt.timedelta(days=random.randint(60, 900))).isoformat()),
            p_uuid('bid', bid), p_uuid('cid', cid), p_str('notes', TAG),
        ])
        user_rows.append([
            p_uuid('id', uid), p_str('email', email), p_str('pw', pw_hash),
            p_str('fn', first), p_str('ln', last), p_str('role', role),
            p_uuid('cid', cid), p_uuid('bid', bid), p_uuid('emp', eid),
        ])
        ub_rows.append([p_uuid('uid', uid), p_uuid('bid', bid), p_uuid('cid', cid)])
        staff_accounts.append((email, role, f'{first} {last}'))
        return eid, bid

    teacher_ids = []      # (emp_id, branch_id)
    for i, (first, last) in enumerate(TEACHERS):
        eid, bid = add_staff(first, last, 'مدرس', 'الأكاديمي', 'VIEWER',
                             random.choice([6000, 7000, 8000, 9000]), i, 'teacher')
        teacher_ids.append((eid, bid))
    for i, (first, last) in enumerate(SECRETARIES):
        add_staff(first, last, 'سكرتير', 'الإدارة', 'BRANCH_ADMIN',
                  random.choice([4500, 5000, 5500]), i, 'secretary')

    # ── Build courses (2 per branch), instructors divided across teachers ──────
    course_rows = []
    course_meta = []  # (course_id, branch_id, teacher_emp_id, max_students)
    for i, (name, price, duration, maxst) in enumerate(COURSES):
        coid = str(uuid.uuid4())
        bid = branch_ids[i % len(branch_ids)]
        teacher_eid, _ = teacher_ids[i % len(teacher_ids)]   # divide courses across 8 teachers
        lvl = level_ids[i % len(level_ids)]
        course_rows.append([
            p_uuid('id', coid), p_uuid('bid', bid), p_uuid('cid', cid),
            p_str('name', name), p_str('desc', f'كورس {name} بأكاديمية كريم للروبوتات'),
            p_dbl('price', price), p_long('dur', duration), p_long('max', maxst),
            p_uuid('inst', teacher_eid), p_uuid('lvl', lvl),
        ])
        course_meta.append((coid, bid, teacher_eid, maxst))

    # ── Build classes (5 groups per course) ───────────────────────────────────
    class_rows = []
    start_date = dt.date(2026, 6, 1)
    end_date = dt.date(2026, 12, 31)
    for coid, bid, teacher_eid, maxst in course_meta:
        for g in range(5):
            clid = str(uuid.uuid4())
            days = DAY_PATTERNS[g % len(DAY_PATTERNS)]
            st, et = TIME_SLOTS[g % len(TIME_SLOTS)]
            class_rows.append([
                p_uuid('id', clid), p_uuid('coid', coid), p_uuid('inst', teacher_eid),
                p_str('name', f'المجموعة {GROUP_LETTERS[g]}'),
                p_date('sd', start_date.isoformat()), p_date('ed', end_date.isoformat()),
                p_time('st', st), p_time('et', et), p_str('days', days),
                p_long('max', maxst), p_str('notes', TAG),
            ])

    # ── Build students (2000, spread across branches) ─────────────────────────
    student_rows = []
    seen_tokens = set()
    for i in range(N_STUDENTS):
        sid = str(uuid.uuid4())
        gender = 'MALE' if random.random() < 0.55 else 'FEMALE'
        first = random.choice(MALE_FIRST if gender == 'MALE' else FEMALE_FIRST)
        last = random.choice(SURNAME)
        parent = f'{random.choice(MALE_FIRST)} {last}'
        birth_year = random.randint(2010, 2020)
        dob = dt.date(birth_year, random.randint(1, 12), random.randint(1, 28))
        enroll = TODAY - dt.timedelta(days=random.randint(0, 540))
        tok = uuid.uuid4().hex
        while tok in seen_tokens:
            tok = uuid.uuid4().hex
        seen_tokens.add(tok)
        bid = branch_ids[i % len(branch_ids)]
        student_rows.append([
            p_uuid('id', sid), p_str('fn', first), p_str('ln', last),
            p_date('dob', dob.isoformat()), p_str('gen', gender),
            p_str('phone', eg_phone()), p_str('pname', parent), p_str('pphone', eg_phone()),
            p_uuid('bid', bid), p_uuid('cid', cid),
            p_date('enr', enroll.isoformat()), p_str('tok', tok),
            p_long('code', i + 1), p_str('acq', random.choice(ACQ)), p_str('notes', TAG),
        ])

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n── PLAN ─────────────────────────────────────────────")
    print(f"  branches : rename 1 (MAIN) + create {len(new_branches)}  = {len(branch_ids)} total")
    print(f"  levels   : {len(level_rows)}")
    print(f"  employees: {len(emp_rows)}  (8 teachers + 5 secretaries)")
    print(f"  users    : {len(user_rows)}  (login accounts, pw='{STAFF_PASSWORD}')")
    print(f"  courses  : {len(course_rows)}  (2 per branch)")
    print(f"  classes  : {len(class_rows)}  (5 per course)")
    print(f"  students : {len(student_rows)}  ({N_STUDENTS // len(branch_ids)} per branch)")
    print("  (also: companies.max_branches=5, max_users=20)")
    print("─────────────────────────────────────────────────────")
    # course -> teacher distribution
    from collections import Counter
    tc = Counter(t for _, _, t, _ in course_meta)
    tname = {eid: f'{f} {l}' for (eid, _), (f, l) in zip(teacher_ids, TEACHERS)}
    print("  course→teacher division:")
    for eid, n in tc.items():
        print(f"    {tname.get(eid, eid)}: {n} course(s)")

    if not APPLY:
        print("\nDRY-RUN — nothing written. Re-run with --apply to commit.")
        return

    print("\nApplying...")

    # 0) company limits
    q("UPDATE companies SET max_branches=5, max_users=20, updated_at=NOW() WHERE id=:c",
      [p_uuid('c', cid)])

    # 1) rename existing MAIN branch
    if main_branch_id:
        q("UPDATE branches SET name=:n, city=:city, is_active=true, updated_at=NOW() WHERE id=:id",
          [p_str('n', BRANCHES[0][0]), p_str('city', BRANCHES[0][2]), p_uuid('id', main_branch_id)])
        print(f"  renamed MAIN branch -> {BRANCHES[0][0]}")

    # 2) new branches
    if new_branches:
        run_batch("INSERT INTO branches (id, company_id, name, code, city, is_active, opening_date) "
                  "VALUES (:id, :cid, :n, :code, :city, true, :od)",
                  [[p_uuid('id', b[0]), p_uuid('cid', cid), p_str('n', b[1]),
                    p_str('code', b[2]), p_str('city', b[3]),
                    p_date('od', TODAY.isoformat())] for b in new_branches])
        print(f"  inserted {len(new_branches)} branches")

    # 3) levels
    run_batch("INSERT INTO levels (id, company_id, name, age) VALUES (:id, :cid, :n, :age)",
              [[p_uuid('id', lid), p_uuid('cid', cid), p_str('n', n), p_long('age', a)]
               for lid, n, a in level_rows])
    print(f"  inserted {len(level_rows)} levels")

    # 4) employees
    run_batch("INSERT INTO employees (id, first_name, last_name, email, phone, position, department, "
              "salary, salary_type, hire_date, branch_id, company_id, is_active, notes) "
              "VALUES (:id, :fn, :ln, :email, :phone, :pos, :dep, :sal, :stype, :hire, :bid, :cid, true, :notes)",
              emp_rows)
    print(f"  inserted {len(emp_rows)} employees")

    # 5) users (login) + user_branches
    run_batch("INSERT INTO users (id, email, password, first_name, last_name, role, company_id, "
              "branch_id, linked_employee_id, email_verified, is_active) "
              "VALUES (:id, :email, :pw, :fn, :ln, :role, :cid, :bid, :emp, true, true)",
              user_rows)
    run_batch("INSERT INTO user_branches (user_id, branch_id, company_id) "
              "VALUES (:uid, :bid, :cid) ON CONFLICT (user_id, branch_id) DO NOTHING", ub_rows)
    print(f"  inserted {len(user_rows)} login users (+ user_branches)")

    # 6) courses
    run_batch("INSERT INTO courses (id, branch_id, company_id, name, description, price, duration, "
              "max_students, instructor_id, level_id, is_active, payment_type) "
              "VALUES (:id, :bid, :cid, :name, :desc, :price, :dur, :max, :inst, :lvl, true, 'ONE_TIME')",
              course_rows)
    print(f"  inserted {len(course_rows)} courses")

    # 7) classes
    run_batch("INSERT INTO classes (id, course_id, instructor_id, name, start_date, end_date, "
              "start_time, end_time, days_of_week, max_students, current_enrollment, is_active, type, notes) "
              "VALUES (:id, :coid, :inst, :name, :sd, :ed, :st, :et, :days, :max, 0, true, 'OFFLINE', :notes)",
              class_rows)
    print(f"  inserted {len(class_rows)} classes")

    # 8) students
    run_batch("INSERT INTO students (id, first_name, last_name, date_of_birth, gender, phone, "
              "parent_name, parent_phone, branch_id, company_id, is_active, enrollment_date, "
              "qr_token, student_code, acquisition_channel, notes) "
              "VALUES (:id, :fn, :ln, :dob, :gen, :phone, :pname, :pphone, :bid, :cid, true, :enr, "
              ":tok, :code, :acq, :notes)",
              student_rows)
    print(f"  inserted {len(student_rows)} students")

    print("\nDone. Staff logins (password for all: %s):" % STAFF_PASSWORD)
    for email, role, name in staff_accounts:
        print(f"  {email}  [{role}]  {name}")


if __name__ == '__main__':
    main()
