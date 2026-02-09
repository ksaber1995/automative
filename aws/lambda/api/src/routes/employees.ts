import { insert, update, findById, query } from '../db/connection';

function mapEmployeeFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const employee = await insert('employees', {
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
        status: 400 as const,
        body: { message: 'Failed to create employee' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string; isGlobal?: string } }) => {
    try {
      let sql = 'SELECT * FROM employees WHERE 1=1';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const employee = await findById('employees', params.id);

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
      console.error('Get employee error:', error);
      return {
        status: 404 as const,
        body: { message: 'Employee not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.firstName !== undefined) updateData.first_name = body.firstName;
      if (body.lastName !== undefined) updateData.last_name = body.lastName;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.position !== undefined) updateData.position = body.position;
      if (body.salary !== undefined) updateData.salary = body.salary;
      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
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
        status: 404 as const,
        body: { message: 'Failed to update employee' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to delete employee' },
      };
    }
  },
};
