import bcrypt from 'bcryptjs';
import { insert, queryOne } from '../db/connection';
import { signToken, signRefreshToken, verifyToken, extractTokenFromHeader } from '../utils/jwt';

export const authRoutes = {
  login: async ({ body }: { body: { email: string; password: string } }) => {
    try {
      // Find user by email
      const user = await queryOne<any>(
        'SELECT * FROM users WHERE email = $1',
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

      // Check if user is active
      if (!user.is_active) {
        return {
          status: 401 as const,
          body: { message: 'User account is inactive' },
        };
      }

      // Generate tokens
      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
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
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      role: string;
      branchId?: string;
    };
  }) => {
    try {
      // Check if user already exists
      const existingUser = await queryOne(
        'SELECT id FROM users WHERE email = $1',
        [body.email]
      );

      if (existingUser) {
        return {
          status: 400 as const,
          body: { message: 'User already exists' },
        };
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(body.password, 10);

      // Create user
      const user = await insert('users', {
        email: body.email,
        password: hashedPassword,
        first_name: body.firstName,
        last_name: body.lastName,
        role: body.role,
        branch_id: body.branchId || null,
        is_active: true,
      });

      // Generate tokens
      const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        branchId: user.branch_id,
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
            branchId: user.branch_id,
            isActive: user.is_active,
          },
        },
      };
    } catch (error) {
      console.error('Registration error:', error);
      return {
        status: 400 as const,
        body: { message: 'Registration failed' },
      };
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
        'SELECT id, email, first_name, last_name, role, branch_id, is_active FROM users WHERE id = $1',
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
