import { query } from '../db/connection';
import { extractTenantContext, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { mapThrownError } from '../utils/api-error';

/**
 * Lookup endpoints — lightweight {id, label} lists used to populate dropdowns
 * across the app (branches, employees, courses, …).
 *
 * Deliberately NO granular-permission check: they only require a valid session
 * (extractTenantContext) and are always company-scoped (+ branch-scoped where the
 * entity carries a branch). This lets a user who can manage Students — but has no
 * Branches permission — still pick a branch in the student form, without exposing
 * anything beyond a name and id.
 */
type LookupOption = { id: string; label: string };

async function runLookup(
  authorization: string,
  build: (context: Awaited<ReturnType<typeof extractTenantContext>>, params: any[]) => string,
): Promise<{ status: 200; body: LookupOption[] }> {
  // Auth only — intentionally no checkGranularPermission() here.
  const context = await extractTenantContext(authorization);
  const params: any[] = [context.companyId];
  const sql = build(context, params);
  const rows = await query(sql, params);
  return {
    status: 200 as const,
    body: rows.map((r: any) => ({ id: r.id, label: (r.label ?? '').toString().trim() })),
  };
}

const FULL_NAME = `TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))`;

export const lookupsRoutes = {
  branches: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, name AS label FROM branches WHERE company_id = $1 AND is_active = true`;
        const clause = appendBranchSqlFilter(ctx, params, 'id');
        if (clause) sql += ` AND ${clause}`;
        return sql + ` ORDER BY name ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  employees: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, ${FULL_NAME} AS label FROM employees WHERE company_id = $1 AND is_active = true`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        return sql + ` ORDER BY label ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  courses: async ({ headers, query: q }: { headers: { authorization: string }; query?: { branchId?: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, name AS label FROM courses WHERE company_id = $1`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        if (q?.branchId) { params.push(q.branchId); sql += ` AND branch_id = $${params.length}`; }
        return sql + ` ORDER BY name ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  classes: async ({ headers, query: q }: { headers: { authorization: string }; query?: { courseId?: string; branchId?: string } }) => {
    try {
      // classes has no company_id/branch_id of its own — scope via its course.
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT cl.id, cl.name AS label FROM classes cl
                   JOIN courses co ON co.id = cl.course_id
                   WHERE co.company_id = $1 AND cl.deleted_at IS NULL`;
        const clause = appendBranchSqlFilter(ctx, params, 'co.branch_id');
        if (clause) sql += ` AND ${clause}`;
        if (q?.courseId) { params.push(q.courseId); sql += ` AND cl.course_id = $${params.length}`; }
        if (q?.branchId) { params.push(q.branchId); sql += ` AND co.branch_id = $${params.length}`; }
        return sql + ` ORDER BY cl.name ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  levels: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      return await runLookup(headers.authorization, () =>
        `SELECT id, name AS label FROM levels WHERE company_id = $1 ORDER BY name ASC`);
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  subjects: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      return await runLookup(headers.authorization, () =>
        `SELECT id, name AS label FROM subjects WHERE company_id = $1 ORDER BY name ASC`);
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  rooms: async ({ headers, query: q }: { headers: { authorization: string }; query?: { branchId?: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, code AS label FROM rooms WHERE company_id = $1`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        if (q?.branchId) { params.push(q.branchId); sql += ` AND branch_id = $${params.length}`; }
        return sql + ` ORDER BY code ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  masterCourses: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, name AS label FROM master_courses WHERE company_id = $1`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        return sql + ` ORDER BY name ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  students: async ({ headers, query: q }: { headers: { authorization: string }; query?: { branchId?: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, ${FULL_NAME} AS label FROM students WHERE company_id = $1 AND is_active = true`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        if (q?.branchId) { params.push(q.branchId); sql += ` AND branch_id = $${params.length}`; }
        return sql + ` ORDER BY label ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },

  products: async ({ headers, query: q }: { headers: { authorization: string }; query?: { branchId?: string } }) => {
    try {
      return await runLookup(headers.authorization, (ctx, params) => {
        let sql = `SELECT id, name AS label FROM products WHERE company_id = $1 AND is_active = true`;
        const clause = appendBranchSqlFilter(ctx, params, 'branch_id');
        if (clause) sql += ` AND ${clause}`;
        if (q?.branchId) { params.push(q.branchId); sql += ` AND branch_id = $${params.length}`; }
        return sql + ` ORDER BY name ASC`;
      });
    } catch (error) {
      return mapThrownError(error, 'ERRORS.LOOKUPS.FAILED', 'Failed to load lookups');
    }
  },
};
