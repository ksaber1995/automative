import jwt from 'jsonwebtoken';
import { getJWTSecret } from '../utils/secrets';
import { queryOne } from '../db/connection';
import { ensureOnlineExamsColumn } from '../routes/companies';
import { enforce, RATE_LIMITS } from './rate-limit';

/**
 * The student exam portal's session — the OTHER audience of the shared JWT
 * secret, alongside staff tokens and admin-portal tokens.
 *
 * Student tokens deliberately carry NO `role` and NO `permissions` claim:
 * nothing a student token holds should look like staff authority. They MUST
 * carry `companyId` for tenant scoping, which is exactly why they would pass
 * extractTenantContext's only structural check — so that function rejects any
 * token carrying a `typ` claim, and this one requires `typ === 'student'`.
 * The two checks together are what keep a student out of the staff API and a
 * staff member out of impersonating a student. See online_exams.md §0.5.5.
 */
export const STUDENT_TOKEN_TYPE = 'student';

/** Staff tokens last a year; a session on a shared family phone should not. */
const STUDENT_TOKEN_TTL = '12h';

interface StudentTokenPayload {
  sub: string;
  companyId: string;
  typ: typeof STUDENT_TOKEN_TYPE;
}

export interface StudentContext {
  studentId: string;
  companyId: string;
  branchId: string | null;
  /** For greeting headers — saves every screen a second lookup. */
  name: string;
}

export async function signStudentToken(studentId: string, companyId: string): Promise<string> {
  const secret = await getJWTSecret();
  const payload: StudentTokenPayload = { sub: studentId, companyId, typ: STUDENT_TOKEN_TYPE };
  return jwt.sign(payload, secret, { expiresIn: STUDENT_TOKEN_TTL });
}

function bearer(authHeader?: string): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  return parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
}

export type StudentGuard =
  | { ok: true; student: StudentContext }
  | { ok: false; response: { status: 401 | 403; body: { message: string; code: string } } };

const SESSION_EXPIRED = {
  status: 401 as const,
  body: { code: 'ERRORS.STUDENT_AUTH.SESSION_EXPIRED', message: 'Session expired. Sign in again.' },
};

/**
 * Resolve the signed-in student from the Authorization header.
 *
 * Re-reads the student row and the company's online_exams_enabled flag on EVERY
 * request rather than trusting the token: deactivating a student, or switching
 * a tenant's portal off, has to take effect now — mid-paper — not in twelve
 * hours when the token dies. Never calls checkGranularPermission; students have
 * no RBAC row and never will.
 */
export async function extractStudentContext(authHeader?: string): Promise<StudentGuard> {
  const token = bearer(authHeader);
  if (!token) return { ok: false, response: SESSION_EXPIRED };

  let payload: Partial<StudentTokenPayload>;
  try {
    const secret = await getJWTSecret();
    payload = jwt.verify(token, secret) as Partial<StudentTokenPayload>;
  } catch {
    return { ok: false, response: SESSION_EXPIRED };
  }
  if (payload?.typ !== STUDENT_TOKEN_TYPE || !payload.sub || !payload.companyId) {
    return { ok: false, response: SESSION_EXPIRED };
  }

  // Same idea as extractTenantContext's per-user limit; throws a 429 that
  // propagates straight through ts-rest.
  enforce(RATE_LIMITS.STUDENT_AUTHED, payload.sub);

  await ensureOnlineExamsColumn();
  // student_auth needs no ensure here: a student token can only have been minted
  // by claim-finish or login, both of which ran ensureStudentAuthSchema on this
  // same database first.
  const row = await queryOne<any>(
    `SELECT s.id, s.name, s.branch_id, s.is_active, c.online_exams_enabled,
            (a.student_id IS NOT NULL) AS has_credentials
       FROM students s
       JOIN companies c ON c.id = s.company_id
       LEFT JOIN student_auth a ON a.student_id = s.id
      WHERE s.id = $1 AND s.company_id = $2`,
    [payload.sub, payload.companyId]
  );
  // A deleted or deactivated student — or one whose credentials a teacher has
  // REVOKED (the student_auth row is gone but their 12h token isn't) — answers
  // exactly like an expired session: back to the login screen on the next call.
  if (!row || row.is_active !== true || row.has_credentials !== true) {
    return { ok: false, response: SESSION_EXPIRED };
  }
  if (row.online_exams_enabled !== true) {
    return {
      ok: false,
      response: {
        status: 403,
        body: {
          code: 'ERRORS.ONLINE_EXAMS.NOT_AVAILABLE',
          message: 'Online exams are not enabled for this account',
        },
      },
    };
  }

  return {
    ok: true,
    student: {
      studentId: row.id,
      companyId: payload.companyId,
      branchId: row.branch_id ?? null,
      name: row.name,
    },
  };
}
