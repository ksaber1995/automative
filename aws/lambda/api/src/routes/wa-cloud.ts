import { insert, update, query, queryOne, deleteById } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import {
  getWaPlatformConfig,
  isWaPlatformConfigured,
  isWaPlatformSenderConfigured,
  getWaTenantCredentials,
  putWaTenantCredentials,
  deleteWaTenantCredentials,
} from '../utils/secrets';
import {
  MetaGraphError,
  exchangeCodeForToken,
  getWabaIdsForToken,
  getPhoneNumbers,
  subscribeAppToWaba,
  sendText,
  sendTemplate,
} from '../utils/meta-graph';

// ============================================================
// WhatsApp Cloud API — per-tenant connected number, auto-send settings,
// templates, two-way inbox.
//
// Tables are wa_* to avoid colliding with the existing click-to-chat
// `whatsapp_templates` (migration 044). Tenant access tokens live in Secrets
// Manager under WA_TENANT_SECRET_PREFIX, never in the DB — wa_accounts holds
// only the non-secret linkage (waba_id, phone_number_id, status).
//
// Reaching Meta needs the platform app credentials to have been pasted into the
// platform secret by hand after App Review; until then connect/send answer 501
// rather than failing obscurely against Meta. See docs/whatsapp-meta-setup.md.
// ============================================================

/** Free-form text is only allowed within 24h of the contact's last inbound message. */
const FREE_FORM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Meta rejects anything that is not E.164 digits. Egyptian numbers are stored
 * locally as 01xxxxxxxxx, which Meta reads as an invalid country code, so the
 * leading zero becomes 20. Numbers already carrying a country code are left be.
 */
function toE164(raw: string): string | null {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('20')) return digits;
  if (digits.startsWith('0')) return `20${digits.slice(1)}`;
  return digits;
}

/**
 * toE164 above, but for any tenant's country: the platform-number send serves
 * every academy, and a Saudi tenant's locally-written 05xxxxxxxx must become
 * 9665xxxxxxxx, not 205xxxxxxxx. Mirrors the frontend's toWhatsappNumber.
 */
function toE164WithDialCode(raw: string | null | undefined, dialCode: string | null | undefined): string | null {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  const dc = String(dialCode || '').replace(/[^\d]/g, '') || '20';
  if (!digits) return null;
  if (digits.startsWith(dc)) return digits;
  if (digits.startsWith('0')) return `${dc}${digits.slice(1)}`;
  return `${dc}${digits}`;
}

/**
 * Paid = anything that is not a trial and not expired (production rows carry
 * ACTIVE; the schema also allows MONTHLY/ANNUAL). The platform-number send is
 * part of what a subscription buys, so trial tenants keep click-to-chat only.
 */
