import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

type AuthHeaders = { authorization: string };

function mapRow(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    masterEnrollmentId: row.master_enrollment_id,
    studentId: row.student_id,
    classId: row.class_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    enrolledAt: row.enrolled_at,
    status: row.status,
    notes: row.notes,
    className: row.class_name ?? null,
    classCode: row.class_code ?? null,
    courseName: row.course_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const masterClassEnrollmentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      // Verify master enrollment belongs to this company and is active
      const me = await queryOne(
        `SELECT id, student_id, status FROM master_enrollments
         WHERE id = $1 AND company_id = $2`,
        [body.masterEnrollmentId, context.companyId]
      );
      if (!me) return { status: 404 as const, body: { message: 'Master enrollment not found' } };
      if (me.status !== 'ACTIVE') {
        return { status: 400 as const, body: { message: 'Master enrollment is not active' } };
      }

      // Verify the class belongs to the right branch and course
      const cls = await queryOne(
        `SELECT id, branch_id, is_finished FROM classes WHERE id = $1 AND course_id = $2`,
        [body.classId, body.courseId]
      );
      if (!cls) return { status: 404 as const, body: { message: 'Class not found for this course' } };
      if (cls.is_finished) {
        return { status: 400 as const, body: { message: 'This class is finished. Enrollment is closed.' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      // Check for duplicate
      const existing = await queryOne(
        `SELECT id FROM master_class_enrollments
         WHERE master_enrollment_id = $1 AND course_id = $2 AND status != 'DROPPED'`,
        [body.masterEnrollmentId, body.courseId]
      );
      if (existing) {
        return { status: 400 as const, body: { message: 'Student is already enrolled in this course via this bundle' } };
      }

      const row = await insert('master_class_enrollments', {
        company_id: context.companyId,
        master_enrollment_id: body.masterEnrollmentId,
        student_id: me.student_id,
        class_id: body.classId,
        course_id: body.courseId,
        branch_id: body.branchId || cls.branch_id,
        enrolled_at: body.enrolledAt || new Date().toISOString().split('T')[0],
        status: 'ACTIVE',
        notes: body.notes || null,
      });

      // Increment class current_enrollment
      await query(
        `UPDATE classes SET current_enrollment = current_enrollment + 1 WHERE id = $1`,
        [body.classId]
      );

      return { status: 201 as const, body: mapRow(row) };
    } catch (error: any) {
      console.error('Create master class enrollment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create master class enrollment' },
      };
    }
  },

  listByMasterEnrollment: async ({ query: q, headers }: { query: { masterEnrollmentId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const rows = await query(
        `SELECT mce.*,
           cl.name AS class_name, cl.code AS class_code,
           co.name AS course_name
         FROM master_class_enrollments mce
         LEFT JOIN classes cl ON cl.id = mce.class_id
         LEFT JOIN courses co ON co.id = mce.course_id
         WHERE mce.master_enrollment_id = $1 AND mce.company_id = $2
         ORDER BY mce.created_at DESC`,
        [q.masterEnrollmentId, context.companyId]
      );

      return { status: 200 as const, body: rows.map(mapRow) };
    } catch (error: any) {
      console.error('List master class enrollments error:', error);
      return {
        status: isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list master class enrollments' },
      };
    }
  },

  updateStatus: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const existing = await queryOne(
        `SELECT id, class_id, status FROM master_class_enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Not found' } };

      const updated = await update('master_class_enrollments', params.id, {
        status: body.status,
        notes: body.notes !== undefined ? body.notes : existing.notes,
      });

      // Adjust class enrollment count when dropping
      if (body.status === 'DROPPED' && existing.status !== 'DROPPED') {
        await query(
          `UPDATE classes SET current_enrollment = GREATEST(current_enrollment - 1, 0) WHERE id = $1`,
          [existing.class_id]
        );
      }

      return { status: 200 as const, body: mapRow(updated) };
    } catch (error: any) {
      console.error('Update master class enrollment error:', error);
      return {
        status: isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to update' },
      };
    }
  },
};
