import { query, queryOne, getClient } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { assertOnlineExams } from './companies';

type AuthHeaders = { authorization: string };

/**
 * EXAM MODELS — the variants ("Model A / B / C") of one online exam.
 *
 * The original online exam is a POOL: the lessons in exam_lessons plus "draw N",
 * with every student getting their own random paper at attempt start. That still
 * works and is untouched — an exam with no models behaves exactly as before.
 *
 * A model is a FIXED paper instead. "Test 1" carries two to six models, each an
 * explicit ordered question list, and every student who sits Model A sees those
 * questions. Models are handed out either at random (balanced — see pickModel)
 * or one model per class.
 *
 * Two things deliberately NOT done here:
 *
 *  - models are not required to be the same length. exam_attempts.total is
 *    already per-attempt and db/exam-grading.ts re-derives it from the paper the
 *    student actually sat, so an 18-question model scores out of 18 next to a
 *    20-question one with no special case anywhere.
 *  - a model stores REFERENCES to bank questions, not snapshots. A model is a
 *    plan, so fixing a typo in the bank should fix it in the model too. The
 *    protection for a paper somebody has already answered lives elsewhere: the
 *    snapshot taken into exam_attempt_questions at attempt start.
 */

// ─── Schema ─────────────────────────────────────────────────────────────────

/** Mirrors migration 110; self-applies idempotently like the rest of the API. */
let examModelSchemaEnsured = false;
export async function ensureExamModelSchema(): Promise<void> {
  if (examModelSchemaEnsured) return;

  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS model_distribution VARCHAR(16)`);
  await query(`DO $$ BEGIN
    ALTER TABLE exams ADD CONSTRAINT exams_model_distribution_check
      CHECK (model_distribution IN ('RANDOM', 'BY_CLASS'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_models (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id     UUID NOT NULL REFERENCES exams(id)     ON DELETE CASCADE,
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name        VARCHAR(64) NOT NULL,
      order_index INTEGER NOT NULL,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, order_index)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_models_exam ON exam_models(exam_id, order_index)`);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_model_questions (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      model_id    UUID NOT NULL REFERENCES exam_models(id)      ON DELETE CASCADE,
      question_id UUID NOT NULL REFERENCES lesson_questions(id) ON DELETE CASCADE,
      lesson_id   UUID REFERENCES lessons(id) ON DELETE SET NULL,
      order_index INTEGER NOT NULL,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (model_id, order_index),
      UNIQUE (model_id, question_id)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_emq_model ON exam_model_questions(model_id, order_index)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_emq_question ON exam_model_questions(question_id)`);

  await query(`
    CREATE TABLE IF NOT EXISTS exam_model_classes (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id    UUID NOT NULL REFERENCES exams(id)       ON DELETE CASCADE,
      model_id   UUID NOT NULL REFERENCES exam_models(id) ON DELETE CASCADE,
      class_id   UUID NOT NULL REFERENCES classes(id)     ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, class_id)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_emc_exam ON exam_model_classes(exam_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_emc_model ON exam_model_classes(model_id)`);

  // What a student's paper was out of — see migration 110 and db/exam-grading.ts.
  await query(`ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS out_of INTEGER`);

  await query(`ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS model_id UUID`);
  await query(`DO $$ BEGIN
    ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_model_id_fkey
      FOREIGN KEY (model_id) REFERENCES exam_models(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`);
  await query(`CREATE INDEX IF NOT EXISTS idx_exam_attempts_model ON exam_attempts(model_id)`);

  examModelSchemaEnsured = true;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const MAX_MODELS = 6;
/** A..Z, so the third model is offered as "Model C" without the client naming it. */
const MODEL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The exam, if it belongs to this tenant and is an online one. */
async function loadOnlineExam(examId: string, companyId: string): Promise<any | null> {
  return queryOne<any>(
    `SELECT * FROM exams WHERE id = $1 AND company_id = $2 AND is_online = true`,
    [examId, companyId],
  );
}

/**
 * Once anybody has started, the models are frozen — exactly like the lesson
 * scope and question count (exams.ts). Papers already drawn came from these
 * models; editing them afterwards would leave two students marked against
 * different things under one exam name.
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

/** A model plus its exam, verified against the tenant in one hop. */
async function loadModel(modelId: string, companyId: string): Promise<any | null> {
  return queryOne<any>(
    `SELECT m.*, e.course_id, e.is_online
       FROM exam_models m JOIN exams e ON e.id = m.exam_id
      WHERE m.id = $1 AND m.company_id = $2`,
    [modelId, companyId],
  );
}

/**
 * Keep only ids that are real, active, keyed questions belonging to lessons of
 * this exam's course — in the order the caller asked for them.
 *
 * "Keyed" (has a correct option) matters: an unkeyed question cannot be marked,
 * so the pooled draw already refuses to deal one and a model must not either.
 * Silently dropping is wrong here — the caller is naming specific questions, so
 * a bad id is reported rather than ignored.
 */
async function resolveQuestionIds(
  ids: string[],
  courseId: string,
  companyId: string,
): Promise<{ ok: true; rows: any[] } | { ok: false; error: string; detail?: string }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length !== ids.length) {
    return { ok: false, error: 'ERRORS.EXAM_MODELS.DUPLICATE_QUESTION' };
  }
  if (!unique.length) return { ok: false, error: 'ERRORS.EXAM_MODELS.QUESTIONS_REQUIRED' };

  const rows = await query<any>(
    `SELECT q.id, q.lesson_id
       FROM lesson_questions q
       JOIN lessons l ON l.id = q.lesson_id
      WHERE q.id = ANY($1::uuid[]) AND q.company_id = $2 AND l.course_id = $3
        AND q.is_active = true
        AND EXISTS (SELECT 1 FROM lesson_question_options o
                     WHERE o.question_id = q.id AND o.is_correct = true)`,
    [unique, companyId, courseId],
  );
  if (rows.length !== unique.length) {
    return {
      ok: false,
      error: 'ERRORS.EXAM_MODELS.QUESTION_NOT_AVAILABLE',
      detail: `${unique.length - rows.length} of the chosen questions are not in this course, retired, or have no correct answer set`,
    };
  }

  // Preserve the caller's order — that IS the paper order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { ok: true, rows: unique.map((id) => byId.get(id)!) };
}

