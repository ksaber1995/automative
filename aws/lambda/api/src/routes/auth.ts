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

      // Generate tokens with companyId
      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        companyId: user.company_id,  // NEW: Include company ID for tenant isolation
        branchId: user.branch_id,
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
            companyId: user.company_id,  // NEW: Return company ID
            branchId: user.branch_id,
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
      const company = await insert('companies', {
        name: body.companyName,
        code: companyCode,
        email: body.companyEmail,
        industry: body.industry || null,
        subscription_tier: 'BASIC',  // Start with basic tier
        subscription_status: 'TRIAL', // 30-day trial
        subscription_start_date: new Date(),
        subscription_end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        max_branches: 1,
        max_users: 5,
        timezone: body.timezone || 'Africa/Cairo',
        currency: 'EGP',
        locale: 'en-US',
        is_active: true,
        onboarding_completed: false,
      });

      // 5. Create default Branch
      const branch = await insert('branches', {
        company_id: company.id,
        name: `${body.companyName} - Main Branch`,
        code: 'MAIN',
        email: body.companyEmail,
        phone: body.phone || null,
        is_active: true,
        opening_date: new Date(),
      });

      // 6. Hash password
      const hashedPassword = await bcrypt.hash(body.password, 10);

      // 7. Create User (ADMIN role - company owner)
      const user = await insert('users', {
        company_id: company.id,
        branch_id: branch.id,
        email: body.email,
        password: hashedPassword,
        first_name: body.firstName,
        last_name: body.lastName,
        role: 'ADMIN', // Company owner is ADMIN
        is_active: true,
      });

      // 8. Update company created_by
      await update('companies', company.id, {
        created_by: user.id,
      });

      // 9. Update branch manager
      await update('branches', branch.id, {
        manager_id: user.id,
      });

      // 10. Create default cash_state for the company
      await insert('cash_state', {
        company_id: company.id,
        current_balance: 0,
        updated_by: user.id,
      });

      // Commit transaction
      await client.query('COMMIT');

      // 11. Generate tokens with companyId
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
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Registration error:', error);
      return {
        status: 400 as const,
        body: { message: 'Registration failed' },
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

      // Fetch fresh user data
      const user = await queryOne<any>(
        'SELECT id, email, first_name, last_name, role, company_id, branch_id, is_active FROM users WHERE id = $1',
        [decoded.id]
      );

      if (!user) {
        return {
          status: 401 as const,
          body: { message: 'User not found' },
        };
      }

      return {
        status: 200 as const,
        body: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.role,
          companyId: user.company_id,  // NEW: Include company ID
          branchId: user.branch_id,
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
