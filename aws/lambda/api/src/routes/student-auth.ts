import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, queryOne } from '../db/connection';
import { getJWTSecret } from '../utils/secrets';
import { apiError } from '../utils/api-error';
import { enforce, enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { extractStudentContext, signStudentToken } from '../middleware/student-context';
import { ensureQrCardSchema, qrStudentMatchPublic } from './qr-cards';
import { ensureOnlineExamsColumn } from './companies';

/**
 * Sign-in for the student exam portal (exams.netrofit.com) — claim, reset,
 * login. See online_exams.md §0.5.
 *
 * Students never sign into the staff app. Their credential is created (and
 * reset) by scanning their own card: claim-start turns a scanned qr_token into
 * a short-lived claim ticket, claim-finish spends that ticket on a username +
 * password. Possession of the card IS the password reset — the trade for a
 * recovery flow that needs no email, no SMS and no staff involvement. Every
 * reset stamps `reset_at`, which the teacher can see (phase 7), so a silent
 * takeover isn't silent.
 *
 * Everything here checks companies.online_exams_enabled: a student of a gated
 * tenant cannot even create credentials, so the portal is dark for them end to
 * end — and the refusal is the same generic 404 an unknown card gets.
 */

// ─── Schema ─────────────────────────────────────────────────────────────────

// Idempotent runtime guard, same pattern as ensureAdminPortalSchema — the table
// appears on the first request that needs it, so no deploy ordering to get
// wrong. Mirrored in aws/sql/migrations/104_student_auth.sql for fresh installs.
let studentAuthSchemaEnsured = false;
export async function ensureStudentAuthSchema(): Promise<void> {
  if (studentAuthSchemaEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS student_auth (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      student_id    UUID NOT NULL UNIQUE REFERENCES students(id)  ON DELETE CASCADE,
      company_id    UUID NOT NULL        REFERENCES companies(id) ON DELETE CASCADE,
      username      VARCHAR(60)  NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until  TIMESTAMP WITH TIME ZONE,
      last_login_at TIMESTAMP WITH TIME ZONE,
      claimed_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reset_at      TIMESTAMP WITH TIME ZONE,
      created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_student_auth_username ON student_auth(LOWER(username))`);
  await query(`CREATE INDEX IF NOT EXISTS idx_student_auth_company ON student_auth(company_id)`);
  studentAuthSchemaEnsured = true;
}

// ─── Identifier canonicalisation ────────────────────────────────────────────

/** Only phone characters, and enough of them to plausibly BE a phone. */
const PHONE_SHAPE = /^\+?[\d\s()-]{6,}$/;

/**
 * The one form an identifier is stored and looked up in.
 *
 * A phone number is a valid username, and the same phone arrives in many
 * shapes — 01001234567, +20 100 123 4567, 00201001234567 — which must all
 * resolve to ONE account, not several. Canonical form is the bare local
 * number: digits only, international prefix (00/+20) and leading zero
 * stripped. Egypt-specific on the country code, like normalizePhone's
 * leading-zero rule in routes/auth.ts — this is an Egyptian product.
 *
 * Anything not phone-shaped is a plain username: trimmed and lower-cased.
 */
export function canonicalIdentifier(input: string): string {
  const trimmed = (input || '').trim();
  if (!PHONE_SHAPE.test(trimmed)) return trimmed.toLowerCase();
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // +20 1xxxxxxxxx — the country code in front of a full Egyptian mobile.
  if (digits.length === 12 && digits.startsWith('201')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** Letters/digits/._- only — a username is typed on a phone keyboard.
 *  Exported for the staff-side credential editor, so both entrances to
 *  student_auth accept exactly the same names. */
export const USERNAME_SHAPE = /^[a-z0-9._-]{3,60}$/;

// ─── Claim tickets ──────────────────────────────────────────────────────────

/**
 * A claim ticket is what a successful card scan buys: proof of possession,
 * detached from the raw qr_token so the token isn't sitting in the SPA while a
 * password is typed. Ten minutes — enough to type a password, useless tomorrow.
 * `typ` keeps it out of extractTenantContext (which rejects all typ-bearing
 * tokens) and out of extractStudentContext (which wants typ 'student').
 */
const CLAIM_TICKET_TYPE = 'STUDENT_CLAIM';
const CLAIM_TICKET_TTL = '10m';

async function signClaimTicket(studentId: string): Promise<string> {
  const secret = await getJWTSecret();
  return jwt.sign({ sub: studentId, typ: CLAIM_TICKET_TYPE }, secret, { expiresIn: CLAIM_TICKET_TTL });
}

async function verifyClaimTicket(ticket: string): Promise<string | null> {
  try {
    const secret = await getJWTSecret();
    const decoded = jwt.verify(ticket, secret) as { sub?: string; typ?: string };
    if (decoded?.typ !== CLAIM_TICKET_TYPE || !decoded.sub) return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

// ─── Shared lookups ─────────────────────────────────────────────────────────

/**
 * One generic refusal for every way a card scan can fail — unknown token,
 * unlinked card, inactive student, gated tenant. Telling them apart would let
 * a found card map out which academies have the portal on.
 */
const CARD_REFUSED = () => apiError(404, 'ERRORS.STUDENT_AUTH.CARD_NOT_FOUND', 'Card not recognised');

const LOGIN_REFUSED = () =>
  apiError(401, 'ERRORS.STUDENT_AUTH.BAD_CREDENTIALS', 'Wrong username or password');

/** Time a bcrypt compare takes, spent on purpose — see admin-portal.ts login. */
const DUMMY_HASH = '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinva';

export const MIN_PASSWORD_LENGTH = 8;
const LOCKOUT_AFTER = 10;
const LOCKOUT_MINUTES = 15;

/** The portal-eligible student a claim resolves to, or null. */
async function claimableStudent(studentId: string): Promise<any | null> {
  await ensureOnlineExamsColumn();
  const row = await queryOne<any>(
    `SELECT s.id, s.name, s.company_id, c.online_exams_enabled
       FROM students s
       JOIN companies c ON c.id = s.company_id
      WHERE s.id = $1 AND s.is_active = true`,
    [studentId]
  );
  return row && row.online_exams_enabled === true ? row : null;
}

function sessionBody(token: string, student: { name: string }, username: string) {
  return { token, student: { name: student.name, username } };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export const studentAuthRoutes = {
  /**
   * POST /api/student-auth/claim-start  { qrToken }
   *
   * Resolve a scanned card to its student and hand back a claim ticket. Returns
   * the student's NAME so the portal can ask "Is this you?" before a password
   * is set — a mis-scan must not set someone else's password — and whether
   * credentials already exist, so the next screen says "reset" not "create".
   */
  claimStart: async ({ body }: { body: { qrToken: string } }) => {
    enforceByIp(RATE_LIMITS.STUDENT_CLAIM_IP);
    try {
      await ensureStudentAuthSchema();
      await ensureQrCardSchema();
      await ensureOnlineExamsColumn();

      const token = (body?.qrToken || '').trim();
      // Same shape gate as the public profile; tokens are 32 hex chars.
      if (!/^[a-f0-9]{16,64}$/i.test(token)) return CARD_REFUSED();

      // The existing predicate, so pool-card linking rules stay in one place.
      const student = await queryOne<any>(
        `SELECT s.id, s.name, s.company_id, c.online_exams_enabled
           FROM students s
           JOIN companies c ON c.id = s.company_id
          WHERE ${qrStudentMatchPublic('$1')} AND s.is_active = true`,
        [token]
      );
      if (!student || student.online_exams_enabled !== true) return CARD_REFUSED();

      const existing = await queryOne<any>(
        'SELECT 1 AS present FROM student_auth WHERE student_id = $1',
        [student.id]
      );

      return {
        status: 200 as const,
        body: {
          studentName: student.name,
          hasCredentials: !!existing,
          claimTicket: await signClaimTicket(student.id),
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student claim-start failed:', error);
      return CARD_REFUSED();
    }
  },

  /**
   * POST /api/student-auth/claim-finish  { claimTicket, username, password }
   *
   * Spend the ticket on credentials. This is both "set my password" and "reset
   * my password" — one scan, one endpoint. On a first claim the student picks
   * the username; on a reset the existing username is kept and only the
   * password changes (the card proves possession, not the right to rename).
   */
  claimFinish: async ({ body }: { body: { claimTicket: string; username: string; password: string } }) => {
    enforceByIp(RATE_LIMITS.STUDENT_CLAIM_IP);
    try {
      await ensureStudentAuthSchema();

      const studentId = await verifyClaimTicket(body?.claimTicket || '');
      if (!studentId) {
        return apiError(401, 'ERRORS.STUDENT_AUTH.CLAIM_EXPIRED', 'The scan has expired — scan the card again');
      }
      // Re-checked here, not just at claim-start: the flag or the student may
      // have been switched off in the minutes the ticket lives.
      const student = await claimableStudent(studentId);
      if (!student) return CARD_REFUSED();

      const password = body?.password ?? '';
      if (password.length < MIN_PASSWORD_LENGTH) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters`);
      }

      const existing = await queryOne<any>(
        'SELECT username FROM student_auth WHERE student_id = $1',
        [studentId]
      );

      let username: string;
      if (existing) {
        username = existing.username;
        await query(
          `UPDATE student_auth
              SET password_hash = $1, reset_at = NOW(), failed_attempts = 0,
                  locked_until = NULL, updated_at = NOW()
            WHERE student_id = $2`,
          [await bcrypt.hash(password, 10), studentId]
        );
      } else {
        username = canonicalIdentifier(body?.username ?? '');
        // A canonicalised phone is always valid; anything else must look like a
        // username someone can retype on a phone keyboard.
        if (!USERNAME_SHAPE.test(username)) {
          return apiError(400, 'ERRORS.STUDENT_AUTH.BAD_USERNAME', 'Pick a username of 3-60 letters, digits, dots or dashes — or your phone number');
        }
        const taken = await queryOne<any>(
          'SELECT student_id FROM student_auth WHERE LOWER(username) = $1',
          [username]
        );
        if (taken) {
          return apiError(409, 'ERRORS.STUDENT_AUTH.USERNAME_TAKEN', 'That name is taken — pick another');
        }
        await query(
          `INSERT INTO student_auth (student_id, company_id, username, password_hash)
           VALUES ($1, $2, $3, $4)`,
          [studentId, student.company_id, username, await bcrypt.hash(password, 10)]
        );
      }

      const token = await signStudentToken(studentId, student.company_id);
      return { status: 200 as const, body: sessionBody(token, student, username) };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      // The unique index can still race two simultaneous claims of one name.
      if (error?.code === '23505') {
        return apiError(409, 'ERRORS.STUDENT_AUTH.USERNAME_TAKEN', 'That name is taken — pick another');
      }
      console.error('Student claim-finish failed:', error);
      return apiError(500, 'ERRORS.STUDENT_AUTH.CLAIM_FAILED', 'Could not finish setting up');
    }
  },

  /**
   * POST /api/student-auth/login  { identifier, password }
   *
   * A miss always answers the same generic 401 in the same time — dummy
   * bcrypt.compare when no row exists — so a wrong username and a wrong
   * password cannot be told apart. Ten misses lock the account for 15 minutes;
   * the lockout IS distinguishable, deliberately: the portal shows "locked,
   * try later" as its own screen rather than gaslighting a student whose
   * password is right.
   */
  login: async ({ body }: { body: { identifier: string; password: string } }) => {
    enforceByIp(RATE_LIMITS.STUDENT_LOGIN_IP);
    try {
      await ensureStudentAuthSchema();
      await ensureOnlineExamsColumn();

      const ident = canonicalIdentifier(body?.identifier ?? '');
      const password = body?.password ?? '';
      if (ident) enforce(RATE_LIMITS.STUDENT_LOGIN_IDENT, ident);

      const row = ident
        ? await queryOne<any>(
            `SELECT a.*, s.name AS student_name, s.is_active AS student_active,
                    c.online_exams_enabled
               FROM student_auth a
               JOIN students  s ON s.id = a.student_id
               JOIN companies c ON c.id = a.company_id
              WHERE LOWER(a.username) = $1`,
            [ident]
          )
        : null;

      if (!row || row.student_active !== true || row.online_exams_enabled !== true) {
        // A gated tenant's credential and a deactivated student answer exactly
        // like a wrong password — and take as long.
        await bcrypt.compare(password, DUMMY_HASH);
        return LOGIN_REFUSED();
      }

      if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        return apiError(403, 'ERRORS.STUDENT_AUTH.LOCKED', 'Too many attempts — try again in a few minutes');
      }

      if (!(await bcrypt.compare(password, row.password_hash))) {
        await query(
          `UPDATE student_auth
              SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE WHEN failed_attempts + 1 >= $2
                                      THEN NOW() + make_interval(mins => $3) END,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, LOCKOUT_AFTER, LOCKOUT_MINUTES]
        );
        return LOGIN_REFUSED();
      }

      await query(
        `UPDATE student_auth
            SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [row.id]
      );

      const token = await signStudentToken(row.student_id, row.company_id);
      return { status: 200 as const, body: sessionBody(token, { name: row.student_name }, row.username) };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student login failed:', error);
      return apiError(500, 'ERRORS.STUDENT_AUTH.LOGIN_FAILED', 'Login failed');
    }
  },

  /**
   * GET /api/student-auth/me — who the token belongs to. The portal restores
   * its session from this on every load, so a revoked credential or a switched-
   * off tenant bounces to the login screen on the next refresh.
   */
  me: async ({ headers }: { headers: { authorization?: string } }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureStudentAuthSchema();
      const row = await queryOne<any>(
        `SELECT a.username, a.last_login_at,
                s.name, s.student_code, s.qr_token,
                b.name AS branch_name, c.name AS company_name
           FROM student_auth a
           JOIN students  s ON s.id = a.student_id
           JOIN companies c ON c.id = a.company_id
           LEFT JOIN branches b ON b.id = s.branch_id
          WHERE a.student_id = $1`,
        [guard.student.studentId]
      );
      // A revoked credential with a still-live token: signed out, not 500.
      if (!row) {
        return apiError(401, 'ERRORS.STUDENT_AUTH.SESSION_EXPIRED', 'Session expired. Sign in again.');
      }
      return {
        status: 200 as const,
        body: {
          name: row.name,
          username: row.username,
          companyName: row.company_name,
          branchName: row.branch_name ?? null,
          lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
          // The student's own card: the short code they read out to a teacher
          // and the QR the attendance scanner reads. Same values the printed
          // card carries, so a phone screen stands in for a forgotten card.
          studentCode: row.student_code === null || row.student_code === undefined ? null : Number(row.student_code),
          qrToken: row.qr_token ?? null,
        },
      };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student me failed:', error);
      return apiError(500, 'ERRORS.STUDENT_AUTH.ME_FAILED', 'Could not load your account');
    }
  },

  /**
   * POST /api/student-auth/change-password  { currentPassword, newPassword }
   * For a student who remembers the old one and has no card to hand.
   */
  changePassword: async ({ headers, body }: {
    headers: { authorization?: string };
    body: { currentPassword: string; newPassword: string };
  }) => {
    const guard = await extractStudentContext(headers?.authorization);
    if (!guard.ok) return guard.response;
    try {
      await ensureStudentAuthSchema();
      const row = await queryOne<any>(
        'SELECT id, password_hash FROM student_auth WHERE student_id = $1',
        [guard.student.studentId]
      );
      if (!row || !(await bcrypt.compare(body?.currentPassword ?? '', row.password_hash))) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.WRONG_PASSWORD', 'That is not your current password');
      }
      const next = body?.newPassword ?? '';
      if (next.length < MIN_PASSWORD_LENGTH) {
        return apiError(400, 'ERRORS.STUDENT_AUTH.WEAK_PASSWORD', `Use at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      await query(
        'UPDATE student_auth SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [await bcrypt.hash(next, 10), row.id]
      );
      return { status: 200 as const, body: { success: true } };
    } catch (error: any) {
      if (error?.statusCode === 429 || error?.status === 429) throw error;
      console.error('Student change-password failed:', error);
      return apiError(500, 'ERRORS.STUDENT_AUTH.PASSWORD_FAILED', 'Could not change the password');
    }
  },
};
