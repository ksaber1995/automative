import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

function mapMasterCourseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    branchName: row.branch_name ?? null,
    name: row.name,
    code: row.code,
    description: row.description,
    defaultPrice: parseFloat(row.default_price),
    defaultDuration: row.default_duration,
    defaultMaxStudents: row.default_max_students,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWithCounts(row: any) {
  return {
    ...mapMasterCourseFromDB(row),
    linkedCourseCount: parseInt(row.linked_course_count || '0', 10),
    branchCount: parseInt(row.branch_count || '0', 10),
  };
}

export const masterCoursesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (!body.branchId || !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }
      const branch = await queryOne(
        'SELECT id FROM branches WHERE id = $1 AND company_id = $2',
        [body.branchId, context.companyId]
      );
      if (!branch) return { status: 400 as const, body: { message: 'Invalid branch' } };

      const masterCourse = await insert('master_courses', {
        company_id: context.companyId,
        branch_id: body.branchId,
        name: body.name,
        code: body.code,
        description: body.description || null,
        default_price: body.defaultPrice,
        default_duration: body.defaultDuration,
        default_max_students: body.defaultMaxStudents || null,
        is_active: true,
      });

      return { status: 201 as const, body: mapMasterCourseFromDB(masterCourse) };
    } catch (error: any) {
      console.error('Create master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create master course' },
      };
    }
  },

  list: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const sql = `
        SELECT
          mc.*,
          b.name AS branch_name,
          COUNT(DISTINCT c.id) FILTER (WHERE c.is_active = true) AS linked_course_count,
          COUNT(DISTINCT c.branch_id) FILTER (WHERE c.is_active = true) AS branch_count
        FROM master_courses mc
        LEFT JOIN branches b ON b.id = mc.branch_id
        LEFT JOIN courses c ON c.master_course_id = mc.id
        WHERE mc.company_id = $1
        GROUP BY mc.id, b.name
        ORDER BY mc.created_at DESC
      `;
      const rows = await query(sql, [context.companyId]);
      const mapped = rows.map(mapWithCounts);
      const filtered = mapped.filter((m: any) => !m.branchId || canAccessBranch(context, m.branchId));
      return { status: 200 as const, body: filtered };
    } catch (error: any) {
      console.error('List master courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list master courses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const row = await queryOne(
        `SELECT mc.*, b.name AS branch_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         WHERE mc.id = $1 AND mc.company_id = $2`,
        [params.id, context.companyId]
      );
      if (!row) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      return { status: 200 as const, body: mapMasterCourseFromDB(row) };
    } catch (error: any) {
      console.error('Get master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Master course not found' },
      };
    }
  },

  getLinkedCourses: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const master = await queryOne(
        'SELECT id, branch_id FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (master.branch_id && !canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const rows = await query(
        `SELECT c.*, b.name AS branch_name
         FROM courses c
         LEFT JOIN branches b ON b.id = c.branch_id
         WHERE c.master_course_id = $1 AND c.company_id = $2
         ORDER BY b.name ASC, c.created_at DESC`,
        [params.id, context.companyId]
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          branchId: r.branch_id,
          branchName: r.branch_name,
          name: r.name,
          code: r.code,
          price: parseFloat(r.price),
          duration: r.duration,
          maxStudents: r.max_students,
          isActive: r.is_active,
        })),
      };
    } catch (error: any) {
      console.error('List linked courses error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list linked courses' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.defaultPrice !== undefined) updateData.default_price = body.defaultPrice;
      if (body.defaultDuration !== undefined) updateData.default_duration = body.defaultDuration;
      if (body.defaultMaxStudents !== undefined) updateData.default_max_students = body.defaultMaxStudents;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const row = await update('master_courses', params.id, updateData);
      if (!row) return { status: 404 as const, body: { message: 'Master course not found' } };

      const withBranch = await queryOne(
        `SELECT mc.*, b.name AS branch_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         WHERE mc.id = $1`,
        [row.id]
      );
      return { status: 200 as const, body: mapMasterCourseFromDB(withBranch || row) };
    } catch (error: any) {
      console.error('Update master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update master course' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      await update('master_courses', params.id, { is_active: false });
      return { status: 200 as const, body: { message: 'Master course deleted successfully' } };
    } catch (error: any) {
      console.error('Delete master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete master course' },
      };
    }
  },

  // Apply master fields to every linked course. Linked courses can only live on
  // the master's own branch, so every target is on that branch.
  apply: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions on courses' } };
      }

      const master = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (master.branch_id && !canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const applyName = body.applyName === true;
      const applyDescription = body.applyDescription === true;
      const applyPrice = body.applyPrice === true;
      const applyDuration = body.applyDuration === true;
      const applyMaxStudents = body.applyMaxStudents === true;

      if (!applyName && !applyDescription && !applyPrice && !applyDuration && !applyMaxStudents) {
        return { status: 400 as const, body: { message: 'Select at least one field to apply' } };
      }

      const targets = await query(
        'SELECT id, branch_id FROM courses WHERE master_course_id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      const accessible = targets.filter((t: any) => canAccessBranch(context, t.branch_id));
      if (accessible.length === 0) {
        return { status: 200 as const, body: { updatedCount: 0, skippedCount: targets.length } };
      }

      const sets: string[] = [];
      const values: any[] = [];
      if (applyName) { values.push(master.name); sets.push(`name = $${values.length}`); }
      if (applyDescription) { values.push(master.description); sets.push(`description = $${values.length}`); }
      if (applyPrice) { values.push(master.default_price); sets.push(`price = $${values.length}`); }
      if (applyDuration) { values.push(master.default_duration); sets.push(`duration = $${values.length}`); }
      if (applyMaxStudents) { values.push(master.default_max_students); sets.push(`max_students = $${values.length}`); }
      sets.push(`updated_at = CURRENT_TIMESTAMP`);

      const ids = accessible.map((t: any) => t.id);
      values.push(ids);
      const sql = `UPDATE courses SET ${sets.join(', ')} WHERE id = ANY($${values.length}::uuid[])`;
      await query(sql, values);

      return {
        status: 200 as const,
        body: { updatedCount: accessible.length, skippedCount: targets.length - accessible.length },
      };
    } catch (error: any) {
      console.error('Apply master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to apply master course' },
      };
    }
  },

  // Create linked course instances inside the master's own branch. Selected
  // branches outside the master's branch are rejected. Branches already linked
  // or with a code conflict are skipped.
  instantiate: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (!checkGranularPermission(context, 'courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions on courses' } };
      }

      const master = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (!master.branch_id) {
        return { status: 400 as const, body: { message: 'Master course has no branch assigned' } };
      }
      if (!canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this master course' } };
      }

      const branchIds: string[] = Array.isArray(body.branchIds) ? body.branchIds : [];
      if (branchIds.length === 0) {
        return { status: 400 as const, body: { message: 'No branches selected' } };
      }

      const offBranch = branchIds.filter((b) => b !== master.branch_id);
      if (offBranch.length > 0) {
        return {
          status: 400 as const,
          body: { message: 'Can only link courses inside the master course\'s branch. Use clone to create it on another branch.' },
        };
      }

      const targetBranchId = master.branch_id;

      const existing = await query(
        'SELECT branch_id FROM courses WHERE master_course_id = $1 AND company_id = $2 AND branch_id = $3',
        [params.id, context.companyId, targetBranchId]
      );
      const alreadyLinked = existing.length > 0;

      const codeConflicts = await query(
        'SELECT id FROM courses WHERE code = $1 AND branch_id = $2',
        [master.code, targetBranchId]
      );

      let createdCount = 0;
      let skippedCount = 0;
      const created: { id: string; branchId: string }[] = [];

      if (alreadyLinked || codeConflicts.length > 0) {
        skippedCount = 1;
      } else {
        const row = await insert('courses', {
          company_id: context.companyId,
          branch_id: targetBranchId,
          master_course_id: master.id,
          name: master.name,
          code: master.code,
          description: master.description,
          price: master.default_price,
          duration: master.default_duration,
          max_students: master.default_max_students,
          is_active: true,
        });
        created.push({ id: row.id, branchId: row.branch_id });
        createdCount = 1;
      }

      return { status: 201 as const, body: { createdCount, skippedCount, created } };
    } catch (error: any) {
      console.error('Instantiate master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to instantiate master course' },
      };
    }
  },

  // Copy this master to another branch. The new master is independent and can
  // then be instantiated / linked on the target branch.
  clone: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'master_courses', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const master = await queryOne(
        'SELECT * FROM master_courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!master) return { status: 404 as const, body: { message: 'Master course not found' } };
      if (master.branch_id && !canAccessBranch(context, master.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to source master course' } };
      }

      const targetBranchId: string | undefined = body.branchId;
      if (!targetBranchId || !canAccessBranch(context, targetBranchId)) {
        return { status: 403 as const, body: { message: 'Access denied to target branch' } };
      }
      if (targetBranchId === master.branch_id) {
        return { status: 400 as const, body: { message: 'Target branch must differ from source branch' } };
      }

      const targetBranch = await queryOne(
        'SELECT id FROM branches WHERE id = $1 AND company_id = $2',
        [targetBranchId, context.companyId]
      );
      if (!targetBranch) return { status: 400 as const, body: { message: 'Invalid target branch' } };

      const code: string = (body.code && body.code.trim()) || master.code;

      const conflict = await queryOne(
        'SELECT id FROM master_courses WHERE branch_id = $1 AND code = $2',
        [targetBranchId, code]
      );
      if (conflict) {
        return {
          status: 400 as const,
          body: { message: 'A master course with this code already exists on the target branch. Provide a different code.' },
        };
      }

      const cloned = await insert('master_courses', {
        company_id: context.companyId,
        branch_id: targetBranchId,
        name: master.name,
        code,
        description: master.description,
        default_price: master.default_price,
        default_duration: master.default_duration,
        default_max_students: master.default_max_students,
        is_active: true,
      });

      const withBranch = await queryOne(
        `SELECT mc.*, b.name AS branch_name
         FROM master_courses mc
         LEFT JOIN branches b ON b.id = mc.branch_id
         WHERE mc.id = $1`,
        [cloned.id]
      );

      return { status: 201 as const, body: mapMasterCourseFromDB(withBranch || cloned) };
    } catch (error: any) {
      console.error('Clone master course error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to clone master course' },
      };
    }
  },
};
