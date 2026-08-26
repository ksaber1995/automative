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
    })().catch((e) => {
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
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
    const c = await vapid();
    if (!c) return;
    await ensurePushSchema();
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

/** Present: fired at check-in, while the parent still remembers the drop-off. */
export async function pushCheckin(companyId: string, sessionId: string, studentId: string): Promise<void> {
  try {
    const ctx = await queryOne<any>(
      `SELECT st.name AS student_name, cl.name AS class_name, co.name AS course_name
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
      body: `${ctx.student_name} حضر حصة ${ctx.course_name}${ctx.class_name ? ` (${ctx.class_name})` : ''} اليوم.`,
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
              cl.name AS class_name, co.name AS course_name
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
        body: `${a.name} تغيب عن حصة ${session.course_name}${session.class_name ? ` (${session.class_name})` : ''} اليوم.`,
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
  receiptToken: string | null,
): Promise<void> {
  await sendPushToStudent(companyId, studentId, {
    title: 'تم تسجيل دفعة 💰',
    body: `تم تسجيل دفعة بقيمة ${amount}${courseName ? ` — ${courseName}` : ''}.`,
    url: receiptToken ? `/r/${receiptToken}` : undefined,
  });
}

/** A mark landed on the student's record — exam or homework. */
export async function pushExamResult(
  companyId: string,
  studentId: string,
  examName: string,
  grade: string | number,
  maxGrade: number | null,
  isHomework: boolean,
): Promise<void> {
  await sendPushToStudent(companyId, studentId, {
    title: isHomework ? 'تسجيل واجب 📚' : 'نتيجة امتحان 📝',
    body: `${examName}: ${grade}${maxGrade != null ? ` / ${maxGrade}` : ''}`,
  });
}
