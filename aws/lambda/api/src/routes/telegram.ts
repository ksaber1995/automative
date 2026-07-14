import { randomBytes } from 'crypto';
import { ensureQrCardSchema, qrStudentMatch, codeDigits } from './qr-cards';
import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission, canAccessBranch } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

/**
 * Telegram attendance bot + auto-notifications (Phase 1, Bot API only).
 *
 * Outbound: when a student is marked present/absent we push a Telegram message
 * to the student and/or parent (whoever linked their chat). WhatsApp click-to-chat
 * stays as the manual fallback — this is the *automatic* channel.
 *
 * Inbound: a per-company bot. Students/parents link by pressing Start on a deep
 * link (we capture their chat_id). Staff link the same way, then can type a
 * student code into the bot to mark that student present in their running session.
 *
 * The webhook is processed synchronously (a lookup + attendance insert + one
 * sendMessage is well within the Lambda timeout); no SQS in Phase 1.
 */

// ── Templates ────────────────────────────────────────────────────────────────
export const TELEGRAM_TEMPLATE_TYPES = ['PRESENT', 'ABSENT', 'LINK_WELCOME', 'EXAM_RESULT', 'EXAM_ABSENT'] as const;
type TemplateType = (typeof TELEGRAM_TEMPLATE_TYPES)[number];

// Defaults are Arabic to match the academies' audience (same style as WhatsApp).
// Attendance placeholders: {studentName} {className} {courseName} {sessionNumber} {date} {academyName}
// Exam placeholders:       {studentName} {examName} {courseName} {grade} {maxGrade} {percentage} {academyName}
export const DEFAULT_TELEGRAM_TEMPLATES: Record<TemplateType, string> = {
  PRESENT:
    'رسالة من {academyName}:\n\n✅ تم تسجيل حضور {studentName} في حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}.',
  ABSENT:
    'رسالة من {academyName}:\n\n❌ تغيّب {studentName} عن حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}. يرجى الحرص على الحضور المنتظم.',
  LINK_WELCOME:
    'تم ربط حسابك على تليجرام بنجاح مع {academyName}. ستصلك إشعارات الحضور والغياب هنا تلقائياً.',
  EXAM_RESULT:
    'رسالة من {academyName}:\n\n📝 نتيجة {studentName} في امتحان {examName} ({courseName}): {grade}/{maxGrade} ({percentage}%).',
  EXAM_ABSENT:
    'رسالة من {academyName}:\n\n📝 تغيّب {studentName} عن امتحان {examName} ({courseName}).',
};

// ── Low-level helpers ────────────────────────────────────────────────────────
function genHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Replace {{key}} and {key} placeholders with values (missing → ''). */
function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{?(\w+)\}?\}/g, (_m, key) => {
    const v = vars[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Call the Telegram Bot API. Returns { ok, result?, description? }. Never throws. */
async function tg(token: string, method: string, payload: any): Promise<any> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: e instanceof Error ? e.message : 'network error' };
  }
}

async function sendMessage(token: string, chatId: number | string, text: string): Promise<any> {
  return tg(token, 'sendMessage', { chat_id: chatId, text });
}

interface TgSettings {
  company_id: string;
  bot_token: string | null;
  bot_username: string | null;
  webhook_secret: string | null;
  enabled: boolean;
  notify_on_present: boolean;
  notify_on_absent: boolean;
  notify_target: 'STUDENT' | 'PARENT' | 'BOTH';
}

async function loadSettings(companyId: string): Promise<TgSettings | null> {
  return queryOne<TgSettings>('SELECT * FROM telegram_settings WHERE company_id = $1', [companyId]);
}

async function loadTemplates(companyId: string): Promise<Record<TemplateType, string>> {
  const rows = await query('SELECT type, body FROM telegram_templates WHERE company_id = $1', [companyId]);
  const stored = new Map<string, string>(rows.map((r: any) => [r.type, r.body]));
  const out = {} as Record<TemplateType, string>;
  for (const t of TELEGRAM_TEMPLATE_TYPES) out[t] = stored.get(t) ?? DEFAULT_TELEGRAM_TEMPLATES[t];
  return out;
}

