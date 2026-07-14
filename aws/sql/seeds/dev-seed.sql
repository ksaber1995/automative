-- =============================================================================
-- DEV SEED: ~200 students + courses + classes + enrollments over 3 years
-- Target: company k@gmail.com (id 7c1df4c0-c0f0-4dd3-9b31-80b98098f785)
-- All seeded rows are tagged with notes = '[seed]' so they can be identified
-- and removed via the dev-seed-cleanup.sql file.
--
-- Run via Data API:
--   aws rds-data execute-statement \
--     --profile personal --region eu-west-1 \
--     --resource-arn "$RDS_ARN" --secret-arn "$SECRET_ARN" \
--     --database automative \
--     --sql "$(cat aws/sql/seeds/dev-seed.sql)"
-- =============================================================================
DO $$
DECLARE
  v_company_id UUID := '7c1df4c0-c0f0-4dd3-9b31-80b98098f785';
  v_branch_ids UUID[];
  v_branch_id UUID;
  v_student_id UUID;
  v_course_id UUID;
  v_class_id UUID;
  v_enrollment_id UUID;
  v_first VARCHAR;
  v_last VARCHAR;
  v_enrollment_date DATE;  -- local "joined" date (drives inactive_date math); NOT a students column
  v_dob DATE;
  v_status VARCHAR;
  v_start_date DATE;
  v_end_date DATE;
  v_finished BOOLEAN;
  v_price NUMERIC;
  v_paid NUMERIC;
  v_payment_status VARCHAR;
  v_completion_date DATE;
  v_is_active BOOLEAN;
  v_first_names VARCHAR[] := ARRAY[
    'Ahmed','Mohamed','Omar','Youssef','Khaled','Adam','Hassan','Hussein','Karim','Mahmoud',
    'Ali','Ibrahim','Mostafa','Sameh','Nour','Hamza','Tarek','Sherif','Bassel','Ramy',
    'Sara','Salma','Dina','Yasmin','Heba','Nada','Layla','Maya','Lina','Reem',
    'Mariam','Habiba','Farida','Aya','Hana','Rania','Marwa','Maha','Hala','Noha'
  ];
  v_last_names VARCHAR[] := ARRAY[
    'Hassan','Mohamed','Ali','Mahmoud','Khaled','Ahmed','Ibrahim','Said','Fouad','Naguib',
    'Saleh','Salem','Hamdy','Refaat','Galal','Adel','Wahid','Fawzy','Nabil','Nasser',
    'Yousef','Helmy','Abdelaziz','Abdelrahman','Ezzat','Magdy','Sami','Lotfy','Sabry','Tawfik'
  ];
  v_course_names TEXT[] := ARRAY[
    'Algebra','Geometry','Calculus','Physics','Chemistry','Biology','English','Arabic',
    'French','German','Programming Basics','Web Development','Data Science','Robotics',
    'Math Olympiad','Spanish','Public Speaking','Critical Thinking','SAT Prep','IELTS Prep'
  ];
  i INT;
  j INT;
  n_classes INT;
  enrollment_count INT;
  rand_offset INT;
