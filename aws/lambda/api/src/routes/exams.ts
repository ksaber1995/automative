import { insert, update, query, queryOne, getClient } from '../db/connection';
import { ensureQrCardSchema, qrStudentMatch, codeDigits } from './qr-cards';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { studentIsPresent } from '../db/active-students';
import { sendExamResultsSms } from '../services/sms/triggers';
import { sendExamResultNotifications, sendExamAbsenceTelegram } from './telegram';
import { ensureHomeworkGradingColumn, assertOnlineExams, isOnlineExamsEnabled } from './companies';
import { ensureLessonSchema, lessonPoolSize, lessonsInCourse } from './lessons';
import { ensureStudentAuthSchema, canonicalIdentifier, USERNAME_SHAPE, MIN_PASSWORD_LENGTH } from './student-auth';
import bcrypt from 'bcryptjs';
import { gradeAttempt } from '../db/exam-grading';
import { pushExamResult, pushExamAbsence } from '../utils/push';

type AuthHeaders = { authorization: string };

/**
 * Rating homework is always out of this — see homework-rating.util.ts on the
 * client, which owns the labels. Keep the two in step.
 */
export const HOMEWORK_RATING_MAX = 5;

/**
 * Whether a mark should READ as a rating rather than a number. Same rule the
 * marking panel uses: the company is in RATING mode and the item is out of 5.
 * An older homework out of 10 keeps its number, because relabelling a stored 7
 * would invent a meaning nobody recorded.
 *
 * Tolerant of a database that has not had the column added yet — that is a
 * number-marking company by definition.
 */
export async function isRatingCompany(companyId: string): Promise<boolean> {
  try {
    await ensureHomeworkGradingColumn();
    const row = await queryOne<any>(
      'SELECT homework_grading_mode FROM companies WHERE id = $1',
      [companyId],
    );
    return row?.homework_grading_mode === 'RATING';
  } catch {
    return false;
  }
}

/**
 * Idempotent runtime guard — creates the exam tables if a DB hasn't had
 * migration 035 applied yet (mirrors ensureAttendanceMagicColumns in
 * routes/sessions.ts). Cheap once the tables exist.
 */
