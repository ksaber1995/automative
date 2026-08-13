import { insert, update, query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// ============================================================
// Idempotent runtime schema guard (migration 096). Mirrors
// ensureSchoolLevelsSchema in school-levels.ts — same `school` Postgres
// schema, so every query below must schema-qualify (`school.classes`).
// ============================================================
let schoolClassSchemaInitPromise: Promise<void> | null = null;
export async function ensureSchoolClassesSchema(): Promise<void> {
  if (!schoolClassSchemaInitPromise) {
    schoolClassSchemaInitPromise = (async () => {
      await query(`CREATE SCHEMA IF NOT EXISTS school`);
      await query(`CREATE TABLE IF NOT EXISTS school.classes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        level_id UUID NOT NULL REFERENCES school.levels(id) ON DELETE CASCADE,
        room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_classes_company_id ON school.classes(company_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_classes_level_id ON school.classes(level_id)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_school_classes_room_id ON school.classes(room_id)`);
    })().catch((e) => {
      schoolClassSchemaInitPromise = null;
      throw e;
    });
  }
  return schoolClassSchemaInitPromise;
}

function mapSchoolClassFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    levelId: row.level_id,
    roomId: row.room_id,
    name: row.name,
    // Present only on the joined list/getById query below.
    levelName: row.level_name !== undefined ? row.level_name : undefined,
    roomCode: row.room_code !== undefined ? row.room_code : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Same belt-and-braces scoping as every other school.* route: the level and
 *  (if given) the room must actually belong to this company, or a stale id
 *  from another tenant would otherwise insert fine and link across tenants. */
async function levelBelongsToCompany(levelId: string, companyId: string): Promise<boolean> {
  const row = await queryOne('SELECT id FROM school.levels WHERE id = $1 AND company_id = $2', [levelId, companyId]);
  return !!row;
}

async function roomBelongsToCompany(roomId: string, companyId: string): Promise<boolean> {
  const row = await queryOne('SELECT id FROM rooms WHERE id = $1 AND company_id = $2', [roomId, companyId]);
  return !!row;
}

/**
 * A SCHOOL tenant's classes — one-to-many under an educational stage
 * (school.levels), same relationship as school.subjects. Deliberately NOT the
 * academy `classes` shape: no course, no timetable (start/end time, days of
 * week) — just a name and which of the company's existing rooms it meets in.
 */
export const schoolClassesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolClassesSchema();

      if (!body.levelId) {
        return apiError(400, 'ERRORS.SCHOOL_CLASSES.LEVEL_REQUIRED', 'An educational stage must be selected');
      }
      if (!(await levelBelongsToCompany(body.levelId, context.companyId))) {
        return apiError(400, 'ERRORS.SCHOOL_CLASSES.LEVEL_NOT_FOUND', 'Educational stage not found');
      }
      if (body.roomId && !(await roomBelongsToCompany(body.roomId, context.companyId))) {
        return apiError(400, 'ERRORS.SCHOOL_CLASSES.ROOM_NOT_FOUND', 'Room not found');
      }

      const cls = await insert('school.classes', {
        company_id: context.companyId,
        level_id: body.levelId,
        room_id: body.roomId || null,
        name: body.name,
      });

      return { status: 201 as const, body: mapSchoolClassFromDB(cls) };
    } catch (error) {
      console.error('Create school class error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_CLASSES.CREATE_FAILED', 'Failed to create class', 400);
    }
  },

  /** GET /api/school-classes?levelId= — levelId narrows to one stage's
   *  classes; omitted, every class across every stage (the flat Classes
   *  page's level filter uses both). */
  list: async ({ query: q, headers }: { query: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolClassesSchema();

      const params: any[] = [context.companyId];
      let sql = `SELECT c.*, l.name AS level_name, r.code AS room_code
                 FROM school.classes c
                 JOIN school.levels l ON l.id = c.level_id
                 LEFT JOIN rooms r ON r.id = c.room_id
                 WHERE c.company_id = $1`;
      if (q?.levelId) {
        params.push(q.levelId);
        sql += ` AND c.level_id = $${params.length}`;
      }
      sql += ' ORDER BY l.name ASC, c.name ASC';

      const classes = await query(sql, params);
      return { status: 200 as const, body: classes.map(mapSchoolClassFromDB) };
    } catch (error) {
      console.error('List school classes error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_CLASSES.LIST_FAILED', 'Failed to list classes');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const cls = await queryOne(
        `SELECT c.*, l.name AS level_name, r.code AS room_code FROM school.classes c
         JOIN school.levels l ON l.id = c.level_id
         LEFT JOIN rooms r ON r.id = c.room_id
         WHERE c.id = $1 AND c.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!cls) return apiError(404, 'ERRORS.SCHOOL_CLASSES.NOT_FOUND', 'Class not found');

      return { status: 200 as const, body: mapSchoolClassFromDB(cls) };
    } catch (error) {
      console.error('Get school class error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_CLASSES.NOT_FOUND', 'Class not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSchoolClassesSchema();

      const existing = await queryOne(
        'SELECT * FROM school.classes WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_CLASSES.NOT_FOUND', 'Class not found');

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.levelId !== undefined) {
        if (!(await levelBelongsToCompany(body.levelId, context.companyId))) {
          return apiError(400, 'ERRORS.SCHOOL_CLASSES.LEVEL_NOT_FOUND', 'Educational stage not found');
        }
        updateData.level_id = body.levelId;
      }
      if (body.roomId !== undefined) {
        if (body.roomId && !(await roomBelongsToCompany(body.roomId, context.companyId))) {
          return apiError(400, 'ERRORS.SCHOOL_CLASSES.ROOM_NOT_FOUND', 'Room not found');
        }
        updateData.room_id = body.roomId || null;
      }

      const cls = await update('school.classes', params.id, updateData);
      if (!cls) return apiError(404, 'ERRORS.SCHOOL_CLASSES.NOT_FOUND', 'Class not found');

      return { status: 200 as const, body: mapSchoolClassFromDB(cls) };
    } catch (error) {
      console.error('Update school class error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_CLASSES.UPDATE_FAILED', 'Failed to update class', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM school.classes WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.SCHOOL_CLASSES.NOT_FOUND', 'Class not found');

      await query('DELETE FROM school.classes WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Class deleted successfully', code: 'SCHOOL_CLASSES.DELETED' } };
    } catch (error) {
      console.error('Delete school class error:', error);
      return mapThrownError(error, 'ERRORS.SCHOOL_CLASSES.DELETE_FAILED', 'Failed to delete class', 400);
    }
  },
};
