import bcrypt from 'bcryptjs';
import { insert, queryOne, update, getClient } from '../db/connection';
import { signToken, signRefreshToken, verifyToken, extractTokenFromHeader } from '../utils/jwt';

export const authRoutes = {
  login: async ({ body }: { body: { email: string; password: string } }) => {
    try {
      // Find user by email and JOIN with companies to verify company is active
      const user = await queryOne<any>(
        `SELECT u.*,
                c.is_active as company_is_active,
                c.subscription_status,
                c.name as company_name,
                c.code as company_code
         FROM users u
         JOIN companies c ON u.company_id = c.id
         WHERE u.email = $1`,
        [body.email]
      );

      if (!user) {
        return {
          status: 401 as const,
          body: { message: 'Invalid credentials' },
        };
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(body.password, user.password);
      if (!isValidPassword) {
        return {
          status: 401 as const,
          body: { message: 'Invalid credentials' },
        };
      }

      // Check if company is active
      if (!user.company_is_active) {
        return {
          status: 401 as const,
          body: { message: 'Company account is inactive. Please contact support.' },
        };
      }

      // Check subscription status
      if (user.subscription_status === 'SUSPENDED' || user.subscription_status === 'CANCELLED') {
        return {
          status: 401 as const,
          body: { message: 'Company subscription is not active. Please contact support.' },
        };
      }

      // Check if user is active
      if (!user.is_active) {
        return {
          status: 401 as const,
          body: { message: 'User account is inactive' },
        };
      }

      // Fetch branch IDs for multi-branch users
      let branchIds: string[] = [];
      try {
        const { query: dbQuery } = await import('../db/connection');
        const userBranches = await dbQuery<any>(
          'SELECT branch_id FROM user_branches WHERE user_id = $1',
          [user.id]
        );
        branchIds = userBranches.map((r: any) => r.branch_id);
      } catch {
        if (user.branch_id) branchIds = [user.branch_id];
      }
      if (branchIds.length === 0 && user.branch_id) branchIds = [user.branch_id];

      // Generate tokens with companyId and permissions
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
          user: {
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
          },
        },
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        status: 401 as const,
        body: { message: 'Authentication failed' },
      };
    }
  },

  register: async ({
    body,
  }: {
    body: {
      // Company details
      companyName: string;
      companyEmail: string;
      companyCode?: string;
      industry?: string;

      // User details (becomes company owner)
      firstName: string;
      lastName: string;
      email: string;
      password: string;

      // Optional
      phone?: string;
      timezone?: string;
    };
  }) => {
    // Use database transaction for atomicity
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // 1. Check if company email already exists
      const existingCompany = await queryOne(
        'SELECT id FROM companies WHERE email = $1',
        [body.companyEmail]
      );

      if (existingCompany) {
        await client.query('ROLLBACK');
        return {
          status: 400 as const,
          body: { message: 'Company already exists with this email' },
        };
      }

      // 2. Check if user email already exists
      const existingUser = await queryOne(
        'SELECT id FROM users WHERE email = $1',
        [body.email]
      );

      if (existingUser) {
        await client.query('ROLLBACK');
        return {
          status: 400 as const,
          body: { message: 'User email already exists' },
        };
      }

      // 3. Generate company code if not provided
      const companyCode = body.companyCode ||
        `COMP-${Date.now().toString(36).toUpperCase()}`;

      // 4. Create Company
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

      // 5. Create default Branch
      const branchRes = await client.query(
        `INSERT INTO branches (company_id, name, code, email, phone, is_active, opening_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          company.id, `${body.companyName} - Main Branch`, 'MAIN',
          body.companyEmail, body.phone || null, true, new Date(),
        ]
      );
      const branch = branchRes.rows[0];

      // 6. Hash password
      const hashedPassword = await bcrypt.hash(body.password, 10);

      // 7. Create User (ADMIN role - company owner)
      const userRes = await client.query(
        `INSERT INTO users
          (company_id, branch_id, email, password, first_name, last_name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          company.id, branch.id, body.email, hashedPassword,
          body.firstName, body.lastName, 'ADMIN', true,
        ]
      );
      const user = userRes.rows[0];

      // 8. Update company created_by
      await client.query(
        `UPDATE companies SET created_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [user.id, company.id]
      );

      // 9. Update branch manager
      await client.query(
        `UPDATE branches SET manager_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [user.id, branch.id]
      );

      // 10. Create default cash_state for the company
      await client.query(
        `INSERT INTO cash_state (company_id, current_balance, updated_by) VALUES ($1,$2,$3)`,
        [company.id, 0, user.id]
      );

      // 11. Create subscription record (TRIAL for 2 months)
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

      // Commit transaction
      await client.query('COMMIT');

      // 12. Generate tokens with companyId
      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: company.id,
        branchId: branch.id,
      };

      const accessToken = await signToken(payload);
      const refreshToken = await signRefreshToken(payload);

      return {
        status: 201 as const,
        body: {
          accessToken,
          refreshToken,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            companyId: company.id,
            branchId: branch.id,
            isActive: user.is_active,
          },
          company: {
            id: company.id,
            name: company.name,
            code: company.code,
            subscriptionTier: company.subscription_tier,
            subscriptionStatus: company.subscription_status,
          },
        },
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Registration error:', error);

      // Return specific messages for known DB constraint violations
      if (error?.code === '23505') {
        const constraint: string = error?.constraint || '';
        const table: string = error?.table || '';
        const detail: string = error?.detail || '';
        let message = 'Registration failed due to a conflict.';
        if (constraint === 'companies_code_key') {
          message = 'Company code is already taken. Please choose a different code.';
        } else if (table === 'companies' && detail.includes('email')) {
          message = 'A company with this email already exists.';
        } else if (table === 'users' || constraint.includes('users')) {
          message = 'An account with this email already exists.';
        } else if (table === 'branches' || constraint.includes('branches')) {
          message = 'Company code is already taken. Please choose a different code.';
        }
        return {
          status: 400 as const,
          body: { message },
        };
      }

      return {
        status: 400 as const,
        body: { message: 'Registration failed. Please try again.' },
      };
    } finally {
      client.release();
    }
  },

  profile: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const token = extractTokenFromHeader(headers.authorization);
      if (!token) {
        return {
          status: 401 as const,
          body: { message: 'No token provided' },
        };
      }

      const decoded = await verifyToken(token);

      // Fetch fresh user data with branch IDs
      const user = await queryOne<any>(
        `SELECT u.*, array_agg(ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) as branch_ids
         FROM users u
         LEFT JOIN user_branches ub ON ub.user_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
        [decoded.id]
      );

      if (!user) {
        return {
          status: 401 as const,
          body: { message: 'User not found' },
        };
      }

      const branchIds: string[] = user.branch_ids ?? (user.branch_id ? [user.branch_id] : []);

      return {
        status: 200 as const,
        body: {
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
        },
      };
    } catch (error) {
      console.error('Profile error:', error);
      return {
        status: 401 as const,
        body: { message: 'Unauthorized' },
      };
    }
  },
};
