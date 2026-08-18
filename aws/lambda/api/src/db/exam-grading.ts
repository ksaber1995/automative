import { getClient } from './connection';

/**
 * Grades an attempt from its frozen paper and publishes the mark into
 * `exam_results` — the SAME feed offline exams and homework write to, which is
 * what makes the student detail page, the QR profile, the results roster,
 * markRemainingAbsent and the Telegram/SMS result blast all work on an
 * auto-computed mark with no changes.
 *
 * Shared by the student submit, the expiry catches on the student start/resume
 * reads, and (phase 7) the teacher's attempts monitor. An EXPIRED attempt is
 * still graded — the student sat it, they just ran out of clock.
 *
 * Idempotent: a double submit recomputes the same numbers, and an attempt that
 * already left IN_PROGRESS keeps its status and submitted_at (grading again
 * must never turn a SUBMITTED into an EXPIRED or move its timestamp).
 */
export interface GradedAttempt {
  attemptId: string;
  status: 'SUBMITTED' | 'EXPIRED';
  score: number;
  total: number;
  submittedAt: string;
}

export async function gradeAttempt(
  attemptId: string,
  reason: 'SUBMIT' | 'EXPIRY',
): Promise<GradedAttempt> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Mark each snapshot row right or wrong against its own frozen option
    //    list. Unanswered counts as wrong — silence is not credit.
    await client.query(
      `UPDATE exam_attempt_questions q
          SET is_correct = (
            q.selected_option_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(q.options) o
               WHERE (o->>'id')::uuid = q.selected_option_id
                 AND (o->>'isCorrect')::boolean = true
            )
          )
        WHERE q.attempt_id = $1`,
      [attemptId],
    );

    // 2 + 3. Score off the paper and close the attempt — status and
    //    submitted_at only move on the first grading.
    const updated = await client.query(
      `UPDATE exam_attempts a
          SET score = counted.score,
              total = counted.total,
              status = CASE WHEN a.status = 'IN_PROGRESS' THEN $2 ELSE a.status END,
              submitted_at = COALESCE(a.submitted_at, NOW()),
              updated_at = NOW()
         FROM (
            SELECT COUNT(*) FILTER (WHERE q.is_correct) AS score, COUNT(*) AS total
              FROM exam_attempt_questions q
             WHERE q.attempt_id = $1
         ) counted
        WHERE a.id = $1
        RETURNING a.exam_id, a.company_id, a.student_id, a.status, a.score, a.total, a.submitted_at`,
      [attemptId, reason === 'SUBMIT' ? 'SUBMITTED' : 'EXPIRED'],
    );
    const attempt = updated.rows[0];
    if (!attempt) throw new Error(`gradeAttempt: attempt ${attemptId} not found`);

    // 4. Publish. Same upsert shape as every teacher-side grade write in
    //    routes/exams.ts; grade is VARCHAR(50), so the count goes in as text.
    const exam = await client.query(
      'SELECT course_id FROM exams WHERE id = $1',
      [attempt.exam_id],
    );
    await client.query(
      `INSERT INTO exam_results (exam_id, company_id, course_id, student_id, grade, is_absent)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (exam_id, student_id)
       DO UPDATE SET grade = EXCLUDED.grade, is_absent = false, recorded_at = NOW(), updated_at = NOW()`,
      [attempt.exam_id, attempt.company_id, exam.rows[0].course_id, attempt.student_id, String(attempt.score)],
    );

    await client.query('COMMIT');
    return {
      attemptId,
      status: attempt.status,
      score: attempt.score,
      total: attempt.total,
      submittedAt: new Date(attempt.submitted_at).toISOString(),
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
