import { insert, update, findById, query, queryOne, deleteById } from '../db/connection';
import { extractTenantContext, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

function mapBranchFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    address: row.address,
    city: row.city,
    state: row.state,
    phone: row.phone,
    email: row.email,
    isActive: row.is_active,
    openingDate: row.opening_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const branchesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Only ADMIN or GLOBAL_ADMIN can create branches
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return {
          status: 403 as const,
          body: { message: 'Only administrators can create branches' },
        };
      }

      const branch = await insert('branches', {
        company_id: context.companyId,
        name: body.name,
        code: body.code,
        address: body.address || null,
        city: body.city || null,
        state: body.state || null,
        phone: body.phone || null,
        email: body.email || null,
        opening_date: body.openingDate || null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapBranchFromDB(branch),
      };
    } catch (error) {
      console.error('Create branch error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create branch' },
      };
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const branches = await query(
        'SELECT * FROM branches WHERE company_id = $1 ORDER BY created_at DESC',
        [context.companyId]
      );
      return {
        status: 200 as const,
        body: branches.map(mapBranchFromDB),
      };
    } catch (error) {
      console.error('List branches error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list branches' },
      };
    }
  },

  listActive: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const branches = await query(
        'SELECT * FROM branches WHERE company_id = $1 AND is_active = true ORDER BY created_at DESC',
        [context.companyId]
      );
      return {
        status: 200 as const,
        body: branches.map(mapBranchFromDB),
      };
    } catch (error) {
      console.error('List active branches error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list active branches' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const branch = await queryOne(
        'SELECT * FROM branches WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!branch) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapBranchFromDB(branch),
      };
    } catch (error) {
      console.error('Get branch error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Branch not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Verify branch belongs to company
      const existing = await queryOne(
        'SELECT * FROM branches WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      // Only ADMIN or GLOBAL_ADMIN can update branches
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return {
          status: 403 as const,
          body: { message: 'Only administrators can update branches' },
        };
      }

      const updateData: any = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.city !== undefined) updateData.city = body.city;
      if (body.state !== undefined) updateData.state = body.state;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.openingDate !== undefined) updateData.opening_date = body.openingDate;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        return {
          status: 400 as const,
          body: { message: 'No valid fields to update' },
        };
      }

      const branch = await update('branches', params.id, updateData);

      if (!branch) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapBranchFromDB(branch),
      };
    } catch (error) {
      console.error('Update branch error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update branch' },
      };
    }
  },

  getStats: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Verify branch belongs to company
      const branch = await queryOne(
        'SELECT * FROM branches WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!branch) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      // Get course count
      const courseResult = await queryOne(
        'SELECT COUNT(*) as count FROM courses WHERE branch_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      const courseCount = parseInt(courseResult?.count || '0');

      // Get class count
      const classResult = await queryOne(
        'SELECT COUNT(*) as count FROM classes WHERE branch_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      const classCount = parseInt(classResult?.count || '0');

      // Get student count
      const studentResult = await queryOne(
        'SELECT COUNT(DISTINCT student_id) as count FROM enrollments WHERE branch_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      const studentCount = parseInt(studentResult?.count || '0');

      // Get active enrollments count
      const activeEnrollmentsResult = await queryOne(
        'SELECT COUNT(*) as count FROM enrollments WHERE branch_id = $1 AND company_id = $2 AND status = $3',
        [params.id, context.companyId, 'ACTIVE']
      );
      const activeEnrollments = parseInt(activeEnrollmentsResult?.count || '0');

      // Get employee count (both branch-specific and global)
      const employeeResult = await queryOne(
        'SELECT COUNT(*) as count FROM employees WHERE company_id = $1 AND (branch_id = $2 OR is_global = true)',
        [context.companyId, params.id]
      );
      const employeeCount = parseInt(employeeResult?.count || '0');

      // Get total revenue from enrollments
      const enrollmentRevenueResult = await queryOne(
        'SELECT COALESCE(SUM(final_price), 0) as total FROM enrollments WHERE branch_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      const enrollmentRevenue = parseFloat(enrollmentRevenueResult?.total || '0');

      // Get total revenue from product sales
      const productRevenueResult = await queryOne(
        'SELECT COALESCE(SUM(total_amount), 0) as total FROM product_sales WHERE branch_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      const productRevenue = parseFloat(productRevenueResult?.total || '0');

      const totalRevenue = enrollmentRevenue + productRevenue;

      // Get total expenses for this branch
      const expenseResult = await queryOne(
        'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = $1 AND (branch_id = $2 OR type = $3)',
        [context.companyId, params.id, 'SHARED']
      );
      const totalExpenses = parseFloat(expenseResult?.total || '0');

      const netProfit = totalRevenue - totalExpenses;

      return {
        status: 200 as const,
        body: {
          courseCount,
          studentCount,
          classCount,
          employeeCount,
          totalRevenue,
          totalExpenses,
          netProfit,
          activeEnrollments,
        },
      };
    } catch (error) {
      console.error('Get branch stats error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get branch statistics' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Verify branch belongs to company
      const existing = await queryOne(
        'SELECT * FROM branches WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      // Only ADMIN or GLOBAL_ADMIN can delete branches
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return {
          status: 403 as const,
          body: { message: 'Only administrators can delete branches' },
        };
      }

      await deleteById('branches', params.id);

      return {
        status: 200 as const,
        body: { message: 'Branch deleted successfully' },
      };
    } catch (error) {
      console.error('Delete branch error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete branch' },
      };
    }
  },
};
