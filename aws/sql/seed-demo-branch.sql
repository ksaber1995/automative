-- Seed a fully populated demo branch for k@gmail.com (company 7c1df4c0-c0f0-4dd3-9b31-80b98098f785)
-- with employees, students, courses/classes, enrollments, events, revenues, expenses,
-- spread over the last 3 years (2023-05-14 → 2026-05-14).
-- One transaction; safe to re-run after deleting the branch.

DO $$
DECLARE
  v_company UUID := '7c1df4c0-c0f0-4dd3-9b31-80b98098f785';
  v_branch UUID;
  v_employees UUID[];
  v_instructors UUID[];
  v_courses UUID[];
  v_classes UUID[];
  v_students UUID[];
  v_events UUID[];
  v_start_date DATE := DATE '2023-05-14';
  v_today DATE := CURRENT_DATE;
  v_total_days INT;
  v_total_months INT;
  v_branch_code TEXT := 'DEMO-' || to_char(now(), 'YYYYMMDDHH24MISS');
BEGIN
  v_total_days := (v_today - v_start_date);
  v_total_months := ((extract(year FROM age(v_today, v_start_date))::int) * 12)
                     + extract(month FROM age(v_today, v_start_date))::int;

  -- ─────────────── 1) BRANCH ───────────────
  INSERT INTO branches (company_id, name, code, address, city, state, phone, email, opening_date, is_active)
  VALUES (v_company, 'Downtown Academy (Demo)', v_branch_code,
          '123 Main Street', 'Cairo', 'Cairo', '+20 100 000 0001',
          'downtown.demo@netrofit.com', v_start_date, true)
  RETURNING id INTO v_branch;

  -- ─────────────── 2) EMPLOYEES (25) ───────────────
  -- First 6 are instructors (linked from courses/classes); rest are admin/ops.
  WITH ins AS (
    INSERT INTO employees (first_name, last_name, email, phone, position, department,
                           salary, hire_date, branch_id, company_id, is_global, is_active)
    SELECT
      (ARRAY['Ahmed','Sara','Omar','Mona','Khaled','Heba','Tarek','Layla','Hassan','Nour',
             'Karim','Salma','Mostafa','Yara','Hossam','Dina','Tamer','Reem','Bassem','Rania',
             'Wael','Engy','Sherif','Aya','Magdy'])[g],
      (ARRAY['Hassan','Mohamed','Saad','Fawzy','Ibrahim','Ali','Sayed','Mahmoud','Ezz','Ramadan',
             'Aboul','Khalil','Naguib','Said','Fouad','Adel','Sami','Anwar','Lotfy','Galal',
             'Shawky','Younes','Riad','Halim','Bakr'])[g],
      'emp' || g || '.demo@netrofit-demo.local',
      '+2010' || LPAD(g::text, 8, '0'),
      CASE WHEN g <= 6  THEN 'Instructor'
           WHEN g <= 10 THEN 'Receptionist'
           WHEN g <= 14 THEN 'Coach Assistant'
           WHEN g <= 18 THEN 'Operations'
           WHEN g <= 22 THEN 'Cleaner'
           ELSE              'Manager' END,
      CASE WHEN g <= 6  THEN 'Teaching'
           WHEN g <= 10 THEN 'Front Desk'
           WHEN g <= 14 THEN 'Teaching'
           WHEN g <= 18 THEN 'Operations'
           WHEN g <= 22 THEN 'Facilities'
           ELSE              'Administration' END,
      CASE WHEN g <= 6  THEN 8000 + (g * 250)::numeric
           WHEN g <= 10 THEN 5000 + (g * 100)::numeric
           ELSE              4500 + (g *  75)::numeric END,
      v_start_date + ((g - 1) * 18),
      v_branch, v_company, false, true
    FROM generate_series(1, 25) AS g
    RETURNING id, position
  )
  SELECT
    array_agg(id ORDER BY id),
    array_agg(id ORDER BY id) FILTER (WHERE position = 'Instructor')
  INTO v_employees, v_instructors
  FROM ins;

  -- ─────────────── 3) COURSES (8) ───────────────
  WITH ins AS (
    INSERT INTO courses (branch_id, company_id, name, code, description, price, duration,
                         max_students, instructor_id, is_active)
    SELECT
      v_branch, v_company,
      (ARRAY['Karate Basics','Karate Advanced','Yoga Foundations','Yoga Pro',
             'Kickboxing','Crossfit Intro','Swimming Kids','Pilates'])[g],
      'C' || g || '-' || substring(v_branch_code from 6),
      'Demo course #' || g,
      (ARRAY[1200,1800,1000,1600,2000,2200,1400,1500])[g]::numeric,
      8,
      20,
      v_instructors[((g - 1) % array_length(v_instructors, 1)) + 1],
      true
    FROM generate_series(1, 8) AS g
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_courses FROM ins;

  -- ─────────────── 4) CLASSES (16, two per course, spread across 3 years) ───────────────
  WITH ins AS (
    INSERT INTO classes (course_id, branch_id, company_id, instructor_id, name, code,
                         start_date, end_date, start_time, end_time, days_of_week,
                         max_students, current_enrollment, is_active, is_finished)
    SELECT
      v_courses[((g - 1) % 8) + 1],
      v_branch, v_company,
      v_instructors[((g - 1) % array_length(v_instructors, 1)) + 1],
      'Cohort ' || g,
      'CLS' || g || '-' || substring(v_branch_code from 6),
      v_start_date + ((g - 1) * 60),
      v_start_date + ((g - 1) * 60) + 90,
      '17:00'::time, '18:30'::time,
      'MON,WED', 20, 0, true,
      (v_start_date + ((g - 1) * 60) + 90) < v_today
    FROM generate_series(1, 16) AS g
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_classes FROM ins;

  -- ─────────────── 5) STUDENTS (200) ───────────────
  -- enrollment_date uniformly distributed across the 3-year window;
  -- ~10% are inactive (churned in the past year).
  WITH ins AS (
    INSERT INTO students (first_name, last_name, date_of_birth, email, phone,
                          parent_name, parent_phone, parent_email, address,
                          branch_id, company_id, is_active, enrollment_date, inactive_date)
    SELECT
      (ARRAY['Ali','Mariam','Youssef','Habiba','Adam','Lina','Zeyad','Jana','Malak','Selim',
             'Farida','Karim','Nour','Hassan','Salma','Mostafa','Yara','Hossam','Dina','Tamer'])[((g - 1) % 20) + 1],
      'Family' || g,
      v_start_date - ((random() * 365 * 12 + 365 * 6)::int),  -- age 6-18-ish
      'student' || g || '.demo@netrofit-demo.local',
      '+2011' || LPAD(g::text, 8, '0'),
      'Parent ' || g, '+2012' || LPAD(g::text, 8, '0'),
      'parent' || g || '.demo@netrofit-demo.local',
      'Apt ' || g || ', Demo Street',
      v_branch, v_company,
      CASE WHEN g % 10 = 0 THEN false ELSE true END,
      v_start_date + ((random() * v_total_days)::int),
      CASE WHEN g % 10 = 0
           THEN v_today - ((random() * 365)::int)
           ELSE NULL END
    FROM generate_series(1, 200) AS g
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_students FROM ins;

  -- ─────────────── 6) EVENTS (30 across 3 years, branch-scoped) ───────────────
  WITH ins AS (
    INSERT INTO events (company_id, branch_id, name, code, event_type, description,
                        location, start_date, end_date, status,
                        subscription_price, is_active)
    SELECT
      v_company, v_branch,
      (ARRAY['Summer Camp','Winter Cup','Open Tournament','Family Day','Friendly Match',
             'Belt Test','Annual Show','Charity Run','Workshop','Demo Day'])[((g - 1) % 10) + 1]
        || ' ' || to_char(v_start_date + ((g - 1) * (v_total_days / 30)), 'YYYY-MM'),
      'EVT' || g || '-' || substring(v_branch_code from 6),
      (ARRAY['CAMP','COMPETITION','WORKSHOP','SHOW','OTHER'])[((g - 1) % 5) + 1],
      'Demo event #' || g,
      'Downtown Academy hall',
      v_start_date + ((g - 1) * (v_total_days / 30)),
      v_start_date + ((g - 1) * (v_total_days / 30)) + 2,
      CASE WHEN (v_start_date + ((g - 1) * (v_total_days / 30)) + 2) < v_today
           THEN 'COMPLETED' ELSE 'PLANNED' END,
      (ARRAY[100,150,200,250,300,75,125,175])[((g - 1) % 8) + 1]::numeric,
      true
    FROM generate_series(1, 30) AS g
    RETURNING id
  )
  SELECT array_agg(id ORDER BY id) INTO v_events FROM ins;

  -- ─────────────── 7) ENROLLMENTS (one per student, all PAID) ───────────────
  INSERT INTO enrollments (student_id, class_id, course_id, branch_id,
                           enrollment_date, status,
                           original_price, discount_percent, discount_amount, final_price,
                           payment_mode, down_payment, amount_paid, payment_status,
                           total_refunded, company_id)
  SELECT
    s.id,
    v_classes[((((row_number() OVER (ORDER BY s.enrollment_date)) - 1) % 16) + 1)],
    v_courses[((((row_number() OVER (ORDER BY s.enrollment_date)) - 1) % 8) + 1)],
    v_branch,
    s.enrollment_date,
    CASE WHEN s.inactive_date IS NOT NULL THEN 'DROPPED'
         WHEN s.enrollment_date + 90 < v_today THEN 'COMPLETED'
         ELSE 'ACTIVE' END,
    (ARRAY[1200,1800,1000,1600,2000,2200,1400,1500])[
      ((((row_number() OVER (ORDER BY s.enrollment_date)) - 1) % 8) + 1)
    ]::numeric AS orig,
    0,
    0,
    (ARRAY[1200,1800,1000,1600,2000,2200,1400,1500])[
      ((((row_number() OVER (ORDER BY s.enrollment_date)) - 1) % 8) + 1)
    ]::numeric,
    'FULL',
    0,
    (ARRAY[1200,1800,1000,1600,2000,2200,1400,1500])[
      ((((row_number() OVER (ORDER BY s.enrollment_date)) - 1) % 8) + 1)
    ]::numeric,
    'PAID',
    0,
    v_company
  FROM students s
  WHERE s.branch_id = v_branch
  ORDER BY s.enrollment_date;

  -- ─────────────── 8) REVENUES — one per enrollment ───────────────
  INSERT INTO revenues (branch_id, course_id, enrollment_id, student_id,
                        amount, description, date, payment_method, receipt_number)
  SELECT
    e.branch_id, e.course_id, e.id, e.student_id,
    e.final_price,
    'Demo enrollment payment',
    e.enrollment_date,
    (ARRAY['CASH','BANK_TRANSFER','CREDIT_CARD'])[((row_number() OVER (ORDER BY e.id)) % 3) + 1],
    'R-' || to_char(e.enrollment_date, 'YYYYMM') || '-' || substring(e.id::text from 1 for 8)
  FROM enrollments e
  WHERE e.branch_id = v_branch;

  -- ─────────────── 9) EVENT REVENUES — random small subscriptions per event ───────────────
  INSERT INTO revenues (branch_id, event_id, student_id,
                        amount, description, date, payment_method, receipt_number)
  SELECT
    v_branch, ev.id,
    v_students[((row_number() OVER (PARTITION BY ev.id ORDER BY ev.id, g)) % 200) + 1],
    150 + (random() * 100)::numeric(10,2),
    'Event subscription (demo)',
    ev.start_date,
    'CASH',
    'EV-' || substring(ev.id::text from 1 for 8) || '-' || g
  FROM (SELECT id, start_date FROM events WHERE branch_id = v_branch) ev
  CROSS JOIN generate_series(1, 5) AS g;

  -- ─────────────── 10) EXPENSES + EXPENSE_PAYMENTS (monthly rent + utilities + salaries) ───────────────
  -- Rent (FIXED 6000/mo)
  INSERT INTO expense_payments (company_id, branch_id, type, category, amount, date, vendor, notes)
  SELECT v_company, v_branch, 'FIXED', 'RENT', 6000,
         (date_trunc('month', v_start_date) + (n * INTERVAL '1 month'))::date,
         'Downtown Landlord',
         'Monthly rent (demo)'
  FROM generate_series(0, v_total_months) n
  WHERE (date_trunc('month', v_start_date) + (n * INTERVAL '1 month'))::date <= v_today;

  -- Utilities (1200/mo)
  INSERT INTO expense_payments (company_id, branch_id, type, category, amount, date, vendor, notes)
  SELECT v_company, v_branch, 'VARIABLE', 'UTILITIES', 1200,
         (date_trunc('month', v_start_date) + (n * INTERVAL '1 month') + INTERVAL '5 days')::date,
         'Egyptian Electricity Co.',
         'Monthly utilities (demo)'
  FROM generate_series(0, v_total_months) n
  WHERE (date_trunc('month', v_start_date) + (n * INTERVAL '1 month'))::date <= v_today;

  -- Salaries (paid the 28th of each month, one row per active employee in that month)
  INSERT INTO expense_payments (company_id, branch_id, employee_id, type, category, amount, date, notes)
  SELECT
    v_company, v_branch, emp.id, 'FIXED', 'SALARIES', emp.salary,
    (date_trunc('month', v_start_date) + (n * INTERVAL '1 month') + INTERVAL '27 days')::date,
    'Monthly salary (demo)'
  FROM generate_series(0, v_total_months) n
  CROSS JOIN (SELECT id, salary, hire_date FROM employees WHERE branch_id = v_branch) emp
  WHERE (date_trunc('month', v_start_date) + (n * INTERVAL '1 month'))::date <= v_today
    AND (date_trunc('month', v_start_date) + (n * INTERVAL '1 month'))::date >= emp.hire_date;

  -- One-off marketing burst per quarter
  INSERT INTO expense_payments (company_id, branch_id, type, category, amount, date, vendor, notes)
  SELECT v_company, v_branch, 'VARIABLE', 'MARKETING',
         800 + (random() * 1200)::numeric(10,2),
         (date_trunc('quarter', v_start_date) + (n * INTERVAL '3 months') + INTERVAL '10 days')::date,
         'Facebook Ads',
         'Quarterly campaign (demo)'
  FROM generate_series(0, (v_total_months / 3) + 1) n
  WHERE (date_trunc('quarter', v_start_date) + (n * INTERVAL '3 months'))::date <= v_today;

  RAISE NOTICE 'Seed complete. branch_id=%, employees=%, students=%, events=%',
    v_branch,
    array_length(v_employees, 1),
    array_length(v_students, 1),
    array_length(v_events, 1);
END$$;
