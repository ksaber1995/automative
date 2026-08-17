import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import {
  AUTOMATIC_SMS_TYPES, DEFAULT_SMS_TEMPLATES, SMS_TYPES, SmsType,
  ensureSmsSchema, companyCanSendSms, fillTemplate, getSmsTemplate, sendSms,
} from '../services/sms/send';
import { countSegments, normaliseEgyptianMobile } from '../services/sms/phone';

type AuthHeaders = { authorization: string };

/**
 * The tenant's own SMS screens: what is switched on, what it says, sending by
 * hand, and what has been sent.
 *
 * Entitlement is not decided here — `companies.sms_activated` is sold from the
 * admin console (migration 097) and checked inside sendSms. This file is about
 * what a tenant does with an entitlement they already have.
 */

function isSmsType(value: string): value is SmsType {
  return (SMS_TYPES as readonly string[]).includes(value);
}

export const smsRoutes = {
  /**
   * GET /api/sms/status
   * Whether this tenant may send, and what they have spent this month. The UI
   * hides the whole feature on `active: false`, so this is the first call the
   * SMS screen makes.
   */
  status: async ({ headers }: { headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSmsSchema();

      const active = await companyCanSendSms(context.companyId);
      const row = await queryOne<any>(
        `SELECT c.sms_activated, c.sms_expiration,
                (SELECT COUNT(*)      FROM sms_messages m
                  WHERE m.company_id = c.id AND m.status = 'SENT'
                    AND m.created_at >= date_trunc('month', CURRENT_DATE)) AS sent_this_month,
                (SELECT COALESCE(SUM(m.segments), 0) FROM sms_messages m
                  WHERE m.company_id = c.id AND m.status = 'SENT'
                    AND m.created_at >= date_trunc('month', CURRENT_DATE)) AS segments_this_month
           FROM companies c WHERE c.id = $1`,
        [context.companyId],
      );

      return {
        status: 200 as const,
        body: {
          active,
          activated: row?.sms_activated === true,
          expiration: row?.sms_expiration ? new Date(row.sms_expiration).toISOString().slice(0, 10) : null,
          sentThisMonth: Number(row?.sent_this_month ?? 0),
          // What it actually cost: Arabic is 70 characters a segment, so this is
          // the number that matters, not the message count.
          segmentsThisMonth: Number(row?.segments_this_month ?? 0),
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.STATUS_FAILED', 'Failed to read SMS status');
    }
  },

  /**
   * GET /api/sms/settings
   * Every automatic type with its on/off state and body, defaults filled in for
   * the ones this tenant has never touched.
   */
  getSettings: async ({ headers }: { headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSmsSchema();

      const rows = await query<any>(
        'SELECT type, enabled, body FROM sms_templates WHERE company_id = $1',
        [context.companyId],
      );
      const stored = new Map<string, { enabled: boolean; body: string | null }>(
        rows.map((r) => [r.type, { enabled: r.enabled === true, body: r.body }]),
      );

      const templates = AUTOMATIC_SMS_TYPES.map((type) => {
        const s = stored.get(type);
        const body = (s?.body ?? '').trim() || DEFAULT_SMS_TEMPLATES[type];
        const { segments, unicode, length } = countSegments(body);
        return { type, enabled: s?.enabled === true, body, isDefault: !s?.body, segments, unicode, length };
      });

      return { status: 200 as const, body: { templates } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.SETTINGS_FAILED', 'Failed to read SMS settings');
    }
  },

  /**
   * PUT /api/sms/settings   { templates: [{ type, enabled?, body? }] }
   * Each teacher decides which kinds go out automatically and what they say.
   */
  updateSettings: async ({ headers, body }: {
    headers: AuthHeaders;
    body: { templates: { type: string; enabled?: boolean; body?: string | null }[] };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSmsSchema();

      for (const t of body?.templates ?? []) {
        if (!isSmsType(t.type) || t.type === 'MANUAL') {
          return apiError(400, 'ERRORS.SMS.INVALID_TYPE', `Invalid SMS type: ${t.type}`);
        }
        // Blank body means "back to the default", stored as NULL so the default
        // keeps improving with the app rather than being frozen at whatever it
        // said the day someone cleared the box.
        const text = t.body == null ? null : String(t.body).trim().slice(0, 800) || null;
        await query(
          `INSERT INTO sms_templates (company_id, type, enabled, body)
           VALUES ($1, $2, COALESCE($3, false), $4)
           ON CONFLICT (company_id, type) DO UPDATE
             SET enabled = COALESCE($3, sms_templates.enabled),
                 body    = $4,
                 updated_at = NOW()`,
          [context.companyId, t.type, t.enabled ?? null, text],
        );
      }

      return await smsRoutes.getSettings({ headers });
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.SETTINGS_UPDATE_FAILED', 'Failed to save SMS settings');
    }
  },

  /**
   * POST /api/sms/send   { studentIds[], body, toParent? }
   * The manual send. One row of the result per student, so a bad number in a
   * list of two hundred reports itself instead of losing the batch.
   */
  send: async ({ headers, body }: {
    headers: AuthHeaders;
    body: { studentIds: string[]; body: string; toParent?: boolean };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSmsSchema();

      if (!(await companyCanSendSms(context.companyId))) {
        return apiError(403, 'ERRORS.SMS.NOT_ACTIVE', 'SMS is not active for this account');
      }

      const ids = (body?.studentIds ?? []).filter(Boolean);
      const text = (body?.body ?? '').trim();
      if (!ids.length) return apiError(400, 'ERRORS.SMS.NO_RECIPIENTS', 'Choose at least one student');
      if (!text) return apiError(400, 'ERRORS.SMS.EMPTY_BODY', 'The message is empty');
      // A hand-typed blast is capped: this spends real money per recipient, and
      // an unbounded list is a slip, not a plan.
      if (ids.length > 300) return apiError(400, 'ERRORS.SMS.TOO_MANY', 'Send to at most 300 students at once');

      const students = await query<any>(
        `SELECT s.id, s.name, s.phone, s.parent_phone, s.parent_name, c.name AS academy_name
           FROM students s JOIN companies c ON c.id = s.company_id
          WHERE s.company_id = $1 AND s.id = ANY($2::uuid[])`,
        [context.companyId, ids],
      );

      const results: { studentId: string; name: string; sent: boolean; message: string }[] = [];
      for (const s of students) {
        const to = body?.toParent ? (s.parent_phone || s.phone) : (s.phone || s.parent_phone);
        const outcome = await sendSms({
          companyId: context.companyId,
          type: 'MANUAL',
          to,
          body: fillTemplate(text, {
            studentName: s.name,
            parentName: s.parent_name,
            academyName: s.academy_name,
          }),
          studentId: s.id,
          createdBy: context.userId,
          // An explicit click is its own opt-in; the daily guard is for triggers.
          allowDuplicate: true,
        });
        results.push({
          studentId: s.id,
          name: s.name,
          sent: outcome.sent,
          message: outcome.sent ? 'Sent' : outcome.message,
        });
      }

      return {
        status: 200 as const,
        body: {
          sent: results.filter((r) => r.sent).length,
          failed: results.filter((r) => !r.sent).length,
          results,
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.SEND_FAILED', 'Failed to send');
    }
  },

  /**
   * GET /api/sms/messages?limit=
   * What has been sent, newest first — including the failures, which are the
   * rows anyone actually comes here to look at.
   */
  listMessages: async ({ headers, query: q }: { headers: AuthHeaders; query?: { limit?: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSmsSchema();

      const limit = Math.min(Math.max(Number(q?.limit) || 100, 1), 500);
      const rows = await query<any>(
        `SELECT m.id, m.type, m.to_phone, m.body, m.segments, m.status, m.error,
                m.created_at, s.name AS student_name
           FROM sms_messages m
           LEFT JOIN students s ON s.id = m.student_id
          WHERE m.company_id = $1
          ORDER BY m.created_at DESC
          LIMIT ${limit}`,
        [context.companyId],
      );

      return {
        status: 200 as const,
        body: {
          messages: rows.map((r) => ({
            id: r.id,
            type: r.type,
            toPhone: r.to_phone,
            body: r.body,
            segments: Number(r.segments ?? 1),
            status: r.status,
            error: r.error ?? null,
            studentName: r.student_name ?? null,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
          })),
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.LIST_FAILED', 'Failed to list messages');
    }
  },

  /**
   * POST /api/sms/preview  { body }
   * What this will cost before it is sent. Arabic doubles the segment count for
   * the same wording, which is not obvious until the bill arrives.
   */
  preview: async ({ headers, body }: { headers: AuthHeaders; body: { body: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const { segments, unicode, length } = countSegments((body?.body ?? '').trim());
      return { status: 200 as const, body: { segments, unicode, length } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.SMS.PREVIEW_FAILED', 'Failed to preview');
    }
  },
};

/** Exported for the triggers, which need the same normalisation the routes use. */
export { normaliseEgyptianMobile, getSmsTemplate };