function targetRoles(target: TgSettings['notify_target']): string[] {
  if (target === 'STUDENT') return ['STUDENT'];
  if (target === 'PARENT') return ['PARENT'];
  return ['STUDENT', 'PARENT'];
}

// ── Outbound notifications (best-effort; never throw into callers) ────────────

interface SessionCtx {
  sessionId: string;
  className: string;
  courseName: string;
  sessionNumber: string;
  date: string;
  academyName: string;
}

async function loadSessionCtx(companyId: string, sessionId: string): Promise<SessionCtx | null> {
  const row = await queryOne<any>(
    `SELECT s.id, s.session_number, s.start_date,
            cl.name AS class_name, co.name AS course_name, comp.name AS academy_name
     FROM sessions s
     JOIN classes cl ON cl.id = s.class_id
     LEFT JOIN courses co ON co.id = cl.course_id
     LEFT JOIN companies comp ON comp.id = s.company_id
     WHERE s.id = $1 AND s.company_id = $2`,
    [sessionId, companyId]
  );
  if (!row) return null;
  return {
    sessionId: row.id,
    className: row.class_name || '',
    courseName: row.course_name || '',
    sessionNumber: row.session_number != null ? String(row.session_number) : '',
    date: row.start_date ? new Date(row.start_date).toLocaleDateString('en-GB') : '',
    academyName: row.academy_name || '',
  };
}

/**
 * Notify the student/parent (per settings.notify_target) of a PRESENT/ABSENT
 * fact. Idempotent via telegram_outbox UNIQUE(session_id, student_id, chat_id,
 * kind): a re-trigger for the same fact is skipped. Swallows all errors.
 */
async function notifyOne(
  settings: TgSettings,
  templates: Record<TemplateType, string>,
  ctx: SessionCtx,
  studentId: string,
  studentName: string,
  kind: 'PRESENT' | 'ABSENT'
): Promise<void> {
  try {
    const token = settings.bot_token;
    if (!token) return;
    const links = await query(
      `SELECT chat_id FROM telegram_links
       WHERE company_id = $1 AND student_id = $2 AND role = ANY($3::varchar[])`,
      [settings.company_id, studentId, targetRoles(settings.notify_target)]
    );
    if (links.length === 0) return;

    const body = renderTemplate(templates[kind], {
      studentName,
      className: ctx.className,
      courseName: ctx.courseName,
      sessionNumber: ctx.sessionNumber,
      date: ctx.date,
      academyName: ctx.academyName,
    });

    for (const link of links) {
      const chatId = link.chat_id as number;
      // Claim the (session, student, chat, kind) slot. No row back = already sent.
      const claimed = await query(
        `INSERT INTO telegram_outbox (company_id, chat_id, student_id, session_id, kind, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id, student_id, chat_id, kind) DO NOTHING
         RETURNING id`,
        [settings.company_id, chatId, studentId, ctx.sessionId, kind, body]
      );
      if (claimed.length === 0) continue;
      const outboxId = claimed[0].id;
      const resp = await sendMessage(token, chatId, body);
      if (resp?.ok) {
        await query(`UPDATE telegram_outbox SET status='SENT', sent_at=NOW(), attempts=attempts+1 WHERE id=$1`, [outboxId]);
      } else {
        await query(`UPDATE telegram_outbox SET status='FAILED', error=$2, attempts=attempts+1 WHERE id=$1`,
          [outboxId, String(resp?.description || 'send failed').slice(0, 500)]);
      }
    }
  } catch (e) {
    console.error('Telegram notifyOne error (ignored):', e);
  }
}

/** Real-time PRESENT notification for a single check-in. Best-effort. */
export async function notifyCheckin(companyId: string, sessionId: string, studentId: string): Promise<void> {
  try {
    const settings = await loadSettings(companyId);
    if (!settings?.enabled || !settings.bot_token || !settings.notify_on_present) return;
    const ctx = await loadSessionCtx(companyId, sessionId);
    if (!ctx) return;
    const stu = await queryOne<any>('SELECT first_name, last_name FROM students WHERE id = $1', [studentId]);
    if (!stu) return;
    const templates = await loadTemplates(companyId);
    await notifyOne(settings, templates, ctx, studentId, `${stu.first_name} ${stu.last_name}`.trim(), 'PRESENT');
  } catch (e) {
    console.error('notifyCheckin error (ignored):', e);
  }
}

