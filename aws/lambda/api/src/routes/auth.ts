import bcrypt from 'bcryptjs';
import { query, queryOne, getClient } from '../db/connection';
import { signToken, signRefreshToken, verifyToken, extractTokenFromHeader } from '../utils/jwt';
import { sendOtpWhatsApp, normalizeLocalPhone, normalizeCountryCode } from '../utils/whatsapp';
import { enforce, enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Resolves a login identifier to a user. Accepts an email or a phone number
// in any common shape (local with leading 0, international with or without +).
// Returns null if no user matches.
async function findUserByIdentifier(identifier: string): Promise<any | null> {
  const trimmed = (identifier || '').trim();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    return queryOne<any>(
      `SELECT u.*,
              c.is_active as company_is_active,
              c.subscription_status,
              c.name as company_name,
              c.code as company_code
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE LOWER(u.email) = LOWER($1)`,
      [trimmed]
    );
  }

  // Phone path. Strip leading 0 / non-digits.
  const local = normalizeLocalPhone(trimmed);
  if (!local) return null;

  // Try exact match first (works when user types just the local subscriber digits
  // — that's how phones are stored). If nothing matches, try ENDSWITH so users
  // who paste in country code prefixes still resolve.
  const direct = await queryOne<any>(
    `SELECT u.*,
            c.is_active as company_is_active,
            c.subscription_status,
            c.name as company_name,
            c.code as company_code
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
            c.code as company_code
     FROM users u
     JOIN companies c ON u.company_id = c.id
     WHERE u.phone IS NOT NULL AND $1 LIKE '%' || u.phone
     LIMIT 1`,
    [local]
  );
}

