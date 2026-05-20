import bcrypt from 'bcryptjs';
import { query, queryOne, insert } from '../db/connection';
import {
  extractTenantContext,
  isGlobalAdmin,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

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

/**
 * Strip branches.write / branches.delete from a permissions object when the
 * effective role is not GLOBAL_ADMIN/ADMIN. Mirrors the role check in
 * branches.ts so the stored permissions can never claim privileges the
 * branches endpoints would reject anyway.
 */
function sanitizePermissionsForRole(permissions: any, role: string | undefined): any {
  if (!permissions || typeof permissions !== 'object') return permissions;
  if (role === 'GLOBAL_ADMIN' || role === 'ADMIN') return permissions;
  const branches = permissions.branches;
  if (!branches || typeof branches !== 'object') return permissions;
  return {
    ...permissions,
    branches: { ...branches, write: false, delete: false },
  };
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
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_MANAGE', 'Only Global Admins can manage users');
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
      console.error('List users error:', error);
      return mapThrownError(error, 'ERRORS.USERS.LIST_FAILED', 'Failed to list users');
    }
  },

  get: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_VIEW', 'Only Global Admins can view user details');
      }

      const user = await getUserWithBranches(params.id, context.companyId);
      if (!user) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      return { status: 200 as const, body: mapUserRow(user) };

    } catch (error) {
      console.error('Get user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.GET_FAILED', 'Failed to get user');
    }
  },

  create: async ({ body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_CREATE', 'Only Global Admins can create users');
      }

      // Check email uniqueness
      const existing = await queryOne<any>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (existing) {
        return apiError(400, 'ERRORS.USERS.EMAIL_TAKEN', 'A user with this email already exists');
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);

      // Determine primary branchId (first in branchIds, or explicit branchId)
      const primaryBranchId = body.branchId || body.branchIds?.[0] || null;

      // GLOBAL_ADMIN/ADMIN always run with role defaults (FULL access). Custom
      // permissions on these roles are forbidden so admins can never be locked
      // out of their own account.
      const isAdminRole = body.role === 'GLOBAL_ADMIN' || body.role === 'ADMIN';
      const sanitized = sanitizePermissionsForRole(body.permissions, body.role);
      const newUser = await insert<any>('users', {
        company_id: context.companyId,
        email: body.email,
        password: hashedPassword,
        first_name: body.firstName,
        last_name: body.lastName,
        role: body.role,
        branch_id: primaryBranchId,
        linked_employee_id: body.linkedEmployeeId || null,
        permissions: isAdminRole ? null : (sanitized ? JSON.stringify(sanitized) : null),
        is_active: true,
      });

      // Sync branch assignments
      const branchIds = body.branchIds ?? (primaryBranchId ? [primaryBranchId] : []);
      await syncUserBranches(newUser.id, context.companyId, branchIds);

      const fullUser = await getUserWithBranches(newUser.id, context.companyId);
      return { status: 201 as const, body: mapUserRow(fullUser) };

    } catch (error) {
      console.error('Create user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.CREATE_FAILED', 'Failed to create user');
    }
  },

  update: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_UPDATE', 'Only Global Admins can update users');
      }

      const existing = await getUserWithBranches(params.id, context.companyId);
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      // Prevent self-deactivation via update
      if (body.isActive === false && params.id === context.userId) {
        return apiError(400, 'ERRORS.USERS.SELF_DEACTIVATE', 'You cannot deactivate your own account');
      }

      // Block self-elevation: a user cannot change their own role or permissions.
      const isSelf = params.id === context.userId;
      if (isSelf && body.role !== undefined && body.role !== existing.role) {
        return apiError(400, 'ERRORS.USERS.SELF_ROLE_CHANGE', 'You cannot change your own role');
      }
      if (isSelf && 'permissions' in body) {
        return apiError(400, 'ERRORS.USERS.SELF_PERMISSIONS_CHANGE', 'You cannot change your own permissions');
      }

      // Build update fields
      const updates: Record<string, any> = {};
      if (body.email !== undefined) updates.email = body.email;
      if (body.firstName !== undefined) updates.first_name = body.firstName;
      if (body.lastName !== undefined) updates.last_name = body.lastName;
      if (body.role !== undefined && !isSelf) updates.role = body.role;
      if (body.isActive !== undefined) updates.is_active = body.isActive;
      if ('linkedEmployeeId' in body) updates.linked_employee_id = body.linkedEmployeeId;
      if ('permissions' in body && !isSelf) {
        const sanitized = sanitizePermissionsForRole(
          body.permissions,
          (body.role as string | undefined) ?? existing.role,
        );
        updates.permissions = sanitized ? JSON.stringify(sanitized) : null;
      }
      // GLOBAL_ADMIN/ADMIN always run with role defaults — strip any custom
      // permissions so the matrix can never lock them out.
      const finalRole = (updates.role as string | undefined) ?? existing.role;
      if (finalRole === 'GLOBAL_ADMIN' || finalRole === 'ADMIN') {
        updates.permissions = null;
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
      console.error('Update user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.UPDATE_FAILED', 'Failed to update user');
    }
  },

  updatePermissions: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_PERMISSIONS', 'Only Global Admins can update permissions');
      }

      if (params.id === context.userId) {
        return apiError(400, 'ERRORS.USERS.SELF_PERMISSIONS_CHANGE', 'You cannot change your own permissions');
      }

      const existing = await queryOne<any>(
        'SELECT id, role FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      if (existing.role === 'GLOBAL_ADMIN' || existing.role === 'ADMIN') {
        return apiError(400, 'ERRORS.USERS.ADMIN_PERMISSIONS_FIXED', 'GLOBAL_ADMIN/ADMIN always have full permissions and cannot be customised');
      }

      const sanitized = sanitizePermissionsForRole(body.permissions, existing.role);
      await updateUser(
        params.id,
        context.companyId,
        { permissions: sanitized ? JSON.stringify(sanitized) : null }
      );

      return {
        status: 200 as const,
        body: { message: 'Permissions updated successfully', code: 'USERS.PERMISSIONS_UPDATED', permissions: sanitized },
      };

    } catch (error) {
      console.error('Update permissions error:', error);
      return mapThrownError(error, 'ERRORS.USERS.PERMISSIONS_UPDATE_FAILED', 'Failed to update permissions');
    }
  },

  resetPassword: async ({ params, body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_RESET_PW', 'Only Global Admins can reset passwords');
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      const hashedPassword = await bcrypt.hash(body.password, 10);
      await updateUser(params.id, context.companyId, { password: hashedPassword });
      return { status: 200 as const, body: { message: 'Password reset successfully', code: 'USERS.PASSWORD_RESET' } };

    } catch (error) {
      console.error('Reset password error:', error);
      return mapThrownError(error, 'ERRORS.USERS.PASSWORD_RESET_FAILED', 'Failed to reset password');
    }
  },

  deactivate: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_DEACTIVATE', 'Only Global Admins can deactivate users');
      }

      // Prevent deactivating yourself
      if (params.id === context.userId) {
        return apiError(400, 'ERRORS.USERS.SELF_DEACTIVATE', 'You cannot deactivate your own account');
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      await updateUser(params.id, context.companyId, { is_active: false });
      return { status: 200 as const, body: { message: 'User deactivated successfully', code: 'USERS.DEACTIVATED' } };

    } catch (error) {
      console.error('Deactivate user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.DEACTIVATE_FAILED', 'Failed to deactivate user');
    }
  },

  activate: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_ACTIVATE', 'Only Global Admins can activate users');
      }

      const existing = await queryOne<any>(
        'SELECT id FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      await updateUser(params.id, context.companyId, { is_active: true });
      return { status: 200 as const, body: { message: 'User activated successfully', code: 'USERS.ACTIVATED' } };

    } catch (error) {
      console.error('Activate user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.ACTIVATE_FAILED', 'Failed to activate user');
    }
  },

  delete: async ({ params, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_DELETE', 'Only Global Admins can remove users');
      }

      const existing = await queryOne<any>(
        'SELECT id, role FROM users WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.USERS.NOT_FOUND', 'User not found');

      if (existing.id === context.userId) {
        return apiError(400, 'ERRORS.USERS.CANNOT_DELETE_SELF', 'You cannot remove your own user account');
      }

      // user_branches has ON DELETE CASCADE; created_by_user_id columns are
      // unconstrained UUIDs so they tolerate the user disappearing.
      await query('DELETE FROM users WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      return { status: 200 as const, body: { message: 'User removed successfully', code: 'USERS.DELETED' } };

    } catch (error) {
      console.error('Delete user error:', error);
      return mapThrownError(error, 'ERRORS.USERS.DELETE_FAILED', 'Failed to remove user');
    }
  },

  convertEmployee: async ({ body, headers }: any) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!isGlobalAdmin(context)) {
        return apiError(403, 'ERRORS.USERS.GLOBAL_ADMIN_ONLY_CONVERT', 'Only Global Admins can convert employees to users');
      }

      // Verify employee exists and belongs to this company
      const employee = await queryOne<any>(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [body.employeeId, context.companyId]
      );
      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      // Check if employee is already a user
      const alreadyUser = await queryOne<any>(
        'SELECT id FROM users WHERE linked_employee_id = $1',
        [body.employeeId]
      );
      if (alreadyUser) {
        return apiError(400, 'ERRORS.USERS.EMPLOYEE_ALREADY_USER', 'This employee already has a user account');
      }

      // Check email uniqueness
      const emailExists = await queryOne<any>('SELECT id FROM users WHERE email = $1', [body.email]);
      if (emailExists) {
        return apiError(400, 'ERRORS.USERS.EMAIL_TAKEN', 'A user with this email already exists');
      }

      const hashedPassword = await bcrypt.hash(body.password, 10);
      const primaryBranchId = body.branchIds?.[0] || employee.branch_id || null;

      const sanitized = sanitizePermissionsForRole(body.permissions, body.role);
      const newUser = await insert<any>('users', {
        company_id: context.companyId,
        email: body.email,
        password: hashedPassword,
        first_name: employee.first_name,
        last_name: employee.last_name,
        role: body.role,
        branch_id: primaryBranchId,
        linked_employee_id: body.employeeId,
        permissions: sanitized ? JSON.stringify(sanitized) : null,
        is_active: true,
      });

      // Sync branch assignments
      const branchIds = body.branchIds ?? (primaryBranchId ? [primaryBranchId] : []);
      await syncUserBranches(newUser.id, context.companyId, branchIds);

      const fullUser = await getUserWithBranches(newUser.id, context.companyId);
      return { status: 201 as const, body: mapUserRow(fullUser) };

    } catch (error) {
      console.error('Convert employee error:', error);
      return mapThrownError(error, 'ERRORS.USERS.CONVERT_EMPLOYEE_FAILED', 'Failed to convert employee to user');
    }
  },
};
