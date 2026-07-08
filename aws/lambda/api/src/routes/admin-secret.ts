import { randomInt } from 'crypto';
import { query, queryOne } from '../db/connection';
import { ensureOfflineLicenseTable } from '../utils/ensure-offline-license';

// Human-friendly, unambiguous key alphabet (no 0/O/1/I).
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateLicenseKey(tier: 'TEACHER' | 'ACADEMY'): string {
  const prefix = tier === 'ACADEMY' ? 'ACAD' : 'TCHR';
  const group = () =>
    Array.from({ length: 4 }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join('');
  return `${prefix}-${group()}-${group()}-${group()}`;
}

function mapLicenseRow(r: any) {
  return {
    id: r.id,
    licenseKey: r.license_key,
    tier: r.tier,
    label: r.label ?? null,
    name: r.name ?? null,
    phone: r.phone ?? null,
    notes: r.notes ?? null,
    deviceId: r.device_id ?? null,
    trialStartedAt: r.trial_started_at ? new Date(r.trial_started_at).toISOString() : null,
    trialEndsAt: r.trial_ends_at ? new Date(r.trial_ends_at).toISOString() : null,
    activated: !!r.activated,
    activationEndsAt: r.activation_ends_at ? new Date(r.activation_ends_at).toISOString() : null,
    revoked: !!r.revoked,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/**
 * Intentionally-obscure, unauthenticated read-only endpoint for the owner's
 * local admin console. Returns one cross-tenant row per company: subscription
 * "type" (status), price, employee/branch counts, and start/end dates. No auth —
 * the obscure path is the only gate, and the payload is aggregate numbers +
 * company names (no credentials, emails, or phones), which the owner has
 * accepted as safe to expose. Read-only: a single SELECT, no writes.
 */
const SUBSCRIPTIONS_SQL = `
  SELECT
    c.id                                                       AS company_id,
    c.name                                                     AS company_name,
    c.is_active                                                AS company_active,
    c.currency                                                 AS currency,
    c.created_at                                               AS company_created_at,
    c.type                                                     AS company_type,
    NULLIF(CONCAT('+', u.country_code, u.phone), '+')          AS mobile,
    u.email                                                    AS owner_email,
    s.status                                                   AS subscription_type,
    s.price                                                    AS price,
    COALESCE(s.subscription_start_date, s.trial_start_date)    AS start_date,
    COALESCE(s.subscription_end_date,   s.trial_end_date)      AS end_date,
    (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
    (SELECT COUNT(*) FROM branches  b WHERE b.company_id = c.id) AS branch_count,
    (SELECT COUNT(*) FROM students  st WHERE st.company_id = c.id) AS student_count,
    (SELECT COUNT(*) FROM courses   co WHERE co.company_id = c.id) AS course_count,
    (SELECT COUNT(*) FROM students st WHERE st.company_id = c.id AND st.qr_activated) AS qr_activated_count,
    (SELECT COALESCE(SUM(st.qr_price),0) FROM students st WHERE st.company_id = c.id AND st.qr_activated) AS qr_total_cost,
    (SELECT COALESCE(SUM(st.qr_price),0) FROM students st WHERE st.company_id = c.id AND st.qr_activated AND NOT st.qr_paid) AS qr_unpaid_cost
  FROM companies c
  LEFT JOIN subscriptions s ON s.company_id = c.id
  LEFT JOIN users u ON u.id = c.created_by
  ORDER BY c.created_at DESC
`;

function toIso(value: any): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export const adminSecretRoutes = {
  getSubscriptions: async () => {
    try {
      const rows = await query<any>(SUBSCRIPTIONS_SQL);
      const body = rows.map((r) => ({
        company_id: r.company_id,
        company_name: r.company_name,
        company_active: r.company_active == null ? null : !!r.company_active,
        currency: r.currency ?? null,
        company_created_at: toIso(r.company_created_at),
        company_type: r.company_type ?? null,
        mobile: r.mobile ?? null,
        owner_email: r.owner_email ?? null,
        subscription_type: r.subscription_type ?? null,
        price: r.price == null ? null : Number(r.price),
        start_date: toIso(r.start_date),
        end_date: toIso(r.end_date),
        employee_count: Number(r.employee_count ?? 0),
        branch_count: Number(r.branch_count ?? 0),
        student_count: Number(r.student_count ?? 0),
        course_count: Number(r.course_count ?? 0),
        qr_activated_count: Number(r.qr_activated_count ?? 0),
        qr_total_cost: Number(r.qr_total_cost ?? 0),
        qr_unpaid_cost: Number(r.qr_unpaid_cost ?? 0),
      }));
      return { status: 200 as const, body };
    } catch (error: any) {
      console.error('karim-admin-secret query failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Query failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/extend
   * Extend the subscription by N months. Added onto the current end date, or
   * from today if the subscription has already lapsed. Updates whichever end
   * column currently drives the displayed end date (subscription_end_date when
   * ACTIVE / already set, otherwise trial_end_date) so the table stays consistent.
   */
  extendSubscription: async ({ params, body }: { params: { companyId: string }; body: { months: number } }) => {
    try {
      const months = Number(body?.months);
      if (!Number.isInteger(months) || months <= 0) {
        return { status: 400 as const, body: { message: 'months must be a positive integer' } };
      }

      const sub = await queryOne<any>('SELECT * FROM subscriptions WHERE company_id = $1', [params.companyId]);
      if (!sub) return { status: 404 as const, body: { message: 'Subscription not found for this company' } };

      const useSubCol = sub.subscription_end_date != null || sub.status === 'ACTIVE';
      const currentEndRaw = useSubCol ? sub.subscription_end_date : sub.trial_end_date;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let base = currentEndRaw ? new Date(currentEndRaw) : today;
      if (isNaN(base.getTime()) || base < today) base = today;

      const newEnd = new Date(base);
      newEnd.setMonth(newEnd.getMonth() + months);
      const newEndStr = newEnd.toISOString().split('T')[0];

      const col = useSubCol ? 'subscription_end_date' : 'trial_end_date';
      await query(`UPDATE subscriptions SET ${col} = $2, updated_at = NOW() WHERE id = $1`, [sub.id, newEndStr]);

      return { status: 200 as const, body: { success: true, end_date: newEndStr } };
    } catch (error: any) {
      console.error('karim-admin-secret extend failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Extend failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/activate
   * Promote the subscription to ACTIVE. Sets a subscription start date if absent
   * and carries the trial end over to the subscription end so the displayed end
   * date stays meaningful.
   */
  activateSubscription: async ({ params }: { params: { companyId: string } }) => {
    try {
      const sub = await queryOne<any>('SELECT id FROM subscriptions WHERE company_id = $1', [params.companyId]);
      if (!sub) return { status: 404 as const, body: { message: 'Subscription not found for this company' } };

      const company = await queryOne<any>('SELECT type FROM companies WHERE id = $1', [params.companyId]);
      const isTeacher = company?.type === 'TEACHER';

      const today = new Date().toISOString().split('T')[0];
      if (isTeacher) {
        // Teacher activation is forever — no end date (ACTIVE is never expiry-gated).
        await query(
          `UPDATE subscriptions
             SET status = 'ACTIVE',
                 subscription_start_date = COALESCE(subscription_start_date, $2),
                 subscription_end_date   = NULL,
                 updated_at = NOW()
           WHERE id = $1`,
          [sub.id, today]
        );
      } else {
        await query(
          `UPDATE subscriptions
             SET status = 'ACTIVE',
                 subscription_start_date = COALESCE(subscription_start_date, $2),
                 subscription_end_date   = COALESCE(subscription_end_date, trial_end_date),
                 updated_at = NOW()
           WHERE id = $1`,
          [sub.id, today]
        );
      }

      return { status: 200 as const, body: { success: true, subscription_type: 'ACTIVE' } };
    } catch (error: any) {
      console.error('karim-admin-secret activate failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Activate failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/type
   * Switch a company's registration type between ACADEMY and TEACHER. This is
   * the `companies.type` set at signup, which gates teacher-only vs academy-only
   * features; nothing else about the tenant's data changes.
   */
  setCompanyType: async ({ params, body }: { params: { companyId: string }; body: { type: 'ACADEMY' | 'TEACHER' } }) => {
    try {
      const type = body?.type === 'TEACHER' ? 'TEACHER' : body?.type === 'ACADEMY' ? 'ACADEMY' : null;
      if (!type) {
        return { status: 400 as const, body: { message: "type must be 'ACADEMY' or 'TEACHER'" } };
      }

      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      await query('UPDATE companies SET type = $2, updated_at = NOW() WHERE id = $1', [params.companyId, type]);

      return { status: 200 as const, body: { success: true, company_type: type } };
    } catch (error: any) {
      console.error('karim-admin-secret set company type failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set type failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/qr-paid
   * Mark a company's QR activations as paid (or unpaid). Toggled by the owner
   * once the teacher settles the activation bill. Affects every activated
   * student of the company; returns how many rows were updated.
   */
  setQrPaid: async ({ params, body }: { params: { companyId: string }; body: { paid: boolean } }) => {
    try {
      const paid = body?.paid === true;
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const updated = await query<any>(
        `UPDATE students SET qr_paid = $2, updated_at = NOW()
         WHERE company_id = $1 AND qr_activated = true RETURNING id`,
        [params.companyId, paid]
      );

      return { status: 200 as const, body: { success: true, paid, updated_count: updated.length } };
    } catch (error: any) {
      console.error('karim-admin-secret set qr paid failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set QR paid failed' } };
    }
  },

  /**
   * DELETE /api/karim-admin-secret/companies/:companyId
   * Permanently delete a company and ALL its data. Every FK referencing
   * companies is ON DELETE CASCADE, so the single delete removes the whole
   * tenant atomically. Irreversible.
   */
  deleteCompany: async ({ params }: { params: { companyId: string } }) => {
    try {
      const company = await queryOne<any>('SELECT id, name FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      await query('DELETE FROM companies WHERE id = $1', [params.companyId]);

      return { status: 200 as const, body: { success: true, company_name: company.name } };
    } catch (error: any) {
      console.error('karim-admin-secret delete company failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Delete failed' } };
    }
  },

  /**
   * GET /api/karim-admin-secret/telegram-bots
   * Platform-owned Telegram bot pool: one row per bot, with which company (if any)
   * has claimed it. Academies auto-claim a free bot when they enable Telegram.
   */
  listTelegramBots: async () => {
    try {
      const rows = await query<any>(
        `SELECT p.id, p.bot_username, p.assigned_company_id, p.assigned_at, c.name AS company_name
         FROM telegram_bot_pool p
         LEFT JOIN companies c ON c.id = p.assigned_company_id
         ORDER BY p.created_at ASC`
      );
      const bots = rows.map((r) => ({
        id: r.id,
        bot_username: r.bot_username,
        assigned_company_id: r.assigned_company_id ?? null,
        company_name: r.company_name ?? null,
        assigned_at: toIso(r.assigned_at),
      }));
      return {
        status: 200 as const,
        body: {
          bots,
          total: bots.length,
          available: bots.filter((b) => !b.assigned_company_id).length,
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret list telegram bots failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'List failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/telegram-bots  body: { botToken }
   * Add a bot (created in @BotFather) to the pool. Validates the token via getMe
   * and stores its username. Idempotent on the token.
   */
  addTelegramBot: async ({ body }: { body: { botToken: string } }) => {
    try {
      const botToken = (body?.botToken || '').trim();
      if (!botToken) return { status: 400 as const, body: { message: 'botToken is required' } };

      let me: any;
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { method: 'POST' });
        me = await res.json();
      } catch (e: any) {
        return { status: 400 as const, body: { message: 'Could not reach Telegram to validate the token' } };
      }
      if (!me?.ok) return { status: 400 as const, body: { message: 'Bot token is invalid' } };

      await query(
        `INSERT INTO telegram_bot_pool (bot_token, bot_username) VALUES ($1, $2)
         ON CONFLICT (bot_token) DO NOTHING`,
        [botToken, me.result?.username]
      );

      const counts = await queryOne<any>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE assigned_company_id IS NULL)::int AS available
         FROM telegram_bot_pool`
      );
      return {
        status: 200 as const,
        body: {
          success: true,
          bot_username: me.result?.username as string,
          total: counts?.total ?? 0,
          available: counts?.available ?? 0,
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret add telegram bot failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Add bot failed' } };
    }
  },

  // ─── Offline desktop licenses ────────────────────────────────────────────
  // Cross-tenant management of the offline_license table. Same obscure-path
  // "auth" as the rest of this console.

  listLicenses: async () => {
    try {
      await ensureOfflineLicenseTable();
      const rows = await query<any>('SELECT * FROM offline_license ORDER BY created_at DESC');
      return { status: 200 as const, body: rows.map(mapLicenseRow) };
    } catch (error: any) {
      console.error('karim-admin-secret list licenses failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'List failed' } };
    }
  },

  createLicense: async ({ body }: { body: { tier?: 'TEACHER' | 'ACADEMY'; label?: string; phone?: string; notes?: string } }) => {
    try {
      await ensureOfflineLicenseTable();
      const tier = body?.tier === 'ACADEMY' ? 'ACADEMY' : 'TEACHER';
      // Retry on the vanishingly rare key collision.
      let row: any = null;
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        const key = generateLicenseKey(tier);
        try {
          row = await queryOne<any>(
            `INSERT INTO offline_license (license_key, tier, label, phone, notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [key, tier, body?.label || null, body?.phone || null, body?.notes || null]
          );
        } catch (e: any) {
          if (e?.code !== '23505') throw e; // not a unique-violation → real error
        }
      }
      if (!row) return { status: 500 as const, body: { message: 'Could not generate a unique key' } };
      return { status: 201 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret create license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Create failed' } };
    }
  },

  activateLicense: async ({ params, body }: { params: { id: string }; body: { activationEndsAt?: string | null } }) => {
    try {
      await ensureOfflineLicenseTable();
      const row = await queryOne<any>(
        `UPDATE offline_license
           SET activated = true, activation_ends_at = $2, revoked = false,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, body?.activationEndsAt || null]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret activate license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Activate failed' } };
    }
  },

  extendTrial: async ({ params, body }: { params: { id: string }; body: { days: number } }) => {
    try {
      await ensureOfflineLicenseTable();
      const days = Math.max(1, Math.floor(body?.days || 0));
      // Extend from the later of the current trial end or now, so a lapsed
      // trial gets a fresh window rather than one still in the past.
      const row = await queryOne<any>(
        `UPDATE offline_license
           SET trial_started_at = COALESCE(trial_started_at, CURRENT_TIMESTAMP),
               trial_ends_at = GREATEST(COALESCE(trial_ends_at, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
                               + ($2 || ' days')::interval,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, String(days)]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret extend trial failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Extend failed' } };
    }
  },

  // Issue the product license for a paid customer: generate a key on their row
  // (matching the row's tier) if it doesn't have one yet. The owner sends this
  // key to the customer, who enters it in-app to unlock after the trial.
  issueLicense: async ({ params }: { params: { id: string } }) => {
    try {
      await ensureOfflineLicenseTable();
      const existing = await queryOne<any>('SELECT * FROM offline_license WHERE id = $1', [params.id]);
      if (!existing) return { status: 404 as const, body: { message: 'License not found' } };
      if (existing.license_key) {
        return { status: 200 as const, body: mapLicenseRow(existing) }; // already issued
      }
      let row: any = null;
      for (let attempt = 0; attempt < 5 && !row; attempt++) {
        const key = generateLicenseKey(existing.tier === 'ACADEMY' ? 'ACADEMY' : 'TEACHER');
        try {
          row = await queryOne<any>(
            `UPDATE offline_license SET license_key = $2, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 RETURNING *`,
            [params.id, key]
          );
        } catch (e: any) {
          if (e?.code !== '23505') throw e; // key collision → retry
        }
      }
      if (!row) return { status: 500 as const, body: { message: 'Could not generate a unique key' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret issue license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Issue failed' } };
    }
  },

  // Set an absolute trial expiry date (the owner "changing the expiration day").
  setTrialEndDate: async ({ params, body }: { params: { id: string }; body: { trialEndsAt: string } }) => {
    try {
      await ensureOfflineLicenseTable();
      const row = await queryOne<any>(
        `UPDATE offline_license
           SET trial_started_at = COALESCE(trial_started_at, CURRENT_TIMESTAMP),
               trial_ends_at = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, body.trialEndsAt]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret set trial end failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set expiry failed' } };
    }
  },

  resetDevice: async ({ params }: { params: { id: string } }) => {
    try {
      await ensureOfflineLicenseTable();
      // Clear the device lock so the license can bind to a new machine. Trial
      // dates are preserved (validate only starts the trial when it's null).
      const row = await queryOne<any>(
        `UPDATE offline_license SET device_id = NULL, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret reset device failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Reset failed' } };
    }
  },

  setLicenseTier: async ({ params, body }: { params: { id: string }; body: { tier: 'TEACHER' | 'ACADEMY' } }) => {
    try {
      await ensureOfflineLicenseTable();
      const tier = body?.tier === 'ACADEMY' ? 'ACADEMY' : 'TEACHER';
      const row = await queryOne<any>(
        `UPDATE offline_license SET tier = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, tier]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret set tier failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set tier failed' } };
    }
  },

  setLicensePhone: async ({ params, body }: { params: { id: string }; body: { phone: string | null } }) => {
    try {
      await ensureOfflineLicenseTable();
      const phone = body?.phone?.trim() || null;
      const row = await queryOne<any>(
        `UPDATE offline_license SET phone = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, phone]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret set phone failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set phone failed' } };
    }
  },

  setLicenseRevoked: async ({ params, body }: { params: { id: string }; body: { revoked: boolean } }) => {
    try {
      await ensureOfflineLicenseTable();
      const row = await queryOne<any>(
        `UPDATE offline_license SET revoked = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, body?.revoked === true]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret revoke license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Revoke failed' } };
    }
  },

  deleteLicense: async ({ params }: { params: { id: string } }) => {
    try {
      await ensureOfflineLicenseTable();
      await query('DELETE FROM offline_license WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { deleted: true } };
    } catch (error: any) {
      console.error('karim-admin-secret delete license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Delete failed' } };
    }
  },
};
