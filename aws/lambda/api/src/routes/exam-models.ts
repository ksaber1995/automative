import { query, queryOne, getClient } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { assertOnlineExams } from './companies';

type AuthHeaders = { authorization: string };

/**
 * EXAM MODELS â€” a LIBRARY of ready-made papers, built per course.
 *
 * Models are their own thing, like the question bank: you build "Model A / B /
 * C" for a course once, and any exam on that course can hand them out. A retake
 * or a second sitting reuses them instead of rebuilding them.
 *
 * An online exam then declares how it gets its paper (exams.question_source):
 *
 *   RANDOM â€” the original behaviour and the default. Every student gets their
 *            own random paper drawn at attempt start from the exam's lessons.
 *   FIXED  â€” the exam hands out the library models linked to it
 *            (exam_model_links), either balanced-random or one per class.
 *
 * Three things deliberately NOT done here:
 *
 *  - models are not required to be the same length. exam_attempts.total is
 *    already per-attempt and db/exam-grading.ts re-derives it from the paper the
 *    student actually sat, so an 18-question model scores out of 18 next to a
 *    20-question one with no special case anywhere.
 *  - a model stores REFERENCES to bank questions, not snapshots. A model is a
 *    plan, so fixing a typo in the bank should fix it in the model too. The
 *    protection for a paper somebody has already answered lives elsewhere: the
 *    snapshot taken into exam_attempt_questions at attempt start.
 *  - a model is not frozen by ITS OWN age but by use: it locks as soon as any
 *    exam using it has been started. That is the price of a shared library â€”
 *    editing a model would silently rewrite a paper another exam has already
 *    handed out.
 */

