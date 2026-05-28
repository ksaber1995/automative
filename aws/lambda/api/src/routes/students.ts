import { insert, update, findById, query, deleteById, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapStudentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    email: row.email,
    phone: row.phone,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    parentEmail: row.parent_email,
    address: row.address,
    branchId: row.branch_id,
    isActive: row.is_active,
    enrollmentDate: row.enrollment_date,
    churnDate: row.churn_date,
    churnReason: row.churn_reason,
    notes: row.notes,
    acquisitionChannel: row.acquisition_channel,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const studentsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Verify user can access the specified branch
      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const student = await insert('students', {
        company_id: context.companyId,
        first_name: body.firstName,
        last_name: body.lastName,
        date_of_birth: body.dateOfBirth || null,
        email: body.email || null,
        phone: body.phone || null,
        parent_name: body.parentName,
        parent_phone: body.parentPhone,
        parent_email: body.parentEmail || null,
        address: body.address || null,
        branch_id: body.branchId,
        enrollment_date: body.enrollmentDate,
        notes: body.notes || null,
        acquisition_channel: body.acquisitionChannel || null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Create student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.CREATE_FAILED', 'Failed to create student', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = 'SELECT * FROM students WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY created_at DESC';

      const students = await query(sql, params);
      return {
        status: 200 as const,
        body: students.map(mapStudentFromDB),
      };
    } catch (error) {
      console.error('List students error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.LIST_FAILED', 'Failed to list students');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const student = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      if (!canAccessBranch(context, student.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED', 'Access denied to this student');
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Get student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_UPDATE', 'Access denied to update this student');
      }

      const updateData: any = {};

      if (body.firstName !== undefined) updateData.first_name = body.firstName;
      if (body.lastName !== undefined) updateData.last_name = body.lastName;
      if (body.dateOfBirth !== undefined) updateData.date_of_birth = body.dateOfBirth;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.parentName !== undefined) updateData.parent_name = body.parentName;
      if (body.parentPhone !== undefined) updateData.parent_phone = body.parentPhone;
      if (body.parentEmail !== undefined) updateData.parent_email = body.parentEmail;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_TARGET_BRANCH', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.enrollmentDate !== undefined) updateData.enrollment_date = body.enrollmentDate;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.acquisitionChannel !== undefined) updateData.acquisition_channel = body.acquisitionChannel;

      const student = await update('students', params.id, updateData);

      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Update student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.UPDATE_FAILED', 'Failed to update student', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_DELETE', 'Access denied to delete this student');
      }

      // Soft delete by setting is_active to false
      const student = await update('students', params.id, { is_active: false });

      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      return {
        status: 200 as const,
        body: { message: 'Student deleted successfully', code: 'STUDENTS.DELETED' },
      };
    } catch (error) {
      console.error('Delete student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.DELETE_FAILED', 'Failed to delete student', 404);
    }
  },

  reactivate: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne<any>(
        'SELECT s.*, b.is_active AS branch_is_active FROM students s LEFT JOIN branches b ON b.id = s.branch_id WHERE s.id = $1 AND s.company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_UPDATE', 'Access denied to update this student');
      }

      if (existing.branch_is_active === false) {
        return apiError(400, 'ERRORS.STUDENTS.BRANCH_INACTIVE', 'Cannot activate a student whose branch is inactive');
      }

      const student = await update('students', params.id, { is_active: true });

      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Reactivate student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.REACTIVATE_FAILED', 'Failed to reactivate student', 400);
    }
  },

  hardDelete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_DELETE', 'Access denied to delete this student');
      }

      const enrollmentCount = await queryOne<{ count: string }>(
        'SELECT COUNT(*) AS count FROM enrollments WHERE student_id = $1',
        [params.id]
      );
      const masterEnrollmentCount = await queryOne<{ count: string }>(
        'SELECT COUNT(*) AS count FROM master_enrollments WHERE student_id = $1',
        [params.id]
      );

      const total = parseInt(enrollmentCount?.count || '0') + parseInt(masterEnrollmentCount?.count || '0');
      if (total > 0) {
        return apiError(400, 'ERRORS.STUDENTS.HAS_ENROLLMENTS', 'Cannot permanently delete a student with enrollments');
      }

      await query('DELETE FROM students WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return {
        status: 200 as const,
        body: { message: 'Student permanently deleted', code: 'STUDENTS.DELETED' },
      };
    } catch (error) {
      console.error('Hard delete student error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.DELETE_FAILED', 'Failed to delete student', 400);
    }
  },
};