BEGIN
  SELECT array_agg(id) INTO v_branch_ids
  FROM branches WHERE company_id = v_company_id AND is_active = true;
  IF v_branch_ids IS NULL OR array_length(v_branch_ids, 1) = 0 THEN
    RAISE EXCEPTION 'No active branches for company %', v_company_id;
  END IF;

  -- ───────────────────────────── 1) Courses (15) ──────────────────────────────
  -- Mix of active (~75%) and inactive (~25%) across all branches.
  FOR i IN 1..15 LOOP
    v_branch_id := v_branch_ids[1 + floor(random() * array_length(v_branch_ids, 1))::int];
    v_course_id := gen_random_uuid();
    v_price := (1500 + floor(random() * 4000))::NUMERIC;
    INSERT INTO courses (id, company_id, branch_id, name, code, description, price, duration, max_students, is_active)
    VALUES (
      v_course_id, v_company_id, v_branch_id,
      '[seed] ' || v_course_names[1 + floor(random() * array_length(v_course_names, 1))::int] || ' #' || i,
      'SC' || i || '-' || floor(random() * 1000)::text,
      '[seed] auto-generated course',
      v_price,
      8 + floor(random() * 16)::int,
      20,
      random() > 0.25
    );

    -- 3-5 classes per course; cover ~3 years and reach ~90 days into the future
    -- so we get a healthy mix of finished, ongoing, and scheduled classes.
    n_classes := 3 + floor(random() * 3)::int;
    FOR j IN 1..n_classes LOOP
      v_start_date := DATE '2023-01-01' + (random() * 1300)::int;
      v_end_date := v_start_date + (45 + floor(random() * 90))::int;
      v_finished := v_end_date < CURRENT_DATE - 14;
      v_class_id := gen_random_uuid();
      INSERT INTO classes (id, company_id, course_id, branch_id, name, code, start_date, end_date, max_students, current_enrollment, is_active, is_finished, finished_at, notes)
      VALUES (
        v_class_id, v_company_id, v_course_id, v_branch_id,
        '[seed] Class ' || i || '-' || j,
        'SCL' || i || '-' || j || '-' || floor(random() * 10000)::text,
        v_start_date, v_end_date,
        20, 0,
        NOT v_finished, v_finished,
        CASE WHEN v_finished THEN v_end_date::timestamptz ELSE NULL END,
        '[seed]'
      );
    END LOOP;
  END LOOP;

  -- ───────────────────────────── 2) Students (200) ────────────────────────────
  FOR i IN 1..200 LOOP
    v_first := v_first_names[1 + floor(random() * array_length(v_first_names, 1))::int];
    v_last := v_last_names[1 + floor(random() * array_length(v_last_names, 1))::int];
    v_branch_id := v_branch_ids[1 + floor(random() * array_length(v_branch_ids, 1))::int];
    v_enrollment_date := DATE '2023-01-01' + (random() * 850)::int;
    v_dob := DATE '2000-01-01' + (random() * 7000)::int;
    -- ~15% gone (churned), 70% active, 15% inactive (deactivated)
    rand_offset := floor(random() * 100)::int;
    IF rand_offset < 15 THEN
      v_is_active := false;
    ELSIF rand_offset < 30 THEN
      v_is_active := false;
    ELSE
      v_is_active := true;
    END IF;
    v_student_id := gen_random_uuid();
    -- created_at IS the join date now that students.enrollment_date is gone, so set it
    -- explicitly from v_enrollment_date; the DEFAULT now() would flatten every seeded
    -- student onto today and break the historical spread the reports rely on.
    INSERT INTO students (id, company_id, branch_id, first_name, last_name, date_of_birth,
                          parent_name, parent_phone,
                          is_active,
                          inactive_date, inactive_reason, notes, created_at)
    VALUES (
      v_student_id, v_company_id, v_branch_id,
      v_first, v_last, v_dob,
      'Parent of ' || v_first,
      '+201' || lpad(floor(random() * 999999999)::text, 9, '0'),
      v_is_active,
      CASE WHEN NOT v_is_active THEN v_enrollment_date + (60 + floor(random() * 700))::int ELSE NULL END,
      CASE WHEN NOT v_is_active THEN 'Moved' ELSE NULL END,
      '[seed]',
      v_enrollment_date::timestamptz
    );
  END LOOP;

  -- ───────────────────────── 3) Enrollments (1-3 per student) ─────────────────
  FOR v_student_id, v_branch_id IN
    SELECT id, branch_id FROM students WHERE company_id = v_company_id AND notes = '[seed]'
  LOOP
    enrollment_count := 1 + floor(random() * 3)::int;
    FOR i IN 1..enrollment_count LOOP
      SELECT cl.id, cl.course_id, cl.start_date, cl.is_finished, c.price
        INTO v_class_id, v_course_id, v_start_date, v_finished, v_price
      FROM classes cl
      INNER JOIN courses c ON c.id = cl.course_id
      WHERE cl.company_id = v_company_id AND cl.branch_id = v_branch_id
        AND cl.notes = '[seed]'
      ORDER BY random()
      LIMIT 1;

      IF v_class_id IS NULL THEN CONTINUE; END IF;

      IF v_finished THEN
        -- 85% completed, 15% dropped
        v_status := CASE WHEN random() < 0.85 THEN 'COMPLETED' ELSE 'DROPPED' END;
        v_completion_date := v_start_date + 60;
      ELSE
        -- 90% active, 10% dropped
        v_status := CASE WHEN random() < 0.90 THEN 'ACTIVE' ELSE 'DROPPED' END;
        v_completion_date := NULL;
      END IF;

      v_paid := CASE
        WHEN random() < 0.7 THEN v_price          -- fully paid
        WHEN random() < 0.85 THEN round((v_price * (0.3 + random() * 0.6))::numeric, 2)  -- partial
        ELSE 0::numeric                            -- none
      END;
      v_payment_status := CASE
        WHEN v_paid >= v_price THEN 'PAID'
        WHEN v_paid > 0 THEN 'PARTIAL'
        ELSE 'PENDING'
      END;

      v_enrollment_id := gen_random_uuid();
      INSERT INTO enrollments (id, company_id, student_id, class_id, course_id, branch_id,
                                enrollment_date, status, original_price, discount_percent,
                                discount_amount, final_price, payment_mode, down_payment,
                                amount_paid, payment_status, completion_date, notes)
      VALUES (
        v_enrollment_id, v_company_id, v_student_id, v_class_id, v_course_id, v_branch_id,
        v_start_date - floor(random() * 14)::int,
        v_status,
        v_price, 0, 0, v_price,
        'FULL', v_paid, v_paid, v_payment_status,
        v_completion_date,
        '[seed]'
      );

      -- Bump class enrollment count
      UPDATE classes SET current_enrollment = current_enrollment + 1 WHERE id = v_class_id;
    END LOOP;
  END LOOP;
END $$;
