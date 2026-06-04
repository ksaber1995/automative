import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapLevelFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    age: row.age === null || row.age === undefined ? null : Number(row.age),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const levelsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const level = await insert('levels', {
        company_id: context.companyId,
        name: body.name,
        age: body.age === undefined || body.age === null || body.age === '' ? null : body.age,
      });

      return { status: 201 as const, body: mapLevelFromDB(level) };
    } catch (error) {
      console.error('Create level error:', error);
      return mapThrownError(error, 'ERRORS.LEVELS.CREATE_FAILED', 'Failed to create level', 400);
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const levels = await query(
        'SELECT * FROM levels WHERE company_id = $1 ORDER BY name ASC',
        [context.companyId]
      );
      return { status: 200 as const, body: levels.map(mapLevelFromDB) };
    } catch (error) {
      console.error('List levels error:', error);
      return mapThrownError(error, 'ERRORS.LEVELS.LIST_FAILED', 'Failed to list levels');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const level = await queryOne(
        'SELECT * FROM levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!level) return apiError(404, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found');

      return { status: 200 as const, body: mapLevelFromDB(level) };
    } catch (error) {
      console.error('Get level error:', error);
      return mapThrownError(error, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.age !== undefined) updateData.age = body.age === null || body.age === '' ? null : body.age;

      const level = await update('levels', params.id, updateData);
      if (!level) return apiError(404, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found');

      return { status: 200 as const, body: mapLevelFromDB(level) };
    } catch (error) {
      console.error('Update level error:', error);
      return mapThrownError(error, 'ERRORS.LEVELS.UPDATE_FAILED', 'Failed to update level', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found');

      // Courses/master courses reference levels with ON DELETE SET NULL, so
      // deleting a level simply unlinks it everywhere — no blocking needed.
      await query('DELETE FROM levels WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Level deleted successfully', code: 'LEVELS.DELETED' } };
    } catch (error) {
      console.error('Delete level error:', error);
      return mapThrownError(error, 'ERRORS.LEVELS.DELETE_FAILED', 'Failed to delete level', 400);
    }
  },
};
