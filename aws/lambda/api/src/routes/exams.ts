import { insert, update, query, queryOne } from '../db/connection';
import { ensureQrCardSchema, qrStudentMatch, codeDigits } from './qr-cards';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { sendExamResultNotifications } from './telegram';
import { ensureHomeworkGradingColumn } from './companies';

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
async function ensureExamTables(): Promise<void> {
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
  examTablesEnsured = true;
}

function mapExamFromDB(row: any) {
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
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

      const row = await insert('exams', {
        company_id: context.companyId,
        branch_id: course.branch_id,
        course_id: courseId,
        name: body.name,
        exam_date: body.examDate,
        max_grade: body.maxGrade ?? null,
        status: body.status || 'SCHEDULED',
        is_homework: body.isHomework === true,
        class_id: classId,
        session_id: sessionId,
        is_active: true,
      });

      return { status: 201 as const, body: mapExamFromDB(row) };
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
      return { status: 200 as const, body: rows.map(mapExamFromDB) };
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
                (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
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

      return { status: 200 as const, body: mapExamFromDB(row) };
    } catch (error: any) {
      console.error('Get exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found', 404);
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
      // Membership is decided by the ENROLMENT, never by students.is_active. That
      // flag means "has left the academy", which is an office fact: a student can
      // be marked as left while their enrolment in this class is still ACTIVE, and
      // filtering on it here emptied the roster for a class the attendance page
      // was still listing two students for. The attendance roster keys off the
      // enrolment alone, and these two lists have to agree — a student you can
      // take attendance for is a student whose work you must be able to mark.
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
      const enrolledSql = byClass
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
      // an absence on students who were never expected to sit it.
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
         JOIN students s ON s.id = en.student_id AND s.company_id = $2
         WHERE NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.exam_id = $1 AND r.student_id = en.student_id)
         ON CONFLICT (exam_id, student_id) DO NOTHING
         RETURNING student_id`,
        absentParams,
      );
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
   * All of a student's recorded grades (for the student-detail page).
   */
  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query<any>(
        `SELECT e.name AS exam_name, c.name AS course_name, cl.name AS class_name,
                e.exam_date, e.max_grade, e.is_homework, r.grade
         FROM exam_results r
         JOIN exams e   ON e.id = r.exam_id AND e.is_active = true
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE r.student_id = $1 AND r.company_id = $2
         ORDER BY e.exam_date DESC`,
        [params.studentId, context.companyId],
      );

      const rating = await isRatingCompany(context.companyId);

      // Exams and homework come back in one feed; the student page splits them.
      return {
        status: 200 as const,
        body: rows.map((row) => {
          const maxGrade = row.max_grade !== null && row.max_grade !== undefined ? parseFloat(row.max_grade) : null;
          return {
            examName: row.exam_name,
            courseName: row.course_name,
            className: row.class_name ?? null,
            examDate: row.exam_date,
            grade: row.grade,
            maxGrade,
            isHomework: row.is_homework === true,
            isRating: rating && maxGrade === HOMEWORK_RATING_MAX,
          };
        }),
      };
    } catch (error: any) {
      console.error('Exam getByStudent error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.LIST_FAILED', 'Failed to load student exams');
    }
  },
};
