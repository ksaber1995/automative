import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard. Mirrors ensureLevelSchema: the DDL is additive
// and guarded so it is a no-op once applied and safe under concurrent containers.
// Subjects are a brand-new feature with no legacy single column to keep in sync,
// so this bootstraps the whole thing: the subjects table plus the course_subjects
// join table that lets a course be tagged with more than one subject.
// Exported so the courses route can guarantee the join table exists too.
// ============================================================
let subjectSchemaInitPromise: Promise<void> | null = null;
export async function ensureSubjectSchema(): Promise<void> {
  if (!subjectSchemaInitPromise) {
    subjectSchemaInitPromise = (async () => {
      // Shared updated_at trigger function (some DBs were initialized without it).
      await query(`
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = CURRENT_TIMESTAMP;
          RETURN NEW;
        END;
        $$ language 'plpgsql'
      `);

      // subjects table — just an id + name, tenant-scoped like levels.
      await query(`CREATE TABLE IF NOT EXISTS subjects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_subjects_company_id ON subjects(company_id)`);
      await query(`DROP TRIGGER IF EXISTS update_subjects_updated_at ON subjects`);
      await query(`
        CREATE TRIGGER update_subjects_updated_at
          BEFORE UPDATE ON subjects
          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
      `);

      // Many-to-many: a course can be tagged with several subjects.
      await query(`CREATE TABLE IF NOT EXISTS course_subjects (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (course_id, subject_id)
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_course_subjects_course ON course_subjects(course_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_course_subjects_subject ON course_subjects(subject_id)`);
    })().catch((e) => {
      // Reset so a transient failure can be retried on the next call.
      subjectSchemaInitPromise = null;
      throw e;
    });
  }
  return subjectSchemaInitPromise;
}

function mapSubjectFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const subjectsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSubjectSchema();

      const subject = await insert('subjects', {
        company_id: context.companyId,
        name: body.name,
      });

      return { status: 201 as const, body: mapSubjectFromDB(subject) };
    } catch (error) {
      console.error('Create subject error:', error);
      return mapThrownError(error, 'ERRORS.SUBJECTS.CREATE_FAILED', 'Failed to create subject', 400);
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSubjectSchema();

      const subjects = await query(
        'SELECT * FROM subjects WHERE company_id = $1 ORDER BY name ASC',
        [context.companyId]
      );
      return { status: 200 as const, body: subjects.map(mapSubjectFromDB) };
    } catch (error) {
      console.error('List subjects error:', error);
      return mapThrownError(error, 'ERRORS.SUBJECTS.LIST_FAILED', 'Failed to list subjects');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSubjectSchema();

      const subject = await queryOne(
        'SELECT * FROM subjects WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!subject) return apiError(404, 'ERRORS.SUBJECTS.NOT_FOUND', 'Subject not found');

      return { status: 200 as const, body: mapSubjectFromDB(subject) };
    } catch (error) {
      console.error('Get subject error:', error);
      return mapThrownError(error, 'ERRORS.SUBJECTS.NOT_FOUND', 'Subject not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSubjectSchema();

      const existing = await queryOne(
        'SELECT * FROM subjects WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SUBJECTS.NOT_FOUND', 'Subject not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;

      const subject = await update('subjects', params.id, updateData);
      if (!subject) return apiError(404, 'ERRORS.SUBJECTS.NOT_FOUND', 'Subject not found');

      return { status: 200 as const, body: mapSubjectFromDB(subject) };
    } catch (error) {
      console.error('Update subject error:', error);
      return mapThrownError(error, 'ERRORS.SUBJECTS.UPDATE_FAILED', 'Failed to update subject', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM subjects WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SUBJECTS.NOT_FOUND', 'Subject not found');

      // course_subjects links cascade on delete, so removing a subject simply
      // unlinks it from every course — no blocking needed.
      await query('DELETE FROM subjects WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Subject deleted successfully', code: 'SUBJECTS.DELETED' } };
    } catch (error) {
      console.error('Delete subject error:', error);
      return mapThrownError(error, 'ERRORS.SUBJECTS.DELETE_FAILED', 'Failed to delete subject', 400);
    }
  },
};
