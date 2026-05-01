import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

function mapSessionFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    roomId: row.room_id,
    classId: row.class_id,
    startDate: row.start_date,
    endDate: row.end_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionWithDetailsFromDB(row: any) {
  const start = row.start_date ? new Date(row.start_date) : null;
  const end = row.end_date ? new Date(row.end_date) : null;
  const durationMinutes = start && end ? Math.round((end.getTime() - start.getTime()) / 60000) : null;

  return {
    ...mapSessionFromDB(row),
    roomCode: row.room_code,
    roomDescription: row.room_description,
    className: row.class_name,
    classCode: row.class_code,
    courseName: row.course_name,
    branchName: row.branch_name,
    durationMinutes,
  };
}

export const sessionsRoutes = {
  start: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      // Verify room exists and belongs to company
      const room = await queryOne(
        'SELECT * FROM rooms WHERE id = $1 AND company_id = $2 AND is_active = true',
        [body.roomId, context.companyId]
      );
      if (!room) {
        return { status: 404 as const, body: { message: 'Room not found or inactive' } };
      }

      // Verify class exists and belongs to company
      const cls = await queryOne(
        'SELECT * FROM classes WHERE id = $1 AND company_id = $2',
        [body.classId, context.companyId]
      );
      if (!cls) {
        return { status: 404 as const, body: { message: 'Class not found' } };
      }

      if (cls.is_finished) {
        return { status: 400 as const, body: { message: 'This class is finished. Sessions cannot be started.' } };
      }

      // Check if room is already occupied
      const activeSession = await queryOne(
        'SELECT id FROM sessions WHERE room_id = $1 AND end_date IS NULL',
        [body.roomId]
      );
      if (activeSession) {
        return { status: 400 as const, body: { message: 'Room is already occupied. End the current session first.' } };
      }

      // Check if class already has an active session
      const classActiveSession = await queryOne(
        'SELECT id FROM sessions WHERE class_id = $1 AND end_date IS NULL',
        [body.classId]
      );
      if (classActiveSession) {
        return { status: 400 as const, body: { message: 'This class already has an active session running.' } };
      }

      const session = await insert('sessions', {
        company_id: context.companyId,
        branch_id: body.branchId || room.branch_id,
        room_id: body.roomId,
        class_id: body.classId,
        start_date: new Date().toISOString(),
        end_date: null,
        notes: body.notes || null,
      });

      return { status: 201 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('Start session error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to start session' },
      };
    }
  },

  end: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM sessions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Session not found' } };
      }

      if (existing.end_date) {
        return { status: 400 as const, body: { message: 'Session has already ended' } };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this session' } };
      }

      // Allow caller to supply a custom end date (e.g. forgot to end session yesterday)
      let endDate: Date;
      if (body?.endDate) {
        endDate = new Date(body.endDate);
        if (isNaN(endDate.getTime())) {
          return { status: 400 as const, body: { message: 'Invalid endDate provided' } };
        }
        // Validate: endDate must not be before startDate
        const startDate = new Date(existing.start_date);
        if (endDate < startDate) {
          return { status: 400 as const, body: { message: 'End date cannot be before start date' } };
        }
      } else {
        endDate = new Date();
      }

      const updateData: any = {
        end_date: endDate.toISOString(),
      };
      if (body?.notes !== undefined) updateData.notes = body.notes;

      const session = await update('sessions', params.id, updateData);

      return { status: 200 as const, body: mapSessionFromDB(session) };
    } catch (error) {
      console.error('End session error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to end session' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; classId?: string; roomId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `
        SELECT
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          cl.code as class_code,
          co.name as course_name,
          b.name as branch_name
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      }

      if (queryParams.classId) {
        params.push(queryParams.classId);
        sql += ` AND s.class_id = $${params.length}`;
      }

      if (queryParams.roomId) {
        params.push(queryParams.roomId);
        sql += ` AND s.room_id = $${params.length}`;
      }

      sql += ' ORDER BY s.start_date DESC';

      const sessions = await query(sql, params);
      return { status: 200 as const, body: sessions.map(mapSessionWithDetailsFromDB) };
    } catch (error) {
      console.error('List sessions error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list sessions' },
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
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          cl.code as class_code,
          co.name as course_name,
          b.name as branch_name
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.company_id = $1 AND s.end_date IS NULL
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      }

      sql += ' ORDER BY s.start_date DESC';

      const sessions = await query(sql, params);
      return { status: 200 as const, body: sessions.map(mapSessionWithDetailsFromDB) };
    } catch (error) {
      console.error('List active sessions error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list active sessions' },
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
          s.*,
          r.code as room_code,
          r.description as room_description,
          cl.name as class_name,
          cl.code as class_code,
          co.name as course_name,
          b.name as branch_name
        FROM sessions s
        LEFT JOIN rooms r ON s.room_id = r.id
        LEFT JOIN classes cl ON s.class_id = cl.id
        LEFT JOIN courses co ON cl.course_id = co.id
        LEFT JOIN branches b ON s.branch_id = b.id
        WHERE s.id = $1 AND s.company_id = $2
      `;

      const result = await query(sql, [params.id, context.companyId]);

      if (!result || result.length === 0) {
        return { status: 404 as const, body: { message: 'Session not found' } };
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this session' } };
      }

      return { status: 200 as const, body: mapSessionWithDetailsFromDB(result[0]) };
    } catch (error) {
      console.error('Get session error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Session not found' },
      };
    }
  },
};
