import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';

function mapBranchFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    phone: row.phone,
    email: row.email,
    managerId: row.manager_id,
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

      // Only ADMIN can create branches
      if (context.role !== 'ADMIN') {
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
        zip_code: body.zipCode || null,
        phone: body.phone || null,
        email: body.email || null,
        manager_id: body.managerId || null,
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
        status: error.message === 'No authentication token provided' ? 401 : 400,
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
        status: error.message === 'No authentication token provided' ? 401 : 500,
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
        status: error.message === 'No authentication token provided' ? 401 : 500,
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
        status: error.message === 'No authentication token provided' ? 401 : 404,
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

      // Only ADMIN can update branches
      if (context.role !== 'ADMIN') {
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
      if (body.zipCode !== undefined) updateData.zip_code = body.zipCode;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.managerId !== undefined) updateData.manager_id = body.managerId;
      if (body.openingDate !== undefined) updateData.opening_date = body.openingDate;

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
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update branch' },
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

      // Only ADMIN can delete branches
      if (context.role !== 'ADMIN') {
        return {
          status: 403 as const,
          body: { message: 'Only administrators can delete branches' },
        };
      }

      const branch = await update('branches', params.id, { is_active: false });

      if (!branch) {
        return {
          status: 404 as const,
          body: { message: 'Branch not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Branch deleted successfully' },
      };
    } catch (error) {
      console.error('Delete branch error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete branch' },
      };
    }
  },
};
