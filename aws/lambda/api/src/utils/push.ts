import webpush from 'web-push';
import { query, queryOne } from '../db/connection';
import { getPushVapidConfig, isPushVapidConfigured, PushVapidConfig } from './secrets';

/**
 * Web-push notifications to parents, keyed by the student's QR token — see
 * docs/parent-pwa-notifications-plan.md. A parent scans the card, the public
 * page offers "enable notifications", and the subscription lands here tied to
 * that one student. From then on the app pushes on the moments a parent cares
 * about: checked in, marked absent, money recorded, a mark recorded.
 *
 * EVERYTHING here is best-effort and silent. A push is a courtesy; attendance,
 * payments and marks must never fail because a browser endpoint is gone.
 */

let vapidPromise: Promise<PushVapidConfig | null> | null = null;
async function vapid(): Promise<PushVapidConfig | null> {
  if (!vapidPromise) {
    vapidPromise = getPushVapidConfig()
      .then((c) => (isPushVapidConfigured(c) ? c : null))
      .catch((e) => {
        console.error('push: vapid config unavailable (pushes disabled):', e);
        vapidPromise = null;
        return null;
      });
  }
  return vapidPromise;
}

/** The public half of the keypair — what the browser subscribes with. */
export async function getPushPublicKey(): Promise<string | null> {
  const c = await vapid();
  return c?.publicKey ?? null;
}

