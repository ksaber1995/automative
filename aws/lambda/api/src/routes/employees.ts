import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapEmployeeFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    position: row.position,
    salary: row.salary ? parseFloat(row.salary) : null,
    branchId: row.branch_id,
    isGlobal: row.is_global,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const employeesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const employee = await insert('employees', {
        company_id: context.companyId,
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email || null,
        position: body.position || null,
        salary: body.salary || null,
        branch_id: body.branchId || null,
        is_global: body.isGlobal || false,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Create employee error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create employee' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; isGlobal?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM employees WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId && !queryParams.isGlobal) {
        // Non-admins see only their branch employees (unless requesting global)
        params.push(context.branchId);
        sql += ` AND (branch_id = $${params.length} OR is_global = true)`;
      }

      if (queryParams.isGlobal !== undefined) {
        const isGlobalBool = queryParams.isGlobal === 'true';
        params.push(isGlobalBool);
        sql += ` AND is_global = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';

      const employees = await query(sql, params);
      return {
        status: 200 as const,
        body: employees.map(mapEmployeeFromDB),
      };
    } catch (error) {
      console.error('List employees error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list employees' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const employee = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!employee) {
        return {
          status: 404 as const,
          body: { message: 'Employee not found' },
        };
      }

      if (employee.branch_id && !canAccessBranch(context, employee.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this employee' },
        };
      }

      return {
        status: 200 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Get employee error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Employee not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Employee not found' },
        };
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this employee' },
        };
      }

      const updateData: any = {};

      if (body.firstName !== undefined) updateData.first_name = body.firstName;
      if (body.lastName !== undefined) updateData.last_name = body.lastName;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.position !== undefined) updateData.position = body.position;
      if (body.salary !== undefined) updateData.salary = body.salary;
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
        }
        updateData.branch_id = body.branchId;
      }
      if (body.isGlobal !== undefined) updateData.is_global = body.isGlobal;

      const employee = await update('employees', params.id, updateData);

      if (!employee) {
        return {
          status: 404 as const,
          body: { message: 'Employee not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Update employee error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update employee' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Employee not found' },
        };
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this employee' },
        };
      }

      // Soft delete by setting is_active to false
      const employee = await update('employees', params.id, { is_active: false });

      if (!employee) {
        return {
          status: 404 as const,
          body: { message: 'Employee not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Employee deleted successfully' },
      };
    } catch (error) {
      console.error('Delete employee error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete employee' },
      };
    }
  },
};
