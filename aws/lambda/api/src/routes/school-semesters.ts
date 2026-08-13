import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard (migration 095). Mirrors
// ensureSchoolLevelsSchema in school-levels.ts.
// ============================================================
let schoolSemesterSchemaInitPromise: Promise<void> | null = null;
export async function ensureSchoolSemestersSchema(): Promise<void> {
  if (!schoolSemesterSchemaInitPromise) {
    schoolSemesterSchemaInitPromise = (async () => {
      await query(`CREATE SCHEMA IF NOT EXISTS school`);
      await query(`CREATE TABLE IF NOT EXISTS school.semesters (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        start_date DATE,
        end_date DATE,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_semesters_company_id ON school.semesters(company_id)`);
    })().catch((e) => {
      schoolSemesterSchemaInitPromise = null;
      throw e;
    });
  }
  return schoolSemesterSchemaInitPromise;
}

function mapSchoolSemesterFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    startDate: row.start_date || null,
    endDate: row.end_date || null,
    isActive: row.is_active === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A SCHOOL tenant's semesters/terms — company-wide, no relation to
 *  levels/subjects. Minimal CRUD, same permission model as the rest of the
 *  School feature ('academy' resource — no dedicated permission yet). */
export const schoolSemestersRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSemestersSchema();

      const semester = await insert('school.semesters', {
        company_id: context.companyId,
        name: body.name,
        start_date: body.startDate || null,
        end_date: body.endDate || null,
        is_active: body.isActive !== false,
      });

      return { status: 201 as const, body: mapSchoolSemesterFromDB(semester) };
    } catch (error) {
      console.error('Create school semester error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SEMESTERS.CREATE_FAILED', 'Failed to create semester', 400);
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSemestersSchema();

      const semesters = await query(
        'SELECT * FROM school.semesters WHERE company_id = $1 ORDER BY start_date DESC NULLS LAST, name ASC',
        [context.companyId]
      );
      return { status: 200 as const, body: semesters.map(mapSchoolSemesterFromDB) };
    } catch (error) {
      console.error('List school semesters error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SEMESTERS.LIST_FAILED', 'Failed to list semesters');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const semester = await queryOne(
        'SELECT * FROM school.semesters WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!semester) return apiError(404, 'ERRORS.SCHOOL_SEMESTERS.NOT_FOUND', 'Semester not found');

      return { status: 200 as const, body: mapSchoolSemesterFromDB(semester) };
    } catch (error) {
      console.error('Get school semester error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SEMESTERS.NOT_FOUND', 'Semester not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSemestersSchema();

      const existing = await queryOne(
        'SELECT * FROM school.semesters WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_SEMESTERS.NOT_FOUND', 'Semester not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.startDate !== undefined) updateData.start_date = body.startDate || null;
      if (body.endDate !== undefined) updateData.end_date = body.endDate || null;
      if (body.isActive !== undefined) updateData.is_active = body.isActive === true;

      const semester = await update('school.semesters', params.id, updateData);
      if (!semester) return apiError(404, 'ERRORS.SCHOOL_SEMESTERS.NOT_FOUND', 'Semester not found');

      return { status: 200 as const, body: mapSchoolSemesterFromDB(semester) };
    } catch (error) {
      console.error('Update school semester error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SEMESTERS.UPDATE_FAILED', 'Failed to update semester', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM school.semesters WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_SEMESTERS.NOT_FOUND', 'Semester not found');

      await query('DELETE FROM school.semesters WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Semester deleted successfully', code: 'SCHOOL_SEMESTERS.DELETED' } };
    } catch (error) {
      console.error('Delete school semester error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SEMESTERS.DELETE_FAILED', 'Failed to delete semester', 400);
    }
  },
};
