import { query } from '../db/connection';

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
    s.status                                                   AS subscription_type,
    s.price                                                    AS price,
    COALESCE(s.subscription_start_date, s.trial_start_date)    AS start_date,
    COALESCE(s.subscription_end_date,   s.trial_end_date)      AS end_date,
    (SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) AS employee_count,
    (SELECT COUNT(*) FROM branches  b WHERE b.company_id = c.id) AS branch_count,
    (SELECT COUNT(*) FROM students  st WHERE st.company_id = c.id) AS student_count
  FROM companies c
  LEFT JOIN subscriptions s ON s.company_id = c.id
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
        subscription_type: r.subscription_type ?? null,
        price: r.price == null ? null : Number(r.price),
        start_date: toIso(r.start_date),
        end_date: toIso(r.end_date),
        employee_count: Number(r.employee_count ?? 0),
        branch_count: Number(r.branch_count ?? 0),
        student_count: Number(r.student_count ?? 0),
      }));
      return { status: 200 as const, body };
    } catch (error: any) {
      console.error('karim-admin-secret query failed:', error);
      return { status: 500 as const, body: { message: error?.message || 'Query failed' } };
    }
  },
};
