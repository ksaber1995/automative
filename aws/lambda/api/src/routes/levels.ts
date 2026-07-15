import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard. Mirrors ensurePerSessionSchema: the DDL is
// additive and guarded so it is a no-op once applied and safe under concurrent
// containers. Adds the optional level age range (from_age/to_age) and the
// course_levels join table that lets a course link to more than one level.
// Exported so the courses route can guarantee the join table exists too.
// ============================================================
let levelSchemaInitPromise: Promise<void> | null = null;
export async function ensureLevelSchema(): Promise<void> {
  if (!levelSchemaInitPromise) {
    levelSchemaInitPromise = (async () => {
      // Optional age range on levels (both nullable; to_age must be > from_age,
      // enforced in the route rather than a CHECK so partially-filled rows are ok).
      await query(`ALTER TABLE levels ADD COLUMN IF NOT EXISTS from_age INTEGER`);
      await query(`ALTER TABLE levels ADD COLUMN IF NOT EXISTS to_age INTEGER`);

      // Many-to-many: a course can be tagged with several levels. This is the
      // source of truth; courses.level_id is kept in sync as the first level for
      // backward compatibility with older readers.
      await query(`CREATE TABLE IF NOT EXISTS course_levels (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        level_id UUID NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (course_id, level_id)
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_course_levels_course ON course_levels(course_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_course_levels_level ON course_levels(level_id)`);

      // Backfill the join table from the legacy single link so existing courses
      // keep their level. Idempotent via the UNIQUE constraint.
      await query(`INSERT INTO course_levels (course_id, level_id)
        SELECT id, level_id FROM courses WHERE level_id IS NOT NULL
        ON CONFLICT (course_id, level_id) DO NOTHING`);
    })().catch((e) => {
      // Reset so a transient failure can be retried on the next call.
      levelSchemaInitPromise = null;
      throw e;
    });
  }
  return levelSchemaInitPromise;
}

const normAge = (v: any): number | null =>
  v === undefined || v === null || v === '' ? null : Number(v);

// to_age must be strictly greater than from_age when both are provided.
function ageRangeError(fromAge: number | null, toAge: number | null) {
  if (fromAge !== null && toAge !== null && toAge <= fromAge) {
    return apiError(400, 'ERRORS.LEVELS.AGE_RANGE_INVALID', 'To age must be greater than from age');
  }
  return null;
}

function mapLevelFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    age: row.age === null || row.age === undefined ? null : Number(row.age),
    fromAge: row.from_age === null || row.from_age === undefined ? null : Number(row.from_age),
    toAge: row.to_age === null || row.to_age === undefined ? null : Number(row.to_age),
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

      await ensureLevelSchema();

      const fromAge = normAge(body.fromAge);
      const toAge = normAge(body.toAge);
      const rangeErr = ageRangeError(fromAge, toAge);
      if (rangeErr) return rangeErr;

      const level = await insert('levels', {
        company_id: context.companyId,
        name: body.name,
        age: normAge(body.age),
        from_age: fromAge,
        to_age: toAge,
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

      await ensureLevelSchema();

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

      await ensureLevelSchema();

      const existing = await queryOne(
        'SELECT * FROM levels WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.LEVELS.NOT_FOUND', 'Level not found');

      // Resolve the effective range (incoming value, else what's already stored)
      // so a partial update can still be validated as a whole.
      const fromAge = body.fromAge !== undefined ? normAge(body.fromAge) : normAge(existing.from_age);
      const toAge = body.toAge !== undefined ? normAge(body.toAge) : normAge(existing.to_age);
      const rangeErr = ageRangeError(fromAge, toAge);
      if (rangeErr) return rangeErr;

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.age !== undefined) updateData.age = normAge(body.age);
      if (body.fromAge !== undefined) updateData.from_age = fromAge;
      if (body.toAge !== undefined) updateData.to_age = toAge;

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
