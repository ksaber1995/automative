import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { sendExamResultNotifications } from './telegram';

type AuthHeaders = { authorization: string };

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
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Is the student enrolled in this course in ANY class? Mirrors the attendance
// rule — membership of the Course (via regular or bundle enrollment) is enough.
async function isEnrolledInCourse(
  companyId: string,
  courseId: string,
  studentId: string,
): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT 1 FROM (
        SELECT student_id FROM enrollments
        WHERE course_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT student_id FROM master_class_enrollments
        WHERE course_id = $1 AND company_id = $2 AND status != 'DROPPED'
     ) enrolled
     WHERE student_id = $3`,
    [courseId, companyId, studentId],
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

      // Resolve the course (company-scoped) to inherit branch + verify access.
      const course = await queryOne<any>(
        'SELECT id, branch_id FROM courses WHERE id = $1 AND company_id = $2',
        [body.courseId, context.companyId],
      );
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const row = await insert('exams', {
        company_id: context.companyId,
        branch_id: course.branch_id,
        course_id: body.courseId,
        name: body.name,
        exam_date: body.examDate,
        max_grade: body.maxGrade ?? null,
        status: body.status || 'SCHEDULED',
        is_active: true,
      });

      return { status: 201 as const, body: mapExamFromDB(row) };
    } catch (error: any) {
      console.error('Create exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.CREATE_FAILED', 'Failed to create exam', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string; status?: string }; headers: AuthHeaders }) => {
    try {
      await ensureExamTables();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT e.*, c.name AS course_name,
               (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
        FROM exams e
        JOIN courses c ON c.id = e.course_id
        WHERE e.company_id = $1 AND e.is_active = true`;
      const params: any[] = [context.companyId];

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
        `SELECT e.*, c.name AS course_name,
                (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
         FROM exams e JOIN courses c ON c.id = e.course_id
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

      const row = await update('exams', params.id, updateData);
      if (!row) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      // Re-read with course name for a consistent response shape.
      const full = await queryOne(
        `SELECT e.*, c.name AS course_name,
                (SELECT COUNT(*) FROM exam_results r WHERE r.exam_id = e.id) AS result_count
         FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = $1`,
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

      const rows = await query<any>(
        `SELECT s.id AS student_id, s.first_name, s.last_name,
                s.parent_name, s.parent_phone, s.phone,
                r.grade, r.is_absent, r.recorded_at
         FROM students s
         JOIN (
               SELECT student_id FROM enrollments
                 WHERE course_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
               UNION
               SELECT student_id FROM master_class_enrollments
                 WHERE course_id = $1 AND company_id = $2 AND status != 'DROPPED'
              ) en ON en.student_id = s.id
         LEFT JOIN exam_results r ON r.exam_id = $3 AND r.student_id = s.id
         WHERE s.company_id = $2 AND s.is_active = true
         ORDER BY s.first_name, s.last_name`,
        [exam.course_id, context.companyId, params.id],
      );

      return {
        status: 200 as const,
        body: rows.map((row) => ({
          studentId: row.student_id,
          firstName: row.first_name,
          lastName: row.last_name,
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

      const student = await queryOne<any>(
        'SELECT id, first_name, last_name FROM students WHERE qr_token = $1 AND company_id = $2 AND is_active = true',
        [token, context.companyId],
      );
      if (!student) {
        return apiError(404, 'ERRORS.EXAMS.QR_STUDENT_NOT_FOUND', 'No active student matches this QR code');
      }

      if (!(await isEnrolledInCourse(context.companyId, exam.course_id, student.id))) {
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
          studentFirstName: student.first_name,
          studentLastName: student.last_name,
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

      if (!(await isEnrolledInCourse(context.companyId, exam.course_id, body.studentId))) {
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
        if (!(await isEnrolledInCourse(context.companyId, exam.course_id, body.studentId))) {
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

      const inserted = await query<any>(
        `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
         SELECT $1, $2, $3, en.student_id, NULL, true
         FROM (
               SELECT student_id FROM enrollments
                 WHERE course_id = $3 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
               UNION
               SELECT student_id FROM master_class_enrollments
                 WHERE course_id = $3 AND company_id = $2 AND status != 'DROPPED'
              ) en
         JOIN students s ON s.id = en.student_id AND s.company_id = $2 AND s.is_active = true
         WHERE NOT EXISTS (SELECT 1 FROM exam_results r WHERE r.exam_id = $1 AND r.student_id = en.student_id)
         ON CONFLICT (exam_id, student_id) DO NOTHING
         RETURNING student_id`,
        [params.id, context.companyId, exam.course_id],
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
        `SELECT e.name AS exam_name, c.name AS course_name, e.exam_date, e.max_grade, r.grade
         FROM exam_results r
         JOIN exams e   ON e.id = r.exam_id AND e.is_active = true
         JOIN courses c ON c.id = e.course_id
         WHERE r.student_id = $1 AND r.company_id = $2
         ORDER BY e.exam_date DESC`,
        [params.studentId, context.companyId],
      );

      return {
        status: 200 as const,
        body: rows.map((row) => ({
          examName: row.exam_name,
          courseName: row.course_name,
          examDate: row.exam_date,
          grade: row.grade,
          maxGrade: row.max_grade !== null && row.max_grade !== undefined ? parseFloat(row.max_grade) : null,
        })),
      };
    } catch (error: any) {
      console.error('Exam getByStudent error:', error);
      return mapThrownError(error, 'ERRORS.EXAMS.LIST_FAILED', 'Failed to load student exams');
    }
  },
};
