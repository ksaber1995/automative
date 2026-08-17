import { query, queryOne } from '../../db/connection';
import { ensureCompanySmsColumns, smsIsActive } from '../../routes/companies';
import { getSmsProvider } from './provider';
import { countSegments, normaliseEgyptianMobile } from './phone';

/**
 * The one path every SMS takes.
 *
 * Manual sends, the absence trigger, the dues sweep and the exam-result hook all
 * come through `sendSms`, so the entitlement check, the phone normalisation, the
 * de-duplication and the audit row cannot be skipped by a caller who forgot. The
 * gateway is only ever reached from here.
 */

export const SMS_TYPES = [
  'MANUAL',
  'ABSENCE',
  'PAYMENT_DELAY',
  'EXAM_RESULTS',
] as const;

export type SmsType = (typeof SMS_TYPES)[number];

/** The kinds a tenant can have sent automatically. MANUAL is a click, not a rule. */
export const AUTOMATIC_SMS_TYPES: SmsType[] = ['ABSENCE', 'PAYMENT_DELAY', 'EXAM_RESULTS'];

/**
 * Default Arabic bodies — deliberately SHORTER than the WhatsApp equivalents.
 *
 * Arabic forces UCS-2, where a segment is 70 characters, so the WhatsApp
 * wording (three lines, a greeting and a link) would be four paid messages every
 * time. These are written to land in one or two.
 */
export const DEFAULT_SMS_TEMPLATES: Record<SmsType, string> = {
  MANUAL: '',
  ABSENCE: '{academyName}: غاب {studentName} اليوم عن حصة {className}.',
  PAYMENT_DELAY: '{academyName}: مستحق عليك {amount} {currency} عن {courseName}. برجاء السداد.',
  EXAM_RESULTS: '{academyName}: حصل {studentName} على {grade}/{maxGrade} في {examName}.',
};

let smsSchemaEnsured = false;
export async function ensureSmsSchema(): Promise<void> {
  if (smsSchemaEnsured) return;
  await ensureCompanySmsColumns();
  await query(`
    CREATE TABLE IF NOT EXISTS sms_templates (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type       VARCHAR(32) NOT NULL,
      enabled    BOOLEAN NOT NULL DEFAULT FALSE,
      body       TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, type)
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS sms_messages (
      id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      student_id UUID REFERENCES students(id) ON DELETE SET NULL,
      type       VARCHAR(32) NOT NULL,
      to_phone   VARCHAR(20) NOT NULL,
      body       TEXT NOT NULL,
      segments   SMALLINT NOT NULL DEFAULT 1,
      status     VARCHAR(16) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'FAILED')),
      provider   VARCHAR(32),
      provider_message_id VARCHAR(64),
      provider_code VARCHAR(16),
      error      TEXT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      sent_on    DATE NOT NULL DEFAULT CURRENT_DATE
    )`);
  // Tables created before sent_on existed.
  await query(`ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS sent_on DATE NOT NULL DEFAULT CURRENT_DATE`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_company_date ON sms_messages (company_id, created_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_student ON sms_messages (student_id)`);
  // A stored DATE, not created_at::date: casting timestamptz to date depends on
  // the session TimeZone, so Postgres refuses it in an index expression
  // ("functions in index expression must be marked IMMUTABLE"). A column with a
  // CURRENT_DATE default has no such problem — defaults are evaluated on insert.
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_daily_dedupe
      ON sms_messages (company_id, student_id, type, sent_on)
      WHERE student_id IS NOT NULL AND status = 'SENT' AND type <> 'MANUAL'`);
  smsSchemaEnsured = true;
}

/** May this tenant send right now — the flag AND an expiry that has not passed. */
export async function companyCanSendSms(companyId: string): Promise<boolean> {
  await ensureCompanySmsColumns();
  const row = await queryOne<any>(
    `SELECT ${smsIsActive('c')} AS ok FROM companies c WHERE c.id = $1`,
    [companyId],
  );
  return row?.ok === true;
}

/** The body and on/off state for one type, falling back to the shipped default. */
export async function getSmsTemplate(companyId: string, type: SmsType): Promise<{ enabled: boolean; body: string }> {
  await ensureSmsSchema();
  const row = await queryOne<any>(
    'SELECT enabled, body FROM sms_templates WHERE company_id = $1 AND type = $2',
    [companyId, type],
  );
  return {
    enabled: row?.enabled === true,
    body: (row?.body ?? '').trim() || DEFAULT_SMS_TEMPLATES[type],
  };
}

/** `{name}` → value. An unknown placeholder is left as-is rather than blanked. */
export function fillTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === null || v === undefined || v === '' ? whole : String(v);
  });
}

export interface SendSmsInput {
  companyId: string;
  type: SmsType;
  /** Raw, as stored — normalisation happens here. */
  to: string | null | undefined;
  body: string;
  studentId?: string | null;
  createdBy?: string | null;
  /**
   * Skip the once-per-day guard. Only the manual send sets this; every automatic
   * caller wants the guard.
   */
  allowDuplicate?: boolean;
}

export type SendSmsOutcome =
  | { sent: true; id: string }
  | { sent: false; reason: 'NOT_ENTITLED' | 'BAD_NUMBER' | 'EMPTY_BODY' | 'DUPLICATE' | 'GATEWAY'; message: string };

/**
 * Send one message and record it.
 *
 * Never throws for an expected refusal — a bad phone number in a list of two
 * hundred must not abort the other hundred and ninety-nine, so every outcome is
 * a value. Only a genuine database failure escapes.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsOutcome> {
  await ensureSmsSchema();

  const body = (input.body ?? '').trim();
  if (!body) return { sent: false, reason: 'EMPTY_BODY', message: 'The message is empty.' };

  if (!(await companyCanSendSms(input.companyId))) {
    return { sent: false, reason: 'NOT_ENTITLED', message: 'SMS is not active for this account.' };
  }

  const to = normaliseEgyptianMobile(input.to);
  if (!to) {
    return { sent: false, reason: 'BAD_NUMBER', message: 'Not a valid Egyptian mobile number.' };
  }

  // The once-a-day guard, checked before spending anything. The unique index is
  // the real enforcement — this is the cheap path that avoids paying first and
  // discovering the clash on insert.
  if (!input.allowDuplicate && input.studentId) {
    const already = await queryOne<any>(
      `SELECT 1 FROM sms_messages
        WHERE company_id = $1 AND student_id = $2 AND type = $3
          AND status = 'SENT' AND sent_on = CURRENT_DATE`,
      [input.companyId, input.studentId, input.type],
    );
    if (already) {
      return { sent: false, reason: 'DUPLICATE', message: 'Already sent to this student today.' };
    }
  }

  const { segments } = countSegments(body);
  const provider = await getSmsProvider();
  const result = await provider.send(to, body);

  const row = await queryOne<any>(
    `INSERT INTO sms_messages
       (company_id, student_id, type, to_phone, body, segments, status,
        provider, provider_message_id, provider_code, error, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.companyId, input.studentId ?? null, input.type, to, body, segments,
      result.accepted ? 'SENT' : 'FAILED',
      provider.name, result.providerMessageId, result.providerCode, result.error,
      input.createdBy ?? null,
    ],
  );

  if (!result.accepted) {
    return { sent: false, reason: 'GATEWAY', message: result.error || 'The SMS gateway refused the message.' };
  }
  // ON CONFLICT DO NOTHING means the dedupe index caught a race — two triggers
  // for the same student in the same second. The message did go out, so this is
  // reported as sent; the guard exists to stop the second SEND, and by here it
  // is too late for that.
  return { sent: true, id: row?.id ?? '' };
}