let schemaPromise: Promise<void> | null = null;
export async function ensurePushSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        endpoint     TEXT NOT NULL,
        p256dh       TEXT NOT NULL,
        auth         TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        last_sent_at TIMESTAMPTZ,
        UNIQUE (endpoint)
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_push_subs_student ON push_subscriptions(student_id)`);

      // Every parent event, kept as a row as well as pushed. Two consumers: the
      // mobile app's notification feed (it has no service worker, so it reads
      // this and raises its own device notifications), and any future channel
      // (FCM) that wants the same events. Written BEFORE web-push is attempted,
      // so the feed is whole even for a student with no browser subscription.
      await query(`CREATE TABLE IF NOT EXISTS parent_notifications (
        id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        url        TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_parent_notifs_student
                     ON parent_notifications(student_id, created_at DESC)`);
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

/** The feed for one student, newest first. Same shape the push payload carries. */
export async function listParentNotifications(
  companyId: string,
  studentId: string,
  limit = 50,
): Promise<{ id: string; title: string; body: string; url: string | null; createdAt: string }[]> {
  await ensurePushSchema();
  const rows = await query<any>(
    `SELECT id, title, body, url, created_at FROM parent_notifications
      WHERE student_id = $1 AND company_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [studentId, companyId, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    url: r.url ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/**
 * Store (or re-point) one browser's subscription. A device can be handed to a
 * different family, so an endpoint that re-subscribes under a new student is
 * moved, not duplicated — the endpoint is the device, the student is whoever
 * its owner scanned last.
 */
export async function savePushSubscription(
  companyId: string,
  studentId: string,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await ensurePushSchema();
  await query(
    `INSERT INTO push_subscriptions (student_id, company_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint)
     DO UPDATE SET student_id = EXCLUDED.student_id, company_id = EXCLUDED.company_id,
                   p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [studentId, companyId, sub.endpoint, sub.p256dh, sub.auth],
  );
}

/**
 * Push one message to every device subscribed to this student. Dead endpoints
 * (404/410 — the browser unsubscribed or the profile was wiped) are deleted so
 * the list self-cleans. Never throws.
 */
export async function sendPushToStudent(
  companyId: string,
  studentId: string,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  try {
    await ensurePushSchema();

    // The durable feed row comes FIRST, unconditionally: the mobile app polls
    // this even when the family never enabled browser push, and a web-push
    // failure must not erase the event's record.
    await query(
      `INSERT INTO parent_notifications (company_id, student_id, title, body, url)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, studentId, payload.title, payload.body, payload.url ?? null],
    ).catch((e) => console.error('push: feed insert failed (ignored):', e));

    const c = await vapid();
    if (!c) return;
    const subs = await query<any>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE student_id = $1 AND company_id = $2`,
      [studentId, companyId],
    );
    if (!subs.length) return;

    // Clicking the notification lands on the student's own page.
    let url = payload.url;
    if (!url) {
      const s = await queryOne<any>('SELECT qr_token FROM students WHERE id = $1', [studentId]);
      url = s?.qr_token ? `/p/s/${s.qr_token}` : '/';
    }

    webpush.setVapidDetails(c.subject || 'mailto:support@netrofit.com', c.publicKey, c.privateKey);
    const body = JSON.stringify({ title: payload.title, body: payload.body, url });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
        await query('UPDATE push_subscriptions SET last_sent_at = NOW() WHERE id = $1', [sub.id]);
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        } else {
          console.error('push: send failed (ignored):', e?.statusCode ?? e);
        }
      }
    }
  } catch (e) {
    console.error('push: sendPushToStudent failed (ignored):', e);
  }
}

// ── Event copy ────────────────────────────────────────────────────────────────
// Arabic-first, like the tenants. One place for the wording so every trigger
// says the same thing.

/** "حصة كورس (مجموعة) مع مدرس" — the shared tail every session-ish body ends with. */
function lessonPhrase(courseName: string, className: string | null, teacherName: string | null): string {
  return `حصة ${courseName}${className ? ` (${className})` : ''}${teacherName ? ` مع ${teacherName}` : ''}`;
}

/** Present: fired at check-in, while the parent still remembers the drop-off. */
export async function pushCheckin(companyId: string, sessionId: string, studentId: string): Promise<void> {
  try {
    const ctx = await queryOne<any>(
      `SELECT st.name AS student_name, cl.name AS class_name, co.name AS course_name,
              (SELECT NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                 FROM employees e
                WHERE e.id = COALESCE(cl.instructor_id, co.instructor_id)) AS teacher_name
         FROM sessions se
         JOIN classes cl ON cl.id = se.class_id
         JOIN courses co ON co.id = cl.course_id
         CROSS JOIN (SELECT name FROM students WHERE id = $2) st
        WHERE se.id = $1`,
      [sessionId, studentId],
    );
    if (!ctx) return;
    await sendPushToStudent(companyId, studentId, {
      title: 'تسجيل حضور ✅',
      body: `${ctx.student_name} حضر ${lessonPhrase(ctx.course_name, ctx.class_name, ctx.teacher_name)} اليوم.`,
    });
  } catch (e) {
    console.error('push: pushCheckin failed (ignored):', e);
  }
}

/**
 * Absent: fired when a session ENDS (only then is "absent" a fact, not a
 * student who has not arrived yet). Same roster rules the Telegram absence
 * messages use: enrolled, still at the academy, no attendance row, and the
 * lesson ran after they joined the class.
 */
export async function pushSessionAbsences(companyId: string, sessionId: string): Promise<void> {
  try {
    const session = await queryOne<any>(
      `SELECT s.id, s.class_id, s.start_date, COALESCE(s.is_free, false) AS is_free,
              cl.name AS class_name, co.name AS course_name,
              (SELECT NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                 FROM employees e
                WHERE e.id = COALESCE(cl.instructor_id, co.instructor_id)) AS teacher_name
         FROM sessions s JOIN classes cl ON cl.id = s.class_id JOIN courses co ON co.id = cl.course_id
        WHERE s.id = $1 AND s.company_id = $2`,
      [sessionId, companyId],
    );
    // Nobody is "absent" from a free taster lesson.
    if (!session || session.is_free) return;

    const absentees = await query<any>(
      `SELECT st.id, st.name
         FROM students st
         JOIN (
           SELECT student_id FROM enrollments
            WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED', 'CANCELLED')
           UNION
           SELECT student_id FROM master_class_enrollments
            WHERE class_id = $1 AND company_id = $2 AND status <> 'DROPPED'
         ) enr ON enr.student_id = st.id
        WHERE COALESCE(st.is_active, true)
          AND NOT EXISTS (SELECT 1 FROM session_attendance sa
                           WHERE sa.session_id = $3 AND sa.student_id = st.id)
          -- A lesson from before the student joined the class is not theirs to
          -- have missed — same rule as the register (see enrollment-start.ts).
          AND COALESCE(
                (SELECT MIN(COALESCE(e2.class_joined_on, e2.enrollment_date))
                   FROM enrollments e2
                  WHERE e2.student_id = st.id AND e2.class_id = $1
                    AND e2.status NOT IN ('DROPPED', 'CANCELLED')),
                '-infinity'::date
              ) <= $4::date`,
      [session.class_id, companyId, sessionId, session.start_date],
    );
    for (const a of absentees) {
      await sendPushToStudent(companyId, a.id, {
        title: 'غياب ❌',
        body: `${a.name} تغيب عن ${lessonPhrase(session.course_name, session.class_name, session.teacher_name)} اليوم.`,
      });
    }
  } catch (e) {
    console.error('push: pushSessionAbsences failed (ignored):', e);
  }
}

/** Payment recorded: fired where every collection already converges — the receipt. */
export async function pushPayment(
  companyId: string,
  studentId: string,
  amount: number,
  courseName: string | null,
  teacherName: string | null,
  receiptToken: string | null,
): Promise<void> {
  await sendPushToStudent(companyId, studentId, {
    title: 'تم تسجيل دفعة 💰',
    body: `تم تسجيل دفعة بقيمة ${amount}${courseName ? ` — ${courseName}` : ''}${teacherName ? ` مع ${teacherName}` : ''}.`,
    url: receiptToken ? `/r/${receiptToken}` : undefined,
  });
}

/** A mark landed on the student's record — exam or homework. */
export async function pushExamResult(
  companyId: string,
  studentId: string,
  examId: string,
  examName: string,
  grade: string | number,
  maxGrade: number | null,
  isHomework: boolean,
): Promise<void> {
  try {
    // Which course, whose group: the exam's class teacher, else the course's.
    const ctx = await queryOne<any>(
      `SELECT co.name AS course_name,
              (SELECT NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                 FROM employees e
                WHERE e.id = COALESCE(cl.instructor_id, co.instructor_id)) AS teacher_name
         FROM exams ex
         JOIN courses co ON co.id = ex.course_id
         LEFT JOIN classes cl ON cl.id = ex.class_id
        WHERE ex.id = $1 AND ex.company_id = $2`,
      [examId, companyId],
    );
    const tail = ctx
      ? ` — ${ctx.course_name}${ctx.teacher_name ? ` مع ${ctx.teacher_name}` : ''}`
      : '';
    await sendPushToStudent(companyId, studentId, {
      title: isHomework ? 'تسجيل واجب 📚' : 'نتيجة امتحان 📝',
      body: `${examName}${tail}: ${grade}${maxGrade != null ? ` / ${maxGrade}` : ''}`,
    });
  } catch (e) {
    console.error('push: pushExamResult failed (ignored):', e);
  }
}

/**
 * The student was marked ABSENT on an exam, or never handed a homework in —
 * the miss a parent most wants to hear about, told the moment the teacher
 * records it. Same course/teacher tail as the mark push above.
 */
export async function pushExamAbsence(
  companyId: string,
  studentId: string,
  examId: string,
  examName: string,
  isHomework: boolean,
): Promise<void> {
  try {
    const ctx = await queryOne<any>(
      `SELECT co.name AS course_name, s.name AS student_name,
              (SELECT NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '')
                 FROM employees e
                WHERE e.id = COALESCE(cl.instructor_id, co.instructor_id)) AS teacher_name
         FROM exams ex
         JOIN courses co ON co.id = ex.course_id
         LEFT JOIN classes cl ON cl.id = ex.class_id
         LEFT JOIN students s ON s.id = $3
        WHERE ex.id = $1 AND ex.company_id = $2`,
      [examId, companyId, studentId],
    );
    const tail = ctx
      ? ` — ${ctx.course_name}${ctx.teacher_name ? ` مع ${ctx.teacher_name}` : ''}`
      : '';
    const who = ctx?.student_name || 'الطالب';
    await sendPushToStudent(companyId, studentId, {
      title: isHomework ? 'واجب غير محلول ❌' : 'غياب عن امتحان ❌',
      body: isHomework
        ? `${who} لم يحل الواجب "${examName}"${tail}.`
        : `${who} لم يحضر امتحان "${examName}"${tail}.`,
    });
  } catch (e) {
    console.error('push: pushExamAbsence failed (ignored):', e);
  }
}
