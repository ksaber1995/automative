import bcrypt from 'bcryptjs';
import { ensureQrCardSchema, nextCardSerial, firstTakenCardNumber, CARD_SERIAL_BASE_V2 } from './qr-cards';
import { query, queryOne, getClient } from '../db/connection';
import { DEBUG_ACCOUNT_EMAIL, isDebugAccount } from '../utils/debug-account';
import {
  ensureCompanyTypeConstraint,
  ensureCompanySmsColumns,
  ensureOnlineExamsColumn,
  smsIsActive,
} from './companies';
import { withPortalGuard, PortalPermission, PortalUser } from './admin-portal';
import { createPrintJob, ensurePrintJobSchema, mapPrintJob } from './print-jobs';

/**
 * Where the print-shop page is served. The links go to outsiders, so they point
 * at the customer-facing app rather than the admin console — the printer has no
 * business knowing dione exists.
 */
const APP_ORIGIN = process.env.FRONTEND_BASE_URL || 'https://app.netrofit.com';

/** The roles a user account can hold (mirrors the users.role CHECK constraint). */
export const ADMIN_ROLES = [
  'GLOBAL_ADMIN', 'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
  'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER',
];

/**
 * The owner's cross-tenant view: one row per company with subscription status,
 * price, employee/branch/student/course counts, start/end dates, and — because
 * the console and the cards report need them — the owner's email, the account
 * mobile, and the tenant's postal address.
 *
 * This used to be gated by nothing but the obscure path, which was accepted
 * while the payload was aggregate numbers. It carries personal data for every
 * tenant and sits alongside routes that can delete a company, so the path is no
 * longer treated as a credential: every route in this file now requires a portal
 * sign-in (see the guard at the bottom, and routes/admin-portal.ts).
 *
 * Read-only: a single SELECT, no writes.
 */
const SUBSCRIPTIONS_SQL = `
  SELECT
    c.id                                                       AS company_id,
    c.name                                                     AS company_name,
    c.is_active                                                AS company_active,
    c.currency                                                 AS currency,
    c.created_at                                               AS company_created_at,
    c.type                                                     AS company_type,
    -- Where this tenant's printed cards get shipped. Free text on purpose: a
    -- postal address is not worth normalising for a handful of clients, and the
    -- print shop reads it as one block anyway.
    c.address                                                  AS address,
    -- SMS entitlement: the two stored facts, plus whether they add up to "may
    -- send right now". The console shows the derived one and edits the other
    -- two, so it can never disagree with whatever ends up doing the sending.
    c.sms_activated                                            AS sms_activated,
    c.sms_expiration                                           AS sms_expiration,
    ${smsIsActive('c')}                                        AS sms_active,
    -- Online exams (lessons, question banks, student portal): one flag, sold/
    -- trialled per tenant and off by default, toggled from this console.
    c.online_exams_enabled                                     AS online_exams_enabled,
    NULLIF(CONCAT('+', u.country_code, u.phone), '+')          AS mobile,
    u.email                                                    AS owner_email,
    s.status                                                   AS subscription_type,
    s.price                                                    AS price,
    COALESCE(s.subscription_start_date, s.trial_start_date)    AS start_date,
    COALESCE(s.subscription_end_date,   s.trial_end_date)      AS end_date,
    (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
    (SELECT COUNT(*) FROM branches  b WHERE b.company_id = c.id) AS branch_count,
    (SELECT COUNT(*) FROM students  st WHERE st.company_id = c.id) AS student_count,
    -- The roll a client is actually running, as opposed to everyone they have
    -- ever enrolled. is_active is nullable with DEFAULT true, so an unset flag
    -- counts as active — the column's own default is the answer for a row
    -- nobody has touched.
    (SELECT COUNT(*) FROM students  st WHERE st.company_id = c.id
       AND COALESCE(st.is_active, true))                        AS active_student_count,
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

/**
 * Does companies.read_trial cap this caller? A capped caller lives in a world
 * where non-TRIAL tenants do not exist: the tenant list, the user list, and
 * every company-aimed write in this file answer as if they were never there.
 * The cap WINS over the caller's other read grants — the person ticking
 * "trial only" means trial only. OWNER is never capped.
 */
function isTrialCapped(user?: PortalUser): boolean {
  return !!user && user.role !== 'OWNER' && user.permissions.includes('companies.read_trial');
}

async function companyIsTrial(companyId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT 1 FROM subscriptions WHERE company_id = $1 AND status = 'TRIAL'`,
    [companyId],
  );
  return !!row;
}

