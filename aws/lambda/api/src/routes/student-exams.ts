import { randomUUID } from 'crypto';
import { query, queryOne, getClient } from '../db/connection';
import { apiError } from '../utils/api-error';
import { enforce, RATE_LIMITS } from '../middleware/rate-limit';
import { extractStudentContext, StudentContext } from '../middleware/student-context';
import { ensureExamTables, isRatingCompany, mapStudentExamRow, studentExamFeedSql } from './exams';
import { gradeAttempt } from '../db/exam-grading';
import { ensureExamModelSchema, loadModelQuestions, pickModel } from './exam-models';

/**
 * The student side of online exams — what the portal at exams.netrofit.com
 * calls to list, start, sit and submit a paper. See online_exams.md §3.
 *
 * Every handler starts with extractStudentContext (which re-checks
 * students.is_active and the company's online_exams_enabled flag on every
 * request) and then scopes EVERYTHING to that one student. No
 * extractTenantContext, no checkGranularPermission: a student is not a user of
 * the tenant. The exam id in the path is never trusted on its own — it is
 * always resolved within the student's company and checked against their
 * enrolments, so one tenant's student cannot address another's exam.
 *
 * The serialisation rule that must not be got wrong: `isCorrect` lives in the
 * snapshot rows and NEVER crosses the wire before submit. One mapping function
 * (mapPaperQuestion) serves start/resume, and it strips the flag; the review
 * built after grading is the only place it is emitted, and only when
 * exams.show_answers is on.
 */

type AuthHeaders = { authorization?: string };

interface SnapshotOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

/** The paper as the student may see it MID-SITTING: no correct flag, ever. */
function mapPaperQuestion(row: any) {
  const options: SnapshotOption[] = Array.isArray(row.options) ? row.options : [];
  return {
    id: row.id,
    orderIndex: row.order_index,
    questionText: row.question_text,
    options: options.map((o) => ({ id: o.id, text: o.text })),
    selectedOptionId: row.selected_option_id ?? null,
  };
}

function iso(value: any): string | null {
  return value ? new Date(value).toISOString() : null;
}

/** The resume/start payload. `serverNow` is what the client clock is corrected by. */
function attemptPayload(exam: any, attempt: any, questionRows: any[]) {
  return {
    expiresAt: iso(attempt.expires_at),
    serverNow: new Date().toISOString(),
    exam: {
      name: exam.name,
      questionCount: attempt.total ?? questionRows.length,
      durationMinutes: exam.duration_minutes ? parseInt(exam.duration_minutes, 10) : null,
    },
    questions: questionRows.map(mapPaperQuestion),
  };
}

/** The online exam, resolved WITHIN the student's company — 404 otherwise. */
async function resolveOnlineExam(examId: string, companyId: string): Promise<any | null> {
  return queryOne<any>(
    `SELECT * FROM exams
      WHERE id = $1 AND company_id = $2 AND is_online = true AND is_active = true`,
    [examId, companyId],
  );
}

/**
 * May this student sit this exam? The §3.1 rule: enrolled in the exam's course
 * (regular or bundle enrolment, not dropped), narrowed to the class when the
 * exam is class-scoped. Deliberately NOT the grading-side rule from
 * exams.isEnrolledInCourse — substitutes may be GRADED on a class's homework,
 * but a paper is sat by the class it was set for.
 */
async function maySit(student: StudentContext, exam: any): Promise<boolean> {
  const byClass = !!exam.class_id;
  const clause = byClass ? 'AND class_id = $4' : '';
  const params: any[] = [student.studentId, student.companyId, exam.course_id];
  if (byClass) params.push(exam.class_id);
  const row = await queryOne<any>(
    `SELECT 1 FROM (
        SELECT student_id FROM enrollments
         WHERE student_id = $1 AND company_id = $2 AND course_id = $3 ${clause}
           AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT student_id FROM master_class_enrollments
         WHERE student_id = $1 AND company_id = $2 AND course_id = $3 ${clause}
           AND status <> 'DROPPED'
     ) enrolled LIMIT 1`,
    params,
  );
  return !!row;
}

async function findAttempt(examId: string, studentId: string): Promise<any | null> {
  return queryOne<any>(
    'SELECT * FROM exam_attempts WHERE exam_id = $1 AND student_id = $2',
    [examId, studentId],
  );
}

