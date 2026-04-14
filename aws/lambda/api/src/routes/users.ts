import bcrypt from 'bcryptjs';
import { query, queryOne, insert } from '../db/connection';
import {
  extractTenantContext,
  isAuthError,
  isSubscriptionError,
  isGlobalAdmin,
} from '../middleware/tenant-isolation';

/** Convenience: build a parameterised UPDATE returning the updated row */
async function updateUser(
  userId: string,
  companyId: string,
  fields: Record<string, any>
): Promise<any> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  const values = Object.values(fields);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  return queryOne(
    `UPDATE users SET ${setClause}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${keys.length + 1} AND company_id = $${keys.length + 2}
     RETURNING *`,
    [...values, userId, companyId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapUserRow(u: any) {
  return {
    id: u.id,
    companyId: u.company_id,
    email: u.email,
    firstName: u.first_name,
    lastName: u.last_name,
    role: u.role,
    branchId: u.branch_id ?? null,
    branchIds: u.branch_ids ?? [],
    linkedEmployeeId: u.linked_employee_id ?? null,
    permissions: u.permissions ?? null,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

async function getUserWithBranches(userId: string, companyId: string) {
  const user = await queryOne<any>(
    `SELECT u.*, array_agg(ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) as branch_ids
     FROM users u
     LEFT JOIN user_branches ub ON ub.user_id = u.id AND ub.company_id = u.company_id
     WHERE u.id = $1 AND u.company_id = $2
     GROUP BY u.id`,
    [userId, companyId]
  );
  return user;
}

async function syncUserBranches(userId: string, companyId: string, branchIds: string[]) {
  // Remove old branch assignments
  await query('DELETE FROM user_branches WHERE user_id = $1', [userId]);
  // Insert new ones
  for (const branchId of branchIds) {
    await query(
      `INSERT INTO user_branches (user_id, branch_id, company_id)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, branch_id) DO NOTHING`,
      [userId, branchId, companyId]
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers
// ─────────────────────────────────────────────────────────────────────────────

export const usersRoutes = {

  list: async ({ query: q, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can manage users' } };
      }

      let sql = `
        SELECT u.*, array_agg(ub.branch_id) FILTER (WHERE ub.branch_id IS NOT NULL) as branch_ids
        FROM users u
        LEFT JOIN user_branches ub ON ub.user_id = u.id AND ub.company_id = u.company_id
        WHERE u.company_id = $1
      `;
      const params: any[] = [context.companyId];
      let idx = 2;

      if (q?.branchId) {
        sql += ` AND (u.branch_id = $${idx} OR ub.branch_id = $${idx})`;
        params.push(q.branchId); idx++;
      }
      if (q?.role) {
        sql += ` AND u.role = $${idx}`;
        params.push(q.role); idx++;
      }
      if (q?.isActive !== undefined) {
        sql += ` AND u.is_active = $${idx}`;
        params.push(q.isActive); idx++;
      }

      sql += ' GROUP BY u.id ORDER BY u.created_at DESC';

      const rows = await query<any>(sql, params);
      return { status: 200 as const, body: { users: rows.map(mapUserRow) } };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      if (isSubscriptionError(error)) return { status: 402 as const, body: { message: (error as Error).message } };
      console.error('List users error:', error);
      return { status: 500 as const, body: { message: 'Failed to list users' } };
    }
  },

  get: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can view user details' } };
      }

      const user = await getUserWithBranches(params.id, context.companyId);
      if (!user) return { status: 404 as const, body: { message: 'User not found' } };

      return { status: 200 as const, body: mapUserRow(user) };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Get user error:', error);
      return { status: 500 as const, body: { message: 'Failed to get user' } };
    }
  },

  create: async ({ body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can create users' } };
      }

      // Check email uniqueness
      const existing = await queryOne<any>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing) {
        return { status: 400 as const, body: { message: 'A user with this email already exists' } };
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);

      // Determine primary branchId (first in branchIds, or explicit branchId)
      const primaryBranchId = body.branchId || body.branchIds?.[0] || null;

      const newUser = await insert<any>('users', {
        company_id: context.companyId,
        email: body.email,
        password: hashedPassword,
        first_name: body.firstName,
        last_name: body.lastName,
        role: body.role,
        branch_id: primaryBranchId,
        linked_employee_id: body.linkedEmployeeId || null,
        permissions: body.permissions ? JSON.stringify(body.permissions) : null,
        is_active: true,
      });

      // Sync branch assignments
      const branchIds = body.branchIds ?? (primaryBranchId ? [primaryBranchId] : []);
      await syncUserBranches(newUser.id, context.companyId, branchIds);

      const fullUser = await getUserWithBranches(newUser.id, context.companyId);
      return { status: 201 as const, body: mapUserRow(fullUser) };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Create user error:', error);
      return { status: 500 as const, body: { message: 'Failed to create user' } };
    }
  },

  update: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can update users' } };
      }

      const existing = await getUserWithBranches(params.id, context.companyId);
      if (!existing) return { status: 404 as const, body: { message: 'User not found' } };

      // Prevent self-deactivation via update
      if (body.isActive === false && params.id === context.userId) {
        return { status: 400 as const, body: { message: 'You cannot deactivate your own account' } };
      }

      // Build update fields
      const updates: Record<string, any> = {};
      if (body.email !== undefined) updates.email = body.email;
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.role !== undefined) updates.role = body.role;
      if (body.isActive !== undefined) updates.is_active = body.isActive;
      if ('linkedEmployeeId' in body) updates.linked_employee_id = body.linkedEmployeeId;
      if ('permissions' in body) {
        updates.permissions = body.permissions ? JSON.stringify(body.permissions) : null;
      }

      // Update primary branch
      const primaryBranchId = body.branchId !== undefined
        ? body.branchId
        : body.branchIds?.[0] ?? null;
      if (primaryBranchId !== undefined || body.branchIds !== undefined) {
        updates.branch_id = primaryBranchId;
      }

      if (Object.keys(updates).length > 0) {
        await updateUser(params.id, context.companyId, updates);
      }

      // Sync branches if provided
      if (body.branchIds !== undefined) {
        const bIds = body.branchIds as string[];
        await syncUserBranches(params.id, context.companyId, bIds);
      } else if (body.branchId !== undefined) {
        await syncUserBranches(
          params.id,
          context.companyId,
          body.branchId ? [body.branchId] : []
        );
      }

      const updated = await getUserWithBranches(params.id, context.companyId);
      return { status: 200 as const, body: mapUserRow(updated) };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Update user error:', error);
      return { status: 500 as const, body: { message: 'Failed to update user' } };
    }
  },

  updatePermissions: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can update permissions' } };
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'User not found' } };

      await updateUser(
        params.id,
        context.companyId,
        { permissions: body.permissions ? JSON.stringify(body.permissions) : null }
      );

      return {
        status: 200 as const,
        body: { message: 'Permissions updated successfully', permissions: body.permissions },
      };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Update permissions error:', error);
      return { status: 500 as const, body: { message: 'Failed to update permissions' } };
    }
  },

  resetPassword: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can reset passwords' } };
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'User not found' } };

      const hashedPassword = await bcrypt.hash(body.password, 10);
      await updateUser(params.id, context.companyId, { password: hashedPassword });
      return { status: 200 as const, body: { message: 'Password reset successfully' } };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Reset password error:', error);
      return { status: 500 as const, body: { message: 'Failed to reset password' } };
    }
  },

  deactivate: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can deactivate users' } };
      }

      // Prevent deactivating yourself
      if (params.id === context.userId) {
        return { status: 400 as const, body: { message: 'You cannot deactivate your own account' } };
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'User not found' } };

      await updateUser(params.id, context.companyId, { is_active: false });
      return { status: 200 as const, body: { message: 'User deactivated successfully' } };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Deactivate user error:', error);
      return { status: 500 as const, body: { message: 'Failed to deactivate user' } };
    }
  },

  activate: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can activate users' } };
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'User not found' } };

      await updateUser(params.id, context.companyId, { is_active: true });
      return { status: 200 as const, body: { message: 'User activated successfully' } };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Activate user error:', error);
      return { status: 500 as const, body: { message: 'Failed to activate user' } };
    }
  },

  convertEmployee: async ({ body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return { status: 403 as const, body: { message: 'Only Global Admins can convert employees to users' } };
      }

      // Verify employee exists and belongs to this company
      const employee = await queryOne<any>(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [body.employeeId, context.companyId]
      );
      if (!employee) {
        return { status: 404 as const, body: { message: 'Employee not found' } };
      }

      // Check if employee is already a user
      const alreadyUser = await queryOne<any>(
        'SELECT id FROM users WHERE linked_employee_id = $1',
        [body.employeeId]
      );
      if (alreadyUser) {
        return { status: 400 as const, body: { message: 'This employee already has a user account' } };
      }

      // Check email uniqueness
      const emailExists = await queryOne<any>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (emailExists) {
        return { status: 400 as const, body: { message: 'A user with this email already exists' } };
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);
      const primaryBranchId = body.branchIds?.[0] || employee.branch_id || null;

      const newUser = await insert<any>('users', {
        company_id: context.companyId,
        email: body.email,
        password: hashedPassword,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role: body.role,
        branch_id: primaryBranchId,
        linked_employee_id: body.employeeId,
        permissions: body.permissions ? JSON.stringify(body.permissions) : null,
        is_active: true,
      });

      // Sync branch assignments
      const branchIds = body.branchIds ?? (primaryBranchId ? [primaryBranchId] : []);
      await syncUserBranches(newUser.id, context.companyId, branchIds);

      const fullUser = await getUserWithBranches(newUser.id, context.companyId);
      return { status: 201 as const, body: mapUserRow(fullUser) };

    } catch (error) {
      if (isAuthError(error)) return { status: 401 as const, body: { message: (error as Error).message } };
      console.error('Convert employee error:', error);
      return { status: 500 as const, body: { message: 'Failed to convert employee to user' } };
    }
  },
};
