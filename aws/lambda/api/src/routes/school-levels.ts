import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard (migration 094). Mirrors ensureLevelSchema
// in levels.ts, but this table lives in its OWN Postgres schema (`school`),
// not `public` — the first one in this codebase. Every query below MUST
// schema-qualify (`school.levels`): the connection pool sets no custom
// search_path, so a bare `levels` would resolve to the unrelated public table.
// ============================================================
let schoolLevelSchemaInitPromise: Promise<void> | null = null;
export async function ensureSchoolLevelsSchema(): Promise<void> {
  if (!schoolLevelSchemaInitPromise) {
    schoolLevelSchemaInitPromise = (async () => {
      await query(`CREATE SCHEMA IF NOT EXISTS school`);
      await query(`CREATE TABLE IF NOT EXISTS school.levels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_levels_company_id ON school.levels(company_id)`);
    })().catch((e) => {
      // Reset so a transient failure can be retried on the next call.
      schoolLevelSchemaInitPromise = null;
      throw e;
    });
  }
  return schoolLevelSchemaInitPromise;
}

function mapSchoolLevelFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A SCHOOL tenant's "Educational Stages" — the grade/class-year ladder shown
 * on their sidebar. Deliberately a thin, separate CRUD from levels.ts: no age
 * range (schools don't file by age band), and its own table/schema so the
 * shape can diverge freely as the real School feature set gets designed.
 * Permission checks reuse the 'academy' resource, same as levels.ts — there is
 * no school-specific permission resource (yet).
 */
export const schoolLevelsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolLevelsSchema();

      const level = await insert('school.levels', {
        company_id: context.companyId,
        name: body.name,
      });

      return { status: 201 as const, body: mapSchoolLevelFromDB(level) };
    } catch (error) {
      console.error('Create school level error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_LEVELS.CREATE_FAILED', 'Failed to create educational stage', 400);
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolLevelsSchema();

      const levels = await query(
        'SELECT * FROM school.levels WHERE company_id = $1 ORDER BY name ASC',
        [context.companyId]
      );
      return { status: 200 as const, body: levels.map(mapSchoolLevelFromDB) };
    } catch (error) {
      console.error('List school levels error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_LEVELS.LIST_FAILED', 'Failed to list educational stages');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const level = await queryOne(
        'SELECT * FROM school.levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!level) return apiError(404, 'ERRORS.SCHOOL_LEVELS.NOT_FOUND', 'Educational stage not found');

      return { status: 200 as const, body: mapSchoolLevelFromDB(level) };
    } catch (error) {
      console.error('Get school level error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_LEVELS.NOT_FOUND', 'Educational stage not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolLevelsSchema();

      const existing = await queryOne(
        'SELECT * FROM school.levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_LEVELS.NOT_FOUND', 'Educational stage not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;

      const level = await update('school.levels', params.id, updateData);
      if (!level) return apiError(404, 'ERRORS.SCHOOL_LEVELS.NOT_FOUND', 'Educational stage not found');

      return { status: 200 as const, body: mapSchoolLevelFromDB(level) };
    } catch (error) {
      console.error('Update school level error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_LEVELS.UPDATE_FAILED', 'Failed to update educational stage', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM school.levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_LEVELS.NOT_FOUND', 'Educational stage not found');

      await query('DELETE FROM school.levels WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Educational stage deleted successfully', code: 'SCHOOL_LEVELS.DELETED' } };
    } catch (error) {
      console.error('Delete school level error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_LEVELS.DELETE_FAILED', 'Failed to delete educational stage', 400);
    }
  },
};
