import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

function mapRoomFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    code: row.code,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRoomWithStatusFromDB(row: any) {
  return {
    ...mapRoomFromDB(row),
    branchName: row.branch_name,
    isOccupied: row.is_occupied === true || row.is_occupied === 'true',
    activeSession: row.active_session_id ? {
      id: row.active_session_id,
      classId: row.active_class_id,
      className: row.active_class_name,
      startDate: row.active_start_date,
    } : null,
  };
}

export const roomsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      const room = await insert('rooms', {
        company_id: context.companyId,
        branch_id: body.branchId,
        code: body.code,
        description: body.description || null,
        is_active: true,
      });

      return { status: 201 as const, body: mapRoomFromDB(room) };
    } catch (error) {
      console.error('Create room error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create room' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `
        SELECT
          r.*,
          b.name as branch_name,
          s.id as active_session_id,
          s.class_id as active_class_id,
          cl.name as active_class_name,
          s.start_date as active_start_date,
          CASE WHEN s.id IS NOT NULL THEN true ELSE false END as is_occupied
        FROM rooms r
        LEFT JOIN branches b ON r.branch_id = b.id
        LEFT JOIN sessions s ON s.room_id = r.id AND s.end_date IS NULL
        LEFT JOIN classes cl ON s.class_id = cl.id
        WHERE r.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      }

      sql += ' ORDER BY r.code ASC';

      const rooms = await query(sql, params);
      return { status: 200 as const, body: rooms.map(mapRoomWithStatusFromDB) };
    } catch (error) {
      console.error('List rooms error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list rooms' },
      };
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `
        SELECT
          r.*,
          b.name as branch_name,
          s.id as active_session_id,
          s.class_id as active_class_id,
          cl.name as active_class_name,
          s.start_date as active_start_date,
          CASE WHEN s.id IS NOT NULL THEN true ELSE false END as is_occupied
        FROM rooms r
        LEFT JOIN branches b ON r.branch_id = b.id
        LEFT JOIN sessions s ON s.room_id = r.id AND s.end_date IS NULL
        LEFT JOIN classes cl ON s.class_id = cl.id
        WHERE r.company_id = $1 AND r.is_active = true
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      }

      sql += ' ORDER BY r.code ASC';

      const rooms = await query(sql, params);
      return { status: 200 as const, body: rooms.map(mapRoomWithStatusFromDB) };
    } catch (error) {
      console.error('List active rooms error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list active rooms' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const sql = `
        SELECT
          r.*,
          b.name as branch_name,
          s.id as active_session_id,
          s.class_id as active_class_id,
          cl.name as active_class_name,
          s.start_date as active_start_date,
          CASE WHEN s.id IS NOT NULL THEN true ELSE false END as is_occupied
        FROM rooms r
        LEFT JOIN branches b ON r.branch_id = b.id
        LEFT JOIN sessions s ON s.room_id = r.id AND s.end_date IS NULL
        LEFT JOIN classes cl ON s.class_id = cl.id
        WHERE r.id = $1 AND r.company_id = $2
      `;

      const result = await query(sql, [params.id, context.companyId]);

      if (!result || result.length === 0) {
        return { status: 404 as const, body: { message: 'Room not found' } };
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this room' } };
      }

      return { status: 200 as const, body: mapRoomWithStatusFromDB(result[0]) };
    } catch (error) {
      console.error('Get room error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Room not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM rooms WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Room not found' } };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to update this room' } };
      }

      const updateData: any = {};
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const room = await update('rooms', params.id, updateData);

      if (!room) {
        return { status: 404 as const, body: { message: 'Room not found' } };
      }

      return { status: 200 as const, body: mapRoomFromDB(room) };
    } catch (error) {
      console.error('Update room error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to update room' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM rooms WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Room not found' } };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to delete this room' } };
      }

      // Check for active sessions
      const activeSession = await queryOne(
        'SELECT id FROM sessions WHERE room_id = $1 AND end_date IS NULL',
        [params.id]
      );

      if (activeSession) {
        return { status: 400 as const, body: { message: 'Cannot delete room with an active session. End the session first.' } };
      }

      await update('rooms', params.id, { is_active: false });

      return { status: 200 as const, body: { message: 'Room deleted successfully' } };
    } catch (error) {
      console.error('Delete room error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to delete room' },
      };
    }
  },
};
