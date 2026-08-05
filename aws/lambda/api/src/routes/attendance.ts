import { query, queryOne } from '../db/connection';
import { ensureQrCardSchema, qrStudentMatch } from './qr-cards';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureAttendanceMagicColumns, ensureFreeSessionSchema } from './sessions';
import { ensureFreeTrialLimitColumn } from './companies';
import { notifyCheckin } from './telegram';
import { chargeSessionAttendance, chargeSingleCheckin, reverseUnattendedCharges, reverseStudentCharge, ensurePerSessionSchema, pendingChargesForStudents } from './session-payments';
import {
  ensureSubstitutionLinkSchema,
  linkSubstitution,
  claimPendingSubstitutions,
  releaseSubstitutionClaims,
  substitutionCoversExists,
  substitutionCoversLateral,
  substitutionIsOrphanClause,
} from '../db/substitutions';

/** What the roster panels say about a student's attendance record. */
export interface AbsenceStats {
  /** Unbroken run of missed sessions, counting back from the latest ended one. */
  absentStreak: number;
  /** Misses inside `monthAnchor`'s month — scattered ones included. */
  monthAbsences: number;
  /** Ended sessions that month there were to attend, so the count has a scale. */
  monthSessions: number;
}

/**
 * Absence figures for every student enrolled on a class.
 *
 * Only ended, non-free sessions count, and a SUBSTITUTION standing in for the
 * session counts as present — same fairness as the student attendance history,
 * so someone who took the lesson in a sibling class is not flagged.
 *
 * `excludeSessionId` drops the session currently being registered (it has not
 * happened yet from the roster's point of view); pass null from a class page,
 * where there is no such session.
 */
export async function absenceStats(
  companyId: string,
  classId: string,
  excludeSessionId: string | null,
  monthAnchor: Date | string,
): Promise<Map<string, AbsenceStats>> {
  await ensureSubstitutionLinkSchema();   // the presence checks read the link column
  const out = new Map<string, AbsenceStats>();
  const ensure = (id: string): AbsenceStats => {
    const existing = out.get(id);
    if (existing) return existing;
    const fresh = { absentStreak: 0, monthAbsences: 0, monthSessions: 0 };
    out.set(id, fresh);
    return fresh;
  };

  // Streak, capped at the last 20 sessions.
  const streakRows = await query<any>(
    `WITH recent AS (
        SELECT s.id, s.session_number,
               ROW_NUMBER() OVER (ORDER BY s.start_date DESC) AS rn
        FROM sessions s
        WHERE s.class_id = $1 AND s.company_id = $2
          AND ($3::uuid IS NULL OR s.id <> $3::uuid)
          AND s.end_date IS NOT NULL
          AND COALESCE(s.is_free, false) = false
        ORDER BY s.start_date DESC
        LIMIT 20
     ),
     enrolled AS (
        SELECT student_id FROM enrollments
        WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT student_id FROM master_class_enrollments
        WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
     ),
     presence AS (
        SELECT e.student_id, r.rn,
          (
            EXISTS (
              SELECT 1 FROM session_attendance sa
              WHERE sa.session_id = r.id AND sa.student_id = e.student_id
                AND sa.attendance_type = 'NORMAL'
            )
            OR ${substitutionCoversExists({
              student: 'e.student_id',
              sessionId: 'r.id',
              courseId: '(SELECT course_id FROM classes WHERE id = $1)',
              sessionNumber: 'r.session_number',
            })}
          ) AS present
        FROM recent r CROSS JOIN enrolled e
     )
     SELECT student_id,
       CASE WHEN bool_or(present) THEN MIN(rn) FILTER (WHERE present) - 1
            ELSE COUNT(*) END AS absent_streak
     FROM presence
     GROUP BY student_id`,
    [classId, companyId, excludeSessionId],
  );
  for (const r of streakRows) ensure(r.student_id).absentStreak = Number(r.absent_streak ?? 0);

  // Absences within the anchor month, streak or not. A student who misses every
  // other week never builds a run, so the streak alone makes them look fine.
  const monthRows = await query<any>(
    `WITH month_sessions AS (
        SELECT s.id, s.session_number
        FROM sessions s
        WHERE s.class_id = $1 AND s.company_id = $2
          AND ($3::uuid IS NULL OR s.id <> $3::uuid)
          AND s.end_date IS NOT NULL
          AND COALESCE(s.is_free, false) = false
          AND date_trunc('month', s.start_date) = date_trunc('month', $4::timestamp)
     ),
     enrolled AS (
        SELECT student_id FROM enrollments
        WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
        UNION
        SELECT student_id FROM master_class_enrollments
        WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
     )
     SELECT e.student_id,
            COUNT(*) AS session_count,
            COUNT(*) FILTER (WHERE NOT (
              EXISTS (
                SELECT 1 FROM session_attendance sa
                WHERE sa.session_id = m.id AND sa.student_id = e.student_id
                  AND sa.attendance_type = 'NORMAL'
              )
              OR ${substitutionCoversExists({
                student: 'e.student_id',
                sessionId: 'm.id',
                courseId: '(SELECT course_id FROM classes WHERE id = $1)',
                sessionNumber: 'm.session_number',
              })}
            )) AS absent_count
       FROM month_sessions m CROSS JOIN enrolled e
      GROUP BY e.student_id`,
    [classId, companyId, excludeSessionId, monthAnchor instanceof Date ? monthAnchor.toISOString() : monthAnchor],
  );
  for (const r of monthRows) {
    const stat = ensure(r.student_id);
    stat.monthAbsences = Number(r.absent_count ?? 0);
    stat.monthSessions = Number(r.session_count ?? 0);
  }

  return out;
}

/** One thing a student still owes for a class. */
export interface DueItem {
  kind: 'MONTHLY' | 'SESSION' | 'ENROLLMENT';
  label: string;
  amount: number;
  /** null for a monthly month with no stored bill yet — paying it creates one. */
  paymentId: string | null;
  enrollmentId: string;
  billingYear?: number;
  billingMonth?: number;
}

/**
 * What every student on a class still owes, by course type: unpaid months for a
 * subscription, unpaid charges for a per-session course, the remaining balance
 * for a one-time one.
 *
 * Writes nothing. Monthly months with no stored bill are projected the way the
 * subscriptions dashboard projects them (see projectedBills) and only
 * materialise if someone pays. `monthKey` (year*12+month) and `upTo` bound it —
 * counting past them would be billing for classes not yet run.
 *
 * Students with no direct ACTIVE enrollment — bundle enrollees, trial and
 * substitution attendees, held subscriptions — are absent from the result
 * entirely rather than reported as clear: their money lives elsewhere and a
 * green "no dues" would be a lie.
 */