async function loadPaper(attemptId: string): Promise<any[]> {
  return query<any>(
    'SELECT * FROM exam_attempt_questions WHERE attempt_id = $1 ORDER BY order_index',
    [attemptId],
  );
}

function isExpired(attempt: any): boolean {
  return !!attempt.expires_at && new Date(attempt.expires_at).getTime() <= Date.now();
}

/**
 * The one refusal a finished attempt gets, carrying the score so the portal can
 * route straight to the result screen instead of guessing.
 */
function alreadySubmitted(score: any, total: any) {
  return apiError(409, 'ERRORS.EXAMS.ALREADY_SUBMITTED', 'This exam has already been submitted', {
    score: Number(score ?? 0),
    total: Number(total ?? 0),
  });
}

/** In-place Fisher–Yates; Math.random is plenty for shuffling a paper. */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Draw the paper, snapshotted (text + options, in this student's order, each
 * option under a fresh local id) in one transaction.
 *
 * Two kinds of exam land here:
 *
 *  - a MODEL exam: the student is handed one of its models (pickModel — by
 *    class, or balanced-random) and sits that model's FIXED question list, in
 *    the model's own order. Everyone on Model A gets the same paper.
 *  - a pooled exam (no models, the original): `question_count` questions drawn
 *    at random from the pooled active questions of the exam's lessons, so every
 *    student gets a different paper.
 *
 * Either way the snapshot written below is identical in shape, which is why the
 * student portal needs no knowledge of models at all.
 *
 * Fewer questions available than expected (bank edited since the exam was
 * saved) → the paper is what exists; `total` is per-attempt so the mark stays
 * honest. Two simultaneous starts race on UNIQUE (exam_id, student_id); the
 * loser rolls back and resumes the winner's paper.
 */
async function drawPaper(exam: any, student: StudentContext): Promise<any | 'CONFLICT' | 'NO_PAPER'> {
  await ensureExamModelSchema();
  const modelId = await pickModel(exam, student.studentId);

  // Nothing to draw FROM: a fixed exam whose models were never attached, or a
  // pooled one with no question count. Refused rather than dealt as an empty
  // paper, which would be graded 0/0 and look like the student's fault.
  if (!modelId && !Number.isFinite(parseInt(exam.question_count, 10))) return 'NO_PAPER';

  const drawn = modelId
    ? await loadModelQuestions(modelId, student.companyId)
    : await query<any>(
        `SELECT q.id, q.lesson_id, q.question_text
           FROM lesson_questions q
           JOIN exam_lessons el ON el.lesson_id = q.lesson_id
          WHERE el.exam_id = $1 AND q.is_active = true AND q.company_id = $2
            -- Never draw a question whose key is unset (imports arrive that way):
            -- it cannot be marked, so it is not on any paper until a teacher sets it.
            AND EXISTS (SELECT 1 FROM lesson_question_options o
                         WHERE o.question_id = q.id AND o.is_correct = true)
          ORDER BY random()
          LIMIT $3`,
        [exam.id, student.companyId, parseInt(exam.question_count, 10)],
      );

  const optionRows = drawn.length
    ? await query<any>(
        `SELECT question_id, option_text, is_correct
           FROM lesson_question_options
          WHERE question_id = ANY($1)
          ORDER BY order_index`,
        [drawn.map((q) => q.id)],
      )
    : [];
  const optionsByQuestion = new Map<string, any[]>();
  for (const o of optionRows) {
    const list = optionsByQuestion.get(o.question_id) ?? [];
    list.push(o);
    optionsByQuestion.set(o.question_id, list);
  }

  // A question that somehow has no options cannot be asked or marked — drop it
  // from the paper rather than dealing a dud.
  const askable = drawn.filter((q) => (optionsByQuestion.get(q.id) ?? []).length >= 2);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO exam_attempts (exam_id, company_id, student_id, expires_at, total, model_id)
       VALUES ($1, $2, $3,
               LEAST(NOW() + make_interval(mins => $4), $5::timestamptz),
               $6, $7)
       RETURNING *`,
      [
        exam.id,
        student.companyId,
        student.studentId,
        parseInt(exam.duration_minutes, 10),
        exam.closes_at ?? null,   // LEAST ignores a NULL, so no window = duration alone
        askable.length,
        // Which model this student was given; NULL on a pooled exam. Recorded so
        // the teacher can see who sat what, and so a resumed attempt keeps it.
        modelId,
      ],
    );
    const attempt = inserted.rows[0];

    for (let i = 0; i < askable.length; i++) {
      const q = askable[i];
      const snapshot: SnapshotOption[] = (optionsByQuestion.get(q.id) ?? []).map((o) => ({
        id: randomUUID(),   // fresh LOCAL id — the bank's option ids never reach a student
        text: o.option_text,
        isCorrect: o.is_correct === true,
      }));
      if (exam.shuffle_options !== false) shuffle(snapshot);
      await client.query(
        `INSERT INTO exam_attempt_questions
           (attempt_id, question_id, lesson_id, order_index, question_text, options)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [attempt.id, q.id, q.lesson_id, i + 1, q.question_text, JSON.stringify(snapshot)],
      );
    }
    await client.query('COMMIT');
    return attempt;
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23505') return 'CONFLICT';   // the other tab won the race
    throw e;
  } finally {
    client.release();
  }
}