/**
 * On session end: notify present/absent for every enrolled student (per the
 * toggles). PRESENT rows already sent at check-in are skipped by the outbox
 * unique key, so present students checked in via QR/bot aren't double-notified.
 */
export async function notifySessionAttendance(companyId: string, sessionId: string): Promise<void> {
  try {
    const settings = await loadSettings(companyId);
    if (!settings?.enabled || !settings.bot_token) return;
    if (!settings.notify_on_present && !settings.notify_on_absent) return;
    const ctx = await loadSessionCtx(companyId, sessionId);
    if (!ctx) return;
    const session = await queryOne<any>('SELECT class_id FROM sessions WHERE id = $1 AND company_id = $2', [sessionId, companyId]);
    if (!session) return;

    // Enrolled roster for this class + whether each has a present row this session.
    const roster = await query<any>(
      `SELECT st.id, st.first_name, st.last_name,
              (sa.id IS NOT NULL) AS is_present
       FROM students st
       JOIN (
         SELECT student_id FROM enrollments
         WHERE class_id = $1 AND company_id = $2 AND status NOT IN ('DROPPED','CANCELLED')
         UNION
         SELECT student_id FROM master_class_enrollments
         WHERE class_id = $1 AND company_id = $2 AND status != 'DROPPED'
       ) enr ON enr.student_id = st.id
       LEFT JOIN session_attendance sa ON sa.session_id = $3 AND sa.student_id = st.id`,
      [session.class_id, companyId, sessionId]
    );

    const templates = await loadTemplates(companyId);
    for (const r of roster) {
      const kind: 'PRESENT' | 'ABSENT' = r.is_present ? 'PRESENT' : 'ABSENT';
      if (kind === 'PRESENT' && !settings.notify_on_present) continue;
      if (kind === 'ABSENT' && !settings.notify_on_absent) continue;
      await notifyOne(settings, templates, ctx, r.id, `${r.first_name} ${r.last_name}`.trim(), kind);
    }
  } catch (e) {
    console.error('notifySessionAttendance error (ignored):', e);
  }
}

/**
 * Send each graded/absent student's exam result to their linked Telegram chats
 * (student/parent per notify_target), using the editable EXAM_RESULT /
 * EXAM_ABSENT templates. Triggered by a button on the exam page (re-sendable —
 * no dedup). Returns whether Telegram is configured and how many messages sent.
 */
export async function sendExamResultNotifications(
  companyId: string,
  examId: string
): Promise<{ configured: boolean; sent: number }> {
  const settings = await loadSettings(companyId);
  if (!settings?.enabled || !settings.bot_token) return { configured: false, sent: 0 };

  const exam = await queryOne<any>(
    `SELECT e.id, e.name, e.max_grade, co.name AS course_name
     FROM exams e LEFT JOIN courses co ON co.id = e.course_id
     WHERE e.id = $1 AND e.company_id = $2`,
    [examId, companyId]
  );
  if (!exam) return { configured: true, sent: 0 };

  const academy = await queryOne<any>('SELECT name FROM companies WHERE id = $1', [companyId]);
  const academyName = academy?.name || '';
  const templates = await loadTemplates(companyId);
  const maxGrade = exam.max_grade;

  const rows = await query<any>(
    `SELECT r.student_id, r.grade, r.is_absent, s.first_name, s.last_name
     FROM exam_results r JOIN students s ON s.id = r.student_id
     WHERE r.exam_id = $1 AND r.company_id = $2 AND (r.grade IS NOT NULL OR r.is_absent = true)`,
    [examId, companyId]
  );

  const token = settings.bot_token;
  let sent = 0;
  for (const r of rows) {
    const links = await query(
      `SELECT chat_id FROM telegram_links
       WHERE company_id = $1 AND student_id = $2 AND role = ANY($3::varchar[])`,
      [companyId, r.student_id, targetRoles(settings.notify_target)]
    );
    if (links.length === 0) continue;
    const name = `${r.first_name} ${r.last_name}`.trim();
    let body: string;
    if (r.is_absent) {
      body = renderTemplate(templates.EXAM_ABSENT, {
        studentName: name, examName: exam.name, courseName: exam.course_name || '', academyName,
      });
    } else {
      const g = parseFloat(r.grade);
      const pct = maxGrade > 0 && isFinite(g) ? Math.round((g / maxGrade) * 100) : 0;
      body = renderTemplate(templates.EXAM_RESULT, {
        studentName: name, examName: exam.name, courseName: exam.course_name || '',
        grade: r.grade, maxGrade: maxGrade != null ? String(maxGrade) : '', percentage: String(pct), academyName,
      });
    }
    for (const link of links) {
      const resp = await sendMessage(token, link.chat_id as number, body);
      if (resp?.ok) sent++;
    }
  }
  return { configured: true, sent };
}