export async function classDues(
  context: any,
  classId: string,
  monthKey: number,
  upTo: Date | string,
): Promise<{ paymentType: string; byStudent: Map<string, { enrollmentId: string; items: DueItem[] }> }> {
  const course = await queryOne<any>(
    `SELECT co.id, co.payment_type FROM classes cl JOIN courses co ON cl.course_id = co.id WHERE cl.id = $1`,
    [classId]
  );
  const paymentType: string = course?.payment_type || 'ONE_TIME';

    const byStudent = new Map<string, { enrollmentId: string; items: DueItem[] }>();
  const push = (studentId: string, enrollmentId: string, item: DueItem) => {
    const entry = byStudent.get(studentId) || { enrollmentId, items: [] };
    entry.items.push(item);
    byStudent.set(studentId, entry);
  };

  // Every ACTIVE direct enrollment on this class — the set we can speak for.
  // Listed even when nothing is owed, so the roster can show a green badge.
  const enrollments = await query<any>(
    `SELECT e.id, e.student_id, e.enrollment_date, e.final_price, e.amount_paid, c.price AS course_price
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
      WHERE e.class_id = $1 AND e.company_id = $2 AND e.status = 'ACTIVE'`,
    [classId, context.companyId]
  );
  for (const e of enrollments) {
    byStudent.set(e.student_id, { enrollmentId: e.id, items: [] });
  }

  // Both monthly tables arrive by migration and may be absent on an
  // environment that has never run one — guarded like expenses.ts does.
  const monthlyTables = paymentType === 'MONTHLY_SUBSCRIPTION'
    ? await queryOne<any>(
        `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
                to_regclass('public.course_monthly_price_overrides') IS NOT NULL AS has_ov`
      )
    : null;

  if (paymentType === 'MONTHLY_SUBSCRIPTION' && monthlyTables?.has_msp && monthlyTables?.has_ov) {
    // One row per unpaid month from the student's first billable month up to
    // the session's month, stored or projected. Capped at 24 months back so a
    // long-running enrollment can't build an unbounded scan.
    const rows = await query<any>(
      `WITH enr AS (
         SELECT e.id, e.student_id, e.course_id,
                COALESCE(e.final_price, c.price) AS fee,
                c.price AS course_price,
                GREATEST(
                  EXTRACT(YEAR FROM COALESCE(e.enrollment_date, CURRENT_DATE))::int * 12
                    + EXTRACT(MONTH FROM COALESCE(e.enrollment_date, CURRENT_DATE))::int,
                  $3::int - 23
                ) AS from_key
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
          WHERE e.class_id = $1 AND e.company_id = $2 AND e.status = 'ACTIVE'
            AND c.payment_type = 'MONTHLY_SUBSCRIPTION' AND c.is_active = true
       ),
       periods AS (
         SELECT enr.id AS enrollment_id, enr.student_id, enr.course_id,
                enr.fee, enr.course_price,
                ((k - 1) / 12) AS billing_year,
                ((k - 1) % 12) + 1 AS billing_month
           FROM enr
           CROSS JOIN LATERAL generate_series(enr.from_key, $3::int) AS k
       ),
       resolved AS (
         SELECT p.enrollment_id, p.student_id, p.billing_year, p.billing_month,
                msp.id AS payment_id,
                COALESCE(msp.payment_status, 'PENDING') AS payment_status,
                COALESCE(
                  msp.amount_due,
                  CASE
                    WHEN ov.override_price IS NOT NULL AND p.course_price > 0
                      THEN ROUND(ov.override_price * (p.fee / p.course_price), 2)
                    ELSE p.fee
                  END
                ) AS amount_due,
                COALESCE(msp.amount_paid, 0) AS amount_paid
           FROM periods p
           LEFT JOIN monthly_subscription_payments msp
             ON msp.enrollment_id = p.enrollment_id
            AND msp.billing_year = p.billing_year
            AND msp.billing_month = p.billing_month
           LEFT JOIN course_monthly_price_overrides ov
             ON ov.course_id = p.course_id
            AND ov.billing_year = p.billing_year
            AND ov.billing_month = p.billing_month
       )
       SELECT * FROM resolved
        WHERE payment_status NOT IN ('PAID', 'REFUNDED')
          AND amount_due > amount_paid
        ORDER BY billing_year, billing_month`,
      [classId, context.companyId, monthKey]
    );
    for (const r of rows) {
      push(r.student_id, r.enrollment_id, {
        kind: 'MONTHLY',
        // The month name is built client-side from the year/month below —
        // it has to read in the UI's language, not the Lambda's.
        label: '',
        amount: parseFloat(r.amount_due) - parseFloat(r.amount_paid || 0),
        paymentId: r.payment_id || null,
        enrollmentId: r.enrollment_id,
        billingYear: Number(r.billing_year),
        billingMonth: Number(r.billing_month),
      });
    }
  } else if (paymentType === 'PER_SESSION') {
    await ensurePerSessionSchema();
    // Unpaid charges for sessions of this class up to and including this one.
    // COVERED (a prepaid package absorbed it) and WAIVED are not money owed.
    const rows = await query<any>(
      `SELECT sp.id, sp.enrollment_id, sp.student_id, sp.amount_due, sp.amount_paid,
              s.session_number, s.start_date
         FROM session_payments sp
         JOIN sessions s ON s.id = sp.session_id
        WHERE sp.company_id = $2 AND s.class_id = $1
          AND sp.payment_status = 'PENDING'
          AND sp.amount_due > sp.amount_paid
          AND s.start_date <= $3
        ORDER BY s.start_date`,
      [classId, context.companyId, upTo]
    );
    for (const r of rows) {
      push(r.student_id, r.enrollment_id, {
        kind: 'SESSION',
        label: r.session_number != null ? `#${r.session_number}` : new Date(r.start_date).toISOString().slice(0, 10),
        amount: parseFloat(r.amount_due) - parseFloat(r.amount_paid || 0),
        paymentId: r.id,
        enrollmentId: r.enrollment_id,
      });
    }
  } else if (paymentType === 'ONE_TIME') {
    // Whatever is left on the enrollment itself. Deliberately not the
    // fallback branch: a monthly course whose tables are missing must report
    // nothing owed rather than mistake the monthly fee for a balance.
    for (const e of enrollments) {
      const remaining = parseFloat(e.final_price || 0) - parseFloat(e.amount_paid || 0);
      if (remaining > 0.009) {
        push(e.student_id, e.id, {
          kind: 'ENROLLMENT',
          label: '',
          amount: remaining,
          paymentId: null,
          enrollmentId: e.id,
        });
      }
    }
  }

  return { paymentType, byStudent };
}

