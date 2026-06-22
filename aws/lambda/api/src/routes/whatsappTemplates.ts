import { query, queryOne } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { mapThrownError, apiError } from '../utils/api-error';

/**
 * Editable WhatsApp message templates per company.
 *
 * These templates feed the *click-to-chat* flow: the frontend renders the body
 * (substituting {placeholders}) and opens https://wa.me/... so the message is
 * sent from the staff member's own WhatsApp number. The backend only stores and
 * serves the editable bodies — it does NOT send anything.
 */

export const WHATSAPP_TEMPLATE_TYPES = [
  'QR_STUDENT',
  'FOLLOWUP_PARENT',
  'ABSENCE',
  'PAYMENT_DELAY',
  'EXAM_RESULTS',
] as const;

type TemplateType = (typeof WHATSAPP_TEMPLATE_TYPES)[number];

/** Default Arabic bodies. Placeholders use {name} and are substituted client-side. */
export const DEFAULT_WHATSAPP_TEMPLATES: Record<TemplateType, string> = {
  QR_STUDENT:
    'مرحباً {studentName}، هذا رابط كود الـ QR الخاص بك في {academyName}:\n{link}',
  FOLLOWUP_PARENT:
    'رسالة من {academyName}:\n\nعزيزي ولي أمر الطالب {studentName}، يمكنك متابعة بيانات وحضور ابنك/ابنتك عبر الرابط التالي:\n{link}',
  ABSENCE:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، لقد تغيب ابنك/ابنتك {studentName} اليوم عن حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}. يرجى الحرص على الحضور المنتظم.',
  PAYMENT_DELAY:
    'رسالة من {academyName}:\n\nعزيزي {studentName}، دفعتك بقيمة {amount} {currency} لمادة {courseName} كانت مستحقة بتاريخ {dueDate}. يرجى التسديد في أقرب وقت ممكن.',
  EXAM_RESULTS:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، حصل {studentName} على {grade}/{maxGrade} ({percentage}%) في امتحان {examName} لمادة {courseName}.',
};

export const whatsappTemplatesRoutes = {
  /** Return every template type, filling in defaults for any the company hasn't customized. */
  getTemplates: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const rows = await query(
        `SELECT type, body FROM whatsapp_templates WHERE company_id = $1`,
        [context.companyId],
      );
      const stored = new Map<string, string>(rows.map((r: any) => [r.type, r.body]));
      const templates: Record<string, string> = {};
      for (const type of WHATSAPP_TEMPLATE_TYPES) {
        templates[type] = stored.get(type) ?? DEFAULT_WHATSAPP_TEMPLATES[type];
      }
      return { status: 200 as const, body: { templates } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.WHATSAPP.FETCH_TEMPLATES_FAILED', 'Failed to fetch templates');
    }
  },

  /** Upsert one or more template bodies. Unknown types are rejected. */
  updateTemplates: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const incoming: Record<string, unknown> = body?.templates || {};

      for (const [type, value] of Object.entries(incoming)) {
        if (!WHATSAPP_TEMPLATE_TYPES.includes(type as TemplateType)) {
          return apiError(400, 'ERRORS.WHATSAPP.INVALID_TYPE', `Invalid template type: ${type}`);
        }
        if (typeof value !== 'string') {
          return apiError(400, 'ERRORS.WHATSAPP.INVALID_BODY', `Template body for ${type} must be a string`);
        }
        await query(
          `INSERT INTO whatsapp_templates (company_id, type, body)
           VALUES ($1, $2, $3)
           ON CONFLICT (company_id, type)
           DO UPDATE SET body = EXCLUDED.body, updated_at = NOW()`,
          [context.companyId, type, value],
        );
      }

      // Return the full, merged set so the client can refresh its cache.
      const rows = await query(
        `SELECT type, body FROM whatsapp_templates WHERE company_id = $1`,
        [context.companyId],
      );
      const stored = new Map<string, string>(rows.map((r: any) => [r.type, r.body]));
      const templates: Record<string, string> = {};
      for (const type of WHATSAPP_TEMPLATE_TYPES) {
        templates[type] = stored.get(type) ?? DEFAULT_WHATSAPP_TEMPLATES[type];
      }
      return { status: 200 as const, body: { templates } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.WHATSAPP.UPDATE_TEMPLATES_FAILED', 'Failed to update templates');
    }
  },
};
