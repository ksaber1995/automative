import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

const DEFAULT_TEMPLATES: Record<string, string> = {
  ABSENCE:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، لقد تغيب ابنك/ابنتك {studentName} اليوم عن حصة {className} ({courseName}) - الحصة رقم {sessionNumber} بتاريخ {date}. يرجى الحرص على الحضور المنتظم.',
  PAYMENT_DELAY:
    'رسالة من {academyName}:\n\nعزيزي {studentName}، دفعتك بقيمة {amount} {currency} لمادة {courseName} كانت مستحقة بتاريخ {dueDate}. يرجى التسديد في أقرب وقت ممكن.',
  ABSENCE_WARNING:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، لقد تغيب ابنك/ابنتك {studentName} عن {absenceCount} حصص متتالية في {className} ({courseName}). آخر حضور: {lastAttendedDate}. يرجى التواصل معنا لمناقشة الأمر.',
  EXAM_RESULTS:
    'رسالة من {academyName}:\n\nعزيزي {parentName}، حصل {studentName} على {grade}/{maxGrade} ({percentage}%) في امتحان {examName} لمادة {courseName}.',
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Format a local Egyptian phone number for Meta WhatsApp API (E.164 without +) */
function formatPhoneForMeta(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = '20' + cleaned.slice(1);
  }
  if (!cleaned.startsWith('20') && cleaned.length === 10) {
    cleaned = '20' + cleaned;
  }
  return cleaned;
}