// ── Webhook processing (inbound) ─────────────────────────────────────────────

async function replyHelp(token: string, chatId: number): Promise<void> {
  await sendMessage(token, chatId,
    'أرسل كود الطالب (رقمًا) لتسجيل الحضور في الحصة الجارية.\nSend a student code (number) to mark attendance for the running session.');
}

async function handleStart(settings: TgSettings, chatId: number, username: string | undefined, payload: string): Promise<void> {
  const token = settings.bot_token!;
  const templates = await loadTemplates(settings.company_id);
  const academy = await queryOne<any>('SELECT name FROM companies WHERE id = $1', [settings.company_id]);
  const welcome = renderTemplate(templates.LINK_WELCOME, { academyName: academy?.name || '' });

  const m = /^([SPT])_([A-Za-z0-9]+)$/.exec(payload);
  if (!m) { await replyHelp(token, chatId); return; }
  const [, prefix, tokenVal] = m;

  if (prefix === 'S' || prefix === 'P') {
    const role = prefix === 'S' ? 'STUDENT' : 'PARENT';
    await ensureQrCardSchema();   // the lookup below reads qr_cards
    const student = await queryOne<any>(
      `SELECT s.id FROM students s
       WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2 AND s.is_active = true`,
      [tokenVal, settings.company_id]
    );
    if (!student) { await sendMessage(token, chatId, '❌ رابط غير صالح / Invalid link.'); return; }
    await query(
      `INSERT INTO telegram_links (company_id, role, student_id, chat_id, telegram_username)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (company_id, role, chat_id)
       DO UPDATE SET student_id = EXCLUDED.student_id, telegram_username = EXCLUDED.telegram_username`,
      [settings.company_id, role, student.id, chatId, username || null]
    );
    await sendMessage(token, chatId, welcome);
    return;
  }

  // prefix === 'T' → staff operator
  const emp = await queryOne<any>(
    'SELECT id FROM employees WHERE telegram_link_token = $1 AND company_id = $2 AND is_active = true',
    [tokenVal, settings.company_id]
  );
  if (!emp) { await sendMessage(token, chatId, '❌ رابط غير صالح / Invalid link.'); return; }
  await query(
    `INSERT INTO telegram_links (company_id, role, employee_id, chat_id, telegram_username)
     VALUES ($1, 'STAFF', $2, $3, $4)
     ON CONFLICT (company_id, role, chat_id)
     DO UPDATE SET employee_id = EXCLUDED.employee_id, telegram_username = EXCLUDED.telegram_username`,
    [settings.company_id, emp.id, chatId, username || null]
  );
  await sendMessage(token, chatId,
    '✅ تم ربط حسابك كموظف. أرسل كود الطالب لتسجيل الحضور.\nLinked as staff. Send a student code to mark attendance.');
}