async function companyHasPaidSubscription(companyId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT 1 FROM subscriptions WHERE company_id = $1 AND status NOT IN ('TRIAL', 'EXPIRED')`,
    [companyId]
  );
  return !!row;
}

/** Turn a Meta failure into the tenant's error, keeping Meta's own wording. */
function mapMetaError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof MetaGraphError) {
    return apiError(400, 'ERRORS.WA.META_REJECTED', error.message);
  }
  return mapThrownError(error, fallbackCode, fallbackMessage, 400);
}

let waSchemaEnsured = false;
export async function ensureWaSchema(): Promise<void> {
  if (waSchemaEnsured) return;
  await query(`CREATE TABLE IF NOT EXISTS wa_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    waba_id VARCHAR(64), phone_number_id VARCHAR(64) UNIQUE, display_phone_number VARCHAR(32),
    verified_name VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'NOT_CONNECTED' CHECK (status IN ('NOT_CONNECTED','CONNECTING','ACTIVE','ERROR')),
    quality_rating VARCHAR(16), connected_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE TABLE IF NOT EXISTS wa_settings (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    auto_send_on_checkin BOOLEAN NOT NULL DEFAULT false,
    auto_send_on_absence BOOLEAN NOT NULL DEFAULT false,
    absence_warning_threshold INTEGER NOT NULL DEFAULT 3,
    auto_send_absence_warning BOOLEAN NOT NULL DEFAULT false,
    crm_auto_outreach BOOLEAN NOT NULL DEFAULT false,
    crm_auto_drip BOOLEAN NOT NULL DEFAULT false,
    crm_stop_on_reply BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE TABLE IF NOT EXISTS wa_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    key VARCHAR(40) NOT NULL, meta_template_name VARCHAR(120),
    category VARCHAR(16) NOT NULL DEFAULT 'UTILITY', language VARCHAR(10) NOT NULL DEFAULT 'ar',
    body TEXT NOT NULL DEFAULT '', is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, key)
  )`);
  await query(`CREATE TABLE IF NOT EXISTS wa_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    contact_phone VARCHAR(32) NOT NULL, contact_name VARCHAR(200),
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    last_message_at TIMESTAMP WITH TIME ZONE, last_inbound_at TIMESTAMP WITH TIME ZONE,
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, contact_phone)
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wa_conv_company ON wa_conversations(company_id, last_message_at DESC)`);
  await query(`CREATE TABLE IF NOT EXISTS wa_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
    direction VARCHAR(4) NOT NULL CHECK (direction IN ('OUT','IN')),
    type VARCHAR(20) NOT NULL DEFAULT 'text', template_key VARCHAR(40), body TEXT,
    meta_message_id VARCHAR(120), status VARCHAR(16), error_message TEXT,
    student_id UUID REFERENCES students(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
    sent_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wa_msg_conversation ON wa_messages(conversation_id, created_at)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wa_msg_meta ON wa_messages(meta_message_id)`);
  // Delivery receipts for EVERY message the app's numbers send — including the
  // platform (Netrofit) number, which has no wa_accounts row. One row per
  // message (wamid), holding the furthest status it reached.
  await query(`CREATE TABLE IF NOT EXISTS wa_delivery_receipts (
    wamid VARCHAR(160) PRIMARY KEY,
    phone_number_id VARCHAR(64),
    recipient VARCHAR(32),
    status VARCHAR(16),
    error_code VARCHAR(16),
    error_detail TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_wa_receipts_recipient ON wa_delivery_receipts(recipient)`);
  waSchemaEnsured = true;
}

/**
 * Keep the FURTHEST status a message reached: Meta's sent/delivered/read events
 * arrive out of order, and a late "delivered" must not overwrite "read".
 * FAILED always wins — it is terminal and the thing the sender must know.
 */
const WA_STATUS_RANK: Record<string, number> = { SENT: 1, DELIVERED: 2, READ: 3, FAILED: 9 };

async function recordDeliveryReceipt(phoneNumberId: string, st: any): Promise<void> {
  const status = String(st.status || '').toUpperCase();
  if (!WA_STATUS_RANK[status]) return;
  const err = Array.isArray(st.errors) && st.errors[0] ? st.errors[0] : null;
  await query(
    `INSERT INTO wa_delivery_receipts (wamid, phone_number_id, recipient, status, error_code, error_detail)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (wamid) DO UPDATE SET
       status = CASE
         WHEN CASE EXCLUDED.status WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 WHEN 'FAILED' THEN 9 ELSE 0 END
            > CASE wa_delivery_receipts.status WHEN 'SENT' THEN 1 WHEN 'DELIVERED' THEN 2 WHEN 'READ' THEN 3 WHEN 'FAILED' THEN 9 ELSE 0 END
         THEN EXCLUDED.status ELSE wa_delivery_receipts.status END,
       error_code = COALESCE(EXCLUDED.error_code, wa_delivery_receipts.error_code),
       error_detail = COALESCE(EXCLUDED.error_detail, wa_delivery_receipts.error_detail),
       updated_at = NOW()`,
    [String(st.id), phoneNumberId, st.recipient_id ? String(st.recipient_id) : null, status,
     err?.code != null ? String(err.code) : null,
     err ? (err.title || '') + (err.error_data?.details ? ': ' + err.error_data.details : '') : null],
  );
}

// The canonical template keys a tenant can configure.
export const WA_TEMPLATE_KEYS = [
  'CHECKIN', 'ABSENCE', 'ABSENCE_WARNING', 'PAYMENT_DELAY', 'EXAM_RESULTS',
  'CRM_OUTREACH', 'CRM_FOLLOWUP', 'CRM_REENGAGE',
];

function mapAccount(row: any) {
  if (!row) return { status: 'NOT_CONNECTED', wabaId: null, phoneNumberId: null, displayPhoneNumber: null, verifiedName: null, qualityRating: null, connectedAt: null };
  return {
    status: row.status || 'NOT_CONNECTED',
    wabaId: row.waba_id ?? null,
    phoneNumberId: row.phone_number_id ?? null,
    displayPhoneNumber: row.display_phone_number ?? null,
    verifiedName: row.verified_name ?? null,
    qualityRating: row.quality_rating ?? null,
    connectedAt: row.connected_at ?? null,
  };
}

function mapSettings(row: any) {
  return {
    autoSendOnCheckin: row?.auto_send_on_checkin === true,
    autoSendOnAbsence: row?.auto_send_on_absence === true,
    absenceWarningThreshold: row?.absence_warning_threshold ?? 3,
    autoSendAbsenceWarning: row?.auto_send_absence_warning === true,
    crmAutoOutreach: row?.crm_auto_outreach === true,
    crmAutoDrip: row?.crm_auto_drip === true,
    crmStopOnReply: row?.crm_stop_on_reply !== false,
  };
}

function mapTemplate(row: any) {
  return {
    id: row.id, key: row.key,
    metaTemplateName: row.meta_template_name ?? null,
    category: row.category || 'UTILITY',
    language: row.language || 'ar',
    body: row.body ?? '',
    isActive: row.is_active === true,
  };
}

function mapConversation(row: any) {
  return {
    id: row.id,
    contactPhone: row.contact_phone,
    contactName: row.contact_name ?? null,
    studentId: row.student_id ?? null,
    leadId: row.lead_id ?? null,
    lastMessageAt: row.last_message_at ?? null,
    lastInboundAt: row.last_inbound_at ?? null,
    unreadCount: row.unread_count ?? 0,
  };
}

function mapMessage(row: any) {
  return {
    id: row.id,
    direction: row.direction,
    type: row.type,
    templateKey: row.template_key ?? null,
    body: row.body ?? null,
    status: row.status ?? null,
    createdAt: row.created_at,
  };
}

export const waCloudRoutes = {
  // ── Account (connected number) ──
  getAccount: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const row = await queryOne<any>('SELECT * FROM wa_accounts WHERE company_id = $1', [context.companyId]);
      return { status: 200 as const, body: mapAccount(row) };
    } catch (error) {
      console.error('WA getAccount error:', error);
      return mapThrownError(error, 'ERRORS.WA.ACCOUNT_FAILED', 'Failed to load WhatsApp account');
    }
  },

  disconnect: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can disconnect');
      }
      await ensureWaSchema();
      await query(`DELETE FROM wa_accounts WHERE company_id = $1`, [context.companyId]);
      // The token outlives the row unless it is destroyed too — a disconnected
      // tenant whose credentials linger is a live sending key for a number the
      // app no longer admits to having.
      await deleteWaTenantCredentials(context.companyId);
      return { status: 200 as const, body: { message: 'Disconnected', code: 'WA.DISCONNECTED' } };
    } catch (error) {
      console.error('WA disconnect error:', error);
      return mapThrownError(error, 'ERRORS.WA.DISCONNECT_FAILED', 'Failed to disconnect', 400);
    }
  },

  /**
   * Embedded Signup, step 1 — the public ids the browser needs to open Meta's
   * dialog. Kept server-side so they are not baked into the bundle and so an
   * unconfigured platform fails here, with an explanation, instead of inside
   * Meta's popup.
   */
  connectStart: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can connect a number');
      }
      const config = await getWaPlatformConfig();
      if (!isWaPlatformConfigured(config)) {
        return apiError(501, 'ERRORS.WA.PLATFORM_NOT_CONFIGURED', 'WhatsApp is not set up on this platform yet');
      }
      return {
        status: 200 as const,
        body: {
          appId: config.meta_app_id,
          configId: config.meta_config_id,
          graphVersion: process.env.META_GRAPH_VERSION || 'v22.0',
        },
      };
    } catch (error) {
      console.error('WA connectStart error:', error);
      return mapThrownError(error, 'ERRORS.WA.CONNECT_FAILED', 'Failed to start connection', 400);
    }
  },

  /**
   * Embedded Signup, step 2 — trade the code for the tenant's token, then store
   * it and mark the number ACTIVE.
   *
   * wabaId and phoneNumberId arrive from the browser (Meta posts them to the
   * opener) and are treated as a claim, not a fact: the WABA is checked against
   * the ones the token actually grants, so a tenant cannot name a WABA that is
   * not theirs. Where the browser missed the message, the WABA is read back from
   * the token instead.
   */
  connectComplete: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can connect a number');
      }
      await ensureWaSchema();

      const config = await getWaPlatformConfig();
      if (!isWaPlatformConfigured(config)) {
        return apiError(501, 'ERRORS.WA.PLATFORM_NOT_CONFIGURED', 'WhatsApp is not set up on this platform yet');
      }

      const token = await exchangeCodeForToken(config.meta_app_id, config.meta_app_secret, body.code);

      const grantedWabaIds = await getWabaIdsForToken(config.meta_app_id, config.meta_app_secret, token);
      if (!grantedWabaIds.length) {
        return apiError(400, 'ERRORS.WA.NO_WABA', 'That Meta account granted no WhatsApp business account');
      }
      const claimedWabaId = body.wabaId ? String(body.wabaId) : null;
      if (claimedWabaId && !grantedWabaIds.includes(claimedWabaId)) {
        return apiError(400, 'ERRORS.WA.WABA_NOT_GRANTED', 'That WhatsApp business account was not granted to this app');
      }
      const wabaId = claimedWabaId || grantedWabaIds[0];

      const numbers = await getPhoneNumbers(wabaId, token);
      if (!numbers.length) {
        return apiError(400, 'ERRORS.WA.NO_PHONE_NUMBER', 'That WhatsApp business account has no phone number yet');
      }
      const claimedPhoneId = body.phoneNumberId ? String(body.phoneNumberId) : null;
      const phone = (claimedPhoneId && numbers.find((n) => n.id === claimedPhoneId)) || numbers[0];

      // phone_number_id is how the webhook finds the tenant, so it is UNIQUE.
      // Two companies claiming one number would silently steer inbound messages
      // to whichever row was found first.
      const clash = await queryOne<any>(
        'SELECT company_id FROM wa_accounts WHERE phone_number_id = $1 AND company_id <> $2',
        [phone.id, context.companyId],
      );
      if (clash) {
        return apiError(409, 'ERRORS.WA.NUMBER_IN_USE', 'That number is already connected to another account');
      }

      // Without this Meta has nowhere to deliver this tenant's messages. Do it
      // before storing anything, so a failure leaves the tenant disconnected
      // rather than connected-but-deaf.
      await subscribeAppToWaba(wabaId, token);

      await putWaTenantCredentials(context.companyId, {
        phone_number_id: phone.id,
        waba_id: wabaId,
        access_token: token,
        display_phone_number: phone.display_phone_number,
      });

      await query(
        `INSERT INTO wa_accounts (company_id, waba_id, phone_number_id, display_phone_number,
                                  verified_name, status, quality_rating, connected_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, NOW())
         ON CONFLICT (company_id) DO UPDATE SET
           waba_id = EXCLUDED.waba_id,
           phone_number_id = EXCLUDED.phone_number_id,
           display_phone_number = EXCLUDED.display_phone_number,
           verified_name = EXCLUDED.verified_name,
           status = 'ACTIVE',
           quality_rating = EXCLUDED.quality_rating,
           connected_at = NOW(),
           updated_at = NOW()`,
        [context.companyId, wabaId, phone.id, phone.display_phone_number || null,
         phone.verified_name || null, phone.quality_rating || null],
      );

      const row = await queryOne<any>('SELECT * FROM wa_accounts WHERE company_id = $1', [context.companyId]);
      return { status: 200 as const, body: mapAccount(row) };
    } catch (error) {
      console.error('WA connectComplete error:', error);
      return mapMetaError(error, 'ERRORS.WA.CONNECT_FAILED', 'Failed to connect');
    }
  },

  // ── Settings ──
  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      let row = await queryOne<any>('SELECT * FROM wa_settings WHERE company_id = $1', [context.companyId]);
      if (!row) {
        row = await insert('wa_settings', { company_id: context.companyId });
      }
      return { status: 200 as const, body: mapSettings(row) };
    } catch (error) {
      console.error('WA getSettings error:', error);
      return mapThrownError(error, 'ERRORS.WA.SETTINGS_FAILED', 'Failed to load settings');
    }
  },

  updateSettings: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const existing = await queryOne<any>('SELECT company_id FROM wa_settings WHERE company_id = $1', [context.companyId]);
      const data: Record<string, any> = { updated_at: new Date().toISOString() };
      if (body.autoSendOnCheckin !== undefined) data.auto_send_on_checkin = body.autoSendOnCheckin === true;
      if (body.autoSendOnAbsence !== undefined) data.auto_send_on_absence = body.autoSendOnAbsence === true;
      if (body.absenceWarningThreshold !== undefined) data.absence_warning_threshold = Math.max(1, parseInt(body.absenceWarningThreshold, 10) || 3);
      if (body.autoSendAbsenceWarning !== undefined) data.auto_send_absence_warning = body.autoSendAbsenceWarning === true;
      if (body.crmAutoOutreach !== undefined) data.crm_auto_outreach = body.crmAutoOutreach === true;
      if (body.crmAutoDrip !== undefined) data.crm_auto_drip = body.crmAutoDrip === true;
      if (body.crmStopOnReply !== undefined) data.crm_stop_on_reply = body.crmStopOnReply === true;

      if (!existing) {
        await insert('wa_settings', { company_id: context.companyId, ...data });
      } else {
        // update() targets by id; wa_settings is keyed by company_id, so use a direct UPDATE.
        const sets = Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(', ');
        await query(`UPDATE wa_settings SET ${sets} WHERE company_id = $1`, [context.companyId, ...Object.values(data)]);
      }
      const row = await queryOne<any>('SELECT * FROM wa_settings WHERE company_id = $1', [context.companyId]);
      return { status: 200 as const, body: mapSettings(row) };
    } catch (error) {
      console.error('WA updateSettings error:', error);
      return mapThrownError(error, 'ERRORS.WA.SETTINGS_UPDATE_FAILED', 'Failed to update settings', 400);
    }
  },

  // ── Templates ──
  listTemplates: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const rows = await query<any>('SELECT * FROM wa_templates WHERE company_id = $1 ORDER BY key', [context.companyId]);
      return { status: 200 as const, body: rows.map(mapTemplate) };
    } catch (error) {
      console.error('WA listTemplates error:', error);
      return mapThrownError(error, 'ERRORS.WA.TEMPLATES_FAILED', 'Failed to load templates');
    }
  },

  upsertTemplate: async ({ params, body, headers }: { params: { key: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      if (!WA_TEMPLATE_KEYS.includes(params.key)) {
        return apiError(400, 'ERRORS.WA.BAD_TEMPLATE_KEY', 'Unknown template key');
      }
      const category = body?.category === 'MARKETING' ? 'MARKETING' : 'UTILITY';
      await query(
        `INSERT INTO wa_templates (company_id, key, meta_template_name, category, language, body, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (company_id, key) DO UPDATE SET
           meta_template_name = EXCLUDED.meta_template_name,
           category = EXCLUDED.category,
           language = EXCLUDED.language,
           body = EXCLUDED.body,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
        [context.companyId, params.key, body?.metaTemplateName || null, category, body?.language || 'ar', body?.body || '', body?.isActive !== false]
      );
      const row = await queryOne<any>('SELECT * FROM wa_templates WHERE company_id = $1 AND key = $2', [context.companyId, params.key]);
      return { status: 200 as const, body: mapTemplate(row) };
    } catch (error) {
      console.error('WA upsertTemplate error:', error);
      return mapThrownError(error, 'ERRORS.WA.TEMPLATE_SAVE_FAILED', 'Failed to save template', 400);
    }
  },

  /**
   * Send one message from the tenant's own number.
   *
   * Text vs template is not a preference, it is Meta's rule: outside 24 hours
   * from the contact's last inbound message only an approved template may be
   * sent. Rather than let Meta reject a free-form send with an opaque error, the
   * window is checked here first and the caller is told to use a template.
   */
  send: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const account = await queryOne<any>('SELECT status FROM wa_accounts WHERE company_id = $1', [context.companyId]);
      if (!account || account.status !== 'ACTIVE') {
        return apiError(400, 'ERRORS.WA.NOT_CONNECTED', 'Connect a WhatsApp number first');
      }

      const creds = await getWaTenantCredentials(context.companyId);
      if (!creds?.access_token || !creds?.phone_number_id) {
        // The row says ACTIVE but the token is gone — a half-finished disconnect,
        // or a secret deleted by hand. Say so rather than throwing a null deref.
        return apiError(400, 'ERRORS.WA.CREDENTIALS_MISSING', 'This number needs reconnecting');
      }

      // Recipient: an explicit number, or the student's/lead's number on file.
      let to = body.to ? String(body.to) : '';
      if (!to && body.studentId) {
        const student = await queryOne<any>(
          'SELECT parent_phone, phone FROM students WHERE id = $1 AND company_id = $2',
          [body.studentId, context.companyId],
        );
        to = student?.parent_phone || student?.phone || '';
      }
      if (!to && body.leadId) {
        const lead = await queryOne<any>('SELECT phone FROM crm_leads WHERE id = $1 AND company_id = $2',
          [body.leadId, context.companyId]);
        to = lead?.phone || '';
      }
      const e164 = toE164(to);
      if (!e164) {
        return apiError(400, 'ERRORS.WA.NO_RECIPIENT', 'No phone number to send to');
      }

      // The conversation is keyed on the normalised number, so an outbound send
      // lands in the same thread as the reply that comes back.
      let conv = await queryOne<any>(
        'SELECT id, last_inbound_at FROM wa_conversations WHERE company_id = $1 AND contact_phone = $2',
        [context.companyId, e164],
      );

      const lastInbound = conv?.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
      const withinWindow = lastInbound > 0 && Date.now() - lastInbound < FREE_FORM_WINDOW_MS;

      let result: { messageId: string | null };
      let messageBody: string;
      let messageType: string;
      let templateKey: string | null = null;

      if (body.templateKey) {
        const tpl = await queryOne<any>(
          'SELECT * FROM wa_templates WHERE company_id = $1 AND key = $2',
          [context.companyId, body.templateKey],
        );
        if (!tpl) return apiError(400, 'ERRORS.WA.BAD_TEMPLATE_KEY', 'Unknown template key');
        if (tpl.is_active === false) return apiError(400, 'ERRORS.WA.TEMPLATE_INACTIVE', 'That template is switched off');
        if (!tpl.meta_template_name) {
          // The local body is only a preview; Meta sends by approved name.
          return apiError(400, 'ERRORS.WA.TEMPLATE_NOT_APPROVED', 'That template has no approved Meta name yet');
        }
        result = await sendTemplate({
          phoneNumberId: creds.phone_number_id,
          token: creds.access_token,
          to: e164,
          templateName: tpl.meta_template_name,
          language: tpl.language || 'ar',
          bodyParams: Array.isArray(body.templateParams) ? body.templateParams.map(String) : undefined,
        });
        messageType = 'template';
        templateKey = tpl.key;
        messageBody = tpl.body || '';
      } else {
        const text = String(body.text || '').trim();
        if (!text) return apiError(400, 'ERRORS.WA.EMPTY_MESSAGE', 'Write a message first');
        if (!withinWindow) {
          return apiError(400, 'ERRORS.WA.WINDOW_CLOSED',
            'More than 24 hours since their last message — send an approved template instead');
        }
        result = await sendText({
          phoneNumberId: creds.phone_number_id,
          token: creds.access_token,
          to: e164,
          text,
        });
        messageType = 'text';
        messageBody = text;
      }

      if (!conv) {
        conv = await insert('wa_conversations', {
          company_id: context.companyId,
          contact_phone: e164,
          student_id: body.studentId || null,
          lead_id: body.leadId || null,
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        });
      } else {
        await query('UPDATE wa_conversations SET last_message_at = NOW() WHERE id = $1', [conv.id]);
      }

      // Recorded only after Meta accepted it: a row here means it was really
      // sent, so the inbox is not decorated with messages that never left.
      const row = await insert('wa_messages', {
        company_id: context.companyId,
        conversation_id: conv.id,
        direction: 'OUT',
        type: messageType,
        template_key: templateKey,
        body: messageBody,
        meta_message_id: result.messageId,
        status: 'SENT',
        student_id: body.studentId || null,
        lead_id: body.leadId || null,
        sent_by: context.userId,
      });

      return { status: 200 as const, body: mapMessage(row) };
    } catch (error) {
      console.error('WA send error:', error);
      return mapMetaError(error, 'ERRORS.WA.SEND_FAILED', 'Failed to send');
    }
  },

  // ── Inbox ──
  listConversations: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const rows = await query<any>(
        `SELECT * FROM wa_conversations WHERE company_id = $1
         ORDER BY (unread_count > 0) DESC, last_message_at DESC NULLS LAST LIMIT 200`,
        [context.companyId]
      );
      return { status: 200 as const, body: rows.map(mapConversation) };
    } catch (error) {
      console.error('WA listConversations error:', error);
      return mapThrownError(error, 'ERRORS.WA.CONVERSATIONS_FAILED', 'Failed to load conversations');
    }
  },

  getMessages: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureWaSchema();
      const conv = await queryOne<any>('SELECT id FROM wa_conversations WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!conv) return apiError(404, 'ERRORS.WA.CONVERSATION_NOT_FOUND', 'Conversation not found');
      await query(`UPDATE wa_conversations SET unread_count = 0 WHERE id = $1`, [params.id]);
      const rows = await query<any>('SELECT * FROM wa_messages WHERE conversation_id = $1 ORDER BY created_at ASC', [params.id]);
      return { status: 200 as const, body: rows.map(mapMessage) };
    } catch (error) {
      console.error('WA getMessages error:', error);
      return mapThrownError(error, 'ERRORS.WA.MESSAGES_FAILED', 'Failed to load messages');
    }
  },

  // ── Parent link from the PLATFORM number ──
  // Netrofit's own number sends the public-student-page link to a parent, so
  // a tenant gets the feature without connecting a number of their own. Sold
  // with the paid plan: trial tenants keep the click-to-chat path only.

  /**
   * GET /api/wa/parent-link — may THIS tenant use the platform send?
   * The student page builds its menu from this, so the entry never shows to a
   * trial tenant or before the platform number's token has been pasted in.
   */
  parentLinkCapability: async ({ headers }: { headers: { authorization: string } }) => {
    // Auth failures answer as auth failures — only the checks AFTER a valid
    // session are soft, because a probe must never break the page it decorates.
    let context;
    try {
      context = await extractTenantContext(headers.authorization);
    } catch (error) {
      return mapThrownError(error, 'ERRORS.AUTH.UNAUTHORIZED', 'Unauthorized', 401);
    }
    try {
      if (!(await companyHasPaidSubscription(context.companyId))) {
        return { status: 200 as const, body: { available: false, reason: 'TRIAL' as string | null } };
      }
      const config = await getWaPlatformConfig();
      if (!isWaPlatformSenderConfigured(config)) {
        return { status: 200 as const, body: { available: false, reason: 'NOT_CONFIGURED' as string | null } };
      }
      return { status: 200 as const, body: { available: true, reason: null as string | null } };
    } catch (error) {
      console.error('WA parentLinkCapability error:', error);
      return { status: 200 as const, body: { available: false, reason: 'ERROR' as string | null } };
    }
  },

  /**
   * POST /api/wa/parent-link  { studentId }
   *
   * A template send, necessarily: the parent has (usually) never messaged the
   * platform number, so there is no 24h window for free-form text. The
   * template must exist APPROVED on the platform WABA — by default
   * `netrofit_parent_link` (ar) with three body params: academy name, student
   * name, link. The secret can override name/language.
   */
  sendParentLink: async ({ body, headers }: {
    body: { studentId: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      if (!(await companyHasPaidSubscription(context.companyId))) {
        return apiError(403, 'ERRORS.WA.PAID_PLAN_ONLY', 'Sending from the Netrofit number is available on paid plans only');
      }
      const config = await getWaPlatformConfig();
      if (!isWaPlatformSenderConfigured(config)) {
        return apiError(501, 'ERRORS.WA.PLATFORM_SENDER_NOT_CONFIGURED', 'The platform WhatsApp number is not configured yet');
      }

      const student = await queryOne<any>(
        `SELECT id, name, parent_name, parent_phone, qr_token
           FROM students WHERE id = $1 AND company_id = $2`,
        [body?.studentId, context.companyId]
      );
      if (!student) return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      if (!student.qr_token) return apiError(400, 'ERRORS.WA.NO_QR_TOKEN', 'This student has no parent link yet');

      // The caller's own dial code, exactly what the click-to-chat path uses —
      // a Saudi academy's locally-written numbers must get 966, not Egypt's 20.
      const caller = await queryOne<any>('SELECT country_code FROM users WHERE id = $1', [context.userId]);
      const to = toE164WithDialCode(student.parent_phone, caller?.country_code);
      if (!to) return apiError(400, 'ERRORS.WA.NO_PARENT_PHONE', 'This student has no parent phone number');

      const company = await queryOne<any>('SELECT name FROM companies WHERE id = $1', [context.companyId]);
      const appOrigin = process.env.FRONTEND_BASE_URL || 'https://app.netrofit.com';
      const link = `${appOrigin}/p/s/${student.qr_token}`;

      const { messageId } = await sendTemplate({
        phoneNumberId: config.platform_phone_number_id!,
        token: config.platform_access_token!,
        to,
        templateName: config.parent_link_template_name || 'netrofit_parent_link',
        language: config.parent_link_template_language || 'ar',
        bodyParams: [company?.name || 'Netrofit', student.name, link],
      });

      return { status: 200 as const, body: { sent: true, messageId: messageId ?? null, to } };
    } catch (error) {
      console.error('WA sendParentLink error:', error);
      return mapMetaError(error, 'ERRORS.WA.SEND_FAILED', 'Failed to send the parent link');
    }
  },

  // ── Webhook (public, no auth) ──
  webhookVerify: async ({ query: q }: { query: any }) => {
    // Meta sends hub.mode/hub.verify_token/hub.challenge; echo the challenge on match.
    // The token comes from the platform secret, not an env var: it used to read
    // process.env.WA_WEBHOOK_VERIFY_TOKEN, which was never set by the stack, so
    // this always answered 403 and Meta could never complete the subscription.
    try {
      const config = await getWaPlatformConfig();
      const token = config?.webhook_verify_token;
      const mode = q?.['hub.mode'];
      const verify = q?.['hub.verify_token'];
      const challenge = q?.['hub.challenge'];
      if (mode === 'subscribe' && token && verify === token) {
        return { status: 200 as const, body: String(challenge ?? '') };
      }
    } catch (error) {
      console.error('WA webhookVerify error:', error);
    }
    return { status: 403 as const, body: 'forbidden' };
  },

  webhookReceive: async ({ body }: { body: any }) => {
    // Always 200 fast so Meta doesn't retry; process best-effort.
    try {
      await ensureWaSchema();
      const entries = body?.entry || [];
      for (const entry of entries) {
        for (const change of entry?.changes || []) {
          const value = change?.value;
          if (!value) continue;
          const phoneNumberId = value?.metadata?.phone_number_id;
          if (!phoneNumberId) continue;

          // Delivery receipts are recorded for EVERY number of the app — the
          // platform (Netrofit) number has no wa_accounts row, and skipping its
          // statuses is how "accepted" got mistaken for "delivered".
          for (const st of value?.statuses || []) {
            if (!st?.id || !st?.status) continue;
            await recordDeliveryReceipt(phoneNumberId, st);
          }

          const acct = await queryOne<any>('SELECT company_id FROM wa_accounts WHERE phone_number_id = $1', [phoneNumberId]);
          if (!acct) continue;
          const companyId = acct.company_id;

          // Inbound messages
          for (const msg of value?.messages || []) {
            const from = msg?.from;
            if (!from) continue;
            const profileName = value?.contacts?.[0]?.profile?.name || null;
            const text = msg?.text?.body || msg?.button?.text || `[${msg?.type || 'message'}]`;
            let conv = await queryOne<any>('SELECT id FROM wa_conversations WHERE company_id = $1 AND contact_phone = $2', [companyId, from]);
            if (!conv) {
              conv = await insert('wa_conversations', {
                company_id: companyId, contact_phone: from, contact_name: profileName,
                last_message_at: new Date().toISOString(), last_inbound_at: new Date().toISOString(), unread_count: 1,
              });
            } else {
              await query(`UPDATE wa_conversations SET last_message_at = NOW(), last_inbound_at = NOW(), unread_count = unread_count + 1, contact_name = COALESCE(contact_name, $2) WHERE id = $1`, [conv.id, profileName]);
            }
            await insert('wa_messages', {
              company_id: companyId, conversation_id: conv.id, direction: 'IN',
              type: msg?.type || 'text', body: text, meta_message_id: msg?.id || null, status: 'DELIVERED',
            });
          }

          // Delivery statuses for OUT messages
          for (const st of value?.statuses || []) {
            if (!st?.id || !st?.status) continue;
            await query(`UPDATE wa_messages SET status = $2 WHERE meta_message_id = $1`, [st.id, String(st.status).toUpperCase()]);
          }
        }
      }
    } catch (error) {
      console.error('WA webhook receive error:', error);
    }
    return { status: 200 as const, body: { received: true } };
  },
};