function buildSafeUser(user: any, branchIds: string[]) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    role: user.role,
    companyId: user.company_id,
    branchId: user.branch_id,
    branchIds,
    linkedEmployeeId: user.linked_employee_id ?? null,
    permissions: user.permissions ?? null,
    isActive: user.is_active,
    countryCode: user.country_code ?? null,
    phone: user.phone ?? null,
    phoneVerified: user.phone_verified ?? false,
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
        return { status: 401 as const, body: { message: 'Invalid credentials' } };
      }

      const isValidPassword = await bcrypt.compare(body.password, user.password);
      if (!isValidPassword) {
        return { status: 401 as const, body: { message: 'Invalid credentials' } };
      }

      if (!user.company_is_active) {
        return { status: 401 as const, body: { message: 'Company account is inactive. Please contact support.' } };
      }

      if (user.subscription_status === 'SUSPENDED' || user.subscription_status === 'CANCELLED') {
        return { status: 401 as const, body: { message: 'Company subscription is not active. Please contact support.' } };
      }

      if (!user.is_active) {
        return { status: 401 as const, body: { message: 'User account is inactive' } };
      }

      // Block unverified phones
      if (!user.phone_verified) {
        return {
          status: 403 as const,
          body: {
            message: 'Please verify your phone number before logging in.',
            code: 'PHONE_NOT_VERIFIED',
            countryCode: user.country_code ?? '',
            phone: user.phone ?? '',
          },
        };
      }

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
          user: buildSafeUser(user, branchIds),
        },
      };
    } catch (error) {
      console.error('Login error:', error);
      return { status: 401 as const, body: { message: 'Authentication failed' } };
    }
  },

  register: async ({
    body,
  }: {
    body: {
      companyName: string;
      companyEmail: string;
      companyCode?: string;
      industry?: string;
      firstName: string;
      lastName: string;
      email: string;
      password: string;
      countryCode: string;
      phone: string;
      timezone?: string;
    };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    enforce(RATE_LIMITS.AUTH_EMAIL, (body.email || '').trim().toLowerCase() || null);

    const client = await getClient();

    const countryCode = normalizeCountryCode(body.countryCode);
    const phone = normalizeLocalPhone(body.phone);

    if (!countryCode) {
      return { status: 400 as const, body: { message: 'Country code is required.' } };
    }
    if (!phone) {
      return { status: 400 as const, body: { message: 'Phone number is required.' } };
    }

    try {
      await client.query('BEGIN');

      const existingCompany = await queryOne(
        'SELECT id FROM companies WHERE email = $1',
        [body.companyEmail]
      );
      if (existingCompany) {
        await client.query('ROLLBACK');
        return { status: 400 as const, body: { message: 'Company already exists with this email' } };
      }

      const existingUser = await queryOne(
        'SELECT id FROM users WHERE email = $1',
        [body.email]
      );
      if (existingUser) {
        await client.query('ROLLBACK');
        return { status: 400 as const, body: { message: 'User email already exists' } };
      }

      const existingPhone = await queryOne(
        'SELECT id FROM users WHERE phone = $1',
        [phone]
      );
      if (existingPhone) {
        await client.query('ROLLBACK');
        return { status: 400 as const, body: { message: 'A user with this phone number already exists.' } };
      }

      const companyCode = body.companyCode || `COMP-${Date.now().toString(36).toUpperCase()}`;

      const companyRes = await client.query(
        `INSERT INTO companies
          (name, code, email, industry, subscription_tier, subscription_status,
           subscription_start_date, subscription_end_date, max_branches, max_users,
           timezone, currency, locale, is_active, onboarding_completed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          body.companyName, companyCode, body.companyEmail, 'Tech Center',
          'BASIC', 'TRIAL',
          new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          1, 5, 'Africa/Cairo', 'EGP', 'en-US', true, false,
        ]
      );
      const company = companyRes.rows[0];

      const branchRes = await client.query(
        `INSERT INTO branches (company_id, name, code, email, phone, is_active, opening_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          company.id, `${body.companyName} - Main Branch`, 'MAIN',
          body.companyEmail, `+${countryCode}${phone}`, true, new Date(),
        ]
      );
      const branch = branchRes.rows[0];

      const hashedPassword = await bcrypt.hash(body.password, 10);

      // Generate OTP before INSERT so it's part of the transaction
      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      const userRes = await client.query(
        `INSERT INTO users
          (company_id, branch_id, email, password, first_name, last_name, role,
           is_active, country_code, phone, phone_verified, phone_otp, phone_otp_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          company.id, branch.id, body.email, hashedPassword,
          body.firstName, body.lastName, 'ADMIN', true,
          countryCode, phone, false, otp, otpExpiresAt,
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
      await client.query(
        `INSERT INTO cash_state (company_id, current_balance, updated_by) VALUES ($1,$2,$3)`,
        [company.id, 0, user.id]
      );

      const trialStart = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 60);
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

      // Send OTP via WhatsApp (best-effort — failure does not block registration)
      try {
        await sendOtpWhatsApp(countryCode, phone, otp);
      } catch (otpError) {
        console.error('Failed to send WhatsApp OTP after registration:', otpError);
      }

      return {
        status: 201 as const,
        body: {
          countryCode,
          phone,
          message: 'Registration successful. Please check WhatsApp for your 6-digit verification code.',
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
        if (constraint === 'companies_code_key') {
          message = 'Company code is already taken. Please choose a different code.';
        } else if (table === 'companies' && detail.includes('email')) {
          message = 'A company with this email already exists.';
        } else if (constraint.includes('phone') || detail.includes('phone')) {
          message = 'A user with this phone number already exists.';
        } else if (table === 'users' || constraint.includes('users')) {
          message = 'An account with this email already exists.';
        } else if (table === 'branches' || constraint.includes('branches')) {
          message = 'Company code is already taken. Please choose a different code.';
        }
        return { status: 400 as const, body: { message } };
      }

      return { status: 400 as const, body: { message: 'Registration failed. Please try again.' } };
    } finally {
      client.release();
    }
  },

  verifyPhone: async ({
    body,
  }: {
    body: { countryCode: string; phone: string; otp: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    try {
      const countryCode = normalizeCountryCode(body.countryCode);
      const phone = normalizeLocalPhone(body.phone);
      // Per-phone cap on OTP attempts so an attacker can't brute-force a
      // known target even from a fresh IP. Six-digit OTPs only give 10^6
      // entropy, so this is essential.
      const phoneKey = countryCode && phone ? `${countryCode}:${phone}` : null;
      enforce(RATE_LIMITS.AUTH_EMAIL, phoneKey);

      const user = await queryOne<any>(
        `SELECT u.*, c.is_active as company_is_active, c.name as company_name
         FROM users u
         JOIN companies c ON u.company_id = c.id
         WHERE u.phone = $1 AND u.country_code = $2`,
        [phone, countryCode]
      );

      if (!user) {
        return { status: 400 as const, body: { message: 'Invalid verification request.' } };
      }

      if (user.phone_verified) {
        return { status: 400 as const, body: { message: 'Phone number is already verified.' } };
      }

      if (!user.phone_otp || user.phone_otp !== body.otp) {
        return { status: 400 as const, body: { message: 'Invalid verification code.' } };
      }

      if (!user.phone_otp_expires_at || new Date(user.phone_otp_expires_at) < new Date()) {
        return {
          status: 400 as const,
          body: { message: 'Verification code has expired. Please request a new one.' },
        };
      }

      await query(
        `UPDATE users
         SET phone_verified = TRUE, phone_otp = NULL, phone_otp_expires_at = NULL,
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
          user: buildSafeUser({ ...user, phone_verified: true }, branchIds),
        },
      };
    } catch (error) {
      console.error('Verify phone error:', error);
      return { status: 400 as const, body: { message: 'Verification failed. Please try again.' } };
    }
  },

  resendOtp: async ({
    body,
  }: {
    body: { countryCode: string; phone: string };
  }) => {
    enforceByIp(RATE_LIMITS.AUTH_IP);
    try {
      const countryCode = normalizeCountryCode(body.countryCode);
      const phone = normalizeLocalPhone(body.phone);
      // Per-phone cap so an attacker can't pump WhatsApp messages at a
      // target. Same bucket as register/login since it's account-scoped.
      const phoneKey = countryCode && phone ? `${countryCode}:${phone}` : null;
      enforce(RATE_LIMITS.AUTH_EMAIL, phoneKey);

      const user = await queryOne<any>(
        'SELECT * FROM users WHERE phone = $1 AND country_code = $2',
        [phone, countryCode]
      );

      if (!user) {
        // Generic response to avoid enumeration
        return {
          status: 200 as const,
          body: { message: 'If your phone is registered, a new verification code has been sent.' },
        };
      }

      if (user.phone_verified) {
        return { status: 400 as const, body: { message: 'This phone number is already verified.' } };
      }

      const otp = generateOtp();
      const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await query(
        `UPDATE users
         SET phone_otp = $1, phone_otp_expires_at = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [otp, otpExpiresAt, user.id]
      );

      try {
        await sendOtpWhatsApp(countryCode, phone, otp);
      } catch (otpError) {
        console.error('Failed to send WhatsApp OTP on resend:', otpError);
      }

      return {
        status: 200 as const,
        body: { message: 'A new verification code has been sent to your WhatsApp.' },
      };
    } catch (error) {
      console.error('Resend OTP error:', error);
      return { status: 400 as const, body: { message: 'Failed to resend code. Please try again.' } };
    }
  },

  profile: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const token = extractTokenFromHeader(headers.authorization);
      if (!token) {
        return { status: 401 as const, body: { message: 'No token provided' } };
      }

      const decoded = await verifyToken(token);

      const user = await queryOne<any>(
        `SELECT u.*, array_agg(ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) as branch_ids
         FROM users u
         LEFT JOIN user_branches ub ON ub.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [decoded.id]
      );

      if (!user) {
        return { status: 401 as const, body: { message: 'User not found' } };
      }

      const branchIds: string[] = user.branch_ids ?? (user.branch_id ? [user.branch_id] : []);

      return {
        status: 200 as const,
        body: buildSafeUser(user, branchIds),
      };
    } catch (error) {
      console.error('Profile error:', error);
      return { status: 401 as const, body: { message: 'Unauthorized' } };
    }
  },
};