const unguardedAdminSecretRoutes = {
  getSubscriptions: async ({ portalUser }: { portalUser?: PortalUser } = {}) => {
    try {
      // The SELECT reads the SMS and online-exam columns, so they have to exist
      // before it runs.
      await ensureCompanySmsColumns();
      await ensureOnlineExamsColumn();
      let rows = await query<any>(SUBSCRIPTIONS_SQL);

      // The trial cap: paying and expired tenants — and their owner emails,
      // mobiles and addresses — are dropped HERE, not hidden by the console.
      if (isTrialCapped(portalUser)) rows = rows.filter((r) => r.subscription_type === 'TRIAL');

      const body = rows.map((r) => ({
        company_id: r.company_id,
        company_name: r.company_name,
        company_active: r.company_active == null ? null : !!r.company_active,
        currency: r.currency ?? null,
        company_created_at: toIso(r.company_created_at),
        company_type: r.company_type ?? null,
        // Blank reads as unset, so a stored empty string can't look like an address.
        address: (r.address ?? '').trim() || null,
        sms_activated: r.sms_activated === true,
        // Date only — the time of day is noise on an entitlement that runs to
        // the end of a day.
        sms_expiration: r.sms_expiration ? toIso(r.sms_expiration)?.slice(0, 10) ?? null : null,
        sms_active: r.sms_active === true,
        online_exams_enabled: r.online_exams_enabled === true,
        mobile: r.mobile ?? null,
        owner_email: r.owner_email ?? null,
        subscription_type: r.subscription_type ?? null,
        price: r.price == null ? null : Number(r.price),
        start_date: toIso(r.start_date),
        end_date: toIso(r.end_date),
        employee_count: Number(r.employee_count ?? 0),
        branch_count: Number(r.branch_count ?? 0),
        student_count: Number(r.student_count ?? 0),
        active_student_count: Number(r.active_student_count ?? 0),
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

      // Extending an expired tenant is how you put them back on. Moving the date
      // alone left status = 'EXPIRED', so admin went on filing the row under
      // Expired with an end date a year out — the operator had done the thing
      // and the screen said it hadn't. Which column we extended says which state
      // they go back to: a trial date means the trial resumes, a subscription
      // date means they are a paying tenant again.
      const revived = sub.status === 'EXPIRED' ? (useSubCol ? 'ACTIVE' : 'TRIAL') : null;
      await query(
        revived
          ? `UPDATE subscriptions SET ${col} = $2, status = $3, updated_at = NOW() WHERE id = $1`
          : `UPDATE subscriptions SET ${col} = $2, updated_at = NOW() WHERE id = $1`,
        revived ? [sub.id, newEndStr, revived] : [sub.id, newEndStr],
      );

      return {
        status: 200 as const,
        body: { success: true, end_date: newEndStr, subscription_type: revived ?? sub.status ?? null },
      };
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
   * Switch a company's registration type between ACADEMY, TEACHER, and SCHOOL.
   * This is the `companies.type` set at signup, which gates teacher-only vs
   * academy-only features; nothing else about the tenant's data changes. SCHOOL
   * has no self-serve signup yet — this is currently the only way one gets set.
   */
  setCompanyType: async ({ params, body }: { params: { companyId: string }; body: { type: 'ACADEMY' | 'TEACHER' | 'SCHOOL' } }) => {
    try {
      await ensureCompanyTypeConstraint();
      const type = (['ACADEMY', 'TEACHER', 'SCHOOL'] as const).includes(body?.type as any) ? body.type : null;
      if (!type) {
        return { status: 400 as const, body: { message: "type must be 'ACADEMY', 'TEACHER', or 'SCHOOL'" } };
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
   * PUT /api/karim-admin-secret/companies/:companyId/address
   * Set (or clear) the address a tenant's printed cards are shipped to. This is
   * `companies.address`, the same field the tenant's own company profile shows —
   * there is one address per tenant, not a separate shipping one, so updating it
   * here is visible to them too.
   *
   * Empty or whitespace clears it back to NULL, which the cards report shows as
   * "no address" — a client whose cards have nowhere to go should look unset,
   * not look like an empty string.
   */
  setCompanyAddress: async ({ params, body }: { params: { companyId: string }; body: { address?: string | null } }) => {
    try {
      const raw = body?.address == null ? '' : String(body.address);
      // Cap it: this lands in a free-text column with no length limit of its own,
      // and a runaway paste would be pushed to every report that reads the list.
      const address = raw.trim().slice(0, 500) || null;

      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      await query('UPDATE companies SET address = $2, updated_at = NOW() WHERE id = $1', [params.companyId, address]);

      return { status: 200 as const, body: { success: true, address } };
    } catch (error: any) {
      console.error('karim-admin-secret set company address failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set address failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/sms  { activated, expiration? }
   * Switch a tenant's SMS entitlement on or off, and set the date it runs to.
   *
   * `expiration` is a plain YYYY-MM-DD, or null for no end date — which means
   * "until someone turns it off", NOT "already expired". Omitting the field
   * leaves whatever date is stored alone, so flipping the flag back on does not
   * silently wipe the date it was sold with.
   *
   * Returns the derived `sms_active` as well as the two stored values, so the
   * caller never has to re-implement the rule about what an empty date means.
   */
  setSmsAccess: async ({ params, body }: {
    params: { companyId: string };
    body: { activated: boolean; expiration?: string | null };
  }) => {
    try {
      await ensureCompanySmsColumns();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const activated = body?.activated === true;

      // Absent = leave the stored date alone; present-but-null = clear it.
      const setsExpiration = body != null && 'expiration' in body;
      let expiration: string | null = null;
      if (setsExpiration && body.expiration != null) {
        const raw = String(body.expiration).trim();
        // Rejected rather than coerced: a date the caller did not mean is worse
        // than an error, because it silently sells a tenant the wrong window.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(new Date(raw).getTime())) {
          return { status: 400 as const, body: { message: 'expiration must be a YYYY-MM-DD date, or null for no end date' } };
        }
        expiration = raw;
      }

      const row = await queryOne<any>(
        setsExpiration
          ? `UPDATE companies SET sms_activated = $2, sms_expiration = $3::date, updated_at = NOW()
              WHERE id = $1
              RETURNING sms_activated, sms_expiration, ${smsIsActive('companies')} AS sms_active`
          : `UPDATE companies SET sms_activated = $2, updated_at = NOW()
              WHERE id = $1
              RETURNING sms_activated, sms_expiration, ${smsIsActive('companies')} AS sms_active`,
        setsExpiration ? [params.companyId, activated, expiration] : [params.companyId, activated],
      );

      return {
        status: 200 as const,
        body: {
          success: true,
          sms_activated: row?.sms_activated === true,
          sms_expiration: row?.sms_expiration ? toIso(row.sms_expiration)?.slice(0, 10) ?? null : null,
          sms_active: row?.sms_active === true,
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret set sms access failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set SMS access failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/print-links
   *   { ids?, note?, expiresInDays? }
   *
   * Make a link for the print shop: the cards, and the address to ship them to.
   * Omitting `ids` takes everything currently waiting to print.
   *
   * The set is pinned now rather than resolved on each visit, so minting another
   * run tomorrow does not quietly enlarge a job the printer has already quoted
   * for. See routes/print-jobs.ts.
   */
  createPrintLink: async ({ params, body }: {
    params: { companyId: string };
    body?: { ids?: string[]; note?: string | null; expiresInDays?: number | null };
  }) => {
    try {
      const company = await queryOne<any>('SELECT id, address FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const job = await createPrintJob({
        companyId: params.companyId,
        ids: body?.ids,
        note: body?.note ?? null,
        expiresInDays: body?.expiresInDays ?? null,
      });
      if (!job) {
        return { status: 400 as const, body: { message: 'No cards are waiting to print for this client' } };
      }

      return {
        status: 201 as const,
        body: {
          ...mapPrintJob(job, APP_ORIGIN),
          // Surfaced so the console can warn before the link is sent: a printer
          // with no address has nowhere to ship, and the page will say so.
          hasAddress: !!(company.address ?? '').trim(),
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret create print link failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Create print link failed' } };
    }
  },

  /** GET /api/karim-admin-secret/companies/:companyId/print-links */
  listPrintLinks: async ({ params }: { params: { companyId: string } }) => {
    try {
      await ensurePrintJobSchema();
      const rows = await query<any>(
        `SELECT * FROM qr_card_print_jobs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [params.companyId],
      );
      return { status: 200 as const, body: { links: rows.map((r) => mapPrintJob(r, APP_ORIGIN)) } };
    } catch (error: any) {
      console.error('karim-admin-secret list print links failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'List print links failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/print-links/:id/revoke
   * Kill a link that was sent to the wrong printer, or is simply finished.
   * Immediate: the public page checks revoked_at on every request.
   */
  revokePrintLink: async ({ params }: { params: { id: string } }) => {
    try {
      await ensurePrintJobSchema();
      const row = await queryOne<any>(
        `UPDATE qr_card_print_jobs SET revoked_at = NOW()
          WHERE id = $1 AND revoked_at IS NULL RETURNING *`,
        [params.id],
      );
      if (!row) return { status: 404 as const, body: { message: 'Link not found or already revoked' } };
      return { status: 200 as const, body: mapPrintJob(row, APP_ORIGIN) };
    } catch (error: any) {
      console.error('karim-admin-secret revoke print link failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Revoke print link failed' } };
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
   * POST /api/karim-admin-secret/companies/:companyId/online-exams  { enabled }
   * Turn online exams — lessons, question banks and the student exam portal — on
   * or off for one client. Off by default: the feature ships dark and is switched
   * on one tenant at a time, starting with our own test tenant.
   *
   * Switching a tenant OFF is immediate and blunt: their Lessons screen disappears
   * and every endpoint behind the flag starts refusing. Don't do it to a tenant
   * mid-exam.
   */
  setOnlineExamsEnabled: async ({ params, body }: { params: { companyId: string }; body: { enabled: boolean } }) => {
    try {
      await ensureOnlineExamsColumn();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const enabled = body?.enabled === true;
      await query('UPDATE companies SET online_exams_enabled = $2, updated_at = NOW() WHERE id = $1',
        [params.companyId, enabled]);

      return { status: 200 as const, body: { success: true, online_exams_enabled: enabled } };
    } catch (error: any) {
      console.error('karim-admin-secret set online exams failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Set online exams failed' } };
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
    body: { count: number; poolType?: number; price?: number | null; startFrom?: number | null };
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

      // Price per card, stamped on every card in the run (migration 077).
      // Omitted stays NULL — "not recorded", which is not the same as free.
      const rawPrice = body?.price;
      let price: number | null = null;
      if (rawPrice !== undefined && rawPrice !== null && String(rawPrice) !== '') {
        price = Number(rawPrice);
        if (!Number.isFinite(price) || price < 0) {
          return { status: 400 as const, body: { message: 'price must be a positive number' } };
        }
      }

      // New cards mint in the V2 range and print "0N"; the number continues from
      // the last card. The reserved range keeps serials clear of student codes.
      //
      // startFrom overrides where the run begins — the printed number, not the
      // serial, so "500" means the first card reads 0500. Academies ask for this
      // to start a batch on a round number, or to leave room after cards they
      // already hold. The whole window is checked first: walking into occupied
      // numbers would otherwise die on uq_qr_cards_serial as a bare 500.
      let from = await nextCardSerial(params.companyId);
      const rawStart = body?.startFrom;
      if (rawStart !== undefined && rawStart !== null && String(rawStart) !== '') {
        const startN = Math.floor(Number(rawStart));
        if (!Number.isFinite(startN) || startN < 1 || startN > 999999) {
          return { status: 400 as const, body: { message: 'startFrom must be between 1 and 999999' } };
        }
        const taken = await firstTakenCardNumber(params.companyId, startN, startN + count - 1);
        if (taken !== null) {
          return {
            status: 400 as const,
            body: { message: `Card ${taken} already exists — choose a start that leaves the whole run free` },
          };
        }
        from = CARD_SERIAL_BASE_V2 + startN;
      }

      const rows = await query<any>(
        `INSERT INTO qr_cards (company_id, token, serial, pool_type, price)
         SELECT $1, REPLACE(uuid_generate_v4()::text, '-', ''), g, $4, $5
         FROM generate_series($2::int, $3::int) AS g
         RETURNING serial`,
        [params.companyId, from, from + count - 1, poolType, price],
      );

      return {
        status: 200 as const,
        body: { success: true, created: rows.length, from, to: from + count - 1, poolType, price },
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
                (SELECT COUNT(*) FROM qr_cards q WHERE q.company_id = c.id AND q.student_id IS NOT NULL) AS linked,
                (SELECT COUNT(*) FROM qr_cards q WHERE q.company_id = c.id AND q.printed_at IS NOT NULL) AS printed,
                (SELECT COUNT(*) FROM qr_cards q
                  WHERE q.company_id = c.id AND q.printed_at IS NULL AND q.student_id IS NULL) AS unprinted,
                (SELECT COALESCE(SUM(q.price), 0) FROM qr_cards q WHERE q.company_id = c.id) AS pool_value
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
          printed: Number(row.printed ?? 0),
          unprinted: Number(row.unprinted ?? 0),
          poolValue: Number(row.pool_value ?? 0),
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret qr card stats failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Stats failed' } };
    }
  },

  /**
   * GET /api/karim-admin-secret/companies/:companyId/qr-cards/list?status=
   *
   * The cards themselves — token and serial — so the owner dashboard can render
   * the QR images for a print run without signing in as the client.
   *
   * `status` is unprinted (the pending run) | printed | free | linked | all.
   * Capped at 2000, one run's worth: this returns tokens, and an uncapped dump
   * would hand over a client's whole pool in one response.
   */
  listQrCards: async ({ params, query: q }: {
    params: { companyId: string };
    query?: { status?: string };
  }) => {
    try {
      await ensureQrCardSchema();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      let sql = `SELECT id, token, serial, pool_type, price, printed_at, student_id
                   FROM qr_cards WHERE company_id = $1`;
      const status = q?.status || 'unprinted';
      if (status === 'unprinted') sql += ' AND printed_at IS NULL AND student_id IS NULL';
      else if (status === 'printed') sql += ' AND printed_at IS NOT NULL';
      else if (status === 'free') sql += ' AND student_id IS NULL';
      else if (status === 'linked') sql += ' AND student_id IS NOT NULL';
      sql += ' ORDER BY serial LIMIT 2000';

      const rows = await query<any>(sql, [params.companyId]);
      return {
        status: 200 as const,
        body: rows.map((r) => ({
          id: r.id,
          token: r.token,
          serial: r.serial,
          poolType: r.pool_type ?? 1,
          price: r.price === null || r.price === undefined ? null : parseFloat(r.price),
          printedAt: r.printed_at ?? null,
          printed: r.printed_at != null,
          linked: r.student_id != null,
        })),
      };
    } catch (error: any) {
      console.error('karim-admin-secret list qr cards failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'List failed' } };
    }
  },

  /**
   * POST /api/karim-admin-secret/companies/:companyId/qr-cards/mark-printed  { ids? }
   *
   * Stamp a run as sent to the printer so the next download only carries new
   * cards. `ids` should be exactly what was downloaded; omitting it marks every
   * currently-unprinted card, which is only safe when nothing was minted in
   * between — the dashboard always sends ids.
   *
   * Scoped by company_id as well as id, so a stray id can never reach another
   * client's pool. Already-printed cards are skipped rather than re-stamped.
   */
  markQrCardsPrinted: async ({ params, body }: {
    params: { companyId: string };
    body: { ids?: string[]; printed?: boolean };
  }) => {
    try {
      await ensureQrCardSchema();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : null;
      // printed:false undoes a run that never actually reached the printer.
      const markPrinted = body?.printed !== false;

      let rows: any[];
      if (markPrinted) {
        rows = ids
          ? await query<any>(
              `UPDATE qr_cards SET printed_at = NOW()
                WHERE company_id = $1 AND printed_at IS NULL AND id = ANY($2::uuid[]) RETURNING id`,
              [params.companyId, ids])
          : await query<any>(
              `UPDATE qr_cards SET printed_at = NOW()
                WHERE company_id = $1 AND printed_at IS NULL AND student_id IS NULL RETURNING id`,
              [params.companyId]);
      } else {
        if (!ids) return { status: 400 as const, body: { message: 'ids required to un-mark' } };
        // Linked cards stay printed — that card is physically out there.
        rows = await query<any>(
          `UPDATE qr_cards SET printed_at = NULL
            WHERE company_id = $1 AND student_id IS NULL AND id = ANY($2::uuid[]) RETURNING id`,
          [params.companyId, ids]);
      }

      return { status: 200 as const, body: { success: true, marked: rows.length } };
    } catch (error: any) {
      console.error('karim-admin-secret mark qr cards printed failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Mark printed failed' } };
    }
  },

  /**
   * DELETE /api/karim-admin-secret/companies/:companyId/qr-cards?includeLinked=
   * Throw away a client's pool — a run minted by mistake, or a test batch.
   *
   * Linked cards are KEPT unless includeLinked=true. A linked card is physically
   * in a student's pocket; deleting it stops that card scanning, and the student
   * keeps the card's number as their student_code, so the number on the plastic
   * now belongs to nobody. Their own qr_token still resolves, so they are not
   * locked out — the card is.
   *
   * This does not renumber anything. Serials are allocated as MAX(serial)+1, so
   * emptying a pool means the next run starts over from A1 and mints those
   * numbers again with NEW tokens. Any card from the old run that was already
   * printed then shows a number that belongs to a different card and a QR that
   * resolves to nothing. Only delete a run that has not gone to the printer.
   */
  deleteQrCards: async ({ params, query: q }: {
    params: { companyId: string };
    query?: { includeLinked?: string };
  }) => {
    try {
      await ensureQrCardSchema();
      const company = await queryOne<any>('SELECT id FROM companies WHERE id = $1', [params.companyId]);
      if (!company) return { status: 404 as const, body: { message: 'Company not found' } };

      const includeLinked = q?.includeLinked === 'true';

      const rows = await query<any>(
        includeLinked
          ? `DELETE FROM qr_cards WHERE company_id = $1 RETURNING student_id`
          : `DELETE FROM qr_cards WHERE company_id = $1 AND student_id IS NULL RETURNING student_id`,
        [params.companyId],
      );

      const remaining = await queryOne<any>(
        `SELECT COUNT(*) AS n, COUNT(student_id) AS linked FROM qr_cards WHERE company_id = $1`,
        [params.companyId],
      );

      return {
        status: 200 as const,
        body: {
          success: true,
          deleted: rows.length,
          unlinkedStudents: rows.filter((r) => r.student_id).length,
          keptLinked: Number(remaining?.linked ?? 0),
          remaining: Number(remaining?.n ?? 0),
        },
      };
    } catch (error: any) {
      console.error('karim-admin-secret delete qr cards failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Delete failed' } };
    }
  },
  /**
   * POST /api/karim-admin-secret/companies/:companyId/deactivate
   * The counterpart of activate: park a tenant who has stopped paying. Only the
   * status changes — the paid-through date stays untouched so activate restores
   * exactly what they had. EXPIRED itself is the lock: login and every
   * authenticated request reject it (auth.ts / tenant-isolation.ts).
   */
  deactivateSubscription: async ({ params }: { params: { companyId: string } }) => {
    try {
      const sub = await queryOne<any>('SELECT id FROM subscriptions WHERE company_id = $1', [params.companyId]);
      if (!sub) return { status: 404 as const, body: { message: 'Subscription not found for this company' } };

      await query(
        `UPDATE subscriptions SET status = 'EXPIRED', updated_at = NOW() WHERE id = $1`,
        [sub.id],
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
  listUsers: async ({ query: q, portalUser }: { query: { companyId?: string }; portalUser?: PortalUser }) => {
    try {
      const params: any[] = [];
      const where: string[] = [];
      let sql = `
        SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
               u.email_verified, u.created_at,
               u.company_id, c.name AS company_name
          FROM users u
          LEFT JOIN companies c ON c.id = u.company_id`;
      if (q?.companyId) {
        params.push(q.companyId);
        where.push(`u.company_id = $${params.length}`);
      }
      // A trial-capped caller gets the same slice here as on the tenant list:
      // only accounts inside TRIAL tenants exist for them. Accounts with no
      // tenant at all are hidden too — they are not trial pipeline.
      if (isTrialCapped(portalUser)) {
        where.push(`EXISTS (SELECT 1 FROM subscriptions s
                             WHERE s.company_id = u.company_id AND s.status = 'TRIAL')`);
      }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
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
  createUser: async ({ body, portalUser }: {
    body: { companyId: string; email: string; password: string; firstName: string; lastName: string; role: string };
    portalUser?: PortalUser;
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
      // Same 404 as an unknown id: to a trial-capped caller a non-trial tenant
      // does not exist, and a different answer would say otherwise.
      if (isTrialCapped(portalUser) && !(await companyIsTrial(body.companyId))) {
        return { status: 404 as const, body: { message: 'Company not found' } };
      }

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
  deleteUser: async ({ params, portalUser }: { params: { id: string }; portalUser?: PortalUser }) => {
    try {
      const user = await queryOne<any>('SELECT id, role, company_id FROM users WHERE id = $1', [params.id]);
      if (!user) return { status: 404 as const, body: { message: 'User not found' } };
      // A trial-capped caller may only touch accounts they can see — the same
      // TRIAL slice listUsers serves them, and the same 404 as a bad id.
      if (isTrialCapped(portalUser) && (!user.company_id || !(await companyIsTrial(user.company_id)))) {
        return { status: 404 as const, body: { message: 'User not found' } };
      }

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
  moveUserCompany: async ({ params, body, portalUser }: {
    params: { id: string };
    body: { companyId: string };
    portalUser?: PortalUser;
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
      // A trial-capped caller cannot aim the debug account at a tenant they
      // cannot see. Same 404 as an unknown id, for the same reason as above.
      if (isTrialCapped(portalUser) && !(await companyIsTrial(target.id))) {
        return { status: 404 as const, body: { message: 'Company not found' } };
      }

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

/**
 * What each route asks of the caller. Any-of, so a route reachable from two
 * sections doesn't demand both grants.
 *
 * Typed against the route object, so a new route added above without a line
 * here is a compile error rather than an endpoint that quietly ships open.
 */
const ADMIN_SECRET_PERMISSIONS: { [K in keyof typeof unguardedAdminSecretRoutes]: PortalPermission | PortalPermission[] } = {
  // The tenant list is the spine of both the Companies table and the Cards
  // report, so either grant opens it. read_trial opens it too, but the handler
  // then filters the rows down to TRIAL tenants for anyone holding only that.
  getSubscriptions: ['companies.read', 'cards.read', 'companies.read_trial'],
  extendSubscription: 'companies.write',
  activateSubscription: 'companies.write',
  deactivateSubscription: 'companies.write',
  setCompanyType: 'companies.write',
  // The shipping address is edited from the cards sheet and is a company field.
  setCompanyAddress: ['cards.write', 'companies.write'],
  // Selling a tenant a feature is the same kind of act as extending their
  // subscription, so it rides on the same grant.
  setSmsAccess: 'companies.write',
  setOnlineExamsEnabled: 'companies.write',

  // Handing a batch of cards to an outside printer is part of running the pool.
  createPrintLink: 'cards.write',
  listPrintLinks: 'cards.read',
  revokePrintLink: 'cards.write',
  deleteCompany: 'companies.delete',

  listTelegramBots: 'bots.read',
  addTelegramBot: 'bots.write',

  qrCardStats: 'cards.read',
  listQrCards: 'cards.read',
  setQrCardsEnabled: 'cards.write',
  generateQrCards: 'cards.write',
  markQrCardsPrinted: 'cards.write',
  deleteQrCards: 'cards.write',

  listUsers: 'tenant_users.read',
  createUser: 'tenant_users.write',
  deleteUser: 'tenant_users.write',
  moveUserCompany: 'tenant_users.write',
};

/**
 * Every route above, behind the portal sign-in. Nothing on this prefix is
 * reachable with the path alone any more — see routes/admin-portal.ts for why,
 * and for the one route that is still open (the login itself).
 */
export const adminSecretRoutes = withPortalGuard(unguardedAdminSecretRoutes, ADMIN_SECRET_PERMISSIONS);