/** The post-grading review — the ONLY serialisation that carries isCorrect. */
async function buildReview(attemptId: string) {
  const rows = await query<any>(
    `SELECT q.*, lq.explanation
       FROM exam_attempt_questions q
       LEFT JOIN lesson_questions lq ON lq.id = q.question_id
      WHERE q.attempt_id = $1
      ORDER BY q.order_index`,
    [attemptId],
  );
  return rows.map((row) => ({
    questionText: row.question_text,
    explanation: row.explanation ?? null,
    options: (Array.isArray(row.options) ? row.options : []).map((o: SnapshotOption) => ({
      id: o.id,
      text: o.text,
      isCorrect: o.isCorrect === true,
    })),
    selectedOptionId: row.selected_option_id ?? null,
    isCorrect: row.is_correct === true,
  }));
}

export const studentExamsRoutes = {
  /**
   * GET /api/student/exams — what can I sit?
   *
   * Online exams whose window is open, for courses (and, when class-scoped,
   * classes) the student is enrolled in — with their own attempt state joined
   * on.
   */
  list: async ({ headers }: { headers: AuthHeaders }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;
      const rows = await query<any>(
        `SELECT e.id, e.name, c.name AS course_name,
                e.question_count, e.duration_minutes, e.opens_at, e.closes_at,
                a.status AS attempt_status, a.score, a.total, a.expires_at
           FROM exams e
           JOIN courses c ON c.id = e.course_id
           LEFT JOIN exam_attempts a ON a.exam_id = e.id AND a.student_id = $1
          WHERE e.company_id = $2
            AND e.is_online = true AND e.is_active = true
            AND (e.opens_at IS NULL OR e.opens_at <= NOW())
            AND (e.closes_at IS NULL OR e.closes_at >= NOW())
            AND (
              EXISTS (SELECT 1 FROM enrollments en
                       WHERE en.student_id = $1 AND en.company_id = $2
                         AND en.course_id = e.course_id
                         AND (e.class_id IS NULL OR en.class_id = e.class_id)
                         AND en.status NOT IN ('DROPPED', 'CANCELLED'))
              OR EXISTS (SELECT 1 FROM master_class_enrollments m
                       WHERE m.student_id = $1 AND m.company_id = $2
                         AND m.course_id = e.course_id
                         AND (e.class_id IS NULL OR m.class_id = e.class_id)
                         AND m.status <> 'DROPPED')
            )
          ORDER BY e.closes_at ASC NULLS LAST, e.created_at DESC`,
        [s.studentId, s.companyId],
      );
      return {
        status: 200 as const,
        body: rows.map((row) => ({
          examId: row.id,
          name: row.name,
          courseName: row.course_name,
          questionCount: row.question_count !== null ? parseInt(row.question_count, 10) : null,
          durationMinutes: row.duration_minutes !== null ? parseInt(row.duration_minutes, 10) : null,
          closesAt: iso(row.closes_at),
          // Kept in the contract for older portal builds; codes are no longer used.
          requiresCode: false,
          // IN_PROGRESS even when the clock has actually run out — tapping
          // Continue hits start/attempt, which grades it and answers with the
          // finished state. One place resolves expiry, not two.
          state: !row.attempt_status
            ? ('AVAILABLE' as const)
            : row.attempt_status === 'IN_PROGRESS'
              ? ('IN_PROGRESS' as const)
              : ('DONE' as const),
          score: row.attempt_status && row.attempt_status !== 'IN_PROGRESS' && row.score !== null
            ? parseInt(row.score, 10) : null,
          total: row.attempt_status && row.attempt_status !== 'IN_PROGRESS' && row.total !== null
            ? parseInt(row.total, 10) : null,
        })),
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student exams list failed:', error);
      return apiError(500, 'ERRORS.EXAMS.LIST_FAILED', 'Could not load your exams');
    }
  },

  /**
   * GET /api/student/results — my finished marks. The same feed and the same
   * row shape the staff-side student page and the public QR profile use, so the
   * portal cannot disagree with them.
   */
  results: async ({ headers }: { headers: AuthHeaders }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;
      const rating = await isRatingCompany(s.companyId);
      const rows = await query<any>(studentExamFeedSql, [s.studentId, s.companyId]);
      return { status: 200 as const, body: rows.map((row) => mapStudentExamRow(row, rating)) };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student results failed:', error);
      return apiError(500, 'ERRORS.EXAMS.LIST_FAILED', 'Could not load your results');
    }
  },

  /**
   * POST /api/student/exams/:examId/start  { accessCode? } — begin or resume.
   */
  start: async ({ params, body, headers }: {
    params: { examId: string };
    body: { accessCode?: string };
    headers: AuthHeaders;
  }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;

      const exam = await resolveOnlineExam(params.examId, s.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');

      const now = Date.now();
      if (
        (exam.opens_at && new Date(exam.opens_at).getTime() > now) ||
        (exam.closes_at && new Date(exam.closes_at).getTime() < now)
      ) {
        return apiError(403, 'ERRORS.EXAMS.WINDOW_CLOSED', 'This exam is not open right now');
      }
      if (!(await maySit(s, exam))) {
        return apiError(403, 'ERRORS.EXAMS.NOT_ENROLLED', 'You are not enrolled in this exam');
      }
      // No access-code gate: the login is the identity and the open/close window
      // is the schedule — a code on top of both only got in the way (2026-08-19).

      let attempt = await findAttempt(exam.id, s.studentId);
      if (attempt) {
        if (attempt.status === 'IN_PROGRESS' && !isExpired(attempt)) {
          return { status: 200 as const, body: attemptPayload(exam, attempt, await loadPaper(attempt.id)) };
        }
        const graded = attempt.status === 'IN_PROGRESS'
          ? await gradeAttempt(attempt.id, 'EXPIRY')
          : { score: attempt.score, total: attempt.total };
        return alreadySubmitted(graded.score, graded.total);
      }

      const result = await drawPaper(exam, s);
      if (result === 'NO_PAPER') {
        // The teacher has not finished setting the exam up. Said plainly rather
        // than handing over a blank paper that would grade 0/0.
        return apiError(409, 'ERRORS.EXAMS.NOT_READY',
          'This exam has not been set up yet — ask your teacher');
      }
      if (result === 'CONFLICT') {
        // A parallel start won the unique constraint — serve their paper.
        attempt = await findAttempt(exam.id, s.studentId);
        if (!attempt) return apiError(500, 'ERRORS.EXAMS.START_FAILED', 'Could not start the exam');
        if (attempt.status !== 'IN_PROGRESS') return alreadySubmitted(attempt.score, attempt.total);
        return { status: 200 as const, body: attemptPayload(exam, attempt, await loadPaper(attempt.id)) };
      }
      return { status: 200 as const, body: attemptPayload(exam, result, await loadPaper(result.id)) };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student exam start failed:', error);
      return apiError(500, 'ERRORS.EXAMS.START_FAILED', 'Could not start the exam');
    }
  },

  /**
   * GET /api/student/exams/:examId/attempt — resume after a reload or a lost
   * connection: the same paper, the answers so far, and a fresh serverNow for
   * the countdown. Grades first if the clock ran out while the tab was closed.
   */
  attempt: async ({ params, headers }: { params: { examId: string }; headers: AuthHeaders }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;
      const exam = await resolveOnlineExam(params.examId, s.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      const attempt = await findAttempt(exam.id, s.studentId);
      if (!attempt) return apiError(404, 'ERRORS.EXAMS.NOT_STARTED', 'You have not started this exam');

      if (attempt.status === 'IN_PROGRESS' && !isExpired(attempt)) {
        return { status: 200 as const, body: attemptPayload(exam, attempt, await loadPaper(attempt.id)) };
      }
      const graded = attempt.status === 'IN_PROGRESS'
        ? await gradeAttempt(attempt.id, 'EXPIRY')
        : { score: attempt.score, total: attempt.total };
      return alreadySubmitted(graded.score, graded.total);
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student exam attempt read failed:', error);
      return apiError(500, 'ERRORS.EXAMS.START_FAILED', 'Could not load the exam');
    }
  },

  /**
   * POST /api/student/exams/:examId/answer  { questionId, optionId }
   *
   * Autosave, idempotent — re-answering overwrites. `questionId` is the
   * attempt-question id and `optionId` the LOCAL option id, both minted for
   * this one paper, so nothing here addresses the bank.
   */
  answer: async ({ params, body, headers }: {
    params: { examId: string };
    body: { questionId: string; optionId: string };
    headers: AuthHeaders;
  }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;
      enforce(RATE_LIMITS.STUDENT_EXAM_ANSWER, s.studentId);

      const exam = await resolveOnlineExam(params.examId, s.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      const attempt = await findAttempt(exam.id, s.studentId);
      if (!attempt) return apiError(404, 'ERRORS.EXAMS.NOT_STARTED', 'You have not started this exam');
      if (attempt.status !== 'IN_PROGRESS') return alreadySubmitted(attempt.score, attempt.total);
      if (isExpired(attempt)) {
        const graded = await gradeAttempt(attempt.id, 'EXPIRY');
        return apiError(409, 'ERRORS.EXAMS.TIME_UP', 'Time is up', {
          score: graded.score, total: graded.total,
        });
      }

      const row = await queryOne<any>(
        'SELECT id, options FROM exam_attempt_questions WHERE id = $1 AND attempt_id = $2',
        [body.questionId, attempt.id],
      );
      if (!row) return apiError(404, 'ERRORS.EXAMS.QUESTION_NOT_FOUND', 'No such question on your paper');
      const options: SnapshotOption[] = Array.isArray(row.options) ? row.options : [];
      if (!options.some((o) => o.id === body.optionId)) {
        return apiError(400, 'ERRORS.EXAMS.OPTION_NOT_FOUND', 'No such option on this question');
      }

      await query(
        'UPDATE exam_attempt_questions SET selected_option_id = $1, answered_at = NOW() WHERE id = $2',
        [body.optionId, row.id],
      );
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student exam answer failed:', error);
      return apiError(500, 'ERRORS.EXAMS.ANSWER_FAILED', 'Could not save the answer');
    }
  },

  /**
   * POST /api/student/exams/:examId/submit — grade and show the score.
   *
   * Idempotent by design: a second submit (double tap, retried request) returns
   * the same numbers from the same one exam_results row. A submit that arrives
   * after the clock ran out grades as EXPIRY — the sitting still counts, the
   * status just says how it ended. The per-question review rides along ONLY
   * when the exam says so (show_answers), which is the single place the correct
   * flags are ever serialised to a student.
   */
  submit: async ({ params, headers }: { params: { examId: string }; headers: AuthHeaders }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureExamTables();
      const s = guard.student;
      const exam = await resolveOnlineExam(params.examId, s.companyId);
      if (!exam) return apiError(404, 'ERRORS.EXAMS.NOT_FOUND', 'Exam not found');
      const attempt = await findAttempt(exam.id, s.studentId);
      if (!attempt) return apiError(404, 'ERRORS.EXAMS.NOT_STARTED', 'You have not started this exam');

      let score: number;
      let total: number;
      let status: string;
      if (attempt.status === 'IN_PROGRESS') {
        const graded = await gradeAttempt(attempt.id, isExpired(attempt) ? 'EXPIRY' : 'SUBMIT');
        score = graded.score; total = graded.total; status = graded.status;
      } else {
        score = attempt.score ?? 0; total = attempt.total ?? 0; status = attempt.status;
      }

      return {
        status: 200 as const,
        body: {
          score,
          total,
          attemptStatus: status,
          showAnswers: exam.show_answers !== false,
          questions: exam.show_answers !== false ? await buildReview(attempt.id) : undefined,
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student exam submit failed:', error);
      return apiError(500, 'ERRORS.EXAMS.SUBMIT_FAILED', 'Could not submit the exam');
    }
  },
};