export const attendanceRoutes = {
  /**
   * GET /api/attendance/session/:sessionId
   * Returns all enrolled students for the session's class with their attendance status.
   */
  getBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Verify session belongs to company
      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      // Enrolled roster (direct + bundle) plus any SUBSTITUTION or TRIAL attendees
      // who are NOT enrolled in this class. Substitution rows are surfaced so the
      // editor can show "<name> · Substitution (from A_1)"; TRIAL rows so that a
      // prospect who scanned into a free session appears on the roster at all —
      // they have no enrolment to be found by, and an attendance editor that
      // silently dropped them would delete them on the next save.
      const students = await query(
        `SELECT
            s.id AS student_id,
            s.name AS student_name,
            s.student_code AS student_code,
            s.parent_name AS parent_name,
            s.parent_phone AS parent_phone,
            s.phone AS student_phone,
            sa.id AS attendance_id,
            sa.attendance_type AS attendance_type,
            sa.created_at AS checked_in_at,
            hc.name AS home_class_name,
            true AS is_enrolled
         FROM (
            SELECT student_id FROM enrollments
            WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT student_id FROM master_class_enrollments
            WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
         ) enrolled
         JOIN students s ON s.id = enrolled.student_id
         LEFT JOIN session_attendance sa ON sa.session_id = $3 AND sa.student_id = s.id
         LEFT JOIN classes hc ON hc.id = sa.home_class_id

         UNION ALL

         SELECT
            s.id AS student_id,
            s.name AS student_name,
            s.student_code AS student_code,
            s.parent_name AS parent_name,
            s.parent_phone AS parent_phone,
            s.phone AS student_phone,
            sa.id AS attendance_id,
            sa.attendance_type AS attendance_type,
            sa.created_at AS checked_in_at,
            hc.name AS home_class_name,
            false AS is_enrolled
         FROM session_attendance sa
         JOIN students s ON s.id = sa.student_id
         LEFT JOIN classes hc ON hc.id = sa.home_class_id
         WHERE sa.session_id = $3 AND sa.attendance_type IN ('SUBSTITUTION', 'TRIAL')
           AND sa.student_id NOT IN (
             SELECT student_id FROM enrollments
             WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
             UNION
             SELECT student_id FROM master_class_enrollments
             WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
           )
         ORDER BY student_name`,
        [session.class_id, context.companyId, params.sessionId]
      );

      // PER_SESSION courses: attach each student's existing session charge so the
      // UI can warn (and show paid amount) before un-checking deletes it.
      const chargeByStudent = new Map<string, { status: string; amountDue: number; amountPaid: number }>();
      const courseType = await queryOne<any>(
        `SELECT co.payment_type FROM classes cl JOIN courses co ON cl.course_id = co.id WHERE cl.id = $1`,
        [session.class_id]
      );
      if (courseType?.payment_type === 'PER_SESSION') {
        await ensurePerSessionSchema();
        const charges = await query<any>(
          `SELECT student_id, payment_status, amount_due, amount_paid
           FROM session_payments WHERE session_id = $1 AND company_id = $2`,
          [params.sessionId, context.companyId]
        );
        for (const c of charges) {
          chargeByStudent.set(c.student_id, {
            status: c.payment_status,
            amountDue: parseFloat(c.amount_due || 0),
            amountPaid: parseFloat(c.amount_paid || 0),
          });
        }
      }

      // Absence figures for the roster panels: the unbroken run, plus the
      // scattered misses inside this session's month. The session being
      // registered is excluded — it has not happened yet.
      const absences = await absenceStats(
        context.companyId, session.class_id, params.sessionId, session.start_date,
      );

      return {
        status: 200 as const,
        body: students.map((row: any) => ({
          studentId: row.student_id,
          studentName: row.student_name,
          studentCode: row.student_code ?? null,
          parentName: row.parent_name || null,
          parentPhone: row.parent_phone || null,
          studentPhone: row.student_phone || null,
          isPresent: row.attendance_id !== null,
          attendanceId: row.attendance_id || null,
          attendanceType: row.attendance_type || null,
          // When they actually walked in — an attendance list that only says
          // "present" cannot answer who arrived late.
          checkedInAt: row.checked_in_at || null,
          homeClassName: row.home_class_name || null,
          isEnrolled: row.is_enrolled === true,
          charge: chargeByStudent.get(row.student_id) || null,
          absentStreak: absences.get(row.student_id)?.absentStreak ?? 0,
          monthAbsences: absences.get(row.student_id)?.monthAbsences ?? 0,
          monthSessions: absences.get(row.student_id)?.monthSessions ?? 0,
        })),
      };
    } catch (error) {
      console.error('Get session attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.GET_FAILED', 'Failed to get attendance');
    }
  },

  /**
   * GET /api/attendance/session/:sessionId/dues
   *
   * What each student on this roster still owes for THIS class, so the person
   * taking attendance can collect while the student is in front of them instead
   * of finding out weeks later from the dues report.
   *
   * Nothing is written: monthly months with no stored bill are projected the
   * same way the subscriptions dashboard projects them (see projectedBills) and
   * only materialise if someone actually pays. Months after the session's own
   * month are never counted — that would be billing for classes not yet run.
   *
   * A student with no direct enrollment in this class (bundle enrollees, trial
   * and substitution attendees) is left out of the response entirely rather than
   * reported as clear: their money lives elsewhere and a green "no dues" badge
   * would be a lie.
   */
  sessionDues: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne<any>(
        'SELECT id, class_id, branch_id, start_date FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const start = new Date(session.start_date);
      const { paymentType, byStudent } = await classDues(
        context,
        session.class_id,
        start.getFullYear() * 12 + (start.getMonth() + 1),
        session.start_date,
      );
      return {
        status: 200 as const,
        body: {
          paymentType,
          students: Array.from(byStudent.entries()).map(([studentId, v]) => ({
            studentId,
            enrollmentId: v.enrollmentId,
            totalDue: Math.round(v.items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100,
            items: v.items,
          })),
        },
      };
    } catch (error) {
      console.error('Get session dues error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.GET_FAILED', 'Failed to get session dues');
    }
  },

  /**
   * GET /api/attendance/class/:classId/student-status
   *
   * The same two roster panels — absences and money owed — for a class page,
   * which has no session to anchor to. Both are scoped to the CURRENT calendar
   * month; the session variants use the session's own month instead.
   *
   * Absences are reported for everyone enrolled; dues only for students the
   * money query can speak for (see classDues), which is why they are separate
   * lists rather than one merged row per student.
   */
  classStudentStatus: async ({ params, headers }: { params: { classId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Company and branch live on the linked course, not on the class itself.
      const cls = await queryOne<any>(
        `SELECT c.id, co.branch_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [params.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }
      if (!canAccessBranch(context, cls.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const now = new Date();
      const [absences, dues] = await Promise.all([
        absenceStats(context.companyId, params.classId, null, now),
        classDues(context, params.classId, now.getFullYear() * 12 + (now.getMonth() + 1), now),
      ]);

      return {
        status: 200 as const,
        body: {
          paymentType: dues.paymentType,
          /** The month both counts are scoped to, so the UI can name it. */
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          absences: Array.from(absences.entries()).map(([studentId, a]) => ({
            studentId,
            absentStreak: a.absentStreak,
            monthAbsences: a.monthAbsences,
            monthSessions: a.monthSessions,
          })),
          students: Array.from(dues.byStudent.entries()).map(([studentId, v]) => ({
            studentId,
            enrollmentId: v.enrollmentId,
            totalDue: Math.round(v.items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100,
            items: v.items,
          })),
        },
      };
    } catch (error) {
      console.error('Get class student status error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.GET_FAILED', 'Failed to get class student status');
    }
  },

  /**
   * POST /api/attendance/session/:sessionId
   * Bulk save attendance: insert records for present students, delete for absent ones.
   * Body: { presentStudentIds: string[] }
   */
  saveForSession: async ({ params, body, headers }: { params: { sessionId: string }; body: { presentStudentIds: string[] }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();   // charge guards below read session.is_free
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const presentIds: string[] = body.presentStudentIds || [];

      // Who was already on the roster before this save. Used below to prompt for
      // money only for students this save actually marks present — re-saving an
      // unchanged roster (the debounced editor fires on every toggle) must not
      // re-open the pay dialog for someone who was already there.
      const previouslyPresent = new Set(
        (await query<any>(
          `SELECT student_id FROM session_attendance WHERE session_id = $1 AND attendance_type = 'NORMAL'`,
          [params.sessionId]
        )).map((r: any) => r.student_id)
      );

      // Only NORMAL (enrolled-roster) rows are managed by the checkbox editor.
      // SUBSTITUTION and TRIAL rows come from QR check-in and must survive a
      // bulk save — neither has an enrolment, so neither can be re-created from
      // the roster if this wiped them.
      await query(
        `DELETE FROM session_attendance WHERE session_id = $1 AND attendance_type = 'NORMAL'`,
        [params.sessionId]
      );

      // Insert records for present students
      if (presentIds.length > 0) {
        const valuePlaceholders = presentIds.map((_, i) => `($1, $${i + 2}, 'NORMAL')`).join(', ');
        await query(
          `INSERT INTO session_attendance (session_id, student_id, attendance_type) VALUES ${valuePlaceholders}
           ON CONFLICT (session_id, student_id) DO NOTHING`,
          [params.sessionId, ...presentIds]
        );
      }

      // Re-settle make-ups against this session: whoever is now marked present
      // releases the substitution that was covering them, and whoever was just
      // un-checked becomes an absence a pending make-up can claim. Best-effort —
      // never fail the save over it.
      try {
        await releaseSubstitutionClaims(context.companyId, params.sessionId, presentIds);
        await claimPendingSubstitutions(context.companyId, params.sessionId);
      } catch (subErr) {
        console.error('Substitution re-settle (saveForSession) error:', subErr);
      }

      // PER_SESSION courses: create/consume per-session charges for this save.
      // Returns the newly-created PENDING charges that still need collection.
      // Best-effort: a billing hiccup must never fail the attendance save itself.
      let sessionCharges: any[] = [];
      try {
        sessionCharges = await chargeSessionAttendance(context.companyId, session, presentIds);
        // A charge exists once per (enrollment, session), so the call above only
        // reports the ones IT created. A student marked present here whose charge
        // was created earlier — by a QR check-in, or by the attendance page before
        // the cashier reopened this class on the dashboard — would otherwise be
        // billed silently and never prompted for. Marking present is what asks for
        // the money, whichever screen it happens on, so their outstanding charge
        // joins the list.
        const newlyPresent = presentIds.filter((id) => !previouslyPresent.has(id));
        const alreadyReturned = new Set(sessionCharges.map((c: any) => c.id));
        const outstanding = await pendingChargesForStudents(
          context.companyId,
          params.sessionId,
          newlyPresent
        );
        sessionCharges = sessionCharges.concat(
          outstanding.filter((c: any) => !alreadyReturned.has(c.id))
        );
      } catch (billErr) {
        console.error('Per-session charge (saveForSession) error:', billErr);
      }
      // Un-checked students: drop the per-session charge created when they were
      // marked present (and refund any package credit). Best-effort.
      try {
        await reverseUnattendedCharges(context.companyId, session, presentIds);
      } catch (revErr) {
        console.error('Per-session reverse (saveForSession) error:', revErr);
      }

      return {
        status: 200 as const,
        body: {
          message: 'Attendance saved successfully',
          code: 'ATTENDANCE.SAVED',
          presentCount: presentIds.length,
          sessionCharges,
        },
      };
    } catch (error) {
      console.error('Save session attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.SAVE_FAILED', 'Failed to save attendance');
    }
  },

  /**
   * DELETE /api/attendance/session/:sessionId/student/:studentId
   * Remove a single attendance record (any type) — used to undo a wrong QR
   * check-in, including SUBSTITUTION attendees the checkbox editor can't manage.
   */
  removeAttendee: async ({ params, headers }: { params: { sessionId: string; studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }
      await query(
        'DELETE FROM session_attendance WHERE session_id = $1 AND student_id = $2',
        [params.sessionId, params.studentId]
      );
      // The student is absent from this session again, so a make-up waiting for
      // a lesson to cover can now claim it. Best-effort.
      try {
        await claimPendingSubstitutions(context.companyId, params.sessionId);
      } catch (subErr) {
        console.error('Substitution claim (removeAttendee) error:', subErr);
      }
      // Un-checking a student drops the per-session charge raised for their
      // attendance (and restores any package credit). Best-effort.
      try {
        await reverseStudentCharge(context.companyId, session, params.studentId);
      } catch (revErr) {
        console.error('Per-session reverse (removeAttendee) error:', revErr);
      }
      return { status: 200 as const, body: { message: 'Attendee removed', code: 'ATTENDANCE.REMOVED' } };
    } catch (error) {
      console.error('Remove attendee error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.REMOVE_FAILED', 'Failed to remove attendee');
    }
  },

  /**
   * POST /api/attendance/session/:sessionId/checkin
   * Mark a single student present by scanning their QR token. Idempotent —
   * re-scanning an already-present student is a no-op (returns alreadyPresent).
   * Body: { qrToken: string }
   */
  checkinByQr: async ({ params, body, headers }: { params: { sessionId: string }; body: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) {
        return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      }
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const token = (body?.qrToken || '').trim();
      if (!token) {
        return apiError(400, 'ERRORS.ATTENDANCE.QR_TOKEN_REQUIRED', 'QR token is required');
      }

      // Resolve the student by token, scoped to this tenant — a token from
      // another company must not be accepted. Every student's QR works by
      // default (no activation gate).
      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne<any>(
        // student_code travels back with the check-in so the caller can show the
        // badge immediately. A trial attendee has no enrolment, so the roster the
        // page loaded doesn't contain them — without this their row would be the
        // only one on screen with no code until a refetch.
        `SELECT s.id, s.name, s.student_code
         FROM students s
         WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2 AND s.is_active = true`,
        [token, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.ATTENDANCE.QR_STUDENT_NOT_FOUND', 'No active student matches this QR code');
      }

      // A free session is open to the whole academy. Enrolment is exactly what
      // the trial exists to sell, so requiring it would defeat the point — and
      // since nothing is billed, there is no charge to attach to an enrolment
      // anyway. This runs BEFORE the enrolment lookup so a prospect never falls
      // through to the SUBSTITUTION path (which would look for a sibling class
      // they are not in) and get rejected.
      if (session.is_free) {
        // An enrolled student sitting in on a free lesson is still NORMAL —
        // nothing unusual happened, they simply weren't charged. TRIAL is
        // reserved for the newcomers, which is what makes the count on the
        // class's Free sessions tab worth reading.
        const enrolledHere = await queryOne<any>(
          `SELECT 1 FROM (
              SELECT student_id FROM enrollments
              WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
              UNION
              SELECT student_id FROM master_class_enrollments
              WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
           ) enrolled
           WHERE student_id = $3`,
          [session.class_id, context.companyId, student.id]
        );
        const type = enrolledHere ? 'NORMAL' : 'TRIAL';

        // A trial is a taster, not a way to attend for ever. The company can cap
        // how many free sessions one newcomer may ever sit (0 = unlimited, the
        // default and what every tenant had before this existed).
        //
        // Only TRIAL counts. A student enrolled in THIS class is NORMAL — their
        // own lesson simply wasn't billed — and must never be turned away by a
        // cap aimed at prospects. The count is of sessions already attended, so
        // a student on their last allowance still gets that session; and because
        // the insert below is ON CONFLICT DO NOTHING, re-scanning someone who is
        // already in the room can't consume a second slot.
        if (type === 'TRIAL') {
          await ensureFreeTrialLimitColumn();
          const limitRow = await queryOne<any>(
            'SELECT free_session_trial_limit AS lim FROM companies WHERE id = $1',
            [context.companyId]
          );
          const limit = parseInt(limitRow?.lim ?? 0, 10) || 0;
          if (limit > 0) {
            const usedRow = await queryOne<any>(
              `SELECT COUNT(*)::int AS n
                 FROM session_attendance sa
                 JOIN sessions s ON s.id = sa.session_id
                WHERE sa.student_id = $1
                  AND s.company_id = $2
                  AND sa.attendance_type = 'TRIAL'
                  AND sa.session_id <> $3`,
              [student.id, context.companyId, params.sessionId]
            );
            const used = parseInt(usedRow?.n ?? 0, 10) || 0;
            if (used >= limit) {
              return apiError(
                400,
                'ERRORS.ATTENDANCE.TRIAL_LIMIT_REACHED',
                `${student.name} has already used all ${limit} free session(s)`
              );
            }
          }
        }

        const insertedFree = await query(
          `INSERT INTO session_attendance (session_id, student_id, attendance_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (session_id, student_id) DO NOTHING
           RETURNING id`,
          [params.sessionId, student.id, type]
        );
        const alreadyPresentFree = insertedFree.length === 0;

        await notifyCheckin(context.companyId, params.sessionId, student.id);

        return {
          status: 200 as const,
          body: {
            studentId: student.id,
            studentName: student.name,
            studentCode: student.student_code ?? null,
            attendanceType: type as 'NORMAL' | 'TRIAL',
            homeClassName: null,
            sessionNumber: session.session_number ?? null,
            alreadyPresent: alreadyPresentFree,
            code: alreadyPresentFree ? 'ATTENDANCE.ALREADY_PRESENT' : 'ATTENDANCE.CHECKED_IN_FREE',
            message: alreadyPresentFree ? 'Student was already marked present' : 'Student marked present at a free session',
            sessionCharge: null,
          },
        };
      }

      // Is the student enrolled in THIS session's class?
      const enrolled = await queryOne<any>(
        `SELECT 1 FROM (
            SELECT student_id FROM enrollments
            WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT student_id FROM master_class_enrollments
            WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
         ) enrolled
         WHERE student_id = $3`,
        [session.class_id, context.companyId, student.id]
      );

      if (enrolled) {
        // NORMAL check-in. Idempotent: RETURNING only yields a row when a NEW
        // record was inserted; an ON CONFLICT no-op returns nothing — that's how
        // we tell a fresh check-in from a re-scan of an already-present student.
        const inserted = await query(
          `INSERT INTO session_attendance (session_id, student_id, attendance_type)
           VALUES ($1, $2, 'NORMAL')
           ON CONFLICT (session_id, student_id) DO NOTHING
           RETURNING id`,
          [params.sessionId, student.id]
        );
        const alreadyPresent = inserted.length === 0;

        // They came to their own lesson after all — a make-up that was standing
        // in for it now stands in for nothing. Best-effort: the check-in itself
        // must never fail over bookkeeping.
        try {
          await releaseSubstitutionClaims(context.companyId, params.sessionId, [student.id]);
        } catch (subErr) {
          console.error('Substitution release (checkinByQr) error:', subErr);
        }

        // Best-effort Telegram present notification (no-op unless enabled).
        await notifyCheckin(context.companyId, params.sessionId, student.id);

        // PER_SESSION courses: create/consume the charge for this check-in.
        // Best-effort — billing must never fail the check-in itself.
        let sessionCharge: any = null;
        try {
          sessionCharge = await chargeSingleCheckin(context.companyId, session, student.id);
        } catch (billErr) {
          console.error('Per-session charge (checkinByQr) error:', billErr);
        }

        return {
          status: 200 as const,
          body: {
            studentId: student.id,
            studentName: student.name,
            studentCode: student.student_code ?? null,
            attendanceType: 'NORMAL' as const,
            homeClassName: null,
            sessionNumber: session.session_number ?? null,
            alreadyPresent,
            code: alreadyPresent ? 'ATTENDANCE.ALREADY_PRESENT' : 'ATTENDANCE.CHECKED_IN',
            message: alreadyPresent ? 'Student was already marked present' : 'Student marked present',
            sessionCharge,
          },
        };
      }

      // Not enrolled in this class → try SUBSTITUTION. The student qualifies if
      // they're enrolled in a sibling class of the SAME course. Being a member of
      // the Course is enough — the sessions can be on different days/classes.
      const course = await queryOne<any>(
        `SELECT c.course_id
         FROM classes c
         WHERE c.id = $1`,
        [session.class_id]
      );
      const siblingClass = course?.course_id
        ? await queryOne<any>(
            `SELECT cl.id, cl.name
             FROM classes cl
             WHERE cl.course_id = $1
               AND cl.id <> $2
               AND cl.id IN (
                 SELECT class_id FROM enrollments
                 WHERE company_id = $3 AND student_id = $4 AND status NOT IN ('DROPPED', 'CANCELLED')
                 UNION
                 SELECT class_id FROM master_class_enrollments
                 WHERE company_id = $3 AND student_id = $4 AND status != 'DROPPED'
               )
             ORDER BY cl.created_at ASC
             LIMIT 1`,
            [course.course_id, session.class_id, context.companyId, student.id]
          )
        : null;

      if (!siblingClass) {
        // Not in this class and not in any sibling class of the course.
        return apiError(409, 'ERRORS.ATTENDANCE.STUDENT_NOT_IN_CLASS', 'This student is not enrolled in this class');
      }

      const insertedSub = await query(
        `INSERT INTO session_attendance (session_id, student_id, attendance_type, home_class_id)
         VALUES ($1, $2, 'SUBSTITUTION', $3)
         ON CONFLICT (session_id, student_id) DO NOTHING
         RETURNING id`,
        [params.sessionId, student.id, siblingClass.id]
      );
      const alreadyPresentSub = insertedSub.length === 0;

      // Say which of their own lessons this makes up for, so the home session
      // reads "attended elsewhere" instead of absent. Nothing to point at yet
      // when they came EARLY — that lesson has not been opened — and the link is
      // made from the other side when it is (claimPendingSubstitutions).
      let coversSessionId: string | null = null;
      try {
        const subRowId = insertedSub[0]?.id ?? (await queryOne<any>(
          `SELECT id FROM session_attendance WHERE session_id = $1 AND student_id = $2`,
          [params.sessionId, student.id]
        ))?.id;
        if (subRowId) coversSessionId = await linkSubstitution(context.companyId, subRowId);
      } catch (subErr) {
        console.error('Substitution link (checkinByQr) error:', subErr);
      }

      // Best-effort Telegram present notification (no-op unless enabled).
      await notifyCheckin(context.companyId, params.sessionId, student.id);

      return {
        status: 200 as const,
        body: {
          studentId: student.id,
          studentName: student.name,
          studentCode: student.student_code ?? null,
          attendanceType: 'SUBSTITUTION' as const,
          homeClassName: siblingClass.name,
          substitutesForSessionId: coversSessionId,
          sessionNumber: session.session_number ?? null,
          alreadyPresent: alreadyPresentSub,
          code: alreadyPresentSub ? 'ATTENDANCE.ALREADY_PRESENT_SUB' : 'ATTENDANCE.CHECKED_IN_SUB',
          message: alreadyPresentSub
            ? 'Student was already marked as substitution'
            : 'Student marked present by substitution',
        },
      };
    } catch (error) {
      console.error('QR check-in error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.CHECKIN_FAILED', 'Failed to check in student');
    }
  },

  /**
   * GET /api/attendance/student/:studentId
   * Returns attendance history for a student across all their sessions.
   */
  getByStudent: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureAttendanceMagicColumns();
      await ensureFreeSessionSchema();   // the queries below read sessions.is_free
      await ensureSubstitutionLinkSchema();

      // For each session of the student's enrolled classes, derive a status:
      //   PRESENT     — a NORMAL attendance row exists for this session.
      //   SUBSTITUTED — no NORMAL row, but a SUBSTITUTION of theirs stands in for
      //                 this session (linked by id; see db/substitutions.ts).
      //   ABSENT      — neither.
      // SUBSTITUTED counts as present for the attendance rate.
      const records = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.session_number AS session_number,
          s.is_free AS is_free,
          cl.id AS class_id,
          cl.name AS class_name,
          co.id AS course_id,
          co.name AS course_name,
          r.code AS room_code,
          CASE WHEN sa.id IS NOT NULL THEN true ELSE false END AS is_present_normal,
          subst.sub_class_name AS substituted_in_class_name,
          subst.sub_session_id AS substituted_in_session_id,
          subst.sub_session_date AS substituted_session_date
        FROM sessions s
        JOIN classes cl ON s.class_id = cl.id
        JOIN courses co ON co.id = cl.course_id
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa
          ON sa.session_id = s.id AND sa.student_id = $1 AND sa.attendance_type = 'NORMAL'
        LEFT JOIN LATERAL (
          ${substitutionCoversLateral({
            student: '$1',
            sessionId: 's.id',
            courseId: 'cl.course_id',
            sessionNumber: 's.session_number',
          })}
        ) subst ON true
        WHERE s.company_id = $2
          AND s.class_id IN (
            SELECT class_id FROM enrollments
            WHERE student_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
            UNION
            SELECT class_id FROM master_class_enrollments
            WHERE student_id = $1 AND company_id = $2 AND status != 'DROPPED'
          )
        ORDER BY s.start_date DESC`,
        [params.studentId, context.companyId]
      );

      // Make-ups that cover nothing on the student's own timetable — taken before
      // the lesson they stand in for was opened (so there is no home session to
      // carry the SUBSTITUTED status above), or for a lesson that never ran.
      // Without these, attending early would leave no trace at all on the page.
      const orphanSubs = await query(
        `SELECT
          sub_session.id AS session_id,
          sub_session.start_date AS session_start_date,
          sub_session.end_date AS session_end_date,
          sub_session.session_number AS session_number,
          sub_session.is_free AS is_free,
          sub_class.id AS class_id,
          sub_class.name AS class_name,
          co2.id AS course_id,
          co2.name AS course_name,
          r2.code AS room_code,
          hc.name AS home_class_name
        FROM session_attendance sub
        JOIN sessions sub_session ON sub_session.id = sub.session_id
        JOIN classes sub_class ON sub_class.id = sub_session.class_id
        JOIN courses co2 ON co2.id = sub_class.course_id
        LEFT JOIN rooms r2 ON r2.id = sub_session.room_id
        LEFT JOIN classes hc ON hc.id = sub.home_class_id
        WHERE sub.student_id = $1
          AND sub.attendance_type = 'SUBSTITUTION'
          AND sub_session.company_id = $2
          AND ${substitutionIsOrphanClause('$1', '$2')}
        ORDER BY sub_session.start_date DESC`,
        [params.studentId, context.companyId]
      );

      // Free sessions the student sat in on without being enrolled in the class
      // (attendance_type = TRIAL). Neither query above can see these: the first
      // is scoped to the student's enrolled classes, the second to substitutions.
      // Without them, a student who tried three classes has an empty history and
      // no answer to "which free sessions did they attend?".
      const trials = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.session_number AS session_number,
          s.is_free AS is_free,
          cl.id AS class_id,
          cl.name AS class_name,
          co.id AS course_id,
          co.name AS course_name,
          r.code AS room_code
        FROM session_attendance sa
        JOIN sessions s  ON s.id = sa.session_id
        JOIN classes cl  ON cl.id = s.class_id
        JOIN courses co  ON co.id = cl.course_id
        LEFT JOIN rooms r ON r.id = s.room_id
        WHERE sa.student_id = $1
          AND sa.attendance_type = 'TRIAL'
          AND s.company_id = $2
        ORDER BY s.start_date DESC`,
        [params.studentId, context.companyId]
      );

      const enrolledBody = records.map((row: any) => {
        const status: 'PRESENT' | 'ABSENT' | 'SUBSTITUTED' =
          row.is_present_normal ? 'PRESENT'
          : row.substituted_in_class_name ? 'SUBSTITUTED'
          : 'ABSENT';
        return {
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          sessionNumber: row.session_number === null || row.session_number === undefined
            ? null
            : parseInt(row.session_number, 10),
          classId: row.class_id,
          className: row.class_name,
          courseId: row.course_id,
          courseName: row.course_name,
          isFree: row.is_free === true,
          roomCode: row.room_code,
          status,
          substitutedInClassName: row.substituted_in_class_name || null,
          // The lesson they actually sat, named by id and date: "absent" and
          // "made it up on Saturday" must not look the same on the page.
          substitutedInSessionId: row.substituted_in_session_id || null,
          substitutedSessionDate: row.substituted_session_date || null,
          // Backward-compatible: present OR substituted.
          isPresent: status !== 'ABSENT',
        };
      });

      const orphanBody = orphanSubs.map((row: any) => ({
        sessionId: row.session_id,
        sessionStartDate: row.session_start_date,
        sessionEndDate: row.session_end_date,
        sessionNumber: row.session_number === null || row.session_number === undefined
          ? null
          : parseInt(row.session_number, 10),
        classId: row.class_id,
        // The class the student physically attended as a substitute.
        className: row.class_name,
        courseId: row.course_id,
        courseName: row.course_name,
        isFree: row.is_free === true,
        roomCode: row.room_code,
        status: 'SUBSTITUTED' as const,
        substitutedInClassName: row.class_name,
        substitutedInSessionId: row.session_id,
        substitutedSessionDate: row.session_start_date,
        isPresent: true,
      }));

      const trialBody = trials.map((row: any) => ({
        sessionId: row.session_id,
        sessionStartDate: row.session_start_date,
        sessionEndDate: row.session_end_date,
        sessionNumber: row.session_number === null || row.session_number === undefined
          ? null
          : parseInt(row.session_number, 10),
        classId: row.class_id,
        className: row.class_name,
        courseId: row.course_id,
        courseName: row.course_name,
        isFree: row.is_free === true,
        roomCode: row.room_code,
        status: 'TRIAL' as const,
        substitutedInClassName: null,
        substitutedInSessionId: null,
        substitutedSessionDate: null,
        isPresent: true,
      }));

      const body = [...enrolledBody, ...orphanBody, ...trialBody].sort((a, b) =>
        new Date(b.sessionStartDate).getTime() - new Date(a.sessionStartDate).getTime()
      );

      return { status: 200 as const, body };
    } catch (error) {
      console.error('Get student attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.STUDENT_FAILED', 'Failed to get student attendance');
    }
  },

  /**
   * GET /api/attendance/class/:classId
   * Returns per-session attendance summary for a class.
   */
  getByClass: async ({ params, headers }: { params: { classId: string }; headers: { authorization: string } }) => {
    try {
      await ensureAttendanceMagicColumns();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const cls = await queryOne(
        `SELECT c.*, co.company_id, co.branch_id
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND co.company_id = $2`,
        [params.classId, context.companyId]
      );
      if (!cls) {
        return apiError(404, 'ERRORS.CLASSES.NOT_FOUND', 'Class not found');
      }
      if (!canAccessBranch(context, cls.branch_id)) {
        return apiError(403, 'ERRORS.CLASSES.ACCESS_DENIED', 'Access denied to this class');
      }

      // Total enrolled students for this class
      const totalResult = await queryOne(
        `SELECT COUNT(*) AS total FROM (
          SELECT student_id FROM enrollments
          WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
          UNION
          SELECT student_id FROM master_class_enrollments
          WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
        ) enrolled`,
        [params.classId, context.companyId]
      );
      const totalStudents = parseInt(totalResult?.total ?? '0', 10);

      const sessions = await query(
        `SELECT
          s.id AS session_id,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.session_number AS session_number,
          r.code AS room_code,
          COUNT(sa.id) AS present_count
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN session_attendance sa
          ON sa.session_id = s.id AND sa.attendance_type = 'NORMAL'
        WHERE s.class_id = $1 AND s.company_id = $2
        GROUP BY s.id, s.start_date, s.end_date, s.session_number, r.code
        ORDER BY s.start_date DESC`,
        [params.classId, context.companyId]
      );

      return {
        status: 200 as const,
        body: sessions.map((row: any) => ({
          sessionId: row.session_id,
          sessionStartDate: row.session_start_date,
          sessionEndDate: row.session_end_date,
          sessionNumber: row.session_number === null || row.session_number === undefined
            ? null
            : parseInt(row.session_number, 10),
          roomCode: row.room_code,
          totalStudents,
          presentCount: parseInt(row.present_count, 10),
          absentCount: Math.max(0, totalStudents - parseInt(row.present_count, 10)),
        })),
      };
    } catch (error) {
      console.error('Get class attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.CLASS_FAILED', 'Failed to get class attendance');
    }
  },

  // ============================================================
  // Teacher attendance — who taught (or was supposed to teach) a session
  // ============================================================

  /**
   * GET /api/attendance/teachers/session/:sessionId
   * Returns the teacher roster for a single session.
   */
  getTeachersBySession: async ({ params, headers }: { params: { sessionId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const rows = await query(
        `SELECT
           sta.id,
           sta.session_id,
           sta.employee_id,
           sta.role,
           sta.status,
           sta.notes,
           sta.created_at,
           e.first_name,
           e.last_name,
           e.position
         FROM session_teacher_attendance sta
         JOIN employees e ON e.id = sta.employee_id
         WHERE sta.session_id = $1
         ORDER BY sta.role ASC, e.first_name ASC, e.last_name ASC`,
        [params.sessionId]
      );

      return {
        status: 200 as const,
        body: rows.map((row: any) => ({
          id: row.id,
          sessionId: row.session_id,
          employeeId: row.employee_id,
          employeeFirstName: row.first_name,
          employeeLastName: row.last_name,
          employeePosition: row.position,
          role: row.role,
          status: row.status,
          notes: row.notes,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('Get session teacher attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_GET_FAILED', 'Failed to get teacher attendance');
    }
  },

  /**
   * POST /api/attendance/teachers/session/:sessionId
   * Replaces the teacher roster for a session.
   * Body: { teachers: [{ employeeId, role, status, notes? }] }
   */
  saveTeachersForSession: async ({ params, body, headers }: { params: { sessionId: string }; body: { teachers: Array<{ employeeId: string; role: string; status: string; notes?: string | null }> }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const session = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.sessionId, context.companyId]
      );
      if (!session) return apiError(404, 'ERRORS.SESSIONS.NOT_FOUND', 'Session not found');
      if (!canAccessBranch(context, session.branch_id)) {
        return apiError(403, 'ERRORS.SESSIONS.ACCESS_DENIED', 'Access denied to this session');
      }

      const teachers = Array.isArray(body?.teachers) ? body.teachers : [];

      await query('DELETE FROM session_teacher_attendance WHERE session_id = $1', [params.sessionId]);

      for (const t of teachers) {
        if (!t.employeeId) continue;
        await query(
          `INSERT INTO session_teacher_attendance (session_id, employee_id, role, status, notes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, employee_id) DO NOTHING`,
          [
            params.sessionId,
            t.employeeId,
            t.role || 'PRIMARY',
            t.status || 'PRESENT',
            t.notes || null,
          ]
        );
      }

      return { status: 200 as const, body: { message: 'Teacher attendance saved', code: 'ATTENDANCE.TEACHER_SAVED', count: teachers.length } };
    } catch (error) {
      console.error('Save teacher attendance error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_SAVE_FAILED', 'Failed to save teacher attendance');
    }
  },

  /**
   * GET /api/attendance/teachers
   * Cross-employee teacher attendance log with filters.
   */
  getTeachersHistory: async ({ query: queryParams, headers }: { query: { branchId?: string; employeeId?: string; classId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];
      let sql = `
        SELECT
          sta.id,
          sta.session_id,
          sta.employee_id,
          sta.role,
          sta.status,
          sta.notes,
          sta.created_at,
          e.first_name,
          e.last_name,
          e.position,
          s.start_date AS session_start_date,
          s.end_date AS session_end_date,
          s.branch_id,
          s.class_id,
          cl.name AS class_name,
          co.name AS course_name,
          b.name AS branch_name,
          r.code AS room_code,
          EXISTS (
            SELECT 1 FROM session_salary_payments ssp
            WHERE ssp.session_id = sta.session_id AND ssp.employee_id = sta.employee_id
          ) AS paid
        FROM session_teacher_attendance sta
        JOIN sessions s ON s.id = sta.session_id
        JOIN employees e ON e.id = sta.employee_id
        LEFT JOIN classes cl ON cl.id = s.class_id
        LEFT JOIN courses co ON co.id = cl.course_id
        LEFT JOIN branches b ON b.id = s.branch_id
        LEFT JOIN rooms r ON r.id = s.room_id
        WHERE s.company_id = $1
      `;

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 's.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      if (queryParams.employeeId) {
        params.push(queryParams.employeeId);
        sql += ` AND sta.employee_id = $${params.length}`;
      }

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND s.class_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND s.start_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND s.start_date <= $${params.length}`;
      }

      sql += ' ORDER BY s.start_date DESC, e.first_name ASC';

      const rows = await query(sql, params);
      return {
        status: 200 as const,
        body: rows.map((row: any) => {
          const start = row.session_start_date ? new Date(row.session_start_date) : null;
          const end = row.session_end_date ? new Date(row.session_end_date) : null;
          const durationMinutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;
          return {
            id: row.id,
            sessionId: row.session_id,
            employeeId: row.employee_id,
            employeeFirstName: row.first_name,
            employeeLastName: row.last_name,
            employeePosition: row.position,
            role: row.role,
            status: row.status,
            notes: row.notes,
            sessionStartDate: row.session_start_date,
            sessionEndDate: row.session_end_date,
            durationMinutes,
            branchId: row.branch_id,
            branchName: row.branch_name,
            classId: row.class_id,
            className: row.class_name,
            courseName: row.course_name,
            roomCode: row.room_code,
            paid: row.paid === true,
          };
        }),
      };
    } catch (error) {
      console.error('Get teacher attendance history error:', error);
      return mapThrownError(error, 'ERRORS.ATTENDANCE.TEACHER_HISTORY_FAILED', 'Failed to get teacher attendance history');
    }
  },
};
