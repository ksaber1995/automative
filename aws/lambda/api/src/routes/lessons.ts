import { insert, update, query, queryOne, getClient } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { assertOnlineExams } from './companies';

type AuthHeaders = { authorization: string };

/**
 * Lessons — the curriculum of a course, in order.
 *
 * Phase 1 of the online-exams feature (online_exams.md): a teacher registers the
 * lessons a course is taught in, and later phases hang a question bank off each
 * lesson and draw exam papers from them. Nothing here is exam behaviour yet.
 *
 * Per COURSE, not per class: every class of a course teaches the same lessons.
 *
 * Every handler is gated twice — the `academy` permission the rest of the
 * academic screens use, then assertOnlineExams, which keeps the whole feature
 * dark for tenants who have not been switched on. Both, in that order: a tenant
 * without the flag should look like the feature doesn't exist, not like they lack
 * a permission.
 */

/**
 * Idempotent runtime guard — creates the lessons table if a DB hasn't had
 * migration 100 applied yet (mirrors ensureExamTables in routes/exams.ts).
 * Cheap once the table exists.
 */
let lessonSchemaEnsured = false;
export async function ensureLessonSchema(): Promise<void> {
  if (lessonSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS lessons (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      branch_id   UUID REFERENCES branches(id) ON DELETE SET NULL,
      course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      name        VARCHAR(255) NOT NULL,
      description TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_lessons_company ON lessons(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lessons_course  ON lessons(course_id, order_index)`);
  lessonSchemaEnsured = true;
}

/**
 * Idempotent runtime guard for the question bank (migration 101). Separate from
 * ensureLessonSchema so the lesson endpoints don't pay for it: only the bank
 * handlers need these two tables.
 */
let questionSchemaEnsured = false;
export async function ensureQuestionSchema(): Promise<void> {
  if (questionSchemaEnsured) return;
  await ensureLessonSchema();
  await query(`
    CREATE TABLE IF NOT EXISTS lesson_questions (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lesson_id     UUID NOT NULL REFERENCES lessons(id)   ON DELETE CASCADE,
      course_id     UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type VARCHAR(16) NOT NULL DEFAULT 'MCQ' CHECK (question_type IN ('MCQ')),
      explanation   TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_lesson_questions_lesson  ON lesson_questions(lesson_id, is_active)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lesson_questions_company ON lesson_questions(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_lesson_questions_course  ON lesson_questions(course_id, is_active)`);
  await query(`
    CREATE TABLE IF NOT EXISTS lesson_question_options (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      question_id UUID NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
      option_text TEXT NOT NULL,
      is_correct  BOOLEAN NOT NULL DEFAULT false,
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_lesson_question_options_q ON lesson_question_options(question_id, order_index)`);
  questionSchemaEnsured = true;
}

/** How many options a question may carry. Two is a question; seven is a survey. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function mapQuestionFromDB(row: any, options: any[]) {
  return {
    id: row.id,
    companyId: row.company_id,
    lessonId: row.lesson_id,
    courseId: row.course_id,
    questionText: row.question_text,
    questionType: row.question_type ?? 'MCQ',
    explanation: row.explanation ?? null,
    isActive: row.is_active === true,
    options: options.map((o) => ({
      id: o.id,
      optionText: o.option_text,
      isCorrect: o.is_correct === true,
      orderIndex: o.order_index ?? 0,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates the option list of a whole-question write, and returns it cleaned.
 *
 * The rules are the ones an MCQ needs to be answerable: enough options to
 * choose between, not so many nobody reads them, no blank text, and AT MOST one
 * right answer — two means marking it is a coin toss. NONE is allowed on
 * purpose: an imported bank can arrive with the keys unset for the teacher to
 * fill in later, and a keyless question is simply excluded from exam pools
 * (see lessonPoolSize / drawPaper) until it gets one.
 *
 * Returns a string error key on failure, so callers can turn it into a 400 with
 * the message the client already has a translation for.
 */
function validateOptions(input: any): { error: string } | { options: { text: string; isCorrect: boolean }[] } {
  if (!Array.isArray(input)) return { error: 'ERRORS.LESSONS.OPTIONS_REQUIRED' };
  const options = input.map((o: any) => ({
    text: typeof o?.optionText === 'string' ? o.optionText.trim() : '',
    isCorrect: o?.isCorrect === true,
  }));
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return { error: 'ERRORS.LESSONS.OPTION_COUNT' };
  }
  if (options.some((o) => !o.text)) return { error: 'ERRORS.LESSONS.OPTION_TEXT_REQUIRED' };
  if (options.filter((o) => o.isCorrect).length > 1) {
    return { error: 'ERRORS.LESSONS.ONE_CORRECT_REQUIRED' };
  }
  return { options };
}

/**
 * How many active questions the given lessons hold between them — the pool an
 * online exam draws its paper from.
 *
 * Company-scoped, so a lesson id from another tenant contributes nothing rather
 * than inflating the count. Returns 0 for an empty list.
 */
export async function lessonPoolSize(lessonIds: string[], companyId: string): Promise<number> {
  if (!lessonIds.length) return 0;
  await ensureQuestionSchema();
  const row = await queryOne<any>(
    `SELECT COUNT(*) AS total
       FROM lesson_questions q
      WHERE q.lesson_id = ANY($1::uuid[]) AND q.company_id = $2 AND q.is_active = true
        -- A question with no key set (imports arrive that way) cannot be
        -- marked, so it is not part of any exam's pool until the teacher sets one.
        AND EXISTS (SELECT 1 FROM lesson_question_options o
                     WHERE o.question_id = q.id AND o.is_correct = true)`,
    [lessonIds, companyId]
  );
  return parseInt(row?.total ?? '0', 10);
}

/**
 * Filters a list of lesson ids down to the ones that exist in this tenant and
 * belong to the given course — used when an online exam is saved, so its scope can
 * never include a lesson from another course (or another academy).
 */
export async function lessonsInCourse(
  lessonIds: string[],
  courseId: string,
  companyId: string
): Promise<string[]> {
  if (!lessonIds.length) return [];
  await ensureLessonSchema();
  const rows = await query<any>(
    `SELECT id FROM lessons
      WHERE id = ANY($1::uuid[]) AND course_id = $2 AND company_id = $3 AND is_active = true`,
    [lessonIds, courseId, companyId]
  );
  return rows.map((r) => r.id);
}

/** Loads a lesson inside the tenant, for access checks on its bank. */
async function loadLesson(lessonId: string, companyId: string) {
  return queryOne<any>(
    'SELECT id, course_id, branch_id FROM lessons WHERE id = $1 AND company_id = $2',
    [lessonId, companyId]
  );
}

/** Writes a question's options as its complete, ordered list. */
async function writeOptions(
  client: any,
  questionId: string,
  options: { text: string; isCorrect: boolean }[]
): Promise<void> {
  // Replace wholesale rather than diff: a question is always written as a whole, so
  // reconciling ids would be work in aid of nothing. Sat papers keep their own
  // snapshot of the options, so nothing historical points at these rows.
  await client.query('DELETE FROM lesson_question_options WHERE question_id = $1', [questionId]);
  for (let i = 0; i < options.length; i++) {
    await client.query(
      `INSERT INTO lesson_question_options (question_id, option_text, is_correct, order_index)
       VALUES ($1, $2, $3, $4)`,
      [questionId, options[i].text, options[i].isCorrect, i + 1]
    );
  }
}

function mapLessonFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id ?? null,
    courseId: row.course_id,
    courseName: row.course_name ?? undefined,
    name: row.name,
    description: row.description ?? null,
    orderIndex: row.order_index ?? 0,
    questionCount: row.question_count !== undefined && row.question_count !== null
      ? parseInt(row.question_count, 10)
      : undefined,
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * How many questions a lesson holds, as a scalar subquery.
 *
 * The bank arrives in phase 2, so on a database that predates it the subquery
 * would fail the whole list. `to_regclass` makes it read as 0 until the table
 * exists, which is the honest answer for a lesson with no bank yet.
 */
const QUESTION_COUNT_SQL = `
  CASE WHEN to_regclass('public.lesson_questions') IS NULL THEN 0
       ELSE (SELECT COUNT(*) FROM lesson_questions q
              WHERE q.lesson_id = l.id AND q.is_active = true)
  END`;

/** Loads a course inside the tenant, for branch stamping and access checks. */
async function loadCourse(courseId: string, companyId: string) {
  return queryOne<any>(
    'SELECT id, branch_id FROM courses WHERE id = $1 AND company_id = $2',
    [courseId, companyId]
  );
}

export const lessonsRoutes = {
  list: async ({ query: queryParams, headers }: {
    query: { courseId?: string; branchId?: string; includeInactive?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      let sql = `SELECT l.*, c.name AS course_name, ${QUESTION_COUNT_SQL} AS question_count
                   FROM lessons l
                   JOIN courses c ON c.id = l.course_id
                  WHERE l.company_id = $1`;
      const params: any[] = [context.companyId];

      // Retired lessons stay out of the list unless asked for — they exist for the
      // history hanging off them, not to be worked with.
      if (queryParams.includeInactive !== 'true') {
        sql += ' AND l.is_active = true';
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND l.course_id = $${params.length}`;
      }

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND l.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context)) {
        const branchFilter = appendBranchSqlFilter(context, params, 'l.branch_id');
        if (branchFilter) sql += ` AND (${branchFilter} OR l.branch_id IS NULL)`;
      }

      sql += ' ORDER BY l.order_index, l.created_at';

      const rows = await query(sql, params);
      return { status: 200 as const, body: rows.map(mapLessonFromDB) };
    } catch (error: any) {
      console.error('List lessons error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.LIST_FAILED', 'Failed to list lessons');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      const row = await queryOne<any>(
        `SELECT l.*, c.name AS course_name, ${QUESTION_COUNT_SQL} AS question_count
           FROM lessons l
           JOIN courses c ON c.id = l.course_id
          WHERE l.id = $1 AND l.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found');
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      return { status: 200 as const, body: mapLessonFromDB(row) };
    } catch (error: any) {
      console.error('Get lesson error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found', 404);
    }
  },

  create: async ({ body, headers }: { body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      // The course decides the branch — a lesson never gets one of its own, so it
      // cannot drift from the course it belongs to.
      const course = await loadCourse(body.courseId, context.companyId);
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // Default to the end of the course's list, so lessons register in the order
      // they are typed and the teacher never has to think about a number.
      let orderIndex = body.orderIndex;
      if (orderIndex === undefined || orderIndex === null) {
        const last = await queryOne<any>(
          'SELECT MAX(order_index) AS max_index FROM lessons WHERE course_id = $1 AND company_id = $2',
          [body.courseId, context.companyId]
        );
        orderIndex = last?.max_index !== null && last?.max_index !== undefined
          ? parseInt(last.max_index, 10) + 1
          : 1;
      }

      const row = await insert('lessons', {
        company_id: context.companyId,
        branch_id: course.branch_id ?? null,
        course_id: body.courseId,
        name: body.name,
        description: body.description || null,
        order_index: orderIndex,
        is_active: true,
      });

      return { status: 201 as const, body: mapLessonFromDB(row) };
    } catch (error: any) {
      console.error('Create lesson error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.CREATE_FAILED', 'Failed to create lesson', 400);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      const existing = await queryOne<any>(
        'SELECT * FROM lessons WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description || null;
      if (body.orderIndex !== undefined && body.orderIndex !== null) updateData.order_index = body.orderIndex;
      if (body.isActive !== undefined) updateData.is_active = body.isActive === true;

      // Moving a lesson to another course re-stamps the branch from the new course,
      // so the two can never disagree.
      if (body.courseId !== undefined && body.courseId && body.courseId !== existing.course_id) {
        const course = await loadCourse(body.courseId, context.companyId);
        if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
        if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.course_id = body.courseId;
        updateData.branch_id = course.branch_id ?? null;
      }

      if (Object.keys(updateData).length === 0) {
        return { status: 200 as const, body: mapLessonFromDB(existing) };
      }

      const row = await update('lessons', params.id, updateData);
      return { status: 200 as const, body: mapLessonFromDB(row) };
    } catch (error: any) {
      console.error('Update lesson error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.UPDATE_FAILED', 'Failed to update lesson', 400);
    }
  },

  /**
   * Soft-delete. A hard delete would cascade the lesson's question bank away, and
   * later the exams drawn from it, so retiring hides the lesson and keeps both.
   */
  delete: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      const existing = await queryOne<any>(
        'SELECT * FROM lessons WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      await update('lessons', params.id, { is_active: false });
      return { status: 200 as const, body: { message: 'Lesson deleted' } };
    } catch (error: any) {
      console.error('Delete lesson error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.DELETE_FAILED', 'Failed to delete lesson', 400);
    }
  },

  /**
   * Rewrite the order of a course's lessons from a list of ids.
   *
   * One transaction, because a half-applied reorder leaves the course in an order
   * nobody asked for. Ids that don't belong to this course (or this company) are
   * ignored rather than failing the batch — the client sends what it rendered, and
   * a lesson retired in another tab shouldn't block the drag that just happened.
   */
  reorder: async ({ body, headers }: {
    body: { courseId: string; lessonIds: string[] };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureLessonSchema();

      const course = await loadCourse(body.courseId, context.companyId);
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const ids = Array.isArray(body.lessonIds) ? body.lessonIds : [];
      const client = await getClient();
      let updated = 0;
      try {
        await client.query('BEGIN');
        for (let i = 0; i < ids.length; i++) {
          const result = await client.query(
            `UPDATE lessons SET order_index = $1, updated_at = NOW()
              WHERE id = $2 AND course_id = $3 AND company_id = $4`,
            [i + 1, ids[i], body.courseId, context.companyId]
          );
          updated += result.rowCount ?? 0;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      return { status: 200 as const, body: { success: true, count: updated } };
    } catch (error: any) {
      console.error('Reorder lessons error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.REORDER_FAILED', 'Failed to reorder lessons', 400);
    }
  },

  // ─── Question bank ─────────────────────────────────────────────────────────
  // The authenticated teacher view, so the correct answer IS included here. The
  // student-facing serialiser (phase 5) is a different one and must never emit it.

  listQuestions: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureQuestionSchema();

      const lesson = await loadLesson(params.id, context.companyId);
      if (!lesson) return apiError(404, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found');
      if (lesson.branch_id && !canAccessBranch(context, lesson.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      const rows = await query<any>(
        `SELECT * FROM lesson_questions
          WHERE lesson_id = $1 AND company_id = $2 AND is_active = true
          ORDER BY created_at`,
        [params.id, context.companyId]
      );
      if (rows.length === 0) return { status: 200 as const, body: [] };

      // One round trip for every option of every question, then grouped in memory:
      // a bank is tens of questions, so this is cheaper than a query per question.
      const optionRows = await query<any>(
        `SELECT * FROM lesson_question_options
          WHERE question_id = ANY($1::uuid[])
          ORDER BY order_index`,
        [rows.map((r) => r.id)]
      );
      const byQuestion = new Map<string, any[]>();
      for (const o of optionRows) {
        const list = byQuestion.get(o.question_id) ?? [];
        list.push(o);
        byQuestion.set(o.question_id, list);
      }

      return {
        status: 200 as const,
        body: rows.map((r) => mapQuestionFromDB(r, byQuestion.get(r.id) ?? [])),
      };
    } catch (error: any) {
      console.error('List lesson questions error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.QUESTIONS_LIST_FAILED', 'Failed to list questions');
    }
  },

  createQuestion: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureQuestionSchema();

      const lesson = await loadLesson(params.id, context.companyId);
      if (!lesson) return apiError(404, 'ERRORS.LESSONS.NOT_FOUND', 'Lesson not found');
      if (lesson.branch_id && !canAccessBranch(context, lesson.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      const questionText = (body.questionText ?? '').trim();
      if (!questionText) return apiError(400, 'ERRORS.LESSONS.QUESTION_TEXT_REQUIRED', 'Question text is required');

      const validated = validateOptions(body.options);
      if ('error' in validated) return apiError(400, validated.error, 'Invalid options');

      // Question and its options are one write: a question with no options is not a
      // question, so it must never exist, not even briefly.
      const client = await getClient();
      let row: any;
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO lesson_questions (company_id, lesson_id, course_id, question_text, explanation)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [context.companyId, params.id, lesson.course_id, questionText, (body.explanation ?? '').trim() || null]
        );
        row = inserted.rows[0];
        await writeOptions(client, row.id, validated.options);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const options = await query<any>(
        'SELECT * FROM lesson_question_options WHERE question_id = $1 ORDER BY order_index',
        [row.id]
      );
      return { status: 201 as const, body: mapQuestionFromDB(row, options) };
    } catch (error: any) {
      console.error('Create lesson question error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.QUESTION_CREATE_FAILED', 'Failed to create question', 400);
    }
  },

  updateQuestion: async ({ params, body, headers }: {
    params: { lessonId: string; questionId: string };
    body: any;
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureQuestionSchema();

      const existing = await queryOne<any>(
        `SELECT q.* FROM lesson_questions q
          WHERE q.id = $1 AND q.lesson_id = $2 AND q.company_id = $3`,
        [params.questionId, params.lessonId, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LESSONS.QUESTION_NOT_FOUND', 'Question not found');

      const lesson = await loadLesson(params.lessonId, context.companyId);
      if (lesson?.branch_id && !canAccessBranch(context, lesson.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      const questionText = body.questionText !== undefined
        ? (body.questionText ?? '').trim()
        : existing.question_text;
      if (!questionText) return apiError(400, 'ERRORS.LESSONS.QUESTION_TEXT_REQUIRED', 'Question text is required');

      // Options are replaced only when sent. Editing a typo in the stem should not
      // require re-posting the answers.
      let newOptions: { text: string; isCorrect: boolean }[] | null = null;
      if (body.options !== undefined) {
        const validated = validateOptions(body.options);
        if ('error' in validated) return apiError(400, validated.error, 'Invalid options');
        newOptions = validated.options;
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE lesson_questions
              SET question_text = $2,
                  explanation = $3,
                  is_active = $4,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            params.questionId,
            questionText,
            body.explanation !== undefined ? ((body.explanation ?? '').trim() || null) : existing.explanation,
            body.isActive !== undefined ? body.isActive === true : existing.is_active,
          ]
        );
        if (newOptions) await writeOptions(client, params.questionId, newOptions);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      const row = await queryOne<any>('SELECT * FROM lesson_questions WHERE id = $1', [params.questionId]);
      const options = await query<any>(
        'SELECT * FROM lesson_question_options WHERE question_id = $1 ORDER BY order_index',
        [params.questionId]
      );
      return { status: 200 as const, body: mapQuestionFromDB(row, options) };
    } catch (error: any) {
      console.error('Update lesson question error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.QUESTION_UPDATE_FAILED', 'Failed to update question', 400);
    }
  },

  /**
   * Soft-delete: the question drops out of future draws and stays readable for the
   * papers already sat on it.
   */
  deleteQuestion: async ({ params, headers }: {
    params: { lessonId: string; questionId: string };
    headers: AuthHeaders;
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const denied = await assertOnlineExams(context.companyId);
      if (denied) return denied;
      await ensureQuestionSchema();

      const existing = await queryOne<any>(
        `SELECT id FROM lesson_questions
          WHERE id = $1 AND lesson_id = $2 AND company_id = $3`,
        [params.questionId, params.lessonId, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LESSONS.QUESTION_NOT_FOUND', 'Question not found');

      const lesson = await loadLesson(params.lessonId, context.companyId);
      if (lesson?.branch_id && !canAccessBranch(context, lesson.branch_id)) {
        return apiError(403, 'ERRORS.LESSONS.ACCESS_DENIED', 'Access denied to this lesson');
      }

      await query(
        'UPDATE lesson_questions SET is_active = false, updated_at = NOW() WHERE id = $1',
        [params.questionId]
      );
      return { status: 200 as const, body: { message: 'Question deleted' } };
    } catch (error: any) {
      console.error('Delete lesson question error:', error);
      return mapThrownError(error, 'ERRORS.LESSONS.QUESTION_DELETE_FAILED', 'Failed to delete question', 400);
    }
  },
};
