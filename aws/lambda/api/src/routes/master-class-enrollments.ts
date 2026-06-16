import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

type AuthHeaders = { authorization: string };

function mapRow(row: any) {
  // Derive effective status: a class being finished completes the master-class enrollment,
  // unless the student dropped it. Pure DB-derived; no separate sync job needed.
  const rawStatus: string = row.status;
  const classFinished = row.class_is_finished === true;
  const effectiveStatus = rawStatus !== 'DROPPED' && classFinished ? 'COMPLETED' : rawStatus;
  return {
    id: row.id,
    companyId: row.company_id,
    masterEnrollmentId: row.master_enrollment_id,
    studentId: row.student_id,
    classId: row.class_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    enrolledAt: row.enrolled_at,
    status: effectiveStatus,
    notes: row.notes,
    className: row.class_name ?? null,
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
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Verify master enrollment belongs to this company and is active
      const me = await queryOne(
        `SELECT id, student_id, status FROM master_enrollments
         WHERE id = $1 AND company_id = $2`,
        [body.masterEnrollmentId, context.companyId]
      );
      if (!me) return apiError(404, 'ERRORS.MASTER_ENROLLMENTS.NOT_FOUND', 'Master enrollment not found');
      if (me.status !== 'ACTIVE') {
        return apiError(400, 'ERRORS.MASTER_CLASS_ENROLLMENTS.MASTER_NOT_ACTIVE', 'Master enrollment is not active');
      }

      // Verify the class belongs to the right course (branch comes from the course)
      const cls = await queryOne(
        `SELECT c.id, co.branch_id, c.is_finished
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.id = $1 AND c.course_id = $2`,
        [body.classId, body.courseId]
      );
      if (!cls) return apiError(404, 'ERRORS.MASTER_CLASS_ENROLLMENTS.CLASS_NOT_FOUND_FOR_COURSE', 'Class not found for this course');
      if (cls.is_finished) {
        return apiError(400, 'ERRORS.MASTER_CLASS_ENROLLMENTS.CLASS_FINISHED', 'This class is finished. Enrollment is closed.');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // Check for duplicate
      const existing = await queryOne(
        `SELECT id FROM master_class_enrollments
         WHERE master_enrollment_id = $1 AND course_id = $2 AND status != 'DROPPED'`,
        [body.masterEnrollmentId, body.courseId]
      );
      if (existing) {
        return apiError(400, 'ERRORS.MASTER_CLASS_ENROLLMENTS.ALREADY_ENROLLED', 'Student is already enrolled in this course via this bundle');
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
      return mapThrownError(error, 'ERRORS.MASTER_CLASS_ENROLLMENTS.CREATE_FAILED', 'Failed to create master class enrollment', 400);
    }
  },

  listByMasterEnrollment: async ({ query: q, headers }: { query: { masterEnrollmentId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const rows = await query(
        `SELECT mce.*,
           cl.name AS class_name,
           cl.is_finished AS class_is_finished,
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
      return mapThrownError(error, 'ERRORS.MASTER_CLASS_ENROLLMENTS.LIST_FAILED', 'Failed to list master class enrollments');
    }
  },

  updateStatus: async ({ params, body, headers }: { params: { id: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        `SELECT id, class_id, status FROM master_class_enrollments WHERE id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.MASTER_CLASS_ENROLLMENTS.NOT_FOUND', 'Not found');

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
      return mapThrownError(error, 'ERRORS.MASTER_CLASS_ENROLLMENTS.UPDATE_FAILED', 'Failed to update', 400);
    }
  },
};
