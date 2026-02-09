import { insert, update, findById, query } from '../db/connection';

function mapBranchFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const branch = await insert('branches', {
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
        status: 400 as const,
        body: { message: 'Failed to create branch' },
      };
    }
  },

  list: async () => {
    try {
      const branches = await query('SELECT * FROM branches ORDER BY created_at DESC');
      return {
        status: 200 as const,
        body: branches.map(mapBranchFromDB),
      };
    } catch (error) {
      console.error('List branches error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  listActive: async () => {
    try {
      const branches = await query('SELECT * FROM branches WHERE is_active = true ORDER BY created_at DESC');
      return {
        status: 200 as const,
        body: branches.map(mapBranchFromDB),
      };
    } catch (error) {
      console.error('List active branches error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const branch = await findById('branches', params.id);

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
        status: 404 as const,
        body: { message: 'Branch not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to update branch' },
      };
    }
  },
};
