import bcrypt from 'bcryptjs';
import { ensureQrCardSchema, nextCardSerial, firstTakenCardNumber, CARD_SERIAL_BASE_V2 } from './qr-cards';
import { query, queryOne, getClient } from '../db/connection';
import { DEBUG_ACCOUNT_EMAIL, isDebugAccount } from '../utils/debug-account';

/** The roles a user account can hold (mirrors the users.role CHECK constraint). */
export const ADMIN_ROLES = [
  'GLOBAL_ADMIN', 'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
  'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER',
];

/**
 * Intentionally-obscure, unauthenticated read-only endpoint for the owner's
 * local admin console and cards report. Returns one cross-tenant row per
 * company: subscription "type" (status), price, employee/branch/student/course
 * counts, start/end dates, and — because those tools need them — the owner's
 * email, the account mobile, and the tenant's postal address.
 *
 * No auth: the obscure path is the only gate. That was accepted when the payload
 * was aggregate numbers and company names; it now carries contact and address
 * details for every tenant, so the path is genuinely the only thing protecting
 * personal data. Worth revisiting if this endpoint ever outgrows two local-only
 * tools. Read-only: a single SELECT, no writes.
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
        // Blank reads as unset, so a stored empty string can't look like an address.
        address: (r.address ?? '').trim() || null,
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
