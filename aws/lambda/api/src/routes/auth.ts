import bcrypt from 'bcryptjs';
import { query, queryOne, getClient } from '../db/connection';
import { signToken, signRefreshToken, verifyToken, extractTokenFromHeader } from '../utils/jwt';
import { sendWhatsappOtp, sendWhatsappPasswordResetOtp } from '../utils/whatsapp';
import { verifyRecaptcha } from '../utils/recaptcha';
import { enforce, enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { getClientIp } from '../utils/request-context';
import { apiError } from '../utils/api-error';
import { isCompanyQrFree } from '../utils/qr-pricing';
import {
  DEFAULT_CARD_DESIGN,
  ensureCardDesignColumn,
  ensureAutoManageSessionsColumn,
  ensureVerticalColumn,
  ensureOnlineExamsColumn,
  toVertical,
} from './companies';
import { ensureQrCardSchema } from './qr-cards';

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(input: string | null | undefined): string {
  const digits = (input || '').replace(/\D/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

function normalizeCountryCode(input: string | null | undefined): string {
  return (input || '').replace(/\D/g, '');
}

// Resolves a login identifier to a user. Accepts an email or a phone number
// in any common shape (local with leading 0, international with or without +).
// Returns null if no user matches.
async function findUserByIdentifier(identifier: string): Promise<any | null> {
  const trimmed = (identifier || '').trim();
  if (!trimmed) return null;

  // The queries below read c.qr_cards_enabled, c.vertical and
  // c.online_exams_enabled, so all three columns have to exist — a login must
  // never 500 on a database that predates them.
  await ensureQrCardSchema();
  await ensureVerticalColumn();
  await ensureOnlineExamsColumn();

  if (trimmed.includes('@')) {
    return queryOne<any>(
      `SELECT u.*,
              c.is_active as company_is_active,
              c.subscription_status,
              c.name as company_name,
              c.type as company_type,
              c.plan as company_plan,
              c.vertical as company_vertical,
              c.qr_cards_enabled as company_qr_cards,
              c.online_exams_enabled as company_online_exams
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.email) = LOWER($1)`,
      [trimmed]
    );
  }

  const local = normalizePhone(trimmed);
  if (!local) return null;

  const direct = await queryOne<any>(
    `SELECT u.*,
            c.is_active as company_is_active,
            c.subscription_status,
            c.name as company_name,
            c.type as company_type,
            c.plan as company_plan,
            c.vertical as company_vertical,
            c.qr_cards_enabled as company_qr_cards,
            c.online_exams_enabled as company_online_exams
     FROM users u
     JOIN companies c ON u.company_id = c.id
     WHERE u.phone = $1
     LIMIT 1`,
    [local]
  );
  if (direct) return direct;

  return queryOne<any>(
    `SELECT u.*,
            c.is_active as company_is_active,
            c.subscription_status,
            c.name as company_name,
            c.type as company_type,
            c.plan as company_plan,
            c.vertical as company_vertical,
            c.qr_cards_enabled as company_qr_cards,
            c.online_exams_enabled as company_online_exams
     FROM users u
     JOIN companies c ON u.company_id = c.id
     WHERE u.phone IS NOT NULL AND $1 LIKE '%' || u.phone
     LIMIT 1`,
    [local]
  );
}

async function buildSafeUser(user: any, branchIds: string[]) {
  // Launch promo: expose whether this (teacher) tenant gets free QR activation
  // so the client can skip the cost prompt. Academies are never charged, so we
  // only query for teacher companies.
  const qrFree =
    (user.company_type ?? 'ACADEMY') === 'TEACHER'
      ? await isCompanyQrFree(user.company_id)
      : false;
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    companyId: user.company_id,
    companyType: user.company_type ?? 'ACADEMY',
    plan: user.company_plan ?? 'SIMPLE',
    /**
     * What this academy calls things. The client loads a vocabulary overlay for
     * anything other than GENERAL — see the sports i18n files. It rides on the
     * user payload rather than a settings call so the words are right on the
     * first paint after login, not one request later.
     */
    vertical: toVertical(user.company_vertical),
    /** The pre-printed QR card pool is sold per academy; off unless we switch it on. */
    qrCardsEnabled: user.company_qr_cards === true,
    /**
     * Online exams (lessons, question banks, the student exam portal) — switched
     * on per tenant from the admin console, off for everyone else. Rides on the
     * user payload like the flag above so the sidebar is right on first paint;
     * the API enforces it independently, so this only decides what is shown.
     *
     * Read at login: flipping the flag needs a re-login (or refreshCurrentUser)
     * before the client notices.
     */
    onlineExamsEnabled: user.company_online_exams === true,
    qrFree,
    branchId: user.branch_id,
    branchIds,
    linkedEmployeeId: user.linked_employee_id ?? null,
    permissions: user.permissions ?? null,
    isActive: user.is_active,
    countryCode: user.country_code ?? null,
    phone: user.phone ?? null,
    emailVerified: user.email_verified ?? false,
  };
}

async function loadBranchIds(user: any): Promise<string[]> {
  let branchIds: string[] = [];
  try {
    const userBranches = await query<any>(
      'SELECT branch_id FROM user_branches WHERE user_id = $1',
      [user.id]
    );
    branchIds = userBranches.map((r: any) => r.branch_id);
  } catch {}
  if (branchIds.length === 0 && user.branch_id) branchIds = [user.branch_id];
  return branchIds;
}

export const authRoutes = {
  login: async ({ body }: { body: { identifier: string; password: string } }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    enforce(RATE_LIMITS.AUTH_EMAIL, (body.identifier || '').trim().toLowerCase() || null);
    try {
      const user = await findUserByIdentifier(body.identifier);

      if (!user) {
        return apiError(401, 'ERRORS.AUTH.INVALID_CREDENTIALS', 'Invalid credentials');
      }

      const isValidPassword = await bcrypt.compare(body.password, user.password);
      if (!isValidPassword) {
        return apiError(401, 'ERRORS.AUTH.INVALID_CREDENTIALS', 'Invalid credentials');
      }

      if (!user.company_is_active) {
        return apiError(401, 'ERRORS.AUTH.COMPANY_INACTIVE', 'Company account is inactive. Please contact support.');
      }

      if (user.subscription_status === 'SUSPENDED' || user.subscription_status === 'CANCELLED') {
        return apiError(401, 'ERRORS.AUTH.SUBSCRIPTION_INACTIVE', 'Company subscription is not active. Please contact support.');
      }

      // A tenant parked from the admin console lives in the subscriptions
      // table, not on the companies row the checks above read. Without this,
      // a deactivated tenant still gets a fresh session and only finds out
      // when every API call rejects it.
      const parkedSub = await queryOne<any>(
        'SELECT status FROM subscriptions WHERE company_id = $1',
        [user.company_id]
      );
      if (parkedSub?.status === 'EXPIRED') {
        return apiError(401, 'ERRORS.AUTH.SUBSCRIPTION_INACTIVE', 'Company subscription is not active. Please contact support.');
      }

      if (!user.is_active) {
        return apiError(401, 'ERRORS.AUTH.USER_INACTIVE', 'User account is inactive');
      }

      // ── OTP verification temporarily disabled ──────────────────────────────
      // if (!user.email_verified) {
      //   return {
      //     status: 403 as const,
      //     body: {
      //       message: 'Please verify your account via WhatsApp OTP before logging in.',
      //       code: 'ERRORS.AUTH.EMAIL_NOT_VERIFIED',
      //       email: user.email,
      //     },
      //   };
      // }
      // ──────────────────────────────────────────────────────────────────────

      const branchIds = await loadBranchIds(user);

      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        branchId: user.branch_id,
        permissions: user.permissions ?? null,
      };

      const accessToken = await signToken(payload);
      const refreshToken = await signRefreshToken(payload);

      return {
        status: 200 as const,
        body: {
          accessToken,
          refreshToken,
          user: await buildSafeUser(user, branchIds),
        },
      };
    } catch (error) {
      console.error('Login error:', error);
      return apiError(401, 'ERRORS.AUTH.LOGIN_FAILED', 'Authentication failed');
    }
  },

  register: async ({
    body,
  }: {
    body: {
      companyName: string;
      type?: 'ACADEMY' | 'TEACHER' | 'SCHOOL';
      plan?: 'SIMPLE' | 'ADVANCED';
      vertical?: 'GENERAL' | 'SPORTS';
      industry?: string;
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      countryCode: string;
      phone: string;
      timezone?: string;
      recaptchaToken?: string;
    };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    enforce(RATE_LIMITS.AUTH_EMAIL, (body.email || '').trim().toLowerCase() || null);

    const captcha = await verifyRecaptcha(body.recaptchaToken, {
      expectedAction: 'register',
      remoteIp: getClientIp(),
    });
    if (!captcha.ok) {
      return apiError(400, 'ERRORS.RECAPTCHA_FAILED', captcha.reason || 'Captcha verification failed');
    }

    const countryCode = normalizeCountryCode(body.countryCode);
    const phone = normalizePhone(body.phone);
    const email = (body.email || '').trim().toLowerCase();

    if (!countryCode) {
      return apiError(400, 'ERRORS.AUTH.COUNTRY_CODE_REQUIRED', 'Country code is required.');
    }
    if (!phone) {
      return apiError(400, 'ERRORS.AUTH.PHONE_REQUIRED', 'Phone number is required.');
    }
    if (!email) {
      return apiError(400, 'ERRORS.AUTH.EMAIL_REQUIRED', 'Email is required.');
    }
    // SCHOOL is a recognised company type with no signup flow yet — the login
    // page shows it as "Coming soon" (no link), so reaching here at all means a
    // request was crafted by hand. Reject explicitly rather than silently
    // downgrading it to ACADEMY, which would create a company nobody asked for.
    if (body.type === 'SCHOOL') {
      return apiError(400, 'ERRORS.AUTH.SCHOOL_NOT_AVAILABLE', 'School registration is coming soon.');
    }

    const client = await getClient();

    try {
      await client.query('BEGIN');

      const existingUser = await queryOne(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );
      if (existingUser) {
        await client.query('ROLLBACK');
        return apiError(400, 'ERRORS.AUTH.EMAIL_TAKEN', 'An account with this email already exists.');
      }

      const existingPhone = await queryOne(
        'SELECT id FROM users WHERE phone = $1',
        [phone]
      );
      if (existingPhone) {
        await client.query('ROLLBACK');
        return apiError(400, 'ERRORS.AUTH.PHONE_TAKEN', 'A user with this phone number already exists.');
      }

      // Account type chosen at signup; anything other than TEACHER falls back
      // to ACADEMY so a missing/garbage value can't violate the CHECK constraint.
      // A sports academy IS an academy — the vertical only renames things — so a
      // stray type on that signup must not turn it into a teacher account.
      const vertical = toVertical(body.vertical);
      const companyType = vertical === 'SPORTS' || body.type !== 'TEACHER' ? 'ACADEMY' : 'TEACHER';
      // Feature plan is academy-only; teachers are always SIMPLE. A sports
      // academy is advanced by definition — that is what it was sold as, and the
      // CRM and Cash pages gate on it — so it is not left to the request body.
      const plan =
        vertical === 'SPORTS'
          ? 'ADVANCED'
          : companyType === 'ACADEMY' && body.plan === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE';

      // The INSERT below names `vertical`, so the column has to exist.
      await ensureVerticalColumn();

      // Every new tenant starts with the default ID-card design already on the row,
      // so the card-design page opens on a real record instead of an implicit
      // default that only exists until someone saves.
      await ensureCardDesignColumn();
      // The INSERT below never names auto_manage_sessions — it takes the column
      // default — so the column has to exist, and carry the right default,
      // before a tenant is created.
      await ensureAutoManageSessionsColumn();

      const companyRes = await client.query(
        `INSERT INTO companies
          (name, type, industry, subscription_tier, subscription_status,
           subscription_start_date, subscription_end_date, max_branches, max_users,
           timezone, currency, locale, is_active, onboarding_completed, plan, card_design,
           vertical)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
         RETURNING *`,
        [
          body.companyName, companyType, body.industry || 'Tech Center',
          'BASIC', 'TRIAL',
          new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          1, 5, 'Africa/Cairo', 'EGP', 'en-US', true, false, plan,
          JSON.stringify(DEFAULT_CARD_DESIGN),
          vertical,
        ]
      );
      const company = companyRes.rows[0];

      const branchRes = await client.query(
        `INSERT INTO branches (company_id, name, code, email, phone, is_active, opening_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          company.id, `${body.companyName} - Main Branch`, 'MAIN',
          email, `+${countryCode}${phone}`, true, new Date(),
        ]
      );
      const branch = branchRes.rows[0];

      const hashedPassword = await bcrypt.hash(body.password, 10);

      // ── OTP verification temporarily disabled ──────────────────────────────
      // const otp = generateOtp();
      // const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      // ──────────────────────────────────────────────────────────────────────

      const userRes = await client.query(
        `INSERT INTO users
          (company_id, branch_id, email, password, first_name, last_name, role,
           is_active, country_code, phone, email_verified, email_otp, email_otp_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          company.id, branch.id, email, hashedPassword,
          body.firstName, body.lastName, 'ADMIN', true,
          countryCode, phone, true, null, null,
        ]
      );
      const user = userRes.rows[0];

      await client.query(
        `UPDATE companies SET created_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [user.id, company.id]
      );
      await client.query(
        `UPDATE branches SET manager_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [user.id, branch.id]
      );
      // No cash_state row is seeded here: nothing maintains that table's
      // current_balance, so the 0 it was seeded with stayed 0 forever. Cash is
      // computed from the underlying payments instead — see computeTotalCash in
      // routes/cash.ts.

      const trialStart = new Date();
      const trialEnd = new Date();
      // Teacher tenants get a shorter 7-day trial; academies keep 14 days.
      trialEnd.setDate(trialEnd.getDate() + (companyType === 'TEACHER' ? 7 : 14));
      await client.query(
        `INSERT INTO subscriptions (company_id, status, price, trial_start_date, trial_end_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          company.id, 'TRIAL', 0,
          trialStart.toISOString().split('T')[0],
          trialEnd.toISOString().split('T')[0],
        ]
      );

      await client.query('COMMIT');

      // ── OTP verification temporarily disabled ──────────────────────────────
      // try {
      //   await sendWhatsappOtp(countryCode, phone, otp, body.firstName);
      // } catch (otpError) {
      //   console.error('Failed to send WhatsApp OTP after registration:', otpError);
      // }
      // ──────────────────────────────────────────────────────────────────────

      return {
        status: 201 as const,
        body: {
          email,
          message: 'Registration successful.',
          code: 'AUTH.REGISTRATION_SUCCESS',
        },
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Registration error:', error);

      if (error?.code === '23505') {
        const constraint: string = error?.constraint || '';
        const table: string = error?.table || '';
        const detail: string = error?.detail || '';
        let message = 'Registration failed due to a conflict.';
        let conflictCode = 'ERRORS.AUTH.REGISTRATION_CONFLICT';
        if (constraint.includes('phone') || detail.includes('phone')) {
          message = 'A user with this phone number already exists.';
          conflictCode = 'ERRORS.AUTH.PHONE_TAKEN';
        } else if (table === 'users' || constraint.includes('users')) {
          message = 'An account with this email already exists.';
          conflictCode = 'ERRORS.AUTH.EMAIL_TAKEN';
        }
        return apiError(400, conflictCode, message);
      }

      return apiError(400, 'ERRORS.AUTH.REGISTRATION_FAILED', 'Registration failed. Please try again.');
    } finally {
      client.release();
    }
  },

  verifyEmail: async ({
    body,
  }: {
    body: { email: string; otp: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    try {
      const email = (body.email || '').trim().toLowerCase();
      enforce(RATE_LIMITS.AUTH_EMAIL, email || null);

      // Reads three company feature columns below, so all must exist first.
      await ensureQrCardSchema();
      await ensureVerticalColumn();
      await ensureOnlineExamsColumn();
      const user = await queryOne<any>(
        `SELECT u.*, c.is_active as company_is_active, c.name as company_name, c.type as company_type, c.plan as company_plan,
                c.vertical as company_vertical,
                c.qr_cards_enabled as company_qr_cards,
                c.online_exams_enabled as company_online_exams
         FROM users u
         JOIN companies c ON u.company_id = c.id
         WHERE LOWER(u.email) = LOWER($1)`,
        [email]
      );

      if (!user) {
        return apiError(400, 'ERRORS.AUTH.INVALID_VERIFICATION_REQUEST', 'Invalid verification request.');
      }

      if (user.email_verified) {
        return apiError(400, 'ERRORS.AUTH.EMAIL_ALREADY_VERIFIED', 'Account is already verified.');
      }

      if (!user.email_otp || user.email_otp !== body.otp) {
        return apiError(400, 'ERRORS.AUTH.OTP_INVALID', 'Invalid verification code.');
      }

      if (!user.email_otp_expires_at || new Date(user.email_otp_expires_at) < new Date()) {
        return apiError(400, 'ERRORS.AUTH.OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
      }

      await query(
        `UPDATE users
         SET email_verified = TRUE, email_otp = NULL, email_otp_expires_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [user.id]
      );

      const branchIds = await loadBranchIds(user);

      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.company_id,
        branchId: user.branch_id,
        permissions: user.permissions ?? null,
      };

      const accessToken = await signToken(payload);
      const refreshToken = await signRefreshToken(payload);

      return {
        status: 200 as const,
        body: {
          accessToken,
          refreshToken,
          user: await buildSafeUser({ ...user, email_verified: true }, branchIds),
        },
      };
    } catch (error) {
      console.error('Verify OTP error:', error);
      return apiError(400, 'ERRORS.AUTH.VERIFICATION_FAILED', 'Verification failed. Please try again.');
    }
  },

  resendEmailOtp: async ({
    body,
  }: {
    body: { email: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    try {
      const email = (body.email || '').trim().toLowerCase();
      enforce(RATE_LIMITS.AUTH_EMAIL, email || null);

      const user = await queryOne<any>(
        'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
        [email]
      );

      if (!user) {
        return {
          status: 200 as const,
          body: { message: 'If your account is registered, a new verification code has been sent to your WhatsApp.', code: 'AUTH.OTP_RESEND_OK_GENERIC' },
        };
      }

      if (user.email_verified) {
        return apiError(400, 'ERRORS.AUTH.EMAIL_ALREADY_VERIFIED', 'This account is already verified.');
      }

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        `UPDATE users
         SET email_otp = $1, email_otp_expires_at = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [otp, otpExpiresAt, user.id]
      );

      try {
        await sendWhatsappOtp(user.country_code || '', user.phone || '', otp, user.first_name);
      } catch (otpError) {
        console.error('Failed to send WhatsApp OTP on resend:', otpError);
      }

      return {
        status: 200 as const,
        body: { message: 'A new verification code has been sent to your WhatsApp.', code: 'AUTH.OTP_RESENT' },
      };
    } catch (error) {
      console.error('Resend OTP error:', error);
      return apiError(400, 'ERRORS.AUTH.OTP_RESEND_FAILED', 'Failed to resend code. Please try again.');
    }
  },

  forgotPassword: async ({
    body,
  }: {
    body: { phone: string; recaptchaToken?: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    const phone = normalizePhone(body.phone);
    enforce(RATE_LIMITS.AUTH_EMAIL, phone || null);

    const captcha = await verifyRecaptcha(body.recaptchaToken, {
      expectedAction: 'forgot_password',
      remoteIp: getClientIp(),
    });
    if (!captcha.ok) {
      return apiError(400, 'ERRORS.RECAPTCHA_FAILED', captcha.reason || 'Captcha verification failed');
    }

    // Always respond 200 to avoid leaking which phone numbers are registered.
    const genericResponse = {
      status: 200 as const,
      body: { message: 'If an account exists for that number, a reset code has been sent to your WhatsApp.', code: 'AUTH.PASSWORD_RESET_OTP_SENT_GENERIC' },
    };

    if (!phone) return genericResponse;

    try {
      const user = await queryOne<any>(
        `SELECT id, first_name, country_code, phone
         FROM users
         WHERE phone = $1 OR (phone IS NOT NULL AND $1 LIKE '%' || phone)
         LIMIT 1`,
        [phone]
      );
      if (!user) return genericResponse;

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await query(
        `UPDATE users
         SET password_reset_token = $1, password_reset_expires = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [otp, otpExpiresAt, user.id]
      );

      try {
        await sendWhatsappPasswordResetOtp(user.country_code || '', user.phone || '', otp, user.first_name);
      } catch (err) {
        console.error('Failed to send WhatsApp password reset OTP:', err);
      }

      return genericResponse;
    } catch (error) {
      console.error('Forgot password error:', error);
      return genericResponse;
    }
  },

  resetPassword: async ({
    body,
  }: {
    body: { phone: string; otp: string; password: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    try {
      const phone = normalizePhone(body.phone);
      if (!phone) {
        return apiError(400, 'ERRORS.AUTH.PHONE_REQUIRED', 'Phone number is required.');
      }
      if (!body.otp || body.otp.length !== 6) {
        return apiError(400, 'ERRORS.AUTH.OTP_INVALID', 'Invalid verification code.');
      }
      if (!body.password || body.password.length < 6) {
        return apiError(400, 'ERRORS.AUTH.PASSWORD_TOO_SHORT', 'Password must be at least 6 characters.');
      }

      const user = await queryOne<any>(
        `SELECT id, password_reset_token, password_reset_expires
         FROM users
         WHERE phone = $1 OR (phone IS NOT NULL AND $1 LIKE '%' || phone)
         LIMIT 1`,
        [phone]
      );

      if (!user) {
        return apiError(400, 'ERRORS.AUTH.INVALID_VERIFICATION_REQUEST', 'Invalid request.');
      }

      if (!user.password_reset_token || user.password_reset_token !== body.otp) {
        return apiError(400, 'ERRORS.AUTH.OTP_INVALID', 'Invalid verification code.');
      }

      if (!user.password_reset_expires || new Date(user.password_reset_expires) < new Date()) {
        return apiError(400, 'ERRORS.AUTH.OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);

      await query(
        `UPDATE users
         SET password = $1,
             password_reset_token = NULL,
             password_reset_expires = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [hashedPassword, user.id]
      );

      return {
        status: 200 as const,
        body: { message: 'Password updated. You can now sign in with your new password.', code: 'AUTH.PASSWORD_UPDATED' },
      };
    } catch (error) {
      console.error('Reset password error:', error);
      return apiError(400, 'ERRORS.AUTH.PASSWORD_RESET_FAILED', 'Could not reset password. Please try again.');
    }
  },

  profile: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const token = extractTokenFromHeader(headers.authorization);
      if (!token) {
        return apiError(401, 'ERRORS.AUTH.NO_TOKEN', 'No token provided');
      }

      const decoded = await verifyToken(token);

      await ensureQrCardSchema();
      await ensureVerticalColumn();
      await ensureOnlineExamsColumn();
      const user = await queryOne<any>(
        `SELECT u.*, c.type as company_type, c.plan as company_plan,
                c.vertical as company_vertical,
                c.qr_cards_enabled as company_qr_cards,
                c.online_exams_enabled as company_online_exams,
                array_agg(ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) as branch_ids
         FROM users u
         JOIN companies c ON u.company_id = c.id
         LEFT JOIN user_branches ub ON ub.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id, c.type, c.plan, c.vertical, c.qr_cards_enabled, c.online_exams_enabled`,
        [decoded.id]
      );

      if (!user) {
        return apiError(401, 'ERRORS.AUTH.USER_NOT_FOUND', 'User not found');
      }

      const branchIds: string[] = user.branch_ids ?? (user.branch_id ? [user.branch_id] : []);

      return {
        status: 200 as const,
        body: await buildSafeUser(user, branchIds),
      };
    } catch (error) {
      console.error('Profile error:', error);
      return apiError(401, 'ERRORS.UNAUTHORIZED', 'Unauthorized');
    }
  },
};
