import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter, branchBelongsToCompany } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

/**
 * A room's code IS its identity to the person picking it, so two rooms whose
 * codes differ only by whitespace or case ("ديسك 1" vs "ديسك 1 ") read as one
 * room while the double-booking guard sees two — classes land "in the same
 * room at the same time" with nothing to stop them. Reject the near-duplicate
 * at the door.
 */
async function duplicateRoomCode(companyId: string, code: string, excludeId?: string): Promise<boolean> {
  const params: any[] = [companyId, code];
  let sql = `SELECT id FROM rooms WHERE company_id = $1 AND UPPER(TRIM(code)) = UPPER(TRIM($2))`;
  if (excludeId) { params.push(excludeId); sql += ` AND id <> $${params.length}`; }
  return !!(await queryOne<any>(sql, params));
}

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
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      // canAccessBranch alone is not enough: it short-circuits to true for a
      // global admin and cannot see whether the branch is even in this company.
      // A stale branch id from a previously-signed-in tenant therefore stored
      // fine and produced a room nobody could see. Reject it at the boundary.
      if (body.branchId && !(await branchBelongsToCompany(body.branchId, context.companyId))) {
        return apiError(400, 'ERRORS.ROOMS.BRANCH_NOT_IN_COMPANY', 'That branch does not belong to this company');
      }

      const code = String(body.code ?? '').trim();
      if (!code) {
        return apiError(400, 'ERRORS.ROOMS.CODE_REQUIRED', 'Room code is required');
      }
      if (await duplicateRoomCode(context.companyId, code)) {
        return apiError(409, 'ERRORS.ROOMS.DUPLICATE_CODE', 'A room with this code already exists');
      }

      const room = await insert('rooms', {
        company_id: context.companyId,
        branch_id: body.branchId,
        code,
        description: body.description || null,
        is_active: true,
      });

      return { status: 201 as const, body: mapRoomFromDB(room) };
    } catch (error) {
      console.error('Create room error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.CREATE_FAILED', 'Failed to create room', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
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
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'r.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY r.code ASC';

      const rooms = await query(sql, params);
      return { status: 200 as const, body: rooms.map(mapRoomWithStatusFromDB) };
    } catch (error) {
      console.error('List rooms error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.LIST_FAILED', 'Failed to list rooms');
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
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
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND r.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'r.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY r.code ASC';

      const rooms = await query(sql, params);
      return { status: 200 as const, body: rooms.map(mapRoomWithStatusFromDB) };
    } catch (error) {
      console.error('List active rooms error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.LIST_FAILED', 'Failed to list active rooms');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
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
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return apiError(403, 'ERRORS.ROOMS.ACCESS_DENIED', 'Access denied to this room');
      }

      return { status: 200 as const, body: mapRoomWithStatusFromDB(result[0]) };
    } catch (error) {
      console.error('Get room error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM rooms WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.ROOMS.ACCESS_DENIED_UPDATE', 'Access denied to update this room');
      }

      const updateData: any = {};
      if (body.code !== undefined) {
        const code = String(body.code ?? '').trim();
        if (!code) {
          return apiError(400, 'ERRORS.ROOMS.CODE_REQUIRED', 'Room code is required');
        }
        if (await duplicateRoomCode(context.companyId, code, params.id)) {
          return apiError(409, 'ERRORS.ROOMS.DUPLICATE_CODE', 'A room with this code already exists');
        }
        updateData.code = code;
      }
      if (body.description !== undefined) updateData.description = body.description;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const room = await update('rooms', params.id, updateData);

      if (!room) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      return { status: 200 as const, body: mapRoomFromDB(room) };
    } catch (error) {
      console.error('Update room error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.UPDATE_FAILED', 'Failed to update room', 400);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM rooms WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.ROOMS.NOT_FOUND', 'Room not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.ROOMS.ACCESS_DENIED_DELETE', 'Access denied to delete this room');
      }

      // Check for active sessions
      const activeSession = await queryOne(
        'SELECT id FROM sessions WHERE room_id = $1 AND end_date IS NULL',
        [params.id]
      );

      if (activeSession) {
        return apiError(400, 'ERRORS.ROOMS.HAS_ACTIVE_SESSION', 'Cannot delete room with an active session. End the session first.');
      }

      await update('rooms', params.id, { is_active: false });

      return { status: 200 as const, body: { message: 'Room deleted successfully', code: 'ROOMS.DELETED' } };
    } catch (error) {
      console.error('Delete room error:', error);
      return mapThrownError(error, 'ERRORS.ROOMS.DELETE_FAILED', 'Failed to delete room', 400);
    }
  },
};
