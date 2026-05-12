import { insert, query } from '../db/connection';
import { enforce, enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { verifyRecaptcha } from '../utils/recaptcha';
import { getClientIp } from '../utils/request-context';

type AuthHeaders = { authorization?: string };

function mapRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    company: row.company,
    country: row.country,
    branchCount: row.branch_count,
    message: row.message,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const demoLeadsRoutes = {
  // Public — no auth required. Rate-limited by client IP and by submitted
  // email so a spammer can't either flood from one IP or pivot through many
  // IPs to keep hammering the same address.
  create: async ({ body, headers }: { body: any; headers: AuthHeaders }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_FORM_IP);
    try {
      const name = (body?.name || '').toString().trim();
      const email = (body?.email || '').toString().trim().toLowerCase();
      enforce(RATE_LIMITS.PUBLIC_FORM_IP, email || null);
      if (!name || name.length < 2) {
        return { status: 400 as const, body: { message: 'Name is required' } };
      }
      if (!email || !EMAIL_RE.test(email)) {
        return { status: 400 as const, body: { message: 'Valid email is required' } };
      }

      const captcha = await verifyRecaptcha(body?.recaptchaToken, {
        expectedAction: 'demo_lead',
        remoteIp: getClientIp(),
      });
      if (!captcha.ok) {
        return { status: 400 as const, body: { message: captcha.reason } };
      }

      const row = await insert('demo_leads', {
        name: name.slice(0, 200),
        email: email.slice(0, 255),
        phone: (body.phone || '').toString().trim().slice(0, 50) || null,
        company: (body.company || '').toString().trim().slice(0, 255) || null,
        country: (body.country || '').toString().trim().slice(0, 10) || null,
        branch_count: Number.isFinite(body.branchCount) ? body.branchCount : null,
        message: (body.message || '').toString().trim().slice(0, 2000) || null,
        source: (body.source || '').toString().trim().slice(0, 50) || null,
        status: 'NEW',
      });

      return { status: 201 as const, body: { id: row.id, message: 'Thanks — we will be in touch within 24 hours.' } };
    } catch (error: any) {
      console.error('Create demo lead error:', error);
      return { status: 500 as const, body: { message: 'Could not submit the request. Please try again later.' } };
    }
  },

  // Admin-only list (placeholder auth: accepts any caller with Authorization header).
  // Replace with tenant/admin checks if we ever want an internal UI.
  list: async ({ headers }: { headers: AuthHeaders }) => {
    if (!headers.authorization) {
      return { status: 401 as const, body: { message: 'Auth required' } };
    }
    try {
      const rows = await query(
        'SELECT * FROM demo_leads ORDER BY created_at DESC LIMIT 500',
        []
      );
      return { status: 200 as const, body: rows.map(mapRow) };
    } catch (error: any) {
      console.error('List demo leads error:', error);
      return { status: 500 as const, body: { message: error.message || 'Failed to list leads' } };
    }
  },
};