async function handleAttendanceCommand(settings: TgSettings, chatId: number, text: string): Promise<void> {
  const token = settings.bot_token!;

  // Only linked STAFF can mark attendance.
  const staff = await queryOne<any>(
    `SELECT employee_id FROM telegram_links WHERE company_id = $1 AND chat_id = $2 AND role = 'STAFF'`,
    [settings.company_id, chatId]
  );
  if (!staff) {
    await sendMessage(token, chatId, '⛔ غير مصرح. اطلب من الإدارة ربط حسابك.\nNot authorised — ask your admin to link your account.');
    return;
  }

  // Parse: "/present 5" | "/absent 5" | bare "5" (default present).
  const cmd = /^\/(present|absent)\s+(\d+)$/i.exec(text.trim());
  const bare = /^\d+$/.exec(text.trim());
  let kind: 'present' | 'absent' = 'present';
  let codeStr: string | null = null;
  if (cmd) { kind = cmd[1].toLowerCase() as 'present' | 'absent'; codeStr = cmd[2]; }
  else if (bare) { codeStr = bare[0]; }
  else { await replyHelp(token, chatId); return; }

  const code = codeDigits(codeStr!);   // pool cards print "A-100001"
  const student = await queryOne<any>(
    `SELECT id, first_name, last_name, student_code FROM students
     WHERE student_code = $1 AND company_id = $2 AND is_active = true`,
    [code, settings.company_id]
  );
  if (!student) { await sendMessage(token, chatId, `❌ لا يوجد طالب بالكود ${code}.\nNo student with code ${code}.`); return; }

  // The student's currently-running session (mirrors sessions.activeForStudent).
  const session = await queryOne<any>(
    `SELECT s.id, s.session_number, cl.name AS class_name
     FROM sessions s
     JOIN classes cl ON cl.id = s.class_id
     WHERE s.company_id = $1 AND s.end_date IS NULL AND s.started = true
       AND s.class_id IN (
         SELECT class_id FROM enrollments
         WHERE company_id = $1 AND student_id = $2 AND status NOT IN ('DROPPED','CANCELLED')
         UNION
         SELECT class_id FROM master_class_enrollments
         WHERE company_id = $1 AND student_id = $2 AND status != 'DROPPED'
       )
     ORDER BY s.start_date DESC LIMIT 1`,
    [settings.company_id, student.id]
  );
  const name = `${student.first_name} ${student.last_name}`.trim();
  if (!session) {
    await sendMessage(token, chatId, `⚠️ لا توجد حصة جارية لـ ${name} (كود ${code}).\nNo running session for ${name}.`);
    return;
  }

  if (kind === 'absent') {
    await query('DELETE FROM session_attendance WHERE session_id = $1 AND student_id = $2', [session.id, student.id]);
    await sendMessage(token, chatId, `➖ ${name} (كود ${code}) تم تعليمه غائبًا في ${session.class_name} - حصة #${session.session_number ?? ''}.`);
    return;
  }

  const inserted = await query(
    `INSERT INTO session_attendance (session_id, student_id, attendance_type)
     VALUES ($1, $2, 'NORMAL')
     ON CONFLICT (session_id, student_id) DO NOTHING
     RETURNING id`,
    [session.id, student.id]
  );
  const already = inserted.length === 0;
  await sendMessage(token, chatId,
    `${already ? 'ℹ️' : '✅'} ${name} (كود ${code}) ${already ? 'مسجّل حاضر بالفعل' : 'تم تسجيل حضوره'} في ${session.class_name} - حصة #${session.session_number ?? ''}.`);

  // Fire the parent/student PRESENT notification too (best-effort, deduped).
  if (!already) {
    const settings2 = await loadSettings(settings.company_id);
    if (settings2?.notify_on_present) {
      const ctx = await loadSessionCtx(settings.company_id, session.id);
      if (ctx) await notifyOne(settings2, await loadTemplates(settings.company_id), ctx, student.id, name, 'PRESENT');
    }
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

function settingsDto(s: TgSettings | null) {
  return {
    enabled: !!s?.enabled,
    botConfigured: !!s?.bot_token,
    botUsername: s?.bot_username ?? null,
    notifyOnPresent: s?.notify_on_present ?? true,
    notifyOnAbsent: s?.notify_on_absent ?? true,
    notifyTarget: (s?.notify_target ?? 'BOTH') as 'STUDENT' | 'PARENT' | 'BOTH',
  };
}

export const telegramRoutes = {
  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const s = await loadSettings(context.companyId);
      const templates = await loadTemplates(context.companyId);
      return { status: 200 as const, body: { ...settingsDto(s), templates } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETTINGS_FAILED', 'Failed to load Telegram settings');
    }
  },

  updateSettings: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      // Upsert toggles. Bot config is handled by setBot.
      await query(
        `INSERT INTO telegram_settings (company_id, enabled, notify_on_present, notify_on_absent, notify_target)
         VALUES ($1, COALESCE($2, false), COALESCE($3, true), COALESCE($4, true), COALESCE($5, 'BOTH'))
         ON CONFLICT (company_id) DO UPDATE SET
           enabled           = COALESCE($2, telegram_settings.enabled),
           notify_on_present = COALESCE($3, telegram_settings.notify_on_present),
           notify_on_absent  = COALESCE($4, telegram_settings.notify_on_absent),
           notify_target     = COALESCE($5, telegram_settings.notify_target),
           updated_at = NOW()`,
        [
          context.companyId,
          body?.enabled ?? null,
          body?.notifyOnPresent ?? null,
          body?.notifyOnAbsent ?? null,
          body?.notifyTarget ?? null,
        ]
      );
      const s = await loadSettings(context.companyId);
      return { status: 200 as const, body: settingsDto(s) };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETTINGS_FAILED', 'Failed to update Telegram settings');
    }
  },

  updateTemplates: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const incoming: Record<string, unknown> = body?.templates || {};
      for (const [type, value] of Object.entries(incoming)) {
        if (!TELEGRAM_TEMPLATE_TYPES.includes(type as TemplateType)) {
          return apiError(400, 'ERRORS.TELEGRAM.INVALID_TYPE', `Invalid template type: ${type}`);
        }
        if (typeof value !== 'string') {
          return apiError(400, 'ERRORS.TELEGRAM.INVALID_BODY', `Template body for ${type} must be a string`);
        }
        await query(
          `INSERT INTO telegram_templates (company_id, type, body) VALUES ($1, $2, $3)
           ON CONFLICT (company_id, type) DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
          [context.companyId, type, value]
        );
      }
      const templates = await loadTemplates(context.companyId);
      return { status: 200 as const, body: { templates } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETTINGS_FAILED', 'Failed to update Telegram templates');
    }
  },

  /** Save/replace the bot token, register the webhook, and enable the bot. */
  setBot: async ({ body, headers }: { body: { botToken: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const botToken = (body?.botToken || '').trim();
      if (!botToken) return apiError(400, 'ERRORS.TELEGRAM.TOKEN_REQUIRED', 'Bot token is required');

      // Validate the token & fetch the bot username.
      const me = await tg(botToken, 'getMe', {});
      if (!me?.ok) return apiError(400, 'ERRORS.TELEGRAM.TOKEN_INVALID', 'Bot token is invalid');
      const botUsername = me.result?.username as string;

      const apiBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
      if (!apiBase) return apiError(500, 'ERRORS.TELEGRAM.NO_API_BASE', 'Server is missing API_BASE_URL');

      const webhookSecret = genHex(16);
      const webhookUrl = `${apiBase}/api/telegram/webhook/${context.companyId}`;
      const hook = await tg(botToken, 'setWebhook', {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ['message'],
      });
      if (!hook?.ok) {
        return apiError(400, 'ERRORS.TELEGRAM.WEBHOOK_FAILED', hook?.description || 'Failed to register webhook');
      }

      await query(
        `INSERT INTO telegram_settings (company_id, bot_token, bot_username, webhook_secret, enabled)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (company_id) DO UPDATE SET
           bot_token = EXCLUDED.bot_token,
           bot_username = EXCLUDED.bot_username,
           webhook_secret = EXCLUDED.webhook_secret,
           enabled = true,
           updated_at = NOW()`,
        [context.companyId, botToken, botUsername, webhookSecret]
      );

      const s = await loadSettings(context.companyId);
      return { status: 200 as const, body: settingsDto(s) };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETUP_FAILED', 'Failed to set up the Telegram bot');
    }
  },

  /**
   * One-click enable: claim a free platform-owned bot from the pool, assign it
   * to this company, register the webhook, and brand it with the academy name.
   * The academy never creates a bot or pastes a token. If the company already
   * has a bot (e.g. pasted their own), this just (re)enables + re-registers it.
   */
  enableWithPooledBot: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const apiBase = (process.env.API_BASE_URL || '').replace(/\/$/, '');
      if (!apiBase) return apiError(500, 'ERRORS.TELEGRAM.NO_API_BASE', 'Server is missing API_BASE_URL');

      const existing = await loadSettings(context.companyId);
      let token = existing?.bot_token || null;
      let username = existing?.bot_username || null;
      let webhookSecret = existing?.webhook_secret || null;

      if (!token) {
        // Reuse a bot already assigned to this company (e.g. a prior attempt
        // claimed one but failed at setWebhook before settings were saved) so we
        // never leak a pool bot or wrongly report "none available".
        let bot = await queryOne<any>(
          `SELECT bot_token, bot_username FROM telegram_bot_pool
           WHERE assigned_company_id = $1 ORDER BY assigned_at ASC LIMIT 1`,
          [context.companyId]
        );
        if (!bot) {
          // Atomically claim the oldest free bot (concurrency-safe).
          bot = await queryOne<any>(
            `UPDATE telegram_bot_pool
               SET assigned_company_id = $1, assigned_at = NOW()
             WHERE id = (
               SELECT id FROM telegram_bot_pool
               WHERE assigned_company_id IS NULL
               ORDER BY created_at ASC
               LIMIT 1
               FOR UPDATE SKIP LOCKED
             )
             RETURNING bot_token, bot_username`,
            [context.companyId]
          );
        }
        if (!bot) {
          return apiError(409, 'ERRORS.TELEGRAM.NO_BOTS_AVAILABLE', 'No Telegram bots are available — please contact support');
        }
        token = bot.bot_token;
        username = bot.bot_username;
        webhookSecret = genHex(16);
      } else if (!webhookSecret) {
        webhookSecret = genHex(16);
      }

      const webhookUrl = `${apiBase}/api/telegram/webhook/${context.companyId}`;
      const hook = await tg(token!, 'setWebhook', { url: webhookUrl, secret_token: webhookSecret, allowed_updates: ['message'] });
      if (!hook?.ok) {
        return apiError(400, 'ERRORS.TELEGRAM.WEBHOOK_FAILED', hook?.description || 'Failed to register webhook');
      }

      // Brand the bot's display name with the academy name (best-effort —
      // setMyName is rate-limited and the bot still works if it fails).
      const company = await queryOne<any>('SELECT name FROM companies WHERE id = $1', [context.companyId]);
      if (company?.name) {
        await tg(token!, 'setMyName', { name: String(company.name).slice(0, 64) });
      }

      await query(
        `INSERT INTO telegram_settings (company_id, bot_token, bot_username, webhook_secret, enabled)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (company_id) DO UPDATE SET
           bot_token = EXCLUDED.bot_token,
           bot_username = EXCLUDED.bot_username,
           webhook_secret = EXCLUDED.webhook_secret,
           enabled = true,
           updated_at = NOW()`,
        [context.companyId, token, username, webhookSecret]
      );

      const s = await loadSettings(context.companyId);
      return { status: 200 as const, body: settingsDto(s) };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETUP_FAILED', 'Failed to enable Telegram');
    }
  },

  /**
   * Disconnect the current bot from this company: remove the webhook, release a
   * pooled bot back to the pool (so it can be reused), and clear the company's
   * bot config (notify toggles + templates are kept). Lets a teacher switch from
   * the platform bot to their own bot (then connect it via setBot).
   */
  disconnectBot: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const settings = await loadSettings(context.companyId);
      // Best-effort: stop Telegram delivering updates to us for this bot.
      if (settings?.bot_token) {
        await tg(settings.bot_token, 'deleteWebhook', {});
      }
      // Return any pooled bot assigned to this company so it's available again.
      await query(
        `UPDATE telegram_bot_pool SET assigned_company_id = NULL, assigned_at = NULL
         WHERE assigned_company_id = $1`,
        [context.companyId]
      );
      // Clear the bot config but keep notify toggles + templates.
      await query(
        `UPDATE telegram_settings
           SET bot_token = NULL, bot_username = NULL, webhook_secret = NULL,
               enabled = false, updated_at = NOW()
         WHERE company_id = $1`,
        [context.companyId]
      );
      const s = await loadSettings(context.companyId);
      return { status: 200 as const, body: settingsDto(s) };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.SETUP_FAILED', 'Failed to disconnect Telegram');
    }
  },

  /** Deep links for a student + parent to connect their Telegram. */
  getStudentLink: async ({ params, headers }: { params: { studentId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const student = await queryOne<any>(
        'SELECT id, qr_token, branch_id FROM students WHERE id = $1 AND company_id = $2',
        [params.studentId, context.companyId]
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      if (!canAccessBranch(context, student.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED', 'Access denied to this student');
      }
      let qrToken: string = student.qr_token;
      if (!qrToken) {
        qrToken = genHex(16);
        await query('UPDATE students SET qr_token = $1 WHERE id = $2', [qrToken, student.id]);
      }
      const s = await loadSettings(context.companyId);
      const bot = s?.bot_username;
      const linkedRows = await query(
        `SELECT role FROM telegram_links WHERE company_id = $1 AND student_id = $2`,
        [context.companyId, student.id]
      );
      const linkedRoles = new Set(linkedRows.map((r: any) => r.role));
      return {
        status: 200 as const,
        body: {
          botConfigured: !!bot,
          studentUrl: bot ? `https://t.me/${bot}?start=S_${qrToken}` : null,
          parentUrl: bot ? `https://t.me/${bot}?start=P_${qrToken}` : null,
          studentLinked: linkedRoles.has('STUDENT'),
          parentLinked: linkedRoles.has('PARENT'),
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.LINK_FAILED', 'Failed to build Telegram link');
    }
  },

  /** Deep link for a staff member to connect their Telegram (attendance bot). */
  getStaffLink: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const emp = await queryOne<any>(
        'SELECT id, telegram_link_token FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      let token: string = emp.telegram_link_token;
      if (!token) {
        token = genHex(16);
        await query('UPDATE employees SET telegram_link_token = $1 WHERE id = $2', [token, emp.id]);
      }
      const s = await loadSettings(context.companyId);
      const bot = s?.bot_username;
      const linked = await queryOne<any>(
        `SELECT 1 FROM telegram_links WHERE company_id = $1 AND employee_id = $2 AND role = 'STAFF'`,
        [context.companyId, emp.id]
      );
      return {
        status: 200 as const,
        body: {
          botConfigured: !!bot,
          url: bot ? `https://t.me/${bot}?start=T_${token}` : null,
          linked: !!linked,
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.TELEGRAM.LINK_FAILED', 'Failed to build Telegram link');
    }
  },

  /**
   * Telegram webhook (PUBLIC — no JWT). Auth = the secret_token Telegram echoes
   * in X-Telegram-Bot-Api-Secret-Token. Always returns 200 so Telegram doesn't
   * retry; processing errors are swallowed and logged.
   */
  webhook: async ({ params, body, headers }: { params: { companyKey: string }; body: any; headers: any }) => {
    try {
      const settings = await loadSettings(params.companyKey);
      if (!settings || !settings.enabled || !settings.bot_token) {
        return { status: 200 as const, body: { ok: true } };
      }
      const provided = headers?.['x-telegram-bot-api-secret-token'] ?? headers?.['X-Telegram-Bot-Api-Secret-Token'];
      if (!settings.webhook_secret || provided !== settings.webhook_secret) {
        return { status: 200 as const, body: { ok: true } }; // ignore forged calls
      }

      const message = body?.message;
      const chatId: number | undefined = message?.chat?.id;
      const text: string | undefined = message?.text;
      if (!chatId || typeof text !== 'string') {
        return { status: 200 as const, body: { ok: true } };
      }
      const username: string | undefined = message?.from?.username;

      if (text.startsWith('/start')) {
        const payload = text.split(/\s+/)[1] || '';
        await handleStart(settings, chatId, username, payload);
      } else {
        await handleAttendanceCommand(settings, chatId, text);
      }
      return { status: 200 as const, body: { ok: true } };
    } catch (e) {
      console.error('Telegram webhook error (ignored):', e);
      return { status: 200 as const, body: { ok: true } };
    }
  },
};
