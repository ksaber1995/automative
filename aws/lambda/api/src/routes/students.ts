import { insert, update, findById, query, deleteById, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const studentsRoutes = {
  create: async ({ body, request }: { body: any; request: any }) => {
    try {
      // Extract tenant context for multi-tenant isolation
      const authHeader = request?.headers?.authorization || request?.headers?.Authorization;
      const context = await extractTenantContext(authHeader);

      // Verify user can access the specified branch
      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const student = await insert('students', {
        company_id: context.companyId,  // NEW: Add company_id for tenant isolation
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
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Create student error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create student' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      // Extract tenant context for multi-tenant isolation
      const context = await extractTenantContext(headers.authorization);

      // Build query with MANDATORY company_id filter
      let sql = 'SELECT * FROM students WHERE company_id = $1';
      const params: any[] = [context.companyId];

      // Optional branch filtering with permission check
      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        // Non-admins see only their branch
        params.push(context.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';

      const students = await query(sql, params);
      return {
        status: 200 as const,
        body: students.map(mapStudentFromDB),
      };
    } catch (error) {
      console.error('List students error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list students' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      // Extract tenant context for multi-tenant isolation
      const context = await extractTenantContext(headers.authorization);

      // Query with company_id filter to ensure tenant isolation
      const student = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!student) {
        return {
          status: 404 as const,
          body: { message: 'Student not found' },
        };
      }

      // Verify branch access
      if (!canAccessBranch(context, student.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this student' },
        };
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Get student error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Student not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      // Extract tenant context for multi-tenant isolation
      const context = await extractTenantContext(headers.authorization);

      // Verify the student belongs to the user's company
      const existing = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Student not found' },
        };
      }

      // Verify branch access
      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this student' },
        };
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
        // Verify access to new branch
        if (!canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
        }
        updateData.branch_id = body.branchId;
      }
      if (body.enrollmentDate !== undefined) updateData.enrollment_date = body.enrollmentDate;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const student = await update('students', params.id, updateData);

      if (!student) {
        return {
          status: 404 as const,
          body: { message: 'Student not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Update student error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update student' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      // Extract tenant context for multi-tenant isolation
      const context = await extractTenantContext(headers.authorization);

      // Verify the student belongs to the user's company
      const existing = await queryOne(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Student not found' },
        };
      }

      // Verify branch access
      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this student' },
        };
      }

      // Soft delete by setting is_active to false
      const student = await update('students', params.id, { is_active: false });

      if (!student) {
        return {
          status: 404 as const,
          body: { message: 'Student not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Student deleted successfully' },
      };
    } catch (error) {
      console.error('Delete student error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete student' },
      };
    }
  },
};