let examTablesEnsured = false;
export async function ensureExamTables(): Promise<void> {
  if (examTablesEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS exams (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
      course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name        VARCHAR(255) NOT NULL,
      exam_date   DATE NOT NULL,
      status      VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('SCHEDULED', 'DONE')),
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_company   ON exams(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_branch    ON exams(branch_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_course    ON exams(course_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_exam_date ON exams(exam_date)`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS max_grade DECIMAL(6, 2)`);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_results (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      course_id   UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
      student_id  UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
      grade       VARCHAR(50) NOT NULL,
      recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, student_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_results_exam    ON exam_results(exam_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_results_student ON exam_results(student_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_results_company ON exam_results(company_id)`);

  // Homework (migration 059): rides on the exams table behind a flag. A homework
  // belongs to a class; session_id is nullable because a teacher records homework
  // when they want to, not necessarily on every session. Both FKs are SET NULL so
  // deleting a session never destroys the marks recorded in it.
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_homework BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS class_id   UUID REFERENCES classes(id)  ON DELETE SET NULL`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_class    ON exams(class_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_session  ON exams(session_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_homework ON exams(company_id, is_homework)`);

  // Online exams (migration 103): same table, behind a flag, same as homework. The
  // paper is drawn from the question banks of the lessons in exam_lessons and the
  // auto-computed mark lands in exam_results, so the whole existing grading stack
  // applies to it unchanged.
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_count INTEGER`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration_minutes INTEGER`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS opens_at TIMESTAMP WITH TIME ZONE`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS closes_at TIMESTAMP WITH TIME ZONE`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS access_code VARCHAR(12)`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN NOT NULL DEFAULT true`);
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers BOOLEAN NOT NULL DEFAULT true`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exams_online ON exams(company_id, is_online)`);
  // The FK targets `lessons`, so that table has to exist first on a database that
  // predates the online-exams feature.
  await ensureLessonSchema();
  await query(`
    CREATE TABLE IF NOT EXISTS exam_lessons (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id    UUID NOT NULL REFERENCES exams(id)   ON DELETE CASCADE,
      lesson_id  UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, lesson_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_lessons_exam ON exam_lessons(exam_id)`);

  // The sitting (migration 105): one attempt per student, and the paper drawn
  // for them — snapshotted at start so a later bank edit never rewrites it.
  await query(`
    CREATE TABLE IF NOT EXISTS exam_attempts (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id      UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
      company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      student_id   UUID NOT NULL REFERENCES students(id)  ON DELETE CASCADE,
      status       VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS'
                     CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED')),
      started_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at   TIMESTAMP WITH TIME ZONE,
      submitted_at TIMESTAMP WITH TIME ZONE,
      score        INTEGER,
      total        INTEGER,
      created_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, student_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam    ON exam_attempts(exam_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON exam_attempts(student_id)`);
  await query(`
    CREATE TABLE IF NOT EXISTS exam_attempt_questions (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      attempt_id  UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
      question_id UUID REFERENCES lesson_questions(id) ON DELETE SET NULL,
      lesson_id   UUID REFERENCES lessons(id)          ON DELETE SET NULL,
      order_index INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      options     JSONB NOT NULL,
      selected_option_id UUID,
      is_correct  BOOLEAN,
      answered_at TIMESTAMP WITH TIME ZONE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (attempt_id, order_index)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_eaq_attempt  ON exam_attempt_questions(attempt_id, order_index)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eaq_question ON exam_attempt_questions(question_id)`);

  examTablesEnsured = true;
}

/**
 * A short code the teacher reads out so nobody starts before the class does.
 *
 * No 0/O/1/I/5/S: it gets read off a screen, said out loud, and typed on a phone.
 * Stored and compared upper-case.
 */
function generateAccessCode(length = 6): string {
  const alphabet = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** The lessons an online exam draws from, in curriculum order. */
async function loadExamLessonIds(examId: string): Promise<string[]> {
  const rows = await query<any>(
    `SELECT el.lesson_id
       FROM exam_lessons el
       JOIN lessons l ON l.id = el.lesson_id
      WHERE el.exam_id = $1
      ORDER BY l.order_index, l.name`,
    [examId],
  );
  return rows.map((r) => r.lesson_id);
}

/** Replaces an exam's lesson scope with exactly this list. */
async function writeExamLessons(examId: string, lessonIds: string[]): Promise<void> {
  await query('DELETE FROM exam_lessons WHERE exam_id = $1', [examId]);
  for (const lessonId of lessonIds) {
    await query(
      `INSERT INTO exam_lessons (exam_id, lesson_id) VALUES ($1, $2)
       ON CONFLICT (exam_id, lesson_id) DO NOTHING`,
      [examId, lessonId],
    );
  }
}

/**
 * Has anybody started this exam yet?
 *
 * Once they have, the lesson scope and question count are frozen: papers already
 * drawn came from that pool, and changing it would leave two students marked out of
 * different things under one exam. Tolerant of a database with no attempts table
 * yet — that is "nobody has started" by definition.
 */
async function examHasAttempts(examId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT CASE WHEN to_regclass('public.exam_attempts') IS NULL THEN 0
                 ELSE (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = $1)
            END AS total`,
    [examId],
  );
  return parseInt(row?.total ?? '0', 10) > 0;
}

/**
 * Validates and normalises the online settings of an exam being saved.
 *
 * Returns `{ error }` with a translation key, or the columns to write plus the
 * lesson ids to store alongside them.
 *
 * The two checks that matter: the lessons must belong to the exam's own course
 * (otherwise the paper would examine material this class was never taught), and the
 * question count must not exceed the pool it draws from (otherwise every student
 * gets a short paper and nobody finds out until the first sitting).
 */
async function resolveOnlineSettings(
  body: any,
  courseId: string,
  companyId: string,
  existing?: any,
): Promise<{ error: string; detail?: string } | { columns: Record<string, any>; lessonIds: string[] }> {
  const requestedLessons: string[] = Array.isArray(body.lessonIds)
    ? body.lessonIds
    : existing
      ? await loadExamLessonIds(existing.id)
      : [];

  const lessonIds = await lessonsInCourse(requestedLessons, courseId, companyId);
  if (!lessonIds.length) return { error: 'ERRORS.EXAMS.LESSONS_REQUIRED' };
  if (Array.isArray(body.lessonIds) && lessonIds.length !== body.lessonIds.length) {
    return { error: 'ERRORS.EXAMS.LESSON_COURSE_MISMATCH' };
  }

  const rawCount = body.questionCount ?? existing?.question_count;
  const questionCount = rawCount === null || rawCount === undefined ? NaN : parseInt(rawCount, 10);
  if (!Number.isFinite(questionCount) || questionCount < 1) {
    return { error: 'ERRORS.EXAMS.QUESTION_COUNT_REQUIRED' };
  }

  const pool = await lessonPoolSize(lessonIds, companyId);
  if (questionCount > pool) {
    // The pool size rides on the message so the form can say "only 14 available"
    // instead of a flat refusal.
    return { error: 'ERRORS.EXAMS.NOT_ENOUGH_QUESTIONS', detail: `Only ${pool} questions available` };
  }

  const rawDuration = body.durationMinutes ?? existing?.duration_minutes;
  const durationMinutes = rawDuration === null || rawDuration === undefined ? NaN : parseInt(rawDuration, 10);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
    return { error: 'ERRORS.EXAMS.DURATION_REQUIRED' };
  }

  const opensAt = body.opensAt !== undefined ? (body.opensAt || null) : (existing?.opens_at ?? null);
  const closesAt = body.closesAt !== undefined ? (body.closesAt || null) : (existing?.closes_at ?? null);
  if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) {
    return { error: 'ERRORS.EXAMS.WINDOW_INVALID' };
  }

  // An explicit empty string clears the code (identity comes from the student's
  // login in any case); omitting it keeps whatever the exam already had, and a new
  // online exam gets one generated so there is something to read out.
  let accessCode: string | null;
  if (body.accessCode !== undefined) {
    accessCode = (body.accessCode || '').trim().toUpperCase() || null;
  } else if (existing) {
    accessCode = existing.access_code ?? null;
  } else {
    accessCode = generateAccessCode();
  }

  return {
    lessonIds,
    columns: {
      is_online: true,
      question_count: questionCount,
      // Every question is worth one mark, so the paper is out of its own length.
      // Mirroring it into max_grade is what makes the existing "17/20" displays,
      // the results feed and the SMS/Telegram blast correct with no changes.
      max_grade: questionCount,
      duration_minutes: durationMinutes,
      opens_at: opensAt,
      closes_at: closesAt,
      access_code: accessCode,
      shuffle_options: body.shuffleOptions !== undefined
        ? body.shuffleOptions === true
        : (existing?.shuffle_options ?? true),
      show_answers: body.showAnswers !== undefined
        ? body.showAnswers === true
        : (existing?.show_answers ?? true),
    },
  };
}

function mapExamFromDB(row: any, lessonIds?: string[]) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    courseId: row.course_id,
    courseName: row.course_name ?? undefined,
    name: row.name,
    examDate: row.exam_date,
    maxGrade: row.max_grade !== null && row.max_grade !== undefined ? parseFloat(row.max_grade) : null,
    status: row.status,
    resultCount: row.result_count !== undefined && row.result_count !== null
      ? parseInt(row.result_count, 10)
      : undefined,
    isHomework: row.is_homework === true,
    classId: row.class_id ?? null,
    className: row.class_name ?? undefined,
    sessionId: row.session_id ?? null,
    // Online exam settings. `lessonIds` is only populated where it was loaded (the
    // single-exam read and the two writes) — the list would need a query per row.
    isOnline: row.is_online === true,
    questionCount: row.question_count !== null && row.question_count !== undefined
      ? parseInt(row.question_count, 10)
      : null,
    durationMinutes: row.duration_minutes !== null && row.duration_minutes !== undefined
      ? parseInt(row.duration_minutes, 10)
      : null,
    opensAt: row.opens_at ?? null,
    closesAt: row.closes_at ?? null,
    accessCode: row.access_code ?? null,
    shuffleOptions: row.shuffle_options !== false,
    showAnswers: row.show_answers !== false,
    lessonIds,
    // Only the single-exam read computes these (a count per list row would be a
    // query per row); undefined elsewhere.
    attemptCounts: row.attempts_started !== undefined
      ? {
          started: parseInt(row.attempts_started, 10),
          submitted: parseInt(row.attempts_submitted ?? '0', 10),
        }
      : undefined,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The roster union both `results` and the attempts monitor build on — who is
 * expected to sit/be marked. Placeholders are fixed by convention: $1 = course,
 * $2 = company, $4 = class (only when byClass). A class-scoped row also admits
 * substitutes and trial students who actually sat that class's sessions, so the
 * roster matches the attendance sheet — see the long note in `results`.
 */
function examRosterUnionSql(byClass: boolean): string {
  return byClass
    ? `SELECT student_id FROM enrollments
         WHERE course_id = $1 AND company_id = $2 AND class_id = $4 AND status NOT IN ('DROPPED', 'CANCELLED')
       UNION
       SELECT student_id FROM master_class_enrollments
         WHERE course_id = $1 AND company_id = $2 AND class_id = $4 AND status != 'DROPPED'
       UNION
       SELECT sa.student_id
         FROM session_attendance sa
         JOIN sessions se ON se.id = sa.session_id
        WHERE se.class_id = $4 AND se.company_id = $2
          AND sa.attendance_type IN ('SUBSTITUTION', 'TRIAL')`
    : `SELECT student_id FROM enrollments
         WHERE course_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
       UNION
       SELECT student_id FROM master_class_enrollments
         WHERE course_id = $1 AND company_id = $2 AND status != 'DROPPED'`;
}

/**
 * May this student be graded on this exam?
 *
 * A course-wide exam mirrors the attendance rule — membership of the Course (via
 * regular or bundle enrollment) is enough, whichever class they sit in. A
 * CLASS-SCOPED row narrows to that class, matching the roster `results` builds:
 * without this a scan would happily record a grade for a student of another
 * class of the same course, and that grade would then be invisible on the
 * screen it was entered from.
 */
async function isEnrolledInCourse(
  companyId: string,
  courseId: string,
  studentId: string,
  classId?: string | null,
): Promise<boolean> {
  const byClass = !!classId;
  const clause = byClass ? 'AND class_id = $4' : '';
  // A substitute who sat this class's lesson may be graded on its homework even
  // though they are enrolled elsewhere — the same rule the roster uses, so a
  // student who is VISIBLE in the list can actually be saved.
  const substitutes = byClass
    ? `UNION
       SELECT sa.student_id
         FROM session_attendance sa
         JOIN sessions se ON se.id = sa.session_id
        WHERE se.class_id = $4 AND se.company_id = $2
          AND sa.attendance_type IN ('SUBSTITUTION', 'TRIAL')`
    : '';
  const params: any[] = [courseId, companyId, studentId];
  if (byClass) params.push(classId);
  const row = await queryOne<any>(
    `SELECT 1 FROM (
        SELECT student_id FROM enrollments
        WHERE course_id = $1 AND company_id = $2 ${clause} AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT student_id FROM master_class_enrollments
        WHERE course_id = $1 AND company_id = $2 ${clause} AND status != 'DROPPED'
        ${substitutes}
     ) enrolled
     WHERE student_id = $3`,
    params,
  );
  return !!row;
}

/**
 * A student's exam/homework feed — everything they were expected to sit, not
 * only what someone got round to marking.
 *
 * Driving this from exam_results (as it used to) meant an unmarked student
 * simply had no row, so a homework they never handed in and a homework that was
 * never set looked identical on their page. Starting from `exams` and LEFT
 * JOINing the result makes the gap visible: `not_marked` says nobody recorded
 * anything, `is_absent` says someone recorded that they were not there.
 *
 * Membership repeats the roster rule — enrolment in the course, narrowed to the
 * class when the row is class-scoped, plus substitutes who sat the lesson. The
 * last OR keeps a row the student HAS a mark for even if they have since moved
 * class, so marks never disappear from a page they were already on.
 *
 * SCHEDULED rows are left out unless already marked: an exam that has not
 * happened yet is not an absence.
 *
 * $1 = studentId, $2 = companyId.
 */
export const studentExamFeedSql = `
  SELECT e.name AS exam_name, c.name AS course_name, cl.name AS class_name,
         e.exam_date, e.max_grade, e.is_homework, e.is_online,
         -- Who set it: the class's own instructor, else the course's. A parent
         -- with children across several teachers reads the feed by teacher.
         NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') AS teacher_name,
         r.grade, r.is_absent,
         (r.exam_id IS NULL) AS not_marked
    FROM exams e
    JOIN courses c ON c.id = e.course_id
    LEFT JOIN classes cl ON cl.id = e.class_id
    LEFT JOIN employees emp ON emp.id = COALESCE(cl.instructor_id, c.instructor_id)
    LEFT JOIN exam_results r ON r.exam_id = e.id AND r.student_id = $1
   WHERE e.company_id = $2
     AND e.is_active = true
     AND (r.exam_id IS NOT NULL OR e.status = 'DONE')
     AND (
       r.exam_id IS NOT NULL
       OR EXISTS (
            SELECT 1 FROM enrollments en
             WHERE en.student_id = $1 AND en.company_id = $2
               AND en.course_id = e.course_id
               AND (e.class_id IS NULL OR en.class_id = e.class_id)
               AND en.status NOT IN ('DROPPED', 'CANCELLED')
          )
       OR EXISTS (
            SELECT 1 FROM master_class_enrollments m
             WHERE m.student_id = $1 AND m.company_id = $2
               AND m.course_id = e.course_id
               AND (e.class_id IS NULL OR m.class_id = e.class_id)
               AND m.status <> 'DROPPED'
          )
       OR (e.class_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM session_attendance sa
              JOIN sessions se ON se.id = sa.session_id
             WHERE sa.student_id = $1 AND se.class_id = e.class_id AND se.company_id = $2
               AND sa.attendance_type IN ('SUBSTITUTION', 'TRIAL')
          ))
     )
   ORDER BY e.exam_date DESC`;

/** Shared shape for both student feeds, so the two pages can't disagree. */
export function mapStudentExamRow(row: any, rating: boolean) {
  const maxGrade = row.max_grade !== null && row.max_grade !== undefined ? parseFloat(row.max_grade) : null;
  const notMarked = row.not_marked === true;
  return {
    examName: row.exam_name,
    courseName: row.course_name,
    className: row.class_name ?? null,
    teacherName: row.teacher_name ?? null,
    examDate: row.exam_date,
    grade: row.grade ?? '',
    maxGrade,
    isHomework: row.is_homework === true,
    // A rating is a marking style for homework, never a score a machine computed.
    // An online exam with five questions is out of 5 and would otherwise be
    // relabelled "Excellent" in a RATING-mode company — inventing a meaning nobody
    // recorded from a mark that was counted, not judged.
    isRating: rating && maxGrade === HOMEWORK_RATING_MAX && row.is_online !== true,
    // Recorded as not there, vs never recorded at all. Both read as a miss on
    // the page, but they are different facts and only one of them is a decision
    // someone made.
    isAbsent: row.is_absent === true,
    notMarked,
  };
}

export const examsRoutes = {
  create: async ({ body, headers }: { body: any; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Homework is created from a session, which knows its class but not its
      // course — so a classId stands in for a courseId and the course (and branch)
      // are read off the class. An exam still comes in with a courseId.
      let courseId: string | undefined = body.courseId;
      let classId: string | null = body.classId ?? null;
      if (classId) {
        // `classes` carries neither company_id nor branch_id — a class is scoped
        // through its course, so the tenant check has to go via courses.
        const cls = await queryOne<any>(
          `SELECT cl.id, cl.course_id
           FROM classes cl
           JOIN courses co ON co.id = cl.course_id
           WHERE cl.id = $1 AND co.company_id = $2`,
          [classId, context.companyId],
        );
        if (!cls) return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
        courseId = courseId ?? cls.course_id;
      }
      if (!courseId) return apiError(400, 'ERRORS.EXAMS.COURSE_REQUIRED', 'Course or class is required');

      // Resolve the course (company-scoped) to inherit branch + verify access.
      const course = await queryOne<any>(
        'SELECT id, branch_id FROM courses WHERE id = $1 AND company_id = $2',
        [courseId, context.companyId],
      );
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // A session only stamps the homework if it really belongs to this class —
      // otherwise the mark would claim to have been taken in someone else's lesson.
      let sessionId: string | null = body.sessionId ?? null;
      if (sessionId) {
        const session = await queryOne<any>(
          'SELECT id, class_id FROM sessions WHERE id = $1 AND company_id = $2',
          [sessionId, context.companyId],
        );
        if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
        if (classId && session.class_id !== classId) {
          return apiError(400, 'ERRORS.EXAMS.SESSION_CLASS_MISMATCH', 'Session does not belong to this class');
        }
        classId = classId ?? session.class_id;
      }

      // Homework follows the company's marking mode, whoever creates it. In
      // RATING mode it is always out of HOMEWORK_RATING_MAX, because that is what
      // makes the marking screens offer Excellent…Weak instead of a number box —
      // a homework created out of 100 would silently fall back to numbers. The
      // session panel already sends 5; enforcing it here means the /exams/create
      // form, and any other caller, cannot disagree.
      //
      // Exams are untouched: the setting is about homework.
      const isHomework = body.isHomework === true;
      let maxGrade = body.maxGrade ?? null;
      if (isHomework && (await isRatingCompany(context.companyId))) {
        maxGrade = HOMEWORK_RATING_MAX;
      }

      // An online exam is the same row with a flag and its settings. Gated: a tenant
      // without the feature asking for one is refused rather than quietly given a
      // paper exam they cannot mark.
      let onlineColumns: Record<string, any> = {};
      let lessonIds: string[] = [];
      if (body.isOnline === true) {
        const denied = await assertOnlineExams(context.companyId);
        if (denied) return denied;
        const settings = await resolveOnlineSettings(body, courseId, context.companyId);
        if ('error' in settings) return apiError(400, settings.error, settings.detail ?? 'Invalid online exam settings');
        onlineColumns = settings.columns;
        lessonIds = settings.lessonIds;
        maxGrade = settings.columns.max_grade;
      }

      const row = await insert('exams', {
        company_id: context.companyId,
        branch_id: course.branch_id,
        course_id: courseId,
        name: body.name,
        exam_date: body.examDate,
        max_grade: maxGrade,
        status: body.status || 'SCHEDULED',
        is_homework: isHomework,
        class_id: classId,
        session_id: sessionId,
        is_active: true,
        ...onlineColumns,
      });

      if (lessonIds.length) await writeExamLessons(row.id, lessonIds);

      return { status: 201 as const, body: mapExamFromDB(row, lessonIds) };
    } catch (error: any) {
      console.error('Create exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.CREATE_FAILED', 'Failed to create exam', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string; status?: string; classId?: string; isHomework?: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT e.*, c.name AS course_name, cl.name AS class_name,
               (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
        FROM exams e
        JOIN courses c ON c.id = e.course_id
        LEFT JOIN classes cl ON cl.id = e.class_id
        WHERE e.company_id = $1 AND e.is_active = true`;
      const params: any[] = [context.companyId];

      // Exams and homework share the table AND now share a screen, so asking for
      // neither returns both — that combined list is the only place homework can
      // be created outside a session. A caller that wants one kind (the in-session
      // homework panel, which must not offer the class's exams) says so explicitly.
      if (queryParams.isHomework !== undefined) {
        params.push(queryParams.isHomework === 'true');
        sql += ` AND e.is_homework = $${params.length}`;
      }

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND e.class_id = $${params.length}`;
      }

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context)) {
        const branchFilter = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchFilter) sql += ` AND (${branchFilter} OR e.branch_id IS NULL)`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND e.course_id = $${params.length}`;
      }
      if (queryParams.status) {
        params.push(queryParams.status);
        sql += ` AND e.status = $${params.length}`;
      }

      sql += ' ORDER BY e.exam_date DESC, e.created_at DESC';

      const rows = await query(sql, params);
      // Wrapped rather than passed by reference: map's index argument would land in
      // the mapper's `lessonIds` parameter.
      return { status: 200 as const, body: rows.map((r) => mapExamFromDB(r)) };
    } catch (error: any) {
      console.error('List exams error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.LIST_FAILED', 'Failed to list exams');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne(
        `SELECT e.*, c.name AS course_name, cl.name AS class_name,
                (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count,
                -- How far the sitting has got. started > 0 is what freezes the
                -- lesson scope and question count in the edit form (the server's
                -- 409 stays the backstop).
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id = e.id) AS attempts_started,
                (SELECT COUNT(*) FROM exam_attempts a
                  WHERE a.exam_id = e.id AND a.status <> 'IN_PROGRESS') AS attempts_submitted
         FROM exams e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE e.id = $1 AND e.company_id = $2`,
        [params.id, context.companyId],
      );
      if (!row) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      // The lesson scope, so the edit form can render the selection it saved. Only
      // an online exam has one, so a paper exam pays nothing for it.
      const lessonIds = row.is_online === true ? await loadExamLessonIds(params.id) : undefined;

      return { status: 200 as const, body: mapExamFromDB(row, lessonIds) };
    } catch (error: any) {
      console.error('Get exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found', 404);
    }
  },

  /**
   * POST /api/exams/:id/regenerate-code
   * A fresh access code for an online exam — for when the old one leaked, or a
   * second group sits the same exam later.
   *
   * In-progress attempts are unaffected: the code gates STARTING, not continuing.
   */
  regenerateCode: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const exam = await queryOne<any>(
        'SELECT id, branch_id, is_online FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED_UPDATE', 'Access denied to update this exam');
      }
      if (exam.is_online !== true) {
        return apiError(400, 'ERRORS.EXAMS.NOT_ONLINE', 'This is not an online exam');
      }

      const accessCode = generateAccessCode();
      await query('UPDATE exams SET access_code = $2, updated_at = NOW() WHERE id = $1', [params.id, accessCode]);
      return { status: 200 as const, body: { accessCode } };
    } catch (error: any) {
      console.error('Regenerate exam code error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.UPDATE_FAILED', 'Failed to regenerate the code', 400);
    }
  },

  /**
   * GET /api/exams/:id/attempts — the teacher's live monitor.
   *
   * Every student expected to sit (the same roster union `results` uses), each
   * with their attempt state joined on: not started / in progress (with the
   * deadline, for a live countdown) / submitted / expired, plus how many
   * questions they have answered so far.
   *
   * This is also one of the expiry catches from online_exams.md §3.5: any
   * IN_PROGRESS attempt whose clock has run out is graded on the way through,
   * so an abandoned paper's mark lands the next time the teacher looks.
   */
  attempts: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }
      if (exam.is_online !== true) {
        return apiError(400, 'ERRORS.EXAMS.NOT_ONLINE', 'This is not an online exam');
      }

      // The expiry sweep: grade what ran out before reporting it, so the
      // monitor never shows a live countdown on a paper that is actually over.
      const expired = await query<any>(
        `SELECT id FROM exam_attempts
          WHERE exam_id = $1 AND status = 'IN_PROGRESS' AND expires_at <= NOW()`,
        [params.id],
      );
      for (const row of expired) await gradeAttempt(row.id, 'EXPIRY');

      const byClass = !!exam.class_id;
      const rosterParams: any[] = [exam.course_id, context.companyId, params.id];
      if (byClass) rosterParams.push(exam.class_id);
      const rows = await query<any>(
        `SELECT s.id AS student_id, s.name, s.student_code,
                a.status, a.started_at, a.submitted_at, a.expires_at, a.score, a.total,
                -- Which model this student was handed, on a model exam. NULL on a
                -- pooled one, where every paper is its own random draw.
                (SELECT m.name FROM exam_models m WHERE m.id = a.model_id) AS model_name,
                (SELECT COUNT(*) FROM exam_attempt_questions q
                  WHERE q.attempt_id = a.id AND q.selected_option_id IS NOT NULL) AS answered_count
         FROM students s
         JOIN (${examRosterUnionSql(byClass)}) en ON en.student_id = s.id
         LEFT JOIN exam_attempts a ON a.exam_id = $3 AND a.student_id = s.id
         WHERE s.company_id = $2
           AND (${studentIsPresent('s')} OR a.id IS NOT NULL)
         ORDER BY s.name`,
        rosterParams,
      );

      return {
        status: 200 as const,
        body: {
          serverNow: new Date().toISOString(),
          attempts: rows.map((row) => ({
            studentId: row.student_id,
            name: row.name,
            code: row.student_code ?? null,
            status: (row.status ?? 'NOT_STARTED') as string,
            startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
            submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
            expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
            score: row.score !== null && row.score !== undefined ? parseInt(row.score, 10) : null,
            total: row.total !== null && row.total !== undefined ? parseInt(row.total, 10) : null,
            answeredCount: row.answered_count !== null && row.answered_count !== undefined
              ? parseInt(row.answered_count, 10)
              : 0,
            /** The model they were handed, or null on a pooled exam. */
            modelName: row.model_name ?? null,
          })),
        },
      };
    } catch (error: any) {
      console.error('Exam attempts error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.ATTEMPTS_FAILED', 'Failed to load attempts', 500);
    }
  },

  /**
   * DELETE /api/exams/:id/attempts/:studentId — let a student back in.
   *
   * The ONE escape hatch from the one-attempt-per-student rule, for the student
   * whose battery died mid-paper. Deletes the attempt (the frozen paper
   * cascades with it) AND the exam_results row, in one transaction — a mark
   * left behind would block markRemainingAbsent from ever re-flagging them, and
   * a fresh start would look already-graded on every marks page.
   */
  resetAttempt: async ({ params, headers }: {
    params: { id: string; studentId: string };
    headers: AuthHeaders;
  }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const exam = await queryOne<any>(
        'SELECT id, branch_id, is_online FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED_UPDATE', 'Access denied to update this exam');
      }
      if (exam.is_online !== true) {
        return apiError(400, 'ERRORS.EXAMS.NOT_ONLINE', 'This is not an online exam');
      }

      const attempt = await queryOne<any>(
        'SELECT id FROM exam_attempts WHERE exam_id = $1 AND student_id = $2',
        [params.id, params.studentId],
      );
      if (!attempt) return apiError(404, 'ERRORS.EXAMS.NO_ATTEMPT', 'This student has not started');

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM exam_attempts WHERE id = $1', [attempt.id]);
        await client.query(
          'DELETE FROM exam_results WHERE exam_id = $1 AND student_id = $2',
          [params.id, params.studentId],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      console.error('Reset exam attempt error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RESET_FAILED', 'Failed to reset the attempt', 400);
    }
  },

  /**
   * GET /api/exams/students/:studentId/credentials — "why can't this student
   * log in?", answered without touching the database. The username, when they
   * claimed, when they last signed in, and when the password was last reset by
   * a card scan — an unexpected reset_at is the visible symptom of a lost or
   * borrowed card. The password itself is not readable here or anywhere.
   */
  studentCredentials: async ({ params, headers }: {
    params: { studentId: string };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const student = await queryOne<any>(
        'SELECT id FROM students WHERE id = $1 AND company_id = $2',
        [params.studentId, context.companyId],
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');

      await ensureStudentAuthSchema();
      const row = await queryOne<any>(
        `SELECT username, claimed_at, reset_at, last_login_at
           FROM student_auth WHERE student_id = $1`,
        [params.studentId],
      );
      return {
        status: 200 as const,
        body: {
          hasCredentials: !!row,
          username: row?.username ?? null,
          claimedAt: row?.claimed_at ? new Date(row.claimed_at).toISOString() : null,
          resetAt: row?.reset_at ? new Date(row.reset_at).toISOString() : null,
          lastLoginAt: row?.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        },
      };
    } catch (error: any) {
      console.error('Student credentials read error:', error);
      return mapThrownError(error, 'ERRORS.STUDENT_AUTH.READ_FAILED', 'Failed to load credentials', 500);
    }
  },

  /**
   * DELETE /api/exams/students/:studentId/credentials — revoke.
   *
   * Deletes the student_auth row outright: their next portal call 401s and they
   * claim again from scratch by scanning their card. Also the first half of the
   * lost-card answer (revoke here, then reissue the card through the QR-card
   * tooling). Staff can only revoke — a teacher who could SET a student's
   * password could sit their exam.
   */
  revokeStudentCredentials: async ({ params, headers }: {
    params: { studentId: string };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const student = await queryOne<any>(
        'SELECT id FROM students WHERE id = $1 AND company_id = $2',
        [params.studentId, context.companyId],
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');

      await ensureStudentAuthSchema();
      await query('DELETE FROM student_auth WHERE student_id = $1', [params.studentId]);
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      console.error('Revoke student credentials error:', error);
      return mapThrownError(error, 'ERRORS.STUDENT_AUTH.REVOKE_FAILED', 'Failed to revoke credentials', 400);
    }
  },

  /**
   * PUT /api/exams/students/:studentId/credentials — the teacher sets or edits
   * a student's portal credential directly: create username+password for a
   * student with no card claim, rename a username, or reset a password at the
   * desk. Requested by the owner, superseding the earlier revoke-only stance;
   * a teacher-set password stamps reset_at, so it stays visible on the record
   * exactly like a card-scan reset.
   */
  setStudentCredentials: async ({ params, body, headers }: {
    params: { studentId: string };
    body: { username?: string; password?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;

      const student = await queryOne<any>(
        'SELECT id, company_id FROM students WHERE id = $1 AND company_id = $2 AND COALESCE(is_active, true)',
        [params.studentId, context.companyId],
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');

      await ensureStudentAuthSchema();
      const existing = await queryOne<any>(
        'SELECT id, username FROM student_auth WHERE student_id = $1',
        [params.studentId],
      );

      // Normalise exactly like the portal's own claim, so a phone number typed
      // at the desk resolves to the same account it would from the card flow.
      const rawUsername = (body?.username ?? '').trim();
      const username = rawUsername ? canonicalIdentifier(rawUsername) : null;
      const password = body?.password ?? '';

      if (username && !USERNAME_SHAPE.test(username)) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.BAD_USERNAME', 'Pick a username of 3-60 letters, digits, dots or dashes — or the phone number');
      }
      if (password && password.length < MIN_PASSWORD_LENGTH) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (!existing && (!username || !password)) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.CREATE_NEEDS_BOTH', 'A new credential needs both a username and a password');
      }
      if (existing && !username && !password) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.NOTHING_TO_CHANGE', 'Nothing to change');
      }

      if (username && username !== (existing?.username ?? '').toLowerCase()) {
        const taken = await queryOne<any>(
          'SELECT student_id FROM student_auth WHERE LOWER(username) = $1 AND student_id <> $2',
          [username, params.studentId],
        );
        if (taken) return apiError(409, 'ERRORS.STUDENT_AUTH.USERNAME_TAKEN', 'That name is taken — pick another');
      }

      if (!existing) {
        await query(
          `INSERT INTO student_auth (student_id, company_id, username, password_hash)
           VALUES ($1, $2, $3, $4)`,
          [params.studentId, context.companyId, username, await bcrypt.hash(password, 10)],
        );
      } else {
        // A teacher-set password is a reset: stamp reset_at and clear the
        // lockout, exactly as the card flow does.
        await query(
          `UPDATE student_auth
              SET username = COALESCE($1, username),
                  password_hash = COALESCE($2, password_hash),
                  reset_at = CASE WHEN $2 IS NOT NULL THEN NOW() ELSE reset_at END,
                  failed_attempts = CASE WHEN $2 IS NOT NULL THEN 0 ELSE failed_attempts END,
                  locked_until = CASE WHEN $2 IS NOT NULL THEN NULL ELSE locked_until END,
                  updated_at = NOW()
            WHERE id = $3`,
          [username, password ? await bcrypt.hash(password, 10) : null, existing.id],
        );
      }

      const row = await queryOne<any>(
        `SELECT username, claimed_at, reset_at, last_login_at
           FROM student_auth WHERE student_id = $1`,
        [params.studentId],
      );
      return {
        status: 200 as const,
        body: {
          hasCredentials: !!row,
          username: row?.username ?? null,
          claimedAt: row?.claimed_at ? new Date(row.claimed_at).toISOString() : null,
          resetAt: row?.reset_at ? new Date(row.reset_at).toISOString() : null,
          lastLoginAt: row?.last_login_at ? new Date(row.last_login_at).toISOString() : null,
        },
      };
    } catch (error: any) {
      if (error?.code === '23505') {
        return apiError(409, 'ERRORS.STUDENT_AUTH.USERNAME_TAKEN', 'That name is taken — pick another');
      }
      console.error('Set student credentials error:', error);
      return mapThrownError(error, 'ERRORS.STUDENT_AUTH.SET_FAILED', 'Failed to save credentials', 400);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!existing) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED_UPDATE', 'Access denied to update this exam');
      }

      const updateData: any = {};
      if (body.courseId !== undefined) {
        const course = await queryOne<any>(
          'SELECT id, branch_id FROM courses WHERE id = $1 AND company_id = $2',
          [body.courseId, context.companyId],
        );
        if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
        if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.course_id = body.courseId;
        updateData.branch_id = course.branch_id; // keep branch in sync with course
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.examDate !== undefined) updateData.exam_date = body.examDate;
      if (body.maxGrade !== undefined) updateData.max_grade = body.maxGrade;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;
      if (body.isHomework !== undefined) updateData.is_homework = body.isHomework === true;

      // Online settings. The window, the name and the date stay editable for the
      // life of the exam; the lesson scope and the question count freeze the moment
      // somebody starts, because papers already drawn came from that pool and
      // changing it would mark two students out of different things.
      const staysOnline = body.isOnline !== undefined ? body.isOnline === true : existing.is_online === true;
      let newLessonIds: string[] | null = null;
      if (staysOnline) {
        const denied = await assertOnlineExams(context.companyId);
        if (denied) return denied;

        const targetCourse = updateData.course_id ?? existing.course_id;
        const scopeChanged =
          (Array.isArray(body.lessonIds) && body.lessonIds.length > 0) ||
          (body.questionCount !== undefined && parseInt(body.questionCount, 10) !== existing.question_count);
        if (scopeChanged && (await examHasAttempts(params.id))) {
          return apiError(409, 'ERRORS.EXAMS.ALREADY_STARTED', 'Students have already started this exam');
        }

        const settings = await resolveOnlineSettings(body, targetCourse, context.companyId, existing);
        if ('error' in settings) return apiError(400, settings.error, settings.detail ?? 'Invalid online exam settings');
        Object.assign(updateData, settings.columns);
        newLessonIds = settings.lessonIds;
      } else if (body.isOnline === false && existing.is_online === true) {
        // Turned back into a paper exam: drop the scope with the flag, or a later
        // re-enable would silently inherit a stale one.
        updateData.is_online = false;
        newLessonIds = [];
      }

      // Narrowing a row to a class (or widening it back to the whole course)
      // changes who may be graded on it, so the class has to belong to the course
      // the row ends up on — otherwise the roster would come back empty and every
      // scan would be rejected. Clearing the class also drops the session stamp:
      // a session belongs to a class, so it means nothing without one.
      if (body.classId !== undefined) {
        if (!body.classId) {
          updateData.class_id = null;
          updateData.session_id = null;
        } else {
          const cls = await queryOne<any>(
            `SELECT cl.id, cl.course_id
             FROM classes cl
             JOIN courses co ON co.id = cl.course_id
             WHERE cl.id = $1 AND co.company_id = $2`,
            [body.classId, context.companyId],
          );
          if (!cls) return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
          const targetCourse = updateData.course_id ?? existing.course_id;
          if (cls.course_id !== targetCourse) {
            return apiError(400, 'ERRORS.EXAMS.CLASS_COURSE_MISMATCH', 'Class does not belong to this course');
          }
          updateData.class_id = body.classId;
        }
      }

      const row = await update('exams', params.id, updateData);
      if (!row) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');

      if (newLessonIds !== null) await writeExamLessons(params.id, newLessonIds);

      // Results SMS, on the SCHEDULED → DONE transition only.
      //
      // That transition is the teacher saying the marking is finished. Firing on
      // each grade instead would be one text per keystroke, and a parent
      // watching a mark get corrected in real time. Re-saving a DONE exam sends
      // nothing: the state has not changed, and the daily guard in sendSms
      // covers the rest. Best-effort — it never throws.
      if (body.status === 'DONE' && existing.status !== 'DONE') {
        await sendExamResultsSms(context.companyId, params.id);
      }

      // Re-read with course + class name for a consistent response shape.
      const full = await queryOne(
        `SELECT e.*, c.name AS course_name, cl.name AS class_name,
                (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
         FROM exams e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE e.id = $1`,
        [params.id],
      );
      return { status: 200 as const, body: mapExamFromDB(full ?? row) };
    } catch (error: any) {
      console.error('Update exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.UPDATE_FAILED', 'Failed to update exam', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!existing) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED_DELETE', 'Access denied to delete this exam');
      }

      await update('exams', params.id, { is_active: false });
      return { status: 200 as const, body: { message: 'Exam deleted successfully', code: 'EXAMS.DELETED' } };
    } catch (error: any) {
      console.error('Delete exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.DELETE_FAILED', 'Failed to delete exam', 404);
    }
  },

  /**
   * GET /api/exams/:id/results
   * Grading roster — every student enrolled in the exam's course (any class)
   * with their grade (if any).
   */
  results: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      // An exam is course-wide, but a homework is set for one class — so when the
      // row carries a class_id the roster narrows to that class's students. The
      // extra $4 is folded into every branch of the UNION.
      //
      // Someone marked as having LEFT the academy is not on the roster, the same
      // rule the attendance sheet applies (see db/active-students). Their
      // enrolment usually stays ACTIVE — marking them left IS the act staff
      // perform — so a roster built from enrolments alone keeps listing people
      // who will never hand anything in. The two lists have to agree: a student
      // you cannot take attendance for is not one you are asked to mark.
      //
      // Anyone already GRADED stays regardless. Their mark is a record of what
      // happened, and dropping the row would erase a grade from the page it was
      // entered on the day the office ticked "left".
      //
      // SUBSTITUTING STUDENTS: someone who sat this class's lesson as a
      // substitute (their own group was cancelled, they came to another) was in
      // the room and was given the homework, but is enrolled in a DIFFERENT
      // class — so a roster built from enrolments alone leaves them off, and
      // there is no way to mark work they were actually set. They are added
      // here from the attendance they have against this class's sessions.
      // Stamped SUBSTITUTION or TRIAL only: a NORMAL row is already covered by
      // the enrolment halves above.
      const byClass = !!exam.class_id;
      const enrolledSql = examRosterUnionSql(byClass);

      const rosterParams: any[] = [exam.course_id, context.companyId, params.id];
      if (byClass) rosterParams.push(exam.class_id);

      const rows = await query<any>(
        `SELECT s.id AS student_id, s.name, s.student_code,
                s.parent_name, s.parent_phone, s.phone,
                r.grade, r.is_absent, r.recorded_at
         FROM students s
         JOIN (${enrolledSql}) en ON en.student_id = s.id
         LEFT JOIN exam_results r ON r.exam_id = $3 AND r.student_id = s.id
         WHERE s.company_id = $2
           AND (${studentIsPresent('s')} OR r.exam_id IS NOT NULL)
         ORDER BY s.name`,
        rosterParams,
      );

      return {
        status: 200 as const,
        body: rows.map((row) => ({
          studentId: row.student_id,
          name: row.name,
          code: row.student_code ?? null,
          parentName: row.parent_name ?? null,
          parentPhone: row.parent_phone ?? null,
          studentPhone: row.phone ?? null,
          grade: row.grade ?? null,
          isAbsent: row.is_absent === true,
          recordedAt: row.recorded_at ?? null,
        })),
      };
    } catch (error: any) {
      console.error('Exam results error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RESULTS_FAILED', 'Failed to load exam results');
    }
  },

  /**
   * POST /api/exams/:id/record-by-qr  { qrToken, grade }
   * Resolve the student by QR token (tenant-scoped), verify course enrollment,
   * upsert the grade. Idempotent — re-scanning a student updates their grade.
   */
  recordByQr: async ({ params, body, headers }: { params: { id: string }; body: { qrToken: string; grade: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      const token = (body?.qrToken || '').trim();
      if (!token) return apiError(400, 'ERRORS.EXAMS.QR_TOKEN_REQUIRED', 'QR token is required');
      const grade = (body?.grade ?? '').toString().trim();
      if (!grade) return apiError(400, 'ERRORS.EXAMS.GRADE_REQUIRED', 'Grade is required');

      await ensureQrCardSchema();   // the lookup below reads qr_cards
      // No is_active filter: the enrolment check below is what decides whether
      // this student may be marked. Filtering here as well meant a card that the
      // roster now lists came back "not found" when scanned — the same student,
      // two answers depending on which control the teacher used.
      const student = await queryOne<any>(
        `SELECT s.id, s.name FROM students s
         WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2`,
        [token, context.companyId],
      );
      if (!student) {
        return apiError(404, 'ERRORS.EXAMS.QR_STUDENT_NOT_FOUND', 'No active student matches this QR code');
      }

      if (!(await isEnrolledInCourse(context.companyId, exam.course_id, student.id, exam.class_id))) {
        return apiError(409, 'ERRORS.EXAMS.STUDENT_NOT_IN_COURSE', 'This student is not enrolled in this course');
      }

      const upserted = await queryOne<any>(
        `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (exam_id, student_id)
         DO UPDATE SET grade = EXCLUDED.grade, is_absent = false, recorded_at = NOW(), updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [params.id, context.companyId, exam.course_id, student.id, grade],
      );
      const alreadyRecorded = !(upserted?.inserted);
      // Best-effort parent push — a mark landed on their child's record.
      await pushExamResult(context.companyId, student.id, params.id, exam.name, grade,
        exam.max_grade != null ? parseFloat(exam.max_grade) : null, exam.is_homework === true);

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentName: student.name,
          grade,
          alreadyRecorded,
          code: alreadyRecorded ? 'EXAMS.GRADE_UPDATED' : 'EXAMS.GRADE_RECORDED',
          message: alreadyRecorded ? 'Grade updated' : 'Grade recorded',
        },
      };
    } catch (error: any) {
      console.error('Exam record-by-qr error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to record grade');
    }
  },

  /**
   * POST /api/exams/:id/record-by-code  { code, grade }
   * Like recordByQr but resolves the student by their short sequential code.
   * Server-side resolution keeps the exam page from importing the students
   * feature (which would create a circular module dependency).
   */
  recordByCode: async ({ params, body, headers }: { params: { id: string }; body: { code: string; grade: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      const grade = (body?.grade ?? '').toString().trim();
      if (!grade) return apiError(400, 'ERRORS.EXAMS.GRADE_REQUIRED', 'Grade is required');
      const code = codeDigits(body?.code ?? '');   // pool cards print "A-100001"
      if (!Number.isInteger(code) || code < 1) {
        return apiError(404, 'ERRORS.STUDENTS.CODE_NOT_FOUND', 'No student exists with this code');
      }

      const student = await queryOne<any>(
        // Same as the QR lookup: enrolment decides, not the left-the-academy flag.
        'SELECT id, name FROM students WHERE student_code = $1 AND company_id = $2',
        [code, context.companyId],
      );
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.CODE_NOT_FOUND', 'No student exists with this code');
      }
      if (!(await isEnrolledInCourse(context.companyId, exam.course_id, student.id, exam.class_id))) {
        return apiError(409, 'ERRORS.EXAMS.STUDENT_NOT_IN_COURSE', 'This student is not enrolled in this course');
      }

      const upserted = await queryOne<any>(
        `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (exam_id, student_id)
         DO UPDATE SET grade = EXCLUDED.grade, is_absent = false, recorded_at = NOW(), updated_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [params.id, context.companyId, exam.course_id, student.id, grade],
      );
      const alreadyRecorded = !(upserted?.inserted);
      // Best-effort parent push — a mark landed on their child's record.
      await pushExamResult(context.companyId, student.id, params.id, exam.name, grade,
        exam.max_grade != null ? parseFloat(exam.max_grade) : null, exam.is_homework === true);

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentName: student.name,
          grade,
          alreadyRecorded,
          code: alreadyRecorded ? 'EXAMS.GRADE_UPDATED' : 'EXAMS.GRADE_RECORDED',
          message: alreadyRecorded ? 'Grade updated' : 'Grade recorded',
        },
      };
    } catch (error: any) {
      console.error('Exam record-by-code error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to record grade');
    }
  },

  /**
   * POST /api/exams/:id/results  { studentId, grade }
   * Manual (no-camera) grade entry from the roster. Same enrollment check +
   * upsert as recordByQr.
   */
  saveResult: async ({ params, body, headers }: { params: { id: string }; body: { studentId: string; grade: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }
      const grade = (body?.grade ?? '').toString().trim();
      if (!grade) return apiError(400, 'ERRORS.EXAMS.GRADE_REQUIRED', 'Grade is required');

      if (!(await isEnrolledInCourse(context.companyId, exam.course_id, body.studentId, exam.class_id))) {
        return apiError(409, 'ERRORS.EXAMS.STUDENT_NOT_IN_COURSE', 'This student is not enrolled in this course');
      }

      await query(
        `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (exam_id, student_id)
         DO UPDATE SET grade = EXCLUDED.grade, is_absent = false, recorded_at = NOW(), updated_at = NOW()`,
        [params.id, context.companyId, exam.course_id, body.studentId, grade],
      );
      // Best-effort parent push — a mark landed on their child's record.
      await pushExamResult(context.companyId, body.studentId, params.id, exam.name, grade,
        exam.max_grade != null ? parseFloat(exam.max_grade) : null, exam.is_homework === true);
      return { status: 200 as const, body: { success: true, code: 'EXAMS.GRADE_SAVED', message: 'Grade saved' } };
    } catch (error: any) {
      console.error('Exam save-result error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to save grade');
    }
  },

  /** DELETE /api/exams/:id/results/:studentId — clear a recorded grade. */
  deleteResult: async ({ params, headers }: { params: { id: string; studentId: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      await query(
        'DELETE FROM exam_results WHERE exam_id = $1 AND student_id = $2 AND company_id = $3',
        [params.id, params.studentId, context.companyId],
      );
      return { status: 200 as const, body: { success: true, code: 'EXAMS.GRADE_CLEARED', message: 'Grade cleared' } };
    } catch (error: any) {
      console.error('Exam delete-result error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to clear grade');
    }
  },

  /**
   * POST /api/exams/:id/absent  { studentId, absent }
   * Mark a student absent for the exam (absent=true → no grade), or clear the
   * absent flag (absent=false → removes the row, back to "not recorded").
   */
  markAbsent: async ({ params, body, headers }: { params: { id: string }; body: { studentId: string; absent: boolean }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      if (body?.absent) {
        if (!(await isEnrolledInCourse(context.companyId, exam.course_id, body.studentId, exam.class_id))) {
          return apiError(409, 'ERRORS.EXAMS.STUDENT_NOT_IN_COURSE', 'This student is not enrolled in this course');
        }
        await query(
          `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
           VALUES ($1, $2, $3, $4, NULL, true)
           ON CONFLICT (exam_id, student_id)
           DO UPDATE SET grade = NULL, is_absent = true, recorded_at = NOW(), updated_at = NOW()`,
          [params.id, context.companyId, exam.course_id, body.studentId],
        );
        // Best-effort parent push + Telegram (when the tenant has it on): a
        // missed exam / unsolved homework is a fact the moment it's recorded.
        await pushExamAbsence(context.companyId, body.studentId, params.id, exam.name, exam.is_homework === true);
        await sendExamAbsenceTelegram(context.companyId, params.id, body.studentId);
      } else {
        await query(
          'DELETE FROM exam_results WHERE exam_id = $1 AND student_id = $2 AND company_id = $3',
          [params.id, body.studentId, context.companyId],
        );
      }
      return { status: 200 as const, body: { success: true, code: 'EXAMS.ABSENCE_SAVED', message: 'Absence updated' } };
    } catch (error: any) {
      console.error('Exam mark-absent error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to update absence');
    }
  },

  /**
   * POST /api/exams/:id/mark-remaining-absent
   * Mark every enrolled student who has NO result yet (not graded, not already
   * absent) as absent in one go. Returns how many were newly marked.
   */
  markRemainingAbsent: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT * FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      // "Everyone else was absent" must mean everyone on THIS row's roster — for a
      // class-scoped row that is the class, not the whole course, or it would stamp
      // an absence on students who were never expected to sit it. Students who
      // have left are off the roster too, so they are skipped here as well:
      // otherwise the button silently marks people the teacher cannot see.
      const byClass = !!exam.class_id;
      const classClause = byClass ? 'AND class_id = $4' : '';
      const absentParams: any[] = [params.id, context.companyId, exam.course_id];
      if (byClass) absentParams.push(exam.class_id);

      const inserted = await query<any>(
        `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
         SELECT $1, $2, $3, en.student_id, NULL, true
         FROM (
               SELECT student_id FROM enrollments
                 WHERE course_id = $3 AND company_id = $2 ${classClause} AND status NOT IN ('DROPPED', 'CANCELLED')
               UNION
               SELECT student_id FROM master_class_enrollments
                 WHERE course_id = $3 AND company_id = $2 ${classClause} AND status != 'DROPPED'
               ${byClass ? `UNION
               SELECT sa.student_id FROM session_attendance sa
                 JOIN sessions se ON se.id = sa.session_id
                WHERE se.class_id = $4 AND se.company_id = $2
                  AND sa.attendance_type IN ('SUBSTITUTION', 'TRIAL')` : ''}
              ) en
         JOIN students s ON s.id = en.student_id AND s.company_id = $2 AND ${studentIsPresent('s')}
         WHERE NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.exam_id = $1 AND r.student_id = en.student_id)
         ON CONFLICT (exam_id, student_id) DO NOTHING
         RETURNING student_id`,
        absentParams,
      );
      // Every newly-marked miss tells its parent — only the NEW rows (RETURNING),
      // so re-clicking the button never re-notifies anyone. Best-effort each,
      // over push and Telegram alike.
      for (const row of inserted) {
        await pushExamAbsence(context.companyId, row.student_id, params.id, exam.name, exam.is_homework === true);
        await sendExamAbsenceTelegram(context.companyId, params.id, row.student_id);
      }
      return { status: 200 as const, body: { success: true, count: inserted.length } };
    } catch (error: any) {
      console.error('Exam mark-remaining-absent error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.RECORD_FAILED', 'Failed to mark remaining absent');
    }
  },

  /**
   * POST /api/exams/:id/send-telegram
   * Push every graded/absent student's result to their linked Telegram chats
   * via the company bot. Returns how many messages were sent.
   */
  sendTelegramResults: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const exam = await queryOne<any>(
        'SELECT id, branch_id FROM exams WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (exam.branch_id && !canAccessBranch(context, exam.branch_id)) {
        return apiError(403, 'ERRORS.EXAMS.ACCESS_DENIED', 'Access denied to this exam');
      }

      const res = await sendExamResultNotifications(context.companyId, params.id);
      if (!res.configured) {
        return apiError(400, 'ERRORS.TELEGRAM.NOT_CONFIGURED', 'Telegram is not set up for this academy');
      }
      return { status: 200 as const, body: { success: true, sent: res.sent } };
    } catch (error: any) {
      console.error('Exam send-telegram error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.SEND_FAILED', 'Failed to send results');
    }
  },

  /**
   * GET /api/exams/student/:studentId
   * Everything the student was expected to sit, marked or not — see
   * studentExamFeedSql for why the unmarked ones are included.
   */
  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query<any>(studentExamFeedSql, [params.studentId, context.companyId]);

      const rating = await isRatingCompany(context.companyId);

      // Exams and homework come back in one feed; the student page splits them.
      return {
        status: 200 as const,
        body: rows.map((row) => mapStudentExamRow(row, rating)),
      };
    } catch (error: any) {
      console.error('Exam getByStudent error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.LIST_FAILED', 'Failed to load student exams');
    }
  },
};