/** Draw `count` random keyed questions from these lessons, once, at build time. */
async function drawFromLessons(
  lessonIds: string[],
  count: number,
  courseId: string,
  companyId: string,
): Promise<{ ok: true; rows: any[] } | { ok: false; error: string; detail?: string }> {
  const lessons = await query<any>(
    `SELECT id FROM lessons WHERE id = ANY($1::uuid[]) AND course_id = $2 AND company_id = $3`,
    [[...new Set(lessonIds)], courseId, companyId],
  );
  if (!lessons.length) return { ok: false, error: 'ERRORS.EXAMS.LESSONS_REQUIRED' };
  if (lessons.length !== new Set(lessonIds).size) {
    return { ok: false, error: 'ERRORS.EXAMS.LESSON_COURSE_MISMATCH' };
  }

  const rows = await query<any>(
    `SELECT q.id, q.lesson_id
       FROM lesson_questions q
      WHERE q.lesson_id = ANY($1::uuid[]) AND q.company_id = $2 AND q.is_active = true
        AND EXISTS (SELECT 1 FROM lesson_question_options o
                     WHERE o.question_id = q.id AND o.is_correct = true)
      ORDER BY random()
      LIMIT $3`,
    [lessons.map((l) => l.id), companyId, count],
  );

  // Refused rather than silently short: the tenant asked for a 20-question
  // model and would otherwise not find out it holds 14 until somebody sat it.
  if (rows.length < count) {
    return {
      ok: false,
      error: 'ERRORS.EXAMS.NOT_ENOUGH_QUESTIONS',
      detail: `Only ${rows.length} usable questions in those lessons`,
    };
  }
  return { ok: true, rows };
}

