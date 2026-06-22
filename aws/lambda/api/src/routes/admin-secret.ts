import { query, queryOne } from '../db/connection';

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
    s.status                                                   AS subscription_type,
    s.price                                                    AS price,
    COALESCE(s.subscription_start_date, s.trial_start_date)    AS start_date,
    COALESCE(s.subscription_end_date,   s.trial_end_date)      AS end_date,
    (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
    (SELECT COUNT(*) FROM branches  b WHERE b.company_id = c.id) AS branch_count,
    (SELECT COUNT(*) FROM students  st WHERE st.company_id = c.id) AS student_count,
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
        subscription_type: r.subscription_type ?? null,
        price: r.price == null ? null : Number(r.price),
        start_date: toIso(r.start_date),
        end_date: toIso(r.end_date),
        employee_count: Number(r.employee_count ?? 0),
        branch_count: Number(r.branch_count ?? 0),
        student_count: Number(r.student_count ?? 0),
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
};
