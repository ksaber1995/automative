import { query, queryOne } from '../db/connection';
import { ensureQrCardSchema, qrStudentMatchPublic } from './qr-cards';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError } from '../utils/api-error';
import { ensureAttendanceMagicColumns } from './sessions';
import { resolveStatus } from './monthly-subscriptions';
import { isRatingCompany, mapStudentExamRow, studentExamFeedSql } from './exams';

type AuthHeaders = { authorization?: string };

/**
 * Public, UNAUTHENTICATED student profile resolved by QR token.
 *
 * Reached by scanning a student's QR code with any phone camera (the QR
 * encodes a URL ending in this token). Deliberately does NOT call
 * extractTenantContext — the opaque token is the only credential, and it
 * scopes the result to exactly one student. Tenant (company/branch) is read
 * FROM the resolved student, never from a JWT.
 *
 * PRIVACY: this page has no login, so the QR token is the ONLY thing standing
 * between a passer-by and everything below — and that token is printed on a card
 * the student carries in their pocket.
 *
 * It exposes name, branch/academy, courses, attendance, exam grades, and the
 * student's FULL payment history across all three billing models: every billed
 * month with its amounts and dates, every per-session charge, every course
 * instalment, and every refund.
 *
 * The financials are here at the owner's explicit instruction, with that
 * exposure spelled out and accepted. This file previously said the opposite —
 * that amounts were deliberately withheld and should only ever be added behind a
 * second check such as date of birth. That gate was considered and rejected as
 * unworkable: barely half of some tenants' students have a date of birth on
 * record, so it would lock those parents out entirely.
 *
 * Contact info, address and notes are still withheld. Adding anything more
 * sensitive here is a product decision, not a refactor.
 */