/** Replace a model's questions with exactly this ordered list. */
async function writeModelQuestions(modelId: string, rows: any[]): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM exam_model_questions WHERE model_id = $1', [modelId]);
    for (let i = 0; i < rows.length; i++) {
      await client.query(
        `INSERT INTO exam_model_questions (model_id, question_id, lesson_id, order_index)
         VALUES ($1, $2, $3, $4)`,
        [modelId, rows[i].id, rows[i].lesson_id ?? null, i + 1],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** One model, with its questions and the classes pinned to it. */
async function serialiseModels(examId: string): Promise<any[]> {
  const models = await query<any>(
    `SELECT m.id, m.name, m.order_index,
            (SELECT COUNT(*) FROM exam_model_questions q WHERE q.model_id = m.id) AS question_count,
            (SELECT COUNT(*) FROM exam_attempts a WHERE a.model_id = m.id)        AS attempt_count
       FROM exam_models m WHERE m.exam_id = $1 ORDER BY m.order_index`,
    [examId],
  );
  if (!models.length) return [];

  const ids = models.map((m) => m.id);
  const questions = await query<any>(
    `SELECT emq.model_id, emq.question_id, emq.order_index,
            q.question_text, q.lesson_id, l.name AS lesson_name
       FROM exam_model_questions emq
       JOIN lesson_questions q ON q.id = emq.question_id
       LEFT JOIN lessons l ON l.id = q.lesson_id
      WHERE emq.model_id = ANY($1::uuid[])
      ORDER BY emq.model_id, emq.order_index`,
    [ids],
  );
  const classes = await query<any>(
    `SELECT model_id, class_id FROM exam_model_classes WHERE model_id = ANY($1::uuid[])`,
    [ids],
  );

  return models.map((m) => ({
    id: m.id,
    name: m.name,
    orderIndex: m.order_index,
    questionCount: Number(m.question_count ?? 0),
    // Surfaced so the UI can explain why the models are locked.
    attemptCount: Number(m.attempt_count ?? 0),
    questions: questions
      .filter((q) => q.model_id === m.id)
      .map((q) => ({
        questionId: q.question_id,
        orderIndex: q.order_index,
        questionText: q.question_text,
        lessonId: q.lesson_id ?? null,
        lessonName: q.lesson_name ?? null,
      })),
    classIds: classes.filter((c) => c.model_id === m.id).map((c) => c.class_id),
  }));
}

// ─── Model assignment at attempt start ──────────────────────────────────────

/**
 * Which model does this student sit? `null` means the exam has no models, and
 * the caller falls back to the original pooled random draw.
 *
 * BY_CLASS looks up the class the student is enrolled into FOR THIS EXAM'S
 * COURSE. A class nobody assigned a model to falls through to the balanced pick
 * rather than refusing: a student turning up to sit an exam must never be
 * blocked by an operator forgetting a row.
 *
 * The random path is balanced, not a coin toss — it takes the model with the
 * fewest attempts so far, ties broken randomly. An exam of 30 students and 3
 * models comes out roughly 10/10/10 instead of the lumpy 16/7/7 that
 * independent random picks would give, while staying unpredictable to the
 * student, which is the point of having models at all.
 */
export async function pickModel(exam: any, studentId: string): Promise<string | null> {
  const any = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM exam_models WHERE exam_id = $1`, [exam.id]);
  if (!parseInt(any?.n ?? '0', 10)) return null;

  if (exam.model_distribution === 'BY_CLASS') {
    const pinned = await queryOne<any>(
      `SELECT emc.model_id
         FROM exam_model_classes emc
        WHERE emc.exam_id = $1
          AND emc.class_id IN (
            SELECT e.class_id FROM enrollments e
             WHERE e.student_id = $2 AND e.course_id = $3
               AND e.status NOT IN ('DROPPED', 'CANCELLED'))
        LIMIT 1`,
      [exam.id, studentId, exam.course_id],
    );
    if (pinned?.model_id) return pinned.model_id;
  }

  const balanced = await queryOne<any>(
    `SELECT m.id
       FROM exam_models m
       LEFT JOIN exam_attempts a ON a.model_id = m.id
      WHERE m.exam_id = $1
      GROUP BY m.id, m.order_index
      ORDER BY COUNT(a.id) ASC, random()
      LIMIT 1`,
    [exam.id],
  );
  return balanced?.id ?? null;
}

/** The fixed paper of a model, in its own order. Shape matches drawPaper's. */
export async function loadModelQuestions(modelId: string, companyId: string): Promise<any[]> {
  return query<any>(
    `SELECT q.id, q.lesson_id, q.question_text
       FROM exam_model_questions emq
       JOIN lesson_questions q ON q.id = emq.question_id
      WHERE emq.model_id = $1 AND q.company_id = $2 AND q.is_active = true
        -- Same guard as the pooled draw: a question whose key was unset after
        -- the model was built cannot be marked, so it is not asked.
        AND EXISTS (SELECT 1 FROM lesson_question_options o
                     WHERE o.question_id = q.id AND o.is_correct = true)
      ORDER BY emq.order_index`,
    [modelId, companyId],
  );
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/** Guard shared by every route here: signed in, may write/read, feature on. */
async function guard(headers: AuthHeaders, mode: 'read' | 'write') {
  const context = await extractTenantContext(headers.authorization);
  if (!checkGranularPermission(context, 'academy', mode)) {
    return { denied: apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions') };
  }
  const denied = await assertOnlineExams(context.companyId);
  if (denied) return { denied };
  await ensureExamModelSchema();
  return { context };
}

export const examModelsRoutes = {
  /**
   * GET /api/exams/:examId/models
   * The models, their papers, the class pinning, and the classes available to
   * pin — everything the models editor needs in one call.
   */
  list: async ({ params, headers }: { params: { examId: string }; headers: AuthHeaders }) => {
    try {
      const g = await guard(headers, 'read');
      if (g.denied) return g.denied;
      const exam = await loadOnlineExam(params.examId, g.context!.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');

      const classes = await query<any>(
        `SELECT cl.id, cl.name FROM classes cl
          WHERE cl.course_id = $1 AND cl.deleted_at IS NULL
          ORDER BY cl.name`,
        [exam.course_id],
      );

      return {
        status: 200 as const,
        body: {
          distribution: exam.model_distribution ?? null,
          locked: await examHasAttempts(exam.id),
          models: await serialiseModels(exam.id),
          classes: classes.map((c) => ({ id: c.id, name: c.name })),
        },
      };
    } catch (error) {
      console.error('List exam models error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.LIST_FAILED', 'Failed to load the exam models');
    }
  },

  /**
   * GET /api/exams/:examId/question-pool?lessonIds=a,b
   * The bank the models are built from: every usable question of the exam's
   * course, with its lesson, so the picker can show and filter them. Nothing
   * else in the app browses questions across lessons.
   *
   * Never carries which option is correct — this is a teacher screen, but the
   * answer key has no business travelling for a list that only needs text.
   */
  questionPool: async ({ params, query: q, headers }: {
    params: { examId: string };
    query?: { lessonIds?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'read');
      if (g.denied) return g.denied;
      const exam = await loadOnlineExam(params.examId, g.context!.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');

      const wanted = (q?.lessonIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      const params2: any[] = [exam.course_id, g.context!.companyId];
      let sql = `
        SELECT q.id, q.question_text, q.lesson_id, l.name AS lesson_name, l.order_index
          FROM lesson_questions q
          JOIN lessons l ON l.id = q.lesson_id
         WHERE l.course_id = $1 AND q.company_id = $2 AND q.is_active = true
           AND EXISTS (SELECT 1 FROM lesson_question_options o
                        WHERE o.question_id = q.id AND o.is_correct = true)`;
      if (wanted.length) {
        params2.push(wanted);
        sql += ` AND q.lesson_id = ANY($${params2.length}::uuid[])`;
      }
      sql += ' ORDER BY l.order_index, l.name, q.created_at';

      const rows = await query<any>(sql, params2);
      return {
        status: 200 as const,
        body: rows.map((r) => ({
          id: r.id,
          questionText: r.question_text,
          lessonId: r.lesson_id,
          lessonName: r.lesson_name ?? null,
        })),
      };
    } catch (error) {
      console.error('Exam question pool error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.LIST_FAILED', 'Failed to load the question pool');
    }
  },

  /**
   * POST /api/exams/:examId/models
   * Add a model, built one of two ways:
   *   { questionIds: [...] }                  — hand-picked from the bank, in order
   *   { lessonIds: [...], questionCount: N }  — N drawn at random from those
   *                                             lessons ONCE, now, and then fixed
   */
  create: async ({ params, body, headers }: {
    params: { examId: string };
    body: { name?: string | null; questionIds?: string[]; lessonIds?: string[]; questionCount?: number };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;
      const exam = await loadOnlineExam(params.examId, companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (await examHasAttempts(exam.id)) {
        return apiError(409, 'ERRORS.EXAMS.ALREADY_STARTED', 'Students have already started this exam');
      }

      const existing = await query<any>(
        'SELECT order_index FROM exam_models WHERE exam_id = $1 ORDER BY order_index', [exam.id]);
      if (existing.length >= MAX_MODELS) {
        return apiError(400, 'ERRORS.EXAM_MODELS.TOO_MANY', `An exam can hold at most ${MAX_MODELS} models`);
      }

      const resolved = Array.isArray(body?.questionIds) && body.questionIds.length
        ? await resolveQuestionIds(body.questionIds, exam.course_id, companyId)
        : await (async () => {
            const count = parseInt(String(body?.questionCount ?? ''), 10);
            if (!Number.isFinite(count) || count < 1) {
              return { ok: false as const, error: 'ERRORS.EXAMS.QUESTION_COUNT_REQUIRED' };
            }
            if (!Array.isArray(body?.lessonIds) || !body.lessonIds.length) {
              return { ok: false as const, error: 'ERRORS.EXAMS.LESSONS_REQUIRED' };
            }
            return drawFromLessons(body.lessonIds, count, exam.course_id, companyId);
          })();
      if (!resolved.ok) return apiError(400, resolved.error, resolved.detail || 'Could not build the model');

      const nextIndex = (existing.at(-1)?.order_index ?? 0) + 1;
      const name = (body?.name ?? '').trim()
        || `Model ${MODEL_LETTERS[Math.min(nextIndex - 1, MODEL_LETTERS.length - 1)]}`;

      const model = await queryOne<any>(
        `INSERT INTO exam_models (exam_id, company_id, name, order_index)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [exam.id, companyId, name.slice(0, 64), nextIndex],
      );
      await writeModelQuestions(model.id, resolved.rows);

      // A first model turns the exam into a model exam; default to random until
      // somebody chooses per-class.
      if (!exam.model_distribution) {
        await query(`UPDATE exams SET model_distribution = 'RANDOM', updated_at = NOW() WHERE id = $1`, [exam.id]);
      }

      return { status: 201 as const, body: { models: await serialiseModels(exam.id) } };
    } catch (error) {
      console.error('Create exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the model');
    }
  },

  /**
   * PATCH /api/exams/models/:modelId
   * Rename, and/or replace the paper — by ids, or by re-drawing from lessons.
   */
  update: async ({ params, body, headers }: {
    params: { modelId: string };
    body: { name?: string | null; questionIds?: string[]; lessonIds?: string[]; questionCount?: number };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;
      const model = await loadModel(params.modelId, companyId);
      if (!model) return apiError(404, 'ERRORS.EXAM_MODELS.NOT_FOUND', 'Model not found');
      if (await examHasAttempts(model.exam_id)) {
        return apiError(409, 'ERRORS.EXAMS.ALREADY_STARTED', 'Students have already started this exam');
      }

      if (body?.name !== undefined) {
        const name = (body.name ?? '').trim();
        if (!name) return apiError(400, 'ERRORS.EXAM_MODELS.NAME_REQUIRED', 'A model needs a name');
        await query('UPDATE exam_models SET name = $2, updated_at = NOW() WHERE id = $1',
          [model.id, name.slice(0, 64)]);
      }

      const wantsRedraw = Array.isArray(body?.lessonIds) && body.questionCount !== undefined;
      if (Array.isArray(body?.questionIds) || wantsRedraw) {
        const resolved = Array.isArray(body?.questionIds)
          ? await resolveQuestionIds(body.questionIds, model.course_id, companyId)
          : await drawFromLessons(
              body!.lessonIds!, parseInt(String(body!.questionCount), 10), model.course_id, companyId);
        if (!resolved.ok) return apiError(400, resolved.error, resolved.detail || 'Could not build the model');
        await writeModelQuestions(model.id, resolved.rows);
      }

      return { status: 200 as const, body: { models: await serialiseModels(model.exam_id) } };
    } catch (error) {
      console.error('Update exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the model');
    }
  },

  /** DELETE /api/exams/models/:modelId */
  remove: async ({ params, headers }: { params: { modelId: string }; headers: AuthHeaders }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const model = await loadModel(params.modelId, g.context!.companyId);
      if (!model) return apiError(404, 'ERRORS.EXAM_MODELS.NOT_FOUND', 'Model not found');
      if (await examHasAttempts(model.exam_id)) {
        return apiError(409, 'ERRORS.EXAMS.ALREADY_STARTED', 'Students have already started this exam');
      }

      await query('DELETE FROM exam_models WHERE id = $1', [model.id]);
      // Last model gone: the exam goes back to being a pooled random-draw exam,
      // which is what it will actually do at the next attempt start.
      const left = await queryOne<any>('SELECT COUNT(*) AS n FROM exam_models WHERE exam_id = $1', [model.exam_id]);
      if (!parseInt(left?.n ?? '0', 10)) {
        await query('UPDATE exams SET model_distribution = NULL, updated_at = NOW() WHERE id = $1', [model.exam_id]);
      }

      return { status: 200 as const, body: { models: await serialiseModels(model.exam_id) } };
    } catch (error) {
      console.error('Delete exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.DELETE_FAILED', 'Failed to delete the model');
    }
  },

  /**
   * PUT /api/exams/:examId/model-distribution
   *   { distribution: 'RANDOM' | 'BY_CLASS', assignments?: [{ classId, modelId }] }
   *
   * Assignments are replaced wholesale, and only mean anything under BY_CLASS —
   * they are kept when switching to RANDOM so flipping back does not lose the
   * mapping somebody typed in.
   */
  setDistribution: async ({ params, body, headers }: {
    params: { examId: string };
    body: { distribution: string; assignments?: { classId: string; modelId: string }[] };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;
      const exam = await loadOnlineExam(params.examId, companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      if (await examHasAttempts(exam.id)) {
        return apiError(409, 'ERRORS.EXAMS.ALREADY_STARTED', 'Students have already started this exam');
      }

      const distribution = String(body?.distribution || '').toUpperCase();
      if (!['RANDOM', 'BY_CLASS'].includes(distribution)) {
        return apiError(400, 'ERRORS.EXAM_MODELS.BAD_DISTRIBUTION', 'Distribution must be RANDOM or BY_CLASS');
      }
      const models = await query<any>('SELECT id FROM exam_models WHERE exam_id = $1', [exam.id]);
      if (!models.length) {
        return apiError(400, 'ERRORS.EXAM_MODELS.NONE_YET', 'Add a model before choosing how they are handed out');
      }

      const assignments = Array.isArray(body?.assignments) ? body.assignments : null;
      if (assignments) {
        const modelIds = new Set(models.map((m) => m.id));
        const classes = await query<any>(
          `SELECT id FROM classes WHERE course_id = $1 AND deleted_at IS NULL`, [exam.course_id]);
        const classIds = new Set(classes.map((c) => c.id));
        for (const a of assignments) {
          if (!modelIds.has(a?.modelId)) {
            return apiError(400, 'ERRORS.EXAM_MODELS.NOT_FOUND', 'One of the chosen models does not belong to this exam');
          }
          if (!classIds.has(a?.classId)) {
            return apiError(400, 'ERRORS.EXAM_MODELS.CLASS_MISMATCH', 'One of the chosen classes is not on this course');
          }
        }

        const client = await getClient();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM exam_model_classes WHERE exam_id = $1', [exam.id]);
          for (const a of assignments) {
            await client.query(
              `INSERT INTO exam_model_classes (exam_id, model_id, class_id) VALUES ($1, $2, $3)
               ON CONFLICT (exam_id, class_id) DO UPDATE SET model_id = EXCLUDED.model_id`,
              [exam.id, a.modelId, a.classId],
            );
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      }

      await query('UPDATE exams SET model_distribution = $2, updated_at = NOW() WHERE id = $1',
        [exam.id, distribution]);

      return {
        status: 200 as const,
        body: { distribution, models: await serialiseModels(exam.id) },
      };
    } catch (error) {
      console.error('Set exam model distribution error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the distribution');
    }
  },
};
