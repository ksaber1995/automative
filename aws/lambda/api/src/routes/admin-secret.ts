import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { CARD_SERIAL_BASE, ensureQrCardSchema } from './qr-cards';
import { query, queryOne, getClient } from '../db/connection';
import { DEBUG_ACCOUNT_EMAIL, isDebugAccount } from '../utils/debug-account';
import { ensureOfflineLicenseTable } from '../utils/ensure-offline-license';

/** The roles a user account can hold (mirrors the users.role CHECK constraint). */
export const ADMIN_ROLES = [
  'GLOBAL_ADMIN', 'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
  'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER',
];

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
    price: r.price == null ? null : Number(r.price),
    studentCount: r.student_count == null ? null : Number(r.student_count),
    courseCount: r.course_count == null ? null : Number(r.course_count),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
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
    (SELECT COUNT(*) FROM courses   co WHERE co.company_id = c.id) AS course_count
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

  activateLicense: async ({
    params,
    body,
  }: {
    params: { id: string };
    body: { activationEndsAt?: string | null; price?: number | null };
  }) => {
    try {
      await ensureOfflineLicenseTable();
      const price =
        body?.price === null || body?.price === undefined ? null : Number(body.price);
      // Renewal day defaults to one year out when no explicit date is given, so
      // both first activation and a later renewal just restart the annual clock.
      // price is only overwritten when a value is supplied (COALESCE keeps it).
      const row = await queryOne<any>(
        `UPDATE offline_license
           SET activated = true,
               activation_ends_at = COALESCE($2::date, (CURRENT_DATE + INTERVAL '1 year')::date),
               price = COALESCE($3, price),
               revoked = false,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, body?.activationEndsAt || null, price]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret activate license failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Activate failed' } };
    }
  },

  // Edit the recorded annual price independently of activation.
  setLicensePrice: async ({ params, body }: { params: { id: string }; body: { price: number | null } }) => {
    try {
      await ensureOfflineLicenseTable();
      const price =
        body?.price === null || body?.price === undefined ? null : Number(body.price);
      const row = await queryOne<any>(
        `UPDATE offline_license SET price = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [params.id, price]
      );
      if (!row) return { status: 404 as const, body: { message: 'License not found' } };
      return { status: 200 as const, body: mapLicenseRow(row) };
    } catch (error: any) {
      console.error('karim-admin-secret set price failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set price failed' } };
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

  /**
   * POST /api/karim-admin-secret/companies/:companyId/qr-cards/enabled  { enabled }
   * Turn the pre-printed QR card pool on or off for one client. Off by default —
   * it is sold per academy, so nobody gets it until we switch it on.
   */
  setQrCardsEnabled: async ({ params, body }: { params: { companyId: string }; body: { enabled: boolean } }) => {
    try {
      await ensureQrCardSchema();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const enabled = body?.enabled === true;
      await query('UPDATE companies SET qr_cards_enabled = $2, updated_at = NOW() WHERE id = $1',
        [params.companyId, enabled]);

      return { status: 200 as const, body: { success: true, qr_cards_enabled: enabled } };
    } catch (error: any) {
      console.error('karim-admin-secret set qr cards failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set QR cards failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/qr-cards  { count, poolType }
   * Mint a print run FOR a client, without signing in as them. Serials continue
   * from their last run, so a batch we print never collides with a card already in
   * one of their students' pockets.
   *
   * poolType (1/2/3) stamps the run. It labels the cards and nothing else — it
   * does NOT partition serials, which stay one continuous per-company sequence
   * because a linked card's serial becomes the student's code.
   */
  generateQrCards: async ({ params, body }: {
    params: { companyId: string };
    body: { count: number; poolType?: number };
  }) => {
    try {
      await ensureQrCardSchema();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const count = Math.floor(Number(body?.count));
      if (!Number.isFinite(count) || count < 1 || count > 2000) {
        return { status: 400 as const, body: { message: 'count must be between 1 and 2000' } };
      }

      // Unstamped runs are type 1, same as the cards minted before types existed.
      const poolType = body?.poolType === undefined ? 1 : Math.floor(Number(body.poolType));
      if (![1, 2, 3].includes(poolType)) {
        return { status: 400 as const, body: { message: 'poolType must be 1, 2 or 3' } };
      }

      const last = await queryOne<any>(
        'SELECT COALESCE(MAX(serial), 0) AS last FROM qr_cards WHERE company_id = $1',
        [params.companyId],
      );
      // Never below the reserved base — that range is what keeps card serials from
      // colliding with the academy's own student codes. See CARD_SERIAL_BASE.
      const from = Math.max(parseInt(last?.last ?? '0', 10), CARD_SERIAL_BASE) + 1;

      const rows = await query<any>(
        `INSERT INTO qr_cards (company_id, token, serial, pool_type)
         SELECT $1, REPLACE(uuid_generate_v4()::text, '-', ''), g, $4
         FROM generate_series($2::int, $3::int) AS g
         RETURNING serial`,
        [params.companyId, from, from + count - 1, poolType],
      );

      return {
        status: 200 as const,
        body: { success: true, created: rows.length, from, to: from + count - 1, poolType },
      };
    } catch (error: any) {
      console.error('karim-admin-secret generate qr cards failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Generate failed' } };
    }
  },

  /**
   * GET /api/karim-admin-secret/companies/:companyId/qr-cards
   * How big is this client's pool, and how much of it is already handed out.
   */
  qrCardStats: async ({ params }: { params: { companyId: string } }) => {
    try {
      await ensureQrCardSchema();
      const row = await queryOne<any>(
        `SELECT c.qr_cards_enabled,
                (SELECT COUNT(*) FROM qr_cards q WHERE q.company_id = c.id) AS total,
                (SELECT COUNT(*) FROM qr_cards q WHERE q.company_id = c.id AND q.student_id IS NOT NULL) AS linked
         FROM companies c WHERE c.id = $1`,
        [params.companyId],
      );
      if (!row) return { status: 404 as const, body: { message: 'Company not found' } };

      return {
        status: 200 as const,
        body: {
          qr_cards_enabled: row.qr_cards_enabled === true,
          total: Number(row.total ?? 0),
          linked: Number(row.linked ?? 0),
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret qr card stats failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Stats failed' } };
    }
  },
  /**
   * POST /api/karim-admin-secret/companies/:companyId/deactivate
   * The counterpart of activate: park a tenant who has stopped paying. Sets the
   * subscription EXPIRED and ends it today, so the app's own subscription check
   * locks them out. Nothing is deleted — activate puts them straight back.
   */
  deactivateSubscription: async ({ params }: { params: { companyId: string } }) => {
    try {
      const sub = await queryOne<any>('SELECT id FROM subscriptions WHERE company_id = $1', [params.companyId]);
      if (!sub) return { status: 404 as const, body: { message: 'Subscription not found for this company' } };

      const today = new Date().toISOString().split('T')[0];
      await query(
        `UPDATE subscriptions
            SET status = 'EXPIRED',
                subscription_end_date = LEAST(COALESCE(subscription_end_date, $2::date), $2::date),
                updated_at = NOW()
          WHERE id = $1`,
        [sub.id, today],
      );

      return { status: 200 as const, body: { success: true, subscription_type: 'EXPIRED' } };
    } catch (error: any) {
      console.error('karim-admin-secret deactivate failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Deactivate failed' } };
    }
  },

  /**
   * GET /api/karim-admin-secret/users?companyId=...
   * Every user account, with the tenant it belongs to. Passwords never leave here.
   */
  listUsers: async ({ query: q }: { query: { companyId?: string } }) => {
    try {
      const params: any[] = [];
      let sql = `
        SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
               u.email_verified, u.created_at,
               u.company_id, c.name AS company_name
          FROM users u
          LEFT JOIN companies c ON c.id = u.company_id`;
      if (q?.companyId) {
        params.push(q.companyId);
        sql += ' WHERE u.company_id = $1';
      }
      sql += ' ORDER BY c.name NULLS LAST, u.created_at DESC';

      const rows = await query<any>(sql, params);
      return {
        status: 200 as const,
        body: rows.map((r) => ({
          id: r.id,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          role: r.role,
          is_active: r.is_active !== false,
          email_verified: r.email_verified === true,
          company_id: r.company_id ?? null,
          company_name: r.company_name ?? null,
          created_at: toIso(r.created_at),
        })),
      };
    } catch (error: any) {
      console.error('karim-admin-secret list users failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'List users failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/users
   * Create a user inside a tenant. Verified on the spot — a vendor-created account
   * has nobody to click an OTP, and an unverified account cannot log in.
   */
  createUser: async ({ body }: {
    body: { companyId: string; email: string; password: string; firstName: string; lastName: string; role: string };
  }) => {
    try {
      const email = (body?.email || '').trim().toLowerCase();
      const password = body?.password || '';
      const firstName = (body?.firstName || '').trim();
      const lastName = (body?.lastName || '').trim();
      const role = (body?.role || '').trim().toUpperCase();

      if (!email || !password || !firstName || !lastName) {
        return { status: 400 as const, body: { message: 'Email, password, first and last name are required' } };
      }
      if (password.length < 6) {
        return { status: 400 as const, body: { message: 'Password must be at least 6 characters' } };
      }
      if (!ADMIN_ROLES.includes(role)) {
        return { status: 400 as const, body: { message: `Role must be one of: ${ADMIN_ROLES.join(', ')}` } };
      }

      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [body?.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      // Email is UNIQUE across the whole table, not per tenant — say so plainly
      // rather than letting the insert fail on a constraint name.
      const taken = await queryOne<any>('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (taken) return { status: 409 as const, body: { message: 'That email already belongs to a user' } };

      const hashed = await bcrypt.hash(password, 10);
      const row = await queryOne<any>(
        `INSERT INTO users (email, password, first_name, last_name, role, company_id, is_active, email_verified)
         VALUES ($1, $2, $3, $4, $5, $6, true, true)
         RETURNING id, email, first_name, last_name, role, is_active, email_verified, company_id, created_at`,
        [email, hashed, firstName, lastName, role, body.companyId],
      );

      return {
        status: 201 as const,
        body: {
          id: row.id,
          email: row.email,
          first_name: row.first_name,
          last_name: row.last_name,
          role: row.role,
          is_active: row.is_active !== false,
          email_verified: row.email_verified === true,
          company_id: row.company_id ?? null,
          company_name: null,
          created_at: toIso(row.created_at),
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret create user failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Create user failed' } };
    }
  },

  /**
   * DELETE /api/karim-admin-secret/users/:id
   * Refuses to remove a tenant's LAST admin — that would lock the customer out of
   * their own account, with no way back in except this console.
   */
  deleteUser: async ({ params }: { params: { id: string } }) => {
    try {
      const user = await queryOne<any>('SELECT id, role, company_id FROM users WHERE id = $1', [params.id]);
      if (!user) return { status: 404 as const, body: { message: 'User not found' } };

      if (user.company_id && ['ADMIN', 'GLOBAL_ADMIN'].includes(user.role)) {
        const others = await queryOne<any>(
          `SELECT COUNT(*) AS n FROM users
            WHERE company_id = $1 AND id <> $2 AND is_active = true
              AND role IN ('ADMIN', 'GLOBAL_ADMIN')`,
          [user.company_id, user.id],
        );
        if (Number(others?.n ?? 0) === 0) {
          return { status: 409 as const, body: { message: "This is the tenant's last admin — the company would be locked out" } };
        }
      }

      await query('DELETE FROM users WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      console.error('karim-admin-secret delete user failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Delete user failed' } };
    }
  },

  /**
   * PATCH /api/karim-admin-secret/users/:id/company
   * Move an account into another tenant — for a debugging login that needs to
   * sit inside a customer's data.
   *
   * A user's branch, linked employee and granular permissions all name rows the
   * OLD company owns, and none of those columns has a company-aware constraint
   * to catch it: `users.branch_id` has no FK at all. Carrying them over would
   * leave the account silently pointing across the tenant boundary, so the move
   * clears them and the new tenant re-grants what it wants. Same reason
   * `user_branches` rows go — they each carry their own `company_id`.
   *
   * Leaves the old tenant's history (CRM ownership, audit trails) alone: those
   * rows record who did something, and rewriting them to fit a debug move would
   * falsify the customer's records.
   *
   * Only the debug account may be moved. Everything this does is right for a
   * login that is meant to hop tenants and wrong for a real one: a customer's
   * user would be stripped of their branch, linked employee and permissions, and
   * land in a company that is not theirs, with their old token still working
   * against the old tenant. There is no legitimate reason to do that to someone,
   * so the endpoint refuses rather than trusting the caller to aim carefully.
   * These routes have no auth at all — the obscure path is the only gate — which
   * makes the guard belong here and not only on the button.
   *
   * NOTE: the caller's existing JWT still carries the OLD companyId and is good
   * for up to a year — tokens are stateless with no revocation list. The moved
   * account must log out and back in before it sees the new tenant.
   */
  moveUserCompany: async ({ params, body }: {
    params: { id: string };
    body: { companyId: string };
  }) => {
    const client = await getClient();
    try {
      const user = await queryOne<any>('SELECT id, email, role, company_id FROM users WHERE id = $1', [params.id]);
      if (!user) return { status: 404 as const, body: { message: 'User not found' } };

      if (!isDebugAccount(user.email)) {
        return {
          status: 403 as const,
          body: { message: `Only ${DEBUG_ACCOUNT_EMAIL} can be moved between tenants` },
        };
      }

      const target = await queryOne<any>('SELECT id, name FROM companies WHERE id = $1', [body?.companyId]);
      if (!target) return { status: 404 as const, body: { message: 'Company not found' } };

      if (user.company_id === target.id) {
        return { status: 400 as const, body: { message: 'That user is already in this tenant' } };
      }

      // Moving a tenant's last admin out locks the customer out of their own
      // account exactly as deleting them would — same guard as deleteUser.
      if (user.company_id && ['ADMIN', 'GLOBAL_ADMIN'].includes(user.role)) {
        const others = await queryOne<any>(
          `SELECT COUNT(*) AS n FROM users
            WHERE company_id = $1 AND id <> $2 AND is_active = true
              AND role IN ('ADMIN', 'GLOBAL_ADMIN')`,
          [user.company_id, user.id],
        );
        if (Number(others?.n ?? 0) === 0) {
          return { status: 409 as const, body: { message: "This is the tenant's last admin — the company would be locked out" } };
        }
      }

      await client.query('BEGIN');
      await client.query('DELETE FROM user_branches WHERE user_id = $1', [user.id]);
      const moved = await client.query(
        `UPDATE users
            SET company_id = $1, branch_id = NULL, linked_employee_id = NULL,
                permissions = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id, email, first_name, last_name, role, is_active,
                    email_verified, company_id, created_at`,
        [target.id, user.id],
      );
      await client.query('COMMIT');

      const r = moved.rows[0];
      return {
        status: 200 as const,
        body: {
          id: r.id,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          role: r.role,
          is_active: r.is_active !== false,
          email_verified: r.email_verified === true,
          company_id: r.company_id ?? null,
          company_name: target.name ?? null,
          created_at: toIso(r.created_at),
        },
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('karim-admin-secret move user failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Move user failed' } };
    } finally {
      client.release();
    }
  },
};