export const publicStudentsRoutes = {
  /**
   * Public, UNAUTHENTICATED lookup for a pool card that isn't linked to anyone.
   *
   * Scanning a blank card previously hit `profile` and got a flat 404, which is
   * useless to whoever is holding it: a card printed and dropped, or one handed
   * over before it was linked, gives no clue whose it is. This answers the two
   * questions a finder actually has — which teacher/academy it belongs to, and
   * what number is on it, so it can be returned or linked by staff.
   *
   * Exposes nothing a person holding the card can't already see: the serial is
   * printed on its face, and naming the academy is the entire point. No student
   * is involved — an unlinked card has no student by definition.
   *
   * Same IP rate limit as the profile, so this can't be used to sweep the token
   * space any faster.
   */
  cardByToken: async ({ params }: { params: { token: string }; headers: AuthHeaders }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      await ensureQrCardSchema();
      const token = (params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'Not found');
      }

      const card = await queryOne<any>(
        `SELECT c.serial, c.student_id, co.name AS company_name, co.type AS company_type
           FROM qr_cards c
           JOIN companies co ON co.id = c.company_id
          WHERE c.token = $1`,
        [token],
      );

      // Generic 404 either way — never reveal whether a token is unknown.
      if (!card) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'Not found');

      // A linked card belongs on the student profile, not here. Sending it back
      // as "unassigned" would tell a finder the card is free when it isn't.
      if (card.student_id) return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'Not found');

      return {
        status: 200 as const,
        body: {
          serial: card.serial,
          companyName: card.company_name,
          companyType: card.company_type,
        },
      };
    } catch (error) {
      console.error('Public card lookup error:', error);
      return apiError(404, 'ERRORS.QR_CARDS.NOT_FOUND', 'Not found');
    }
  },

  profile: async ({ params }: { params: { qrToken: string }; headers: AuthHeaders }) => {
    // Rate-limit by IP so the token space can't be brute-forced.
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      await ensureAttendanceMagicColumns();
      const token = (params.qrToken || '').trim();
      // Cheap shape check before hitting the DB; tokens are 32 hex chars.
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Not found');
      }

      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne<any>(
        `SELECT s.id, s.name, s.company_id, s.branch_id,
                b.name AS branch_name, co.name AS academy_name, co.type AS company_type
         FROM students s
         JOIN branches b ON b.id = s.branch_id
         JOIN companies co ON co.id = s.company_id
         WHERE ${qrStudentMatchPublic('$1')} AND s.is_active = true`,
        [token]
      );

      // Generic 404 — never reveal whether a token is unknown vs inactive.
      // Every student's QR works by default (no activation gate).
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Not found');
      }

      // Courses the student is enrolled in (regular enrollments). Coarse
      // status only — no prices, no payment amounts.
      const courses = await query<any>(
        `SELECT e.id AS enrollment_id,
                e.payment_type AS payment_type,
                c.name AS course_name,
                cl.name AS class_name,
                e.status AS status,
                e.payment_status AS payment_status,
                e.enrollment_date AS enrollment_date
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE e.student_id = $1 AND e.company_id = $2
         ORDER BY e.enrollment_date DESC`,
        [student.id, student.company_id]
      );

      // Attendance across all sessions for the student's enrolled classes.
      // Mirrors attendance.getByStudent, scoped by the resolved company.
      const attendance = await query<any>(
        `SELECT
            s.start_date AS session_start_date,
            s.session_number AS session_number,
            cl.name AS class_name,
            r.code AS room_code,
            CASE WHEN sa.id IS NOT NULL THEN true ELSE false END AS is_present_normal,
            sub.sub_class_name AS substituted_in_class_name,
            -- When the student was actually marked in, which is not the same as
            -- when the session started: a parent wants to see the arrival time.
            COALESCE(sa.created_at, sub.sub_checked_in_at) AS checked_in_at
         FROM sessions s
         JOIN classes cl ON s.class_id = cl.id
         LEFT JOIN rooms r ON s.room_id = r.id
         LEFT JOIN session_attendance sa
           ON sa.session_id = s.id AND sa.student_id = $1 AND sa.attendance_type = 'NORMAL'
         LEFT JOIN LATERAL (
           SELECT c2.name AS sub_class_name, sub2.created_at AS sub_checked_in_at
           FROM session_attendance sub2
           JOIN sessions s2 ON s2.id = sub2.session_id
           JOIN classes c2 ON c2.id = s2.class_id
           WHERE sub2.student_id = $1
             AND sub2.attendance_type = 'SUBSTITUTION'
             AND c2.course_id = cl.course_id
             AND s2.session_number = s.session_number
             AND s.session_number IS NOT NULL
           LIMIT 1
         ) sub ON true
         WHERE s.company_id = $2
           AND s.class_id IN (
             SELECT class_id FROM enrollments
             WHERE student_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
             UNION
             SELECT class_id FROM master_class_enrollments
             WHERE student_id = $1 AND company_id = $2 AND status != 'DROPPED'
           )
         ORDER BY s.start_date DESC`,
        [student.id, student.company_id]
      );

      // Substitutions into a non-enrolled class with no matching home-class session
      // yet — surfaced so they show even before the home session is started.
      const orphanSubs = await query<any>(
        `SELECT
            s2.start_date AS session_start_date,
            s2.session_number AS session_number,
            c2.name AS class_name,
            r2.code AS room_code,
            false AS is_present_normal,
            c2.name AS substituted_in_class_name,
            sub.created_at AS checked_in_at
         FROM session_attendance sub
         JOIN sessions s2 ON s2.id = sub.session_id
         JOIN classes c2 ON c2.id = s2.class_id
         LEFT JOIN rooms r2 ON r2.id = s2.room_id
         WHERE sub.student_id = $1
           AND sub.attendance_type = 'SUBSTITUTION'
           AND s2.company_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM sessions hs
             JOIN classes hcc ON hcc.id = hs.class_id
             WHERE hcc.course_id = c2.course_id
               AND hs.session_number = s2.session_number
               AND s2.session_number IS NOT NULL
               AND hs.class_id IN (
                 SELECT class_id FROM enrollments
                 WHERE student_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
                 UNION
                 SELECT class_id FROM master_class_enrollments
                 WHERE student_id = $1 AND company_id = $2 AND status != 'DROPPED'
               )
           )`,
        [student.id, student.company_id]
      );

      // ── Payments ────────────────────────────────────────────────────────────
      // The three billing models are separate tables and a student can be on more
      // than one at once, so all three are read and merged. Every query is scoped
      // by the resolved student AND company, same as everything above.

      // MONTHLY_SUBSCRIPTION: one row per billed month.
      const monthlyRows = await query<any>(
        `SELECT m.billing_year, m.billing_month, m.amount_due, m.amount_paid,
                m.payment_status, m.due_date, m.paid_date, m.enrollment_id,
                c.name AS course_name, cl.name AS class_name
         FROM monthly_subscription_payments m
         JOIN courses c ON c.id = m.course_id
         LEFT JOIN enrollments e ON e.id = m.enrollment_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE m.student_id = $1 AND m.company_id = $2
         ORDER BY m.billing_year DESC, m.billing_month DESC`,
        [student.id, student.company_id]
      );

      // PER_SESSION: a charge per attended session, plus any prepaid bundles.
      // Tolerant of a DB where the per-session schema has not self-applied yet.
      let sessionCharges: any[] = [];
      let sessionPackages: any[] = [];
      try {
        sessionCharges = await query<any>(
          `SELECT sp.attendance_state, sp.amount_due, sp.amount_paid, sp.payment_status,
                  sp.paid_date, sp.enrollment_id,
                  ss.start_date AS session_start_date, ss.session_number,
                  c.name AS course_name, cl.name AS class_name
           FROM session_payments sp
           JOIN courses c ON c.id = sp.course_id
           LEFT JOIN sessions ss ON ss.id = sp.session_id
           LEFT JOIN classes cl ON cl.id = ss.class_id
           WHERE sp.student_id = $1 AND sp.company_id = $2
           ORDER BY ss.start_date DESC NULLS LAST`,
          [student.id, student.company_id]
        );
        sessionPackages = await query<any>(
          `SELECT pk.sessions_total, pk.sessions_used, pk.amount_due, pk.amount_paid,
                  pk.status, pk.purchased_at, pk.enrollment_id, c.name AS course_name
           FROM session_packages pk
           JOIN courses c ON c.id = pk.course_id
           WHERE pk.student_id = $1 AND pk.company_id = $2
           ORDER BY pk.purchased_at DESC`,
          [student.id, student.company_id]
        );
      } catch {
        sessionCharges = [];
        sessionPackages = [];
      }

      // ONE_TIME / INSTALLMENTS: the money lives on the enrollment itself, and
      // each instalment actually handed over is a row in enrollment_payments.
      const oneTimeRows = await query<any>(
        `SELECT e.id AS enrollment_id, e.payment_mode, e.original_price, e.discount_amount,
                e.final_price, e.down_payment, e.amount_paid, e.total_refunded,
                e.payment_status, e.enrollment_date,
                c.name AS course_name, cl.name AS class_name
         FROM enrollments e
         JOIN courses c ON c.id = e.course_id
         LEFT JOIN classes cl ON cl.id = e.class_id
         WHERE e.student_id = $1 AND e.company_id = $2 AND e.payment_type = 'ONE_TIME'
         ORDER BY e.enrollment_date DESC`,
        [student.id, student.company_id]
      );

      const instalments = await query<any>(
        `SELECT p.enrollment_id, p.amount, p.payment_date
         FROM enrollment_payments p
         JOIN enrollments e ON e.id = p.enrollment_id
         WHERE e.student_id = $1 AND e.company_id = $2
         ORDER BY p.payment_date DESC`,
        [student.id, student.company_id]
      );

      // Money given back. Shown so a parent can reconcile what they handed over
      // against what the academy kept.
      const refundRows = await query<any>(
        `SELECT r.amount, r.refund_date, r.type, c.name AS course_name
         FROM refunds r
         LEFT JOIN enrollments e ON e.id = r.enrollment_id
         LEFT JOIN courses c ON c.id = e.course_id
         WHERE r.student_id = $1 AND r.company_id = $2
         ORDER BY r.refund_date DESC`,
        [student.id, student.company_id]
      );

      // Exam AND homework grades (low-sensitivity: name, course, class, date,
      // grade). Both live in the exams table, so one query fetches them and
      // `is_homework` tells the page which list a row belongs in — an exam mark
      // and a homework mark mean different things to a parent.
      // Tolerant of DBs that haven't had the exams migrations applied yet.
      let exams: any[] = [];
      try {
        // Same feed the in-app student page uses, so a parent and the office see
        // the same list — including work that was never marked.
        exams = await query<any>(studentExamFeedSql, [student.id, student.company_id]);
      } catch {
        exams = [];
      }

      // Does this academy mark by rating? Decides whether a 5 below reads as
      // "Excellent" or stays a number.
      const ratingCompany = await isRatingCompany(student.company_id);

      // Derive status per session: SUBSTITUTED counts as present.
      const withStatus = [...attendance, ...orphanSubs]
        .map((a: any) => ({
          ...a,
          status: a.is_present_normal ? 'PRESENT' : (a.substituted_in_class_name ? 'SUBSTITUTED' : 'ABSENT'),
        }))
        .sort((a: any, b: any) => new Date(b.session_start_date).getTime() - new Date(a.session_start_date).getTime());
      const totalSessions = withStatus.length;
      const presentCount = withStatus.filter((a: any) => a.status !== 'ABSENT').length;
      const absentCount = totalSessions - presentCount;
      const attendanceRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : 0;

      // The same numbers again, split per class. One blended percentage across
      // every class a student takes tells a parent nothing about WHICH class is
      // being missed — and that is the question they open this page to answer.
      const byClassMap = new Map<string, { className: string; total: number; present: number }>();
      for (const a of withStatus) {
        const name = a.class_name || '—';
        const entry = byClassMap.get(name) || { className: name, total: 0, present: 0 };
        entry.total += 1;
        if (a.status !== 'ABSENT') entry.present += 1;
        byClassMap.set(name, entry);
      }
      const attendanceByClass = [...byClassMap.values()]
        .map(e => ({
          className: e.className,
          totalSessions: e.total,
          presentCount: e.present,
          absentCount: e.total - e.present,
          attendanceRate: e.total > 0 ? Math.round((e.present / e.total) * 100) : 0,
        }))
        // Worst attendance first: the class that needs attention leads.
        .sort((a, b) => a.attendanceRate - b.attendanceRate);

      const num = (v: any) => (v === null || v === undefined ? 0 : parseFloat(v));

      const monthly = monthlyRows.map((row: any) => ({
        courseName: row.course_name,
        className: row.class_name || null,
        billingYear: parseInt(row.billing_year, 10),
        billingMonth: parseInt(row.billing_month, 10),
        amountDue: num(row.amount_due),
        amountPaid: num(row.amount_paid),
        // Same derivation the dashboard uses, so the parent and the office never
        // disagree: overdue is resolved on read, and a 0-due month reads as paid.
        status: resolveStatus(row),
        dueDate: row.due_date,
        paidDate: row.paid_date || null,
        enrollmentId: row.enrollment_id,
      }));

      const sessions = sessionCharges.map((row: any) => ({
        courseName: row.course_name,
        className: row.class_name || null,
        sessionNumber: row.session_number === null || row.session_number === undefined
          ? null : parseInt(row.session_number, 10),
        sessionStartDate: row.session_start_date || null,
        attendanceState: row.attendance_state,
        amountDue: num(row.amount_due),
        amountPaid: num(row.amount_paid),
        status: row.payment_status,
        paidDate: row.paid_date || null,
        enrollmentId: row.enrollment_id,
      }));

      const packages = sessionPackages.map((row: any) => ({
        courseName: row.course_name,
        sessionsTotal: parseInt(row.sessions_total, 10),
        sessionsUsed: parseInt(row.sessions_used, 10),
        amountDue: num(row.amount_due),
        amountPaid: num(row.amount_paid),
        status: row.status,
        purchasedAt: row.purchased_at,
        enrollmentId: row.enrollment_id,
      }));

      const oneTime = oneTimeRows.map((row: any) => ({
        courseName: row.course_name,
        className: row.class_name || null,
        paymentMode: row.payment_mode,
        originalPrice: num(row.original_price),
        discountAmount: num(row.discount_amount),
        finalPrice: num(row.final_price),
        downPayment: num(row.down_payment),
        amountPaid: num(row.amount_paid),
        totalRefunded: num(row.total_refunded),
        remaining: Math.max(0, num(row.final_price) - num(row.amount_paid)),
        status: row.payment_status,
        enrollmentDate: row.enrollment_date,
        // The instalments actually handed over for this course.
        instalments: instalments
          .filter((p: any) => p.enrollment_id === row.enrollment_id)
          .map((p: any) => ({ amount: num(p.amount), paymentDate: p.payment_date })),
      }));

      const refunds = refundRows.map((row: any) => ({
        courseName: row.course_name || null,
        amount: num(row.amount),
        refundDate: row.refund_date,
        type: row.type,
      }));

      /**
       * The real payment state of one enrollment.
       *
       * enrollments.payment_status is only meaningful for ONE_TIME: monthly and
       * per-session enrollments deliberately leave it PENDING with amount_paid 0,
       * because their money lives in the other tables. Reading it blind told every
       * paid-up monthly parent that they owed money.
       */
      const statusFor = (enrollmentId: string, paymentType: string, fallback: string): string => {
        const rows: { due: number; paid: number; status: string }[] =
          paymentType === 'MONTHLY_SUBSCRIPTION'
            ? monthly.filter((m) => m.enrollmentId === enrollmentId)
                .map((m) => ({ due: m.amountDue, paid: m.amountPaid, status: m.status }))
            : paymentType === 'PER_SESSION'
              ? sessions.filter((s) => s.enrollmentId === enrollmentId)
                  .map((s) => ({ due: s.amountDue, paid: s.amountPaid, status: s.status }))
              : [];
        if (!rows.length) return fallback;
        if (rows.some((r) => r.status === 'OVERDUE')) return 'OVERDUE';
        const due = rows.reduce((t, r) => t + r.due, 0);
        const paid = rows.reduce((t, r) => t + r.paid, 0);
        if (paid <= 0) return due > 0 ? 'PENDING' : 'PAID';
        return paid >= due ? 'PAID' : 'PARTIAL';
      };

      // No paid-to-date total: that is a statement of account, and this page is
      // behind nothing but the QR token printed on the student's card. The one
      // number a parent scanning at the desk wants is what is still owed.
      //
      // What is still owed right now — future months a student has not reached are
      // real bills, so they count, but nothing already settled does.
      const totalOutstanding = monthly.reduce((t, m) => t + Math.max(0, m.amountDue - m.amountPaid), 0)
        + sessions.reduce((t, s) => t + Math.max(0, s.amountDue - s.amountPaid), 0)
        + oneTime.reduce((t, o) => t + o.remaining, 0);

      /**
       * The parent sees what is still OWED, not what has already been settled.
       *
       * This page is opened by scanning the card, so it is read standing at a
       * desk to answer one question — "what do I owe?" — and a list of every
       * bill ever paid buries that answer. It also narrows what the QR token
       * exposes: a settled bill is history that nobody needs to hand over.
       *
       * The unfiltered lists above still drive statusFor and the totals, so the
       * course badges and "paid to date" stay right — only the line items shown
       * are narrowed. A refunded per-session charge is not a due either.
       */
      const owed = (due: number, paid: number) => Math.max(0, due - paid) > 0.005;
      const monthlyDue = monthly.filter((m) => owed(m.amountDue, m.amountPaid));
      const sessionsDue = sessions.filter(
        (s) => s.status !== 'REFUNDED' && s.status !== 'WAIVED' && owed(s.amountDue, s.amountPaid));
      const packagesDue = packages.filter(
        (p) => p.status !== 'REFUNDED' && owed(p.amountDue, p.amountPaid));
      const oneTimeDue = oneTime.filter((o) => o.remaining > 0.005);

      return {
        status: 200 as const,
        body: {
          student: {
            name: student.name,
            branchName: student.branch_name,
            academyName: student.academy_name,
          },
          courses: courses.map((row) => ({
            courseName: row.course_name,
            className: row.class_name,
            status: row.status,
            paymentStatus: statusFor(row.enrollment_id, row.payment_type, row.payment_status),
            enrollmentDate: row.enrollment_date,
          })),
          payments: {
            monthly: monthlyDue,
            sessions: sessionsDue,
            packages: packagesDue,
            oneTime: oneTimeDue,
            refunds,
            totalOutstanding,
            totalRefunded: refunds.reduce((t, r) => t + r.amount, 0),
          },
          attendance: {
            totalSessions,
            presentCount,
            absentCount,
            attendanceRate,
            byClass: attendanceByClass,
            recent: withStatus.slice(0, 10).map((row: any) => ({
              sessionStartDate: row.session_start_date,
              sessionNumber: row.session_number === null || row.session_number === undefined
                ? null
                : parseInt(row.session_number, 10),
              className: row.class_name,
              roomCode: row.room_code,
              status: row.status,
              // When the student was actually marked in. Null for an absence —
              // there is no arrival time for someone who never arrived.
              checkedInAt: row.checked_in_at || null,
              substitutedInClassName: row.substituted_in_class_name || null,
              // Backward-compatible: present OR substituted.
              isPresent: row.status !== 'ABSENT',
            })),
          },
          // The parent reading this page should see the same words the teacher
          // picked — "Excellent", not a bare 5 — and the same gaps the office sees.
          exams: exams.map((row: any) => mapStudentExamRow(row, ratingCompany)),
        },
      };
    } catch (error) {
      console.error('Public student profile error:', error);
      return apiError(500, 'ERRORS.STUDENTS.PROFILE_FAILED', 'Failed to load profile');
    }
  },
};
