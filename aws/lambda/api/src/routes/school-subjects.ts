import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard (migration 095). Mirrors
// ensureSchoolLevelsSchema in school-levels.ts — same `school` Postgres
// schema, so every query below must schema-qualify (`school.subjects`).
// ============================================================
let schoolSubjectSchemaInitPromise: Promise<void> | null = null;
export async function ensureSchoolSubjectsSchema(): Promise<void> {
  if (!schoolSubjectSchemaInitPromise) {
    schoolSubjectSchemaInitPromise = (async () => {
      await query(`CREATE SCHEMA IF NOT EXISTS school`);
      await query(`CREATE TABLE IF NOT EXISTS school.subjects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        level_id UUID NOT NULL REFERENCES school.levels(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_subjects_company_id ON school.subjects(company_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_subjects_level_id ON school.subjects(level_id)`);
    })().catch((e) => {
      schoolSubjectSchemaInitPromise = null;
      throw e;
    });
  }
  return schoolSubjectSchemaInitPromise;
}

function mapSchoolSubjectFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    levelId: row.level_id,
    name: row.name,
    // Present only on the joined list/getById query below.
    levelName: row.level_name !== undefined ? row.level_name : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The level must exist and belong to this company, or the FK insert would
 *  otherwise fail with an opaque DB error (or worse, silently cross tenants
 *  if two companies ever shared a level id — they can't, but this is the
 *  same belt-and-braces scoping every other route in this codebase does). */
async function levelBelongsToCompany(levelId: string, companyId: string): Promise<boolean> {
  const row = await queryOne('SELECT id FROM school.levels WHERE id = $1 AND company_id = $2', [levelId, companyId]);
  return !!row;
}

/**
 * A SCHOOL tenant's subjects — one-to-many under an educational stage
 * (school.levels): every subject belongs to exactly one stage, never company-
 * wide like the academy `subjects` table. Supports an optional `levelId`
 * filter on list (used both by the flat Subjects page's level filter and by
 * a stage's own "subjects in this stage" view).
 */
export const schoolSubjectsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSubjectsSchema();

      if (!body.levelId) {
        return apiError(400, 'ERRORS.SCHOOL_SUBJECTS.LEVEL_REQUIRED', 'An educational stage must be selected');
      }
      if (!(await levelBelongsToCompany(body.levelId, context.companyId))) {
        return apiError(400, 'ERRORS.SCHOOL_SUBJECTS.LEVEL_NOT_FOUND', 'Educational stage not found');
      }

      const subject = await insert('school.subjects', {
        company_id: context.companyId,
        level_id: body.levelId,
        name: body.name,
      });

      return { status: 201 as const, body: mapSchoolSubjectFromDB(subject) };
    } catch (error) {
      console.error('Create school subject error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SUBJECTS.CREATE_FAILED', 'Failed to create subject', 400);
    }
  },

  /** GET /api/school-subjects?levelId= — levelId narrows to one stage's
   *  subjects; omitted, it's every subject across every stage (the flat
   *  Subjects page), each carrying its stage's name for the level filter. */
  list: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSubjectsSchema();

      const params: any[] = [context.companyId];
      let sql = `SELECT s.*, l.name AS level_name
                 FROM school.subjects s
                 JOIN school.levels l ON l.id = s.level_id
                 WHERE s.company_id = $1`;
      if (q?.levelId) {
        params.push(q.levelId);
        sql += ` AND s.level_id = $${params.length}`;
      }
      sql += ' ORDER BY l.name ASC, s.name ASC';

      const subjects = await query(sql, params);
      return { status: 200 as const, body: subjects.map(mapSchoolSubjectFromDB) };
    } catch (error) {
      console.error('List school subjects error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SUBJECTS.LIST_FAILED', 'Failed to list subjects');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const subject = await queryOne(
        `SELECT s.*, l.name AS level_name FROM school.subjects s
         JOIN school.levels l ON l.id = s.level_id
         WHERE s.id = $1 AND s.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!subject) return apiError(404, 'ERRORS.SCHOOL_SUBJECTS.NOT_FOUND', 'Subject not found');

      return { status: 200 as const, body: mapSchoolSubjectFromDB(subject) };
    } catch (error) {
      console.error('Get school subject error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SUBJECTS.NOT_FOUND', 'Subject not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolSubjectsSchema();

      const existing = await queryOne(
        'SELECT * FROM school.subjects WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_SUBJECTS.NOT_FOUND', 'Subject not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.levelId !== undefined) {
        if (!(await levelBelongsToCompany(body.levelId, context.companyId))) {
          return apiError(400, 'ERRORS.SCHOOL_SUBJECTS.LEVEL_NOT_FOUND', 'Educational stage not found');
        }
        updateData.level_id = body.levelId;
      }

      const subject = await update('school.subjects', params.id, updateData);
      if (!subject) return apiError(404, 'ERRORS.SCHOOL_SUBJECTS.NOT_FOUND', 'Subject not found');

      return { status: 200 as const, body: mapSchoolSubjectFromDB(subject) };
    } catch (error) {
      console.error('Update school subject error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SUBJECTS.UPDATE_FAILED', 'Failed to update subject', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM school.subjects WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_SUBJECTS.NOT_FOUND', 'Subject not found');

      await query('DELETE FROM school.subjects WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Subject deleted successfully', code: 'SCHOOL_SUBJECTS.DELETED' } };
    } catch (error) {
      console.error('Delete school subject error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_SUBJECTS.DELETE_FAILED', 'Failed to delete subject', 400);
    }
  },
};