export const messagingRoutes = {
  // ── Settings ───────────────────────────────────────────────────
  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      let row = await queryOne(
        `SELECT messaging_status, absence_warning_threshold,
                auto_send_absence, auto_send_payment_delay,
                auto_send_absence_warning, auto_send_exam_results
         FROM message_settings WHERE company_id = $1`,
        [context.companyId],
      );
      if (!row) {
        await insert('message_settings', { company_id: context.companyId });
        row = {
          messaging_status: 'DISABLED',
          absence_warning_threshold: 3,
          auto_send_absence: false,
          auto_send_payment_delay: false,
          auto_send_absence_warning: true,
          auto_send_exam_results: false,
        };
      }
      return {
        status: 200 as const,
        body: {
          messagingStatus: row.messaging_status,
          absenceWarningThreshold: row.absence_warning_threshold,
          autoSendAbsence: row.auto_send_absence,
          autoSendPaymentDelay: row.auto_send_payment_delay,
          autoSendAbsenceWarning: row.auto_send_absence_warning,
          autoSendExamResults: row.auto_send_exam_results,
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.FETCH_SETTINGS_FAILED', 'Failed to fetch messaging settings');
    }
  },

  updateSettings: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const existing = await queryOne(
        `SELECT id FROM message_settings WHERE company_id = $1`,
        [context.companyId],
      );
      if (!existing) {
        await insert('message_settings', { company_id: context.companyId });
      }
      const updates: Record<string, any> = {};
      if (body.absenceWarningThreshold !== undefined)
        updates.absence_warning_threshold = body.absenceWarningThreshold;
      if (body.autoSendAbsence !== undefined)
        updates.auto_send_absence = body.autoSendAbsence;
      if (body.autoSendPaymentDelay !== undefined)
        updates.auto_send_payment_delay = body.autoSendPaymentDelay;
      if (body.autoSendAbsenceWarning !== undefined)
        updates.auto_send_absence_warning = body.autoSendAbsenceWarning;
      if (body.autoSendExamResults !== undefined)
        updates.auto_send_exam_results = body.autoSendExamResults;

      if (Object.keys(updates).length > 0) {
        const setClauses = Object.keys(updates)
          .map((k, i) => `${k} = $${i + 2}`)
          .join(', ');
        await query(
          `UPDATE message_settings SET ${setClauses}, updated_at = NOW() WHERE company_id = $1`,
          [context.companyId, ...Object.values(updates)],
        );
      }
      return { status: 200 as const, body: { message: 'Settings updated' } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.UPDATE_SETTINGS_FAILED', 'Failed to update settings');
    }
  },

  requestActivation: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const existing = await queryOne(
        `SELECT messaging_status FROM message_settings WHERE company_id = $1`,
        [context.companyId],
      );
      if (!existing) {
        await insert('message_settings', {
          company_id: context.companyId,
          messaging_status: 'PENDING',
        });
        return { status: 200 as const, body: { messagingStatus: 'PENDING' } };
      }
      const status = existing.messaging_status;
      if (status === 'ACTIVE') {
        return apiError(400, 'ERRORS.MESSAGING.ALREADY_ACTIVE', 'Messaging is already active');
      }
      if (status === 'PENDING') {
        return apiError(400, 'ERRORS.MESSAGING.ALREADY_PENDING', 'Activation request already pending');
      }
      await query(
        `UPDATE message_settings SET messaging_status = 'PENDING', updated_at = NOW() WHERE company_id = $1`,
        [context.companyId],
      );
      return { status: 200 as const, body: { messagingStatus: 'PENDING' } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.ACTIVATION_FAILED', 'Failed to request activation');
    }
  },

  // ── Quota ──────────────────────────────────────────────────────
  getQuota: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const month = currentMonth();
      const countRow = await queryOne(
        `SELECT COUNT(*) as cnt FROM students WHERE company_id = $1 AND qr_activated = true`,
        [context.companyId],
      );
      const activatedStudents = parseInt(countRow?.cnt || '0', 10);
      const quotaLimit = activatedStudents * 3;

      let quotaRow = await queryOne(
        `SELECT messages_sent, quota_limit FROM messaging_quota WHERE company_id = $1 AND month = $2`,
        [context.companyId, month],
      );
      if (!quotaRow) {
        await insert('messaging_quota', {
          company_id: context.companyId,
          month,
          messages_sent: 0,
          quota_limit: quotaLimit,
        });
        quotaRow = { messages_sent: 0, quota_limit: quotaLimit };
      } else if (quotaRow.quota_limit !== quotaLimit) {
        await query(
          `UPDATE messaging_quota SET quota_limit = $3, updated_at = NOW() WHERE company_id = $1 AND month = $2`,
          [context.companyId, month, quotaLimit],
        );
        quotaRow.quota_limit = quotaLimit;
      }

      return {
        status: 200 as const,
        body: { month, messagesSent: quotaRow.messages_sent, quotaLimit: quotaRow.quota_limit, activatedStudents },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.QUOTA_FAILED', 'Failed to fetch quota');
    }
  },

  // ── Send ───────────────────────────────────────────────────────
  send: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { type, studentId, variables } = body;

      const VALID_TYPES = ['ABSENCE', 'PAYMENT_DELAY', 'ABSENCE_WARNING', 'EXAM_RESULTS'];
      if (!type || !VALID_TYPES.includes(type)) {
        return apiError(400, 'ERRORS.MESSAGING.INVALID_TYPE', 'Invalid message type');
      }

      const settings = await queryOne(
        `SELECT messaging_status FROM message_settings WHERE company_id = $1`,
        [context.companyId],
      );
      if (!settings || settings.messaging_status !== 'ACTIVE') {
        return apiError(403, 'ERRORS.MESSAGING.NOT_ACTIVE', 'Messaging is not active');
      }

      const student = await queryOne(
        `SELECT s.id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, s.qr_activated,
                c.name as company_name
         FROM students s JOIN companies c ON c.id = s.company_id
         WHERE s.id = $1 AND s.company_id = $2`,
        [studentId, context.companyId],
      );
      if (!student) return apiError(400, 'ERRORS.MESSAGING.STUDENT_NOT_FOUND', 'Student not found');
      if (!student.qr_activated) return apiError(400, 'ERRORS.MESSAGING.NOT_ACTIVATED', 'Student has not activated QR');

      const isParentMsg = type !== 'PAYMENT_DELAY';
      const recipientPhone = isParentMsg ? student.parent_phone : student.phone;
      const recipientName = isParentMsg
        ? (student.parent_name || `${student.first_name} ${student.last_name}`)
        : `${student.first_name} ${student.last_name}`;
      if (!recipientPhone) return apiError(400, 'ERRORS.MESSAGING.NO_PHONE', 'Recipient phone is missing');

      // 24h cooldown
      const recent = await queryOne(
        `SELECT id FROM message_log
         WHERE company_id = $1 AND student_id = $2 AND type = $3
           AND created_at > NOW() - INTERVAL '24 hours' AND status != 'FAILED'`,
        [context.companyId, studentId, type],
      );
      if (recent) return apiError(429, 'ERRORS.MESSAGING.COOLDOWN', 'Already sent in last 24h');

      // Quota
      const month = currentMonth();
      let quotaRow = await queryOne(
        `SELECT messages_sent, quota_limit FROM messaging_quota WHERE company_id = $1 AND month = $2`,
        [context.companyId, month],
      );
      if (!quotaRow) {
        const cnt = await queryOne(`SELECT COUNT(*) as cnt FROM students WHERE company_id = $1 AND qr_activated = true`, [context.companyId]);
        const limit = parseInt(cnt?.cnt || '0', 10) * 3;
        await insert('messaging_quota', { company_id: context.companyId, month, messages_sent: 0, quota_limit: limit });
        quotaRow = { messages_sent: 0, quota_limit: limit };
      }
      if (quotaRow.messages_sent >= quotaRow.quota_limit) {
        return apiError(429, 'ERRORS.MESSAGING.QUOTA_EXCEEDED', 'Monthly quota exceeded');
      }

      // Template (fixed, not editable)
      const templateBody = DEFAULT_TEMPLATES[type];
      const allVars: Record<string, string> = {
        academyName: student.company_name || '',
        studentName: `${student.first_name} ${student.last_name}`,
        parentName: student.parent_name || `${student.first_name} ${student.last_name}`,
        ...(variables || {}),
      };
      const renderedBody = templateBody.replace(/\{(\w+)\}/g, (_: string, key: string) => allVars[key] || `{${key}}`);
      const formattedPhone = formatPhoneForMeta(recipientPhone);

      // Log
      const logRow = await queryOne(
        `INSERT INTO message_log (company_id, type, recipient_phone, recipient_name, student_id, body, status, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'SENT', NOW()) RETURNING id`,
        [context.companyId, type, formattedPhone, recipientName, studentId, renderedBody],
      );
      await query(
        `UPDATE messaging_quota SET messages_sent = messages_sent + 1, updated_at = NOW() WHERE company_id = $1 AND month = $2`,
        [context.companyId, month],
      );

      // TODO: Actually send via Meta WhatsApp API when credentials are configured

      return { status: 200 as const, body: { message: 'Message sent', logId: logRow?.id || '' } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.SEND_FAILED', 'Failed to send message');
    }
  },

  sendBulk: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const { type, studentIds, variables } = body;

      const VALID_TYPES = ['ABSENCE', 'PAYMENT_DELAY', 'ABSENCE_WARNING', 'EXAM_RESULTS'];
      if (!type || !VALID_TYPES.includes(type)) {
        return apiError(400, 'ERRORS.MESSAGING.INVALID_TYPE', 'Invalid message type');
      }
      if (!Array.isArray(studentIds) || studentIds.length === 0) {
        return apiError(400, 'ERRORS.MESSAGING.INVALID_STUDENTS', 'studentIds must be a non-empty array');
      }

      const settings = await queryOne(
        `SELECT messaging_status FROM message_settings WHERE company_id = $1`,
        [context.companyId],
      );
      if (!settings || settings.messaging_status !== 'ACTIVE') {
        return apiError(403, 'ERRORS.MESSAGING.NOT_ACTIVE', 'Messaging is not active');
      }

      let sent = 0, skipped = 0, failed = 0;
      const month = currentMonth();

      for (const studentId of studentIds) {
        try {
          const student = await queryOne(
            `SELECT s.id, s.first_name, s.last_name, s.phone, s.parent_name, s.parent_phone, s.qr_activated,
                    c.name as company_name
             FROM students s JOIN companies c ON c.id = s.company_id
             WHERE s.id = $1 AND s.company_id = $2`,
            [studentId, context.companyId],
          );
          if (!student || !student.qr_activated) { skipped++; continue; }

          const isParentMsg = type !== 'PAYMENT_DELAY';
          const recipientPhone = isParentMsg ? student.parent_phone : student.phone;
          if (!recipientPhone) { skipped++; continue; }

          const recent = await queryOne(
            `SELECT id FROM message_log WHERE company_id = $1 AND student_id = $2 AND type = $3
               AND created_at > NOW() - INTERVAL '24 hours' AND status != 'FAILED'`,
            [context.companyId, studentId, type],
          );
          if (recent) { skipped++; continue; }

          const quotaRow = await queryOne(
            `SELECT messages_sent, quota_limit FROM messaging_quota WHERE company_id = $1 AND month = $2`,
            [context.companyId, month],
          );
          if (quotaRow && quotaRow.messages_sent >= quotaRow.quota_limit) { skipped++; continue; }

          const recipientName = isParentMsg
            ? (student.parent_name || `${student.first_name} ${student.last_name}`)
            : `${student.first_name} ${student.last_name}`;
          const templateBody = DEFAULT_TEMPLATES[type];
          const allVars: Record<string, string> = {
            academyName: student.company_name || '',
            studentName: `${student.first_name} ${student.last_name}`,
            parentName: student.parent_name || `${student.first_name} ${student.last_name}`,
            ...(variables || {}),
          };
          const renderedBody = templateBody.replace(/\{(\w+)\}/g, (_: string, key: string) => allVars[key] || `{${key}}`);
          const formattedPhone = formatPhoneForMeta(recipientPhone);

          await query(
            `INSERT INTO message_log (company_id, type, recipient_phone, recipient_name, student_id, body, status, sent_at)
             VALUES ($1, $2, $3, $4, $5, $6, 'SENT', NOW())`,
            [context.companyId, type, formattedPhone, recipientName, studentId, renderedBody],
          );
          await query(
            `UPDATE messaging_quota SET messages_sent = messages_sent + 1, updated_at = NOW() WHERE company_id = $1 AND month = $2`,
            [context.companyId, month],
          );
          sent++;
        } catch {
          failed++;
        }
      }
      return { status: 200 as const, body: { sent, skipped, failed } };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.BULK_SEND_FAILED', 'Failed to send bulk messages');
    }
  },

  // ── Log ────────────────────────────────────────────────────────
  listLog: async ({ headers, query: qp }: { headers: { authorization: string }; query?: any }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const filters: string[] = ['company_id = $1'];
      const values: any[] = [context.companyId];
      let idx = 2;

      if (qp?.type) { filters.push(`type = $${idx}`); values.push(qp.type); idx++; }
      if (qp?.status) { filters.push(`status = $${idx}`); values.push(qp.status); idx++; }

      const where = filters.join(' AND ');
      const limit = Math.min(qp?.limit || 50, 100);
      const offset = qp?.offset || 0;

      const countRow = await queryOne(`SELECT COUNT(*) as cnt FROM message_log WHERE ${where}`, values);
      const rows = await query(
        `SELECT id, type, recipient_phone, recipient_name, student_id, body, status, sent_at, created_at
         FROM message_log WHERE ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      );

      return {
        status: 200 as const,
        body: {
          items: rows.map((r: any) => ({
            id: r.id, type: r.type, recipientPhone: r.recipient_phone, recipientName: r.recipient_name,
            studentId: r.student_id, body: r.body, status: r.status, sentAt: r.sent_at, createdAt: r.created_at,
          })),
          total: parseInt(countRow?.cnt || '0', 10),
        },
      };
    } catch (e) {
      return mapThrownError(e, 'ERRORS.MESSAGING.LIST_LOG_FAILED', 'Failed to list message log');
    }
  },
};
