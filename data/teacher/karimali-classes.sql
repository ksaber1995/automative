-- Populate classes for company karimali201094@gmail.com (netrofit)
-- Company: b6420df6-74fc-4d9d-ab56-78106b376f06
-- Branch:  fb5a38e1-1e09-4f58-a8d4-5360d89504ad
--
-- Courses:
--   eb5c873d-cad3-4f2a-b382-2a1b99f335ad  اللغة العربية الأول الإعدادي
--   393bb193-408d-4cab-ac76-41d19ed04d62  اللغة العربية الثاني الاعدادي
--   80f82ae6-4647-45d8-9fd7-47f58219f874  اللغة العربية الثالث الإعدادي
--
-- Schedule: Every day except Friday (SAT,SUN,MON,TUE,WED,THU)
-- Day pairs: SAT+TUE, SUN+WED, MON+THU
-- Hours: 1PM–11PM, 1h each, back-to-back
-- Rotation: Course1, Course2, Course3, Course1, Course2, Course3, ...
-- Naming: [grade] [day1] و[day2] الساعة [time]

-- =============================================
-- DAY PAIR 1: سبت وتلات  (SATURDAY,TUESDAY)
-- =============================================

-- 1PM–2PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي سبت وتلات الساعة واحدة',
  '2026-06-20', '2027-06-30', '13:00', '14:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 2PM–3PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي سبت وتلات الساعة اتنين',
  '2026-06-20', '2027-06-30', '14:00', '15:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 3PM–4PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي سبت وتلات الساعة تلاتة',
  '2026-06-20', '2027-06-30', '15:00', '16:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 4PM–5PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي سبت وتلات الساعة اربعة',
  '2026-06-20', '2027-06-30', '16:00', '17:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 5PM–6PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي سبت وتلات الساعة خمسة',
  '2026-06-20', '2027-06-30', '17:00', '18:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 6PM–7PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي سبت وتلات الساعة ستة',
  '2026-06-20', '2027-06-30', '18:00', '19:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 7PM–8PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي سبت وتلات الساعة سبعة',
  '2026-06-20', '2027-06-30', '19:00', '20:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 8PM–9PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي سبت وتلات الساعة تمنية',
  '2026-06-20', '2027-06-30', '20:00', '21:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 9PM–10PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي سبت وتلات الساعة تسعة',
  '2026-06-20', '2027-06-30', '21:00', '22:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- 10PM–11PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي سبت وتلات الساعة عشرة',
  '2026-06-20', '2027-06-30', '22:00', '23:00', 'SATURDAY,TUESDAY', 'OFFLINE', true, 0);

-- =============================================
-- DAY PAIR 2: حد واربع  (SUNDAY,WEDNESDAY)
-- =============================================

-- 1PM–2PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي حد واربع الساعة واحدة',
  '2026-06-21', '2027-06-30', '13:00', '14:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 2PM–3PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي حد واربع الساعة اتنين',
  '2026-06-21', '2027-06-30', '14:00', '15:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 3PM–4PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي حد واربع الساعة تلاتة',
  '2026-06-21', '2027-06-30', '15:00', '16:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 4PM–5PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي حد واربع الساعة اربعة',
  '2026-06-21', '2027-06-30', '16:00', '17:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 5PM–6PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي حد واربع الساعة خمسة',
  '2026-06-21', '2027-06-30', '17:00', '18:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 6PM–7PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي حد واربع الساعة ستة',
  '2026-06-21', '2027-06-30', '18:00', '19:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 7PM–8PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي حد واربع الساعة سبعة',
  '2026-06-21', '2027-06-30', '19:00', '20:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 8PM–9PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي حد واربع الساعة تمنية',
  '2026-06-21', '2027-06-30', '20:00', '21:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 9PM–10PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي حد واربع الساعة تسعة',
  '2026-06-21', '2027-06-30', '21:00', '22:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- 10PM–11PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي حد واربع الساعة عشرة',
  '2026-06-21', '2027-06-30', '22:00', '23:00', 'SUNDAY,WEDNESDAY', 'OFFLINE', true, 0);

-- =============================================
-- DAY PAIR 3: اتنين وخميس  (MONDAY,THURSDAY)
-- =============================================

-- 1PM–2PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي اتنين وخميس الساعة واحدة',
  '2026-06-22', '2027-06-30', '13:00', '14:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 2PM–3PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي اتنين وخميس الساعة اتنين',
  '2026-06-22', '2027-06-30', '14:00', '15:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 3PM–4PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي اتنين وخميس الساعة تلاتة',
  '2026-06-22', '2027-06-30', '15:00', '16:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 4PM–5PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي اتنين وخميس الساعة اربعة',
  '2026-06-22', '2027-06-30', '16:00', '17:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 5PM–6PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي اتنين وخميس الساعة خمسة',
  '2026-06-22', '2027-06-30', '17:00', '18:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 6PM–7PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي اتنين وخميس الساعة ستة',
  '2026-06-22', '2027-06-30', '18:00', '19:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 7PM–8PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي اتنين وخميس الساعة سبعة',
  '2026-06-22', '2027-06-30', '19:00', '20:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 8PM–9PM  تاني اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '393bb193-408d-4cab-ac76-41d19ed04d62',
  'تاني اعدادي اتنين وخميس الساعة تمنية',
  '2026-06-22', '2027-06-30', '20:00', '21:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 9PM–10PM  تالت اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), '80f82ae6-4647-45d8-9fd7-47f58219f874',
  'تالت اعدادي اتنين وخميس الساعة تسعة',
  '2026-06-22', '2027-06-30', '21:00', '22:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- 10PM–11PM  أول اعدادي
INSERT INTO classes (id, course_id, name, start_date, end_date, start_time, end_time, days_of_week, type, is_active, current_enrollment)
VALUES (uuid_generate_v4(), 'eb5c873d-cad3-4f2a-b382-2a1b99f335ad',
  'أول اعدادي اتنين وخميس الساعة عشرة',
  '2026-06-22', '2027-06-30', '22:00', '23:00', 'MONDAY,THURSDAY', 'OFFLINE', true, 0);

-- =============================================
-- SUMMARY: 30 classes total
-- Course 1 (أول اعدادي):  12 classes (4 per day pair)
-- Course 2 (تاني اعدادي):  9 classes (3 per day pair)
-- Course 3 (تالت اعدادي):  9 classes (3 per day pair)
--
-- Schedule per day pair (rotating):
--  1PM → Course1,  2PM → Course2,  3PM → Course3
--  4PM → Course1,  5PM → Course2,  6PM → Course3
--  7PM → Course1,  8PM → Course2,  9PM → Course3
-- 10PM → Course1
-- =============================================
