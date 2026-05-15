import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapEmployeeFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    position: row.position,
    salary: row.salary ? parseFloat(row.salary) : null,
    hireDate: row.hire_date,
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
      if (!checkGranularPermission(context, 'employees', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const employee = await insert('employees', {
        company_id: context.companyId,
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email || null,
        phone: body.phone || null,
        department: body.department || null,
        position: body.position || null,
        salary: body.salary || null,
        hire_date: body.hireDate || null,
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
      return mapThrownError(error, 'ERRORS.EMPLOYEES.CREATE_FAILED', 'Failed to create employee', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; isGlobal?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = 'SELECT * FROM employees WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId && !queryParams.isGlobal) {
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
      return mapThrownError(error, 'ERRORS.EMPLOYEES.LIST_FAILED', 'Failed to list employees');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const employee = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      if (employee.branch_id && !canAccessBranch(context, employee.branch_id)) {
        return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED', 'Access denied to this employee');
      }

      return {
        status: 200 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Get employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_UPDATE', 'Access denied to update this employee');
      }

      const updateData: any = {};

      if (body.firstName !== undefined) updateData.first_name = body.firstName;
      if (body.lastName !== undefined) updateData.last_name = body.lastName;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.department !== undefined) updateData.department = body.department;
      if (body.position !== undefined) updateData.position = body.position;
      if (body.salary !== undefined) updateData.salary = body.salary;
      if (body.hireDate !== undefined) updateData.hire_date = body.hireDate;
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.isGlobal !== undefined) updateData.is_global = body.isGlobal;

      const employee = await update('employees', params.id, updateData);

      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      return {
        status: 200 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Update employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.UPDATE_FAILED', 'Failed to update employee', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_DELETE', 'Access denied to delete this employee');
      }

      // Block termination if the employee is still assigned as instructor on any non-finished class.
      // (company_id is derived from the linked course.)
      const assignedClasses = await query(
        `SELECT c.id, c.name, c.code
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.instructor_id = $1
           AND co.company_id = $2
           AND COALESCE(c.is_finished, FALSE) = FALSE`,
        [params.id, context.companyId]
      );

      if (assignedClasses.length > 0) {
        return {
          status: 400 as const,
          body: {
            message: 'Cannot terminate this employee while they are assigned to active classes. Please unassign them from these classes first.',
            code: 'ERRORS.EMPLOYEES.ASSIGNED_TO_ACTIVE_CLASSES',
            assignedClasses: assignedClasses.map((c: any) => ({ id: c.id, name: c.name, code: c.code })),
          },
        };
      }

      // Soft delete by setting is_active to false
      const employee = await update('employees', params.id, { is_active: false });

      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      return {
        status: 200 as const,
        body: { message: 'Employee deleted successfully', code: 'EMPLOYEES.DELETED' },
      };
    } catch (error) {
      console.error('Delete employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.DELETE_FAILED', 'Failed to delete employee', 404);
    }
  },
};
