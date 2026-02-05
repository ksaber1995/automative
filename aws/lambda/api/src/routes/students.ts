import { insert, update, findById, query, deleteById } from '../db/connection';

function mapStudentFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const student = await insert('students', {
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
        status: 400 as const,
        body: { message: 'Failed to create student' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string } }) => {
    try {
      let sql = 'SELECT * FROM students WHERE 1=1';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const student = await findById('students', params.id);

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
      console.error('Get student error:', error);
      return {
        status: 404 as const,
        body: { message: 'Student not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
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
      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
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
        status: 404 as const,
        body: { message: 'Failed to update student' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to delete student' },
      };
    }
  },
};
