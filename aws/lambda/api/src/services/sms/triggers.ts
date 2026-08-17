import { query } from '../../db/connection';
import { studentIsPresent } from '../../db/active-students';
import { fillTemplate, getSmsTemplate, sendSms, companyCanSendSms } from './send';

/**
 * The automatic sends.
 *
 * Each one is opt-in per tenant (`sms_templates.enabled`) on top of the
 * entitlement the platform sells, so two switches have to be on before anything
 * costs money — and neither of them is in code.
 *
 * Every function here is BEST EFFORT and never throws. They are called from the
 * middle of other people's work — ending a session, marking an exam done — and
 * an SMS gateway having a bad afternoon must not fail the thing the user
 * actually asked for. Failures are recorded as rows by sendSms and logged here.
 */

/** Nothing to do unless the tenant is entitled AND has this kind switched on. */
async function armed(companyId: string, type: 'ABSENCE' | 'PAYMENT_DELAY' | 'EXAM_RESULTS') {
  if (!(await companyCanSendSms(companyId))) return null;
  const template = await getSmsTemplate(companyId, type);
  return template.enabled ? template : null;
}

/**
 * Told a parent their child missed today's lesson.
 *
 * Absence is not stored — there is no absent flag on attendance — so it is
 * derived: enrolled in the class, and no attendance row against this session.
 * Students who have LEFT are excluded, the same rule the register itself uses;
 * without that, everyone who ever quit gets a text about a lesson they were
 * never going to sit.
 *
 * The once-a-day guard in sendSms is what makes re-ending a session safe.
 */
export async function sendAbsenceSms(companyId: string, sessionId: string): Promise<void> {
  try {
    const template = await armed(companyId, 'ABSENCE');
    if (!template) return;

    const rows = await query<any>(
      `SELECT s.id, s.name, s.phone, s.parent_phone, s.parent_name,
              cl.name AS class_name, co.name AS course_name, comp.name AS academy_name,
              se.session_number, se.start_date
         FROM sessions se
         JOIN classes cl   ON cl.id = se.class_id
         JOIN courses co   ON co.id = cl.course_id
         JOIN companies comp ON comp.id = se.company_id
         JOIN (
           SELECT student_id, class_id FROM enrollments
             WHERE company_id = $1 AND status NOT IN ('DROPPED', 'CANCELLED')
           UNION
           SELECT student_id, class_id FROM master_class_enrollments
             WHERE company_id = $1 AND status <> 'DROPPED'
         ) en ON en.class_id = se.class_id
         JOIN students s ON s.id = en.student_id AND ${studentIsPresent('s')}
        WHERE se.id = $2 AND se.company_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM session_attendance sa
             WHERE sa.session_id = se.id AND sa.student_id = s.id
          )`,
      [companyId, sessionId],
    );

    for (const r of rows) {
      await sendSms({
        companyId,
        type: 'ABSENCE',
        // The parent is the point of an absence message; the student's own
        // number is the fallback for an adult learner with no parent recorded.
        to: r.parent_phone || r.phone,
        studentId: r.id,
        body: fillTemplate(template.body, {
          studentName: r.name,
          parentName: r.parent_name,
          academyName: r.academy_name,
          className: r.class_name,
          courseName: r.course_name,
          sessionNumber: r.session_number,
          date: r.start_date ? new Date(r.start_date).toISOString().slice(0, 10) : '',
        }),
      });
    }
  } catch (e) {
    console.error('Absence SMS failed:', e);
  }
}

/**
 * Results, once the exam is marked DONE.
 *
 * Fired on that transition rather than on each grade being typed: marking a
 * class is thirty saves, and a text per keystroke is thirty texts and a parent
 * watching a mark change in real time. DONE is the moment the teacher says the
 * marking is finished.
 *
 * Absentees are skipped — "you scored /20" to someone who was not there is
 * worse than silence.
 */
