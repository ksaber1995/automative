import { insert, update, query, queryOne, deleteById } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// WhatsApp Cloud API — FOUNDATION (Phase 1, no Meta creds required yet).
// Per-tenant connected number, auto-send settings, templates, two-way inbox.
// Tables are wa_* to avoid colliding with the existing click-to-chat
// `whatsapp_templates` (migration 044). Tokens live in Secrets Manager, not here.
// Actual Graph API sending is stubbed until a tenant connects a number.
// ============================================================

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
  waSchemaEnsured = true;
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
      // Foundation: clears the local link. (Secrets Manager cleanup happens when Meta is wired.)
      await query(`DELETE FROM wa_accounts WHERE company_id = $1`, [context.companyId]);
      return { status: 200 as const, body: { message: 'Disconnected', code: 'WA.DISCONNECTED' } };
    } catch (error) {
      console.error('WA disconnect error:', error);
      return mapThrownError(error, 'ERRORS.WA.DISCONNECT_FAILED', 'Failed to disconnect', 400);
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

  // ── Sending (scaffold — real Graph API call added once a tenant connects) ──
  send: async ({ headers }: { body: any; headers: { authorization: string } }) => {
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
      // TODO(meta): read creds from Secrets Manager, call Graph API, insert wa_messages(OUT).
      return apiError(501, 'ERRORS.WA.SENDING_NOT_ENABLED', 'Sending will be enabled once Meta is configured');
    } catch (error) {
      console.error('WA send error:', error);
      return mapThrownError(error, 'ERRORS.WA.SEND_FAILED', 'Failed to send', 400);
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

  // ── Webhook (public, no auth) ──
  webhookVerify: async ({ query: q }: { query: any }) => {
    // Meta sends hub.mode/hub.verify_token/hub.challenge; echo the challenge on match.
    const token = process.env.WA_WEBHOOK_VERIFY_TOKEN;
    const mode = q?.['hub.mode'];
    const verify = q?.['hub.verify_token'];
    const challenge = q?.['hub.challenge'];
    if (mode === 'subscribe' && token && verify === token) {
      return { status: 200 as const, body: String(challenge ?? '') };
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
