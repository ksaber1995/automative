import { queryOne } from '../db/connection';

// Paid QR activation pricing (EGP), TEACHER-type companies only.
// ONE_YEAR = one-year expiry; LIFELONG = never expires. Academies get QR free.
export const QR_PLAN_PRICES = { ONE_YEAR: 15, LIFELONG: 30 } as const;
export type QrPlan = keyof typeof QR_PLAN_PRICES;

// Launch promo: the first N companies to register as TEACHER get free QR
// activation for ALL their students. Eligibility is keyed on registration
// order (companies.created_at), which is immutable, so a company's free status
// never changes once it is established — no flag/column, no migration needed.
export const QR_FREE_TEACHER_LIMIT = 100;

/**
 * True when the company is a TEACHER tenant that falls within the first
 * QR_FREE_TEACHER_LIMIT registered teacher companies (by registration order).
 * Academies always return false (their QR is already free by a different path).
 */
export async function isCompanyQrFree(companyId: string): Promise<boolean> {
  const row = await queryOne<any>(
    `SELECT c.type AS type,
            (SELECT COUNT(*) FROM companies e
              WHERE e.type = 'TEACHER' AND e.created_at < c.created_at) AS earlier
       FROM companies c
      WHERE c.id = $1`,
    [companyId]
  );
  if (!row || row.type !== 'TEACHER') return false;
  return parseInt(row.earlier, 10) < QR_FREE_TEACHER_LIMIT;
}