// â”€â”€â”€ Schema â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // Fresh installs get the library shape directly; an installation that ran
  // migration 110 is reshaped by the block further down.
  await query(`
    CREATE TABLE IF NOT EXISTS exam_models (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
      name        VARCHAR(64) NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`);
  await query(`ALTER TABLE exam_models ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES courses(id) ON DELETE CASCADE`);

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

  // â”€â”€ The library reshape (migration 111) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Which library models an exam hands out.
  await query(`
    CREATE TABLE IF NOT EXISTS exam_model_links (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      exam_id     UUID NOT NULL REFERENCES exams(id)       ON DELETE CASCADE,
      model_id    UUID NOT NULL REFERENCES exam_models(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL DEFAULT 1,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (exam_id, model_id)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eml_exam ON exam_model_links(exam_id, order_index)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_eml_model ON exam_model_links(model_id)`);

  // RANDOM by default, so every exam that already exists keeps behaving exactly
  // as it does now.
  await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS question_source VARCHAR(16) NOT NULL DEFAULT 'RANDOM'`);
  await query(`DO $$ BEGIN
    ALTER TABLE exams ADD CONSTRAINT exams_question_source_check
      CHECK (question_source IN ('RANDOM', 'FIXED'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$`);

  // Carry migration 110's per-exam models over, then retire the column that
  // tied a library row to a single exam. Both are self-limiting no-ops after
  // the first boot that runs them.
  await query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'exam_models' AND column_name = 'exam_id') THEN
      UPDATE exam_models m SET course_id = e.course_id
        FROM exams e WHERE e.id = m.exam_id AND m.course_id IS NULL;
      INSERT INTO exam_model_links (exam_id, model_id, order_index)
        SELECT m.exam_id, m.id, m.order_index FROM exam_models m WHERE m.exam_id IS NOT NULL
          ON CONFLICT (exam_id, model_id) DO NOTHING;
      UPDATE exams e SET question_source = 'FIXED'
        WHERE EXISTS (SELECT 1 FROM exam_model_links l WHERE l.exam_id = e.id);
      ALTER TABLE exam_models DROP COLUMN exam_id;
    END IF;
  END $$`);

  await query(`CREATE INDEX IF NOT EXISTS idx_exam_models_course ON exam_models(course_id, order_index)`);

  // What a student's paper was out of â€” see migration 110 and db/exam-grading.ts.
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

// â”€â”€â”€ Shared helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
 * Once anybody has started, an exam's model choice and distribution are frozen â€”
 * exactly like its lesson scope and question count (exams.ts). Papers already
 * drawn came from those models; changing them afterwards would leave two
 * students marked against different things under one exam name.
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
 * Is this library model in use by an exam somebody has already started?
 *
 * The price of a shared library: editing a model would silently rewrite a paper
 * another exam has already handed out. So a model locks on first use, not on its
 * own age, and the lock is reported per model so the library can show which rows
 * are still editable.
 */
async function modelIsLocked(modelId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT CASE WHEN to_regclass('public.exam_attempts') IS NULL THEN 0 ELSE (
              SELECT COUNT(*) FROM exam_model_links l
                JOIN exam_attempts a ON a.exam_id = l.exam_id
               WHERE l.model_id = $1) END AS total`,
    [modelId],
  );
  return parseInt(row?.total ?? '0', 10) > 0;
}

/** A library model, verified against the tenant. */
async function loadModel(modelId: string, companyId: string): Promise<any | null> {
  return queryOne<any>(
    `SELECT m.* FROM exam_models m WHERE m.id = $1 AND m.company_id = $2`,
    [modelId, companyId],
  );
}

/** The course, if it belongs to this tenant. */
async function loadCourse(courseId: string, companyId: string): Promise<any | null> {
  return queryOne<any>(
    'SELECT id, name FROM courses WHERE id = $1 AND company_id = $2',
    [courseId, companyId],
  );
}

/**
 * Keep only ids that are real, active, keyed questions belonging to lessons of
 * this exam's course â€” in the order the caller asked for them.
 *
 * "Keyed" (has a correct option) matters: an unkeyed question cannot be marked,
 * so the pooled draw already refuses to deal one and a model must not either.
 * Silently dropping is wrong here â€” the caller is naming specific questions, so
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

  // Preserve the caller's order â€” that IS the paper order.
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

/**
 * Models with their questions. `examId` scopes the class-pinning and ordering to
 * one exam; omit it for the library view, where a model belongs to no exam.
 */
async function serialiseModels(where: { courseId?: string; examId?: string }): Promise<any[]> {
  const models = where.examId
    ? await query<any>(
        `SELECT m.id, m.name, l.order_index, m.course_id,
                (SELECT COUNT(*) FROM exam_model_questions q WHERE q.model_id = m.id) AS question_count,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.model_id = m.id)        AS attempt_count
           FROM exam_model_links l
           JOIN exam_models m ON m.id = l.model_id
          WHERE l.exam_id = $1 ORDER BY l.order_index, m.name`,
        [where.examId],
      )
    : await query<any>(
        `SELECT m.id, m.name, m.order_index, m.course_id,
                (SELECT COUNT(*) FROM exam_model_questions q WHERE q.model_id = m.id) AS question_count,
                (SELECT COUNT(*) FROM exam_attempts a WHERE a.model_id = m.id)        AS attempt_count,
                (SELECT COUNT(*) FROM exam_model_links l WHERE l.model_id = m.id)     AS used_by_exams
           FROM exam_models m WHERE m.course_id = $1 ORDER BY m.order_index, m.created_at`,
        [where.courseId],
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
  // Class pinning belongs to an exam, so it is only meaningful in that view.
  const classes = where.examId
    ? await query<any>(
        `SELECT model_id, class_id FROM exam_model_classes
          WHERE exam_id = $1 AND model_id = ANY($2::uuid[])`,
        [where.examId, ids],
      )
    : [];

  return models.map((m) => ({
    id: m.id,
    name: m.name,
    orderIndex: m.order_index,
    courseId: m.course_id ?? null,
    questionCount: Number(m.question_count ?? 0),
    // Surfaced so the UI can explain why the models are locked.
    attemptCount: Number(m.attempt_count ?? 0),
    /** How many exams use this library model â€” the library view only. */
    usedByExams: m.used_by_exams === undefined ? undefined : Number(m.used_by_exams ?? 0),
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

// â”€â”€â”€ Model assignment at attempt start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Which model does this student sit? `null` means the exam has no models, and
 * the caller falls back to the original pooled random draw.
 *
 * BY_CLASS looks up the class the student is enrolled into FOR THIS EXAM'S
 * COURSE. A class nobody assigned a model to falls through to the balanced pick
 * rather than refusing: a student turning up to sit an exam must never be
 * blocked by an operator forgetting a row.
 *
 * The random path is balanced, not a coin toss â€” it takes the model with the
 * fewest attempts so far, ties broken randomly. An exam of 30 students and 3
 * models comes out roughly 10/10/10 instead of the lumpy 16/7/7 that
 * independent random picks would give, while staying unpredictable to the
 * student, which is the point of having models at all.
 */
export async function pickModel(exam: any, studentId: string): Promise<string | null> {
  // Only a FIXED exam hands out models. A RANDOM one draws its own paper even
  // if models happen to exist in the course library.
  if (exam.question_source !== 'FIXED') return null;

  const any = await queryOne<any>(
    `SELECT COUNT(*) AS n FROM exam_model_links WHERE exam_id = $1`, [exam.id]);
  // FIXED but nothing linked: fall back to the pooled draw rather than handing
  // the student an empty paper.
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

  // Counted per EXAM, not per model: a model reused by three exams must not look
  // over-used to the fourth.
  const balanced = await queryOne<any>(
    `SELECT l.model_id AS id
       FROM exam_model_links l
       LEFT JOIN exam_attempts a ON a.model_id = l.model_id AND a.exam_id = l.exam_id
      WHERE l.exam_id = $1
      GROUP BY l.model_id, l.order_index
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

// â”€â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // ── The library: models of a course ──────────────────────────────────────

  /**
   * GET /api/exam-models?courseId=…
   * The course's ready-made papers. This is the sidebar screen — the library —
   * so it carries no exam and no class pinning.
   */
  library: async ({ query: q, headers }: {
    query?: { courseId?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'read');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;

      // No course = nothing to list rather than every model the tenant owns:
      // a model only means anything next to the course whose bank it draws on.
      if (!q?.courseId) return { status: 200 as const, body: { models: [], locked: [] } };

      const course = await loadCourse(q.courseId, companyId);
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');

      const models = await serialiseModels({ courseId: course.id });
      // Which of them may still be edited. Per model, because one course can
      // hold both a model already sat and a fresh one.
      const locked: string[] = [];
      for (const m of models) if (await modelIsLocked(m.id)) locked.push(m.id);

      return { status: 200 as const, body: { models, locked } };
    } catch (error) {
      console.error('Exam model library error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.LIST_FAILED', 'Failed to load the exam models');
    }
  },

  /**
   * GET /api/exam-models/question-pool?courseId=…&lessonIds=a,b
   * The bank the models are built from: every usable question of a course, with
   * its lesson. Nothing else in the app browses questions across lessons.
   *
   * Never carries which option is correct — this is a teacher screen, but the
   * answer key has no business travelling for a list that only needs text.
   */
  questionPool: async ({ query: q, headers }: {
    query?: { courseId?: string; lessonIds?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'read');
      if (g.denied) return g.denied;
      if (!q?.courseId) return { status: 200 as const, body: [] };
      const course = await loadCourse(q.courseId, g.context!.companyId);
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');

      const wanted = (q?.lessonIds || '').split(',').map((s) => s.trim()).filter(Boolean);
      const params: any[] = [course.id, g.context!.companyId];
      let sql = `
        SELECT q.id, q.question_text, q.lesson_id, l.name AS lesson_name, l.order_index
          FROM lesson_questions q
          JOIN lessons l ON l.id = q.lesson_id
         WHERE l.course_id = $1 AND q.company_id = $2 AND q.is_active = true
           AND EXISTS (SELECT 1 FROM lesson_question_options o
                        WHERE o.question_id = q.id AND o.is_correct = true)`;
      if (wanted.length) {
        params.push(wanted);
        sql += ` AND q.lesson_id = ANY($${params.length}::uuid[])`;
      }
      sql += ' ORDER BY l.order_index, l.name, q.created_at';

      const rows = await query<any>(sql, params);
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
   * POST /api/exam-models
   * Add a model to a course's library, built one of two ways:
   *   { questionIds: [...] }                  — hand-picked from the bank, in order
   *   { lessonIds: [...], questionCount: N }  — N drawn at random from those
   *                                             lessons ONCE, now, and then fixed
   */
  create: async ({ body, headers }: {
    body: {
      courseId: string; name?: string | null;
      questionIds?: string[]; lessonIds?: string[]; questionCount?: number;
    };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;
      const course = await loadCourse(body?.courseId, companyId);
      if (!course) return apiError(404, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');

      const resolved = Array.isArray(body?.questionIds) && body.questionIds.length
        ? await resolveQuestionIds(body.questionIds, course.id, companyId)
        : await (async () => {
            const count = parseInt(String(body?.questionCount ?? ''), 10);
            if (!Number.isFinite(count) || count < 1) {
              return { ok: false as const, error: 'ERRORS.EXAMS.QUESTION_COUNT_REQUIRED' };
            }
            if (!Array.isArray(body?.lessonIds) || !body.lessonIds.length) {
              return { ok: false as const, error: 'ERRORS.EXAMS.LESSONS_REQUIRED' };
            }
            return drawFromLessons(body.lessonIds, count, course.id, companyId);
          })();
      if (!resolved.ok) return apiError(400, resolved.error, resolved.detail || 'Could not build the model');

      const last = await queryOne<any>(
        'SELECT COALESCE(MAX(order_index), 0) AS n FROM exam_models WHERE course_id = $1', [course.id]);
      const nextIndex = parseInt(last?.n ?? '0', 10) + 1;
      const name = (body?.name ?? '').trim()
        || `Model ${MODEL_LETTERS[Math.min(nextIndex - 1, MODEL_LETTERS.length - 1)]}`;

      const model = await queryOne<any>(
        `INSERT INTO exam_models (company_id, course_id, name, order_index)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [companyId, course.id, name.slice(0, 64), nextIndex],
      );
      await writeModelQuestions(model.id, resolved.rows);

      return {
        status: 201 as const,
        body: { models: await serialiseModels({ courseId: course.id }) },
      };
    } catch (error) {
      console.error('Create exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the model');
    }
  },

  /**
   * PATCH /api/exam-models/:modelId
   * Rename, and/or replace the paper — by ids, or by re-drawing from lessons.
   * Refused once any exam using this model has been started.
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
      if (await modelIsLocked(model.id)) {
        return apiError(409, 'ERRORS.EXAM_MODELS.IN_USE',
          'An exam using this model has already been started');
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

      return {
        status: 200 as const,
        body: { models: await serialiseModels({ courseId: model.course_id }) },
      };
    } catch (error) {
      console.error('Update exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the model');
    }
  },

  /** DELETE /api/exam-models/:modelId — refused while an exam has sat it. */
  remove: async ({ params, headers }: { params: { modelId: string }; headers: AuthHeaders }) => {
    try {
      const g = await guard(headers, 'write');
      if (g.denied) return g.denied;
      const model = await loadModel(params.modelId, g.context!.companyId);
      if (!model) return apiError(404, 'ERRORS.EXAM_MODELS.NOT_FOUND', 'Model not found');
      if (await modelIsLocked(model.id)) {
        return apiError(409, 'ERRORS.EXAM_MODELS.IN_USE',
          'An exam using this model has already been started');
      }

      // Links go with it (ON DELETE CASCADE). An exam left with no models falls
      // back to a pooled draw, which is what pickModel does anyway.
      await query('DELETE FROM exam_models WHERE id = $1', [model.id]);

      return {
        status: 200 as const,
        body: { models: await serialiseModels({ courseId: model.course_id }) },
      };
    } catch (error) {
      console.error('Delete exam model error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.DELETE_FAILED', 'Failed to delete the model');
    }
  },

  /**
   * GET /api/exam-models/:modelId/paper?withAnswers=true
   *
   * The whole model as a paper: its questions in order, each with its OPTIONS —
   * which the list routes deliberately omit, because they only need text.
   *
   * `withAnswers` marks the correct option, for the marking copy. Off unless
   * asked: the key is fine on a teacher screen (the question bank editor shows
   * it to the same permission), but it should travel only when it is wanted,
   * not by default on every print.
   *
   * NOTE ON OPTION ORDER: this is the BANK order. A student sitting on screen
   * gets their options shuffled per attempt when shuffle_options is on, so a
   * printed sheet will not match any one student's screen order — which is
   * correct for a paper handed out on paper, and worth knowing before using
   * this sheet to mark screens by hand.
   */
  paper: async ({ params, query: q, headers }: {
    params: { modelId: string };
    query?: { withAnswers?: string };
    headers: AuthHeaders;
  }) => {
    try {
      const g = await guard(headers, 'read');
      if (g.denied) return g.denied;
      const companyId = g.context!.companyId;

      const model = await queryOne<any>(
        `SELECT m.id, m.name, co.name AS course_name
           FROM exam_models m JOIN courses co ON co.id = m.course_id
          WHERE m.id = $1 AND m.company_id = $2`,
        [params.modelId, companyId],
      );
      if (!model) return apiError(404, 'ERRORS.EXAM_MODELS.NOT_FOUND', 'Model not found');

      const withAnswers = q?.withAnswers === 'true';

      const rows = await query<any>(
        `SELECT emq.order_index, q.id AS question_id, q.question_text, q.explanation,
                l.name AS lesson_name
           FROM exam_model_questions emq
           JOIN lesson_questions q ON q.id = emq.question_id
           LEFT JOIN lessons l ON l.id = q.lesson_id
          WHERE emq.model_id = $1
          ORDER BY emq.order_index`,
        [model.id],
      );

      const optionRows = rows.length
        ? await query<any>(
            `SELECT question_id, option_text, is_correct, order_index
               FROM lesson_question_options
              WHERE question_id = ANY($1::uuid[])
              ORDER BY question_id, order_index`,
            [rows.map((r) => r.question_id)],
          )
        : [];

      return {
        status: 200 as const,
        body: {
          // A library model belongs to a course, not to one exam, so the course
          // is what heads the sheet.
          examName: model.course_name,
          examDate: null,
          durationMinutes: null,
          modelName: model.name,
          questionCount: rows.length,
          withAnswers,
          questions: rows.map((r) => ({
            orderIndex: r.order_index,
            questionText: r.question_text,
            lessonName: r.lesson_name ?? null,
            explanation: withAnswers ? (r.explanation ?? null) : null,
            options: optionRows
              .filter((o) => o.question_id === r.question_id)
              .map((o) => ({
                text: o.option_text,
                ...(withAnswers ? { isCorrect: o.is_correct === true } : {}),
              })),
          })),
        },
      };
    } catch (error) {
      console.error('Exam model paper error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.LIST_FAILED', 'Failed to load the paper');
    }
  },

  // ── Per exam: which models it hands out, and to whom ─────────────────────

  /**
   * GET /api/exams/:examId/models
   * What this exam does: its type, the library models it uses, how they are
   * handed out, and the classes available to pin them to.
   */
  forExam: async ({ params, headers }: { params: { examId: string }; headers: AuthHeaders }) => {
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
          questionSource: exam.question_source === 'FIXED' ? 'FIXED' : 'RANDOM',
          distribution: exam.model_distribution ?? null,
          locked: await examHasAttempts(exam.id),
          models: await serialiseModels({ examId: exam.id }),
          /** The whole library for this course, to choose from. */
          available: await serialiseModels({ courseId: exam.course_id }),
          classes: classes.map((c) => ({ id: c.id, name: c.name })),
        },
      };
    } catch (error) {
      console.error('Exam models for exam error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.LIST_FAILED', 'Failed to load the exam models');
    }
  },

  /**
   * PUT /api/exams/:examId/models
   *   { modelIds, distribution?, assignments? }
   *
   * Everything about how this exam hands out models, in one call: which library
   * models it uses, whether they go out at random or per class, and the
   * class→model mapping. Replaced wholesale — this is the state, not a patch.
   *
   * An empty `modelIds` puts the exam back to a random pooled paper, which is
   * also what an exam with no links does at attempt start.
   */
  setForExam: async ({ params, body, headers }: {
    params: { examId: string };
    body: {
      modelIds?: string[];
      distribution?: string;
      assignments?: { classId: string; modelId: string }[];
    };
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

      const modelIds = Array.isArray(body?.modelIds) ? [...new Set(body.modelIds.filter(Boolean))] : [];
      if (modelIds.length > MAX_MODELS) {
        return apiError(400, 'ERRORS.EXAM_MODELS.TOO_MANY', `An exam can hand out at most ${MAX_MODELS} models`);
      }

      // Every chosen model must be a library model OF THIS EXAM'S COURSE —
      // otherwise the paper would examine material this class was never taught.
      if (modelIds.length) {
        const owned = await query<any>(
          `SELECT id FROM exam_models
            WHERE id = ANY($1::uuid[]) AND company_id = $2 AND course_id = $3`,
          [modelIds, companyId, exam.course_id],
        );
        if (owned.length !== modelIds.length) {
          return apiError(400, 'ERRORS.EXAM_MODELS.COURSE_MISMATCH',
            'One of the chosen models does not belong to this course');
        }
      }

      const distribution = body?.distribution
        ? String(body.distribution).toUpperCase()
        : (exam.model_distribution ?? 'RANDOM');
      if (modelIds.length && !['RANDOM', 'BY_CLASS'].includes(distribution)) {
        return apiError(400, 'ERRORS.EXAM_MODELS.BAD_DISTRIBUTION', 'Distribution must be RANDOM or BY_CLASS');
      }

      const assignments = Array.isArray(body?.assignments) ? body.assignments : null;
      if (assignments?.length) {
        const chosen = new Set(modelIds);
        const classes = await query<any>(
          `SELECT id FROM classes WHERE course_id = $1 AND deleted_at IS NULL`, [exam.course_id]);
        const classIds = new Set(classes.map((c) => c.id));
        for (const a of assignments) {
          if (!chosen.has(a?.modelId)) {
            return apiError(400, 'ERRORS.EXAM_MODELS.NOT_FOUND',
              'A class was assigned a model this exam does not hand out');
          }
          if (!classIds.has(a?.classId)) {
            return apiError(400, 'ERRORS.EXAM_MODELS.CLASS_MISMATCH', 'One of the chosen classes is not on this course');
          }
        }
      }

      const client = await getClient();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM exam_model_links WHERE exam_id = $1', [exam.id]);
        for (let i = 0; i < modelIds.length; i++) {
          await client.query(
            `INSERT INTO exam_model_links (exam_id, model_id, order_index) VALUES ($1, $2, $3)
             ON CONFLICT (exam_id, model_id) DO NOTHING`,
            [exam.id, modelIds[i], i + 1],
          );
        }
        // Pinning is meaningless without the model it points at, so it is
        // rewritten alongside the links rather than left to dangle.
        await client.query('DELETE FROM exam_model_classes WHERE exam_id = $1', [exam.id]);
        for (const a of (assignments ?? [])) {
          await client.query(
            `INSERT INTO exam_model_classes (exam_id, model_id, class_id) VALUES ($1, $2, $3)
             ON CONFLICT (exam_id, class_id) DO UPDATE SET model_id = EXCLUDED.model_id`,
            [exam.id, a.modelId, a.classId],
          );
        }
        await client.query(
          `UPDATE exams SET question_source = $2, model_distribution = $3, updated_at = NOW()
            WHERE id = $1`,
          [exam.id, modelIds.length ? 'FIXED' : 'RANDOM', modelIds.length ? distribution : null],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }

      return {
        status: 200 as const,
        body: {
          questionSource: modelIds.length ? 'FIXED' : 'RANDOM',
          distribution: modelIds.length ? distribution : null,
          models: await serialiseModels({ examId: exam.id }),
        },
      };
    } catch (error) {
      console.error('Set exam models error:', error);
      return mapThrownError(error, 'ERRORS.EXAM_MODELS.SAVE_FAILED', 'Failed to save the exam models');
    }
  },
};