export async function sendExamResultsSms(companyId: string, examId: string): Promise<void> {
  try {
    const template = await armed(companyId, 'EXAM_RESULTS');
    if (!template) return;

    const rows = await query<any>(
      `SELECT s.id, s.name, s.phone, s.parent_phone, s.parent_name,
              r.grade, e.max_grade, e.name AS exam_name,
              co.name AS course_name, comp.name AS academy_name
         FROM exam_results r
         JOIN exams e      ON e.id = r.exam_id
         JOIN students s   ON s.id = r.student_id AND ${studentIsPresent('s')}
         JOIN courses co   ON co.id = e.course_id
         JOIN companies comp ON comp.id = e.company_id
        WHERE r.exam_id = $2 AND r.company_id = $1
          AND r.is_absent IS NOT TRUE AND r.grade IS NOT NULL`,
      [companyId, examId],
    );

    for (const r of rows) {
      const max = r.max_grade != null ? Number(r.max_grade) : null;
      const grade = Number(r.grade);
      await sendSms({
        companyId,
        type: 'EXAM_RESULTS',
        to: r.parent_phone || r.phone,
        studentId: r.id,
        body: fillTemplate(template.body, {
          studentName: r.name,
          parentName: r.parent_name,
          academyName: r.academy_name,
          examName: r.exam_name,
          courseName: r.course_name,
          grade: r.grade,
          maxGrade: max ?? '',
          percentage: max && Number.isFinite(grade) ? Math.round((grade / max) * 100) : '',
        }),
      });
    }
  } catch (e) {
    console.error('Exam result SMS failed:', e);
  }
}

/**
 * The overdue sweep, run once a day on a schedule.
 *
 * Nothing in the app notices a bill going late — monthly bills materialise on
 * demand and nobody is watching the clock — so this is the one trigger that
 * needs a timer rather than a hook.
 *
 * One message per student per day, not per bill: a student three months behind
 * on two courses would otherwise get six texts. The oldest unpaid bill is the
 * one quoted, and the daily guard in sendSms enforces the rest.
 */
export async function sweepOverduePaymentSms(): Promise<{ tenants: number; sent: number }> {
  let tenants = 0;
  let sent = 0;
  try {
    // Only entitled tenants who have switched this on — the join keeps a sweep
    // over a hundred-odd companies down to the handful that want it.
    const companies = await query<any>(
      `SELECT c.id, c.name
         FROM companies c
         JOIN sms_templates t ON t.company_id = c.id AND t.type = 'PAYMENT_DELAY' AND t.enabled = true
        WHERE c.sms_activated = true
          AND (c.sms_expiration IS NULL OR c.sms_expiration >= CURRENT_DATE)`,
    );

    for (const company of companies) {
      tenants++;
      const template = await getSmsTemplate(company.id, 'PAYMENT_DELAY');
      if (!template.enabled) continue;

      const rows = await query<any>(
        `SELECT DISTINCT ON (s.id)
                s.id, s.name, s.phone, s.parent_phone, s.parent_name,
                p.amount_due - p.amount_paid AS outstanding,
                p.due_date, co.name AS course_name,
                comp.currency, comp.name AS academy_name
           FROM monthly_subscription_payments p
           JOIN students s   ON s.id = p.student_id AND ${studentIsPresent('s')}
           JOIN companies comp ON comp.id = p.company_id
           LEFT JOIN courses co ON co.id = p.course_id
          WHERE p.company_id = $1
            AND p.payment_status IN ('PENDING', 'PARTIAL', 'OVERDUE')
            AND p.due_date < CURRENT_DATE
            AND p.amount_due > p.amount_paid
          ORDER BY s.id, p.due_date ASC`,
        [company.id],
      );

      for (const r of rows) {
        const outcome = await sendSms({
          companyId: company.id,
          type: 'PAYMENT_DELAY',
          to: r.parent_phone || r.phone,
          studentId: r.id,
          body: fillTemplate(template.body, {
            studentName: r.name,
            parentName: r.parent_name,
            academyName: r.academy_name,
            courseName: r.course_name || '',
            amount: Number(r.outstanding ?? 0).toLocaleString('en-US'),
            currency: r.currency || 'EGP',
            dueDate: r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '',
          }),
        });
        if (outcome.sent) sent++;
      }
    }
  } catch (e) {
    console.error('Overdue payment SMS sweep failed:', e);
  }
  return { tenants, sent };
}
