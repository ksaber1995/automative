import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapClassFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    courseId: row.course_id,
    branchId: row.branch_id,
    instructorId: row.instructor_id,
    name: row.name,
    code: row.code,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    daysOfWeek: row.days_of_week,
    maxStudents: row.max_students,
    currentEnrollment: row.current_enrollment || 0,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClassWithDetailsFromDB(row: any) {
  return {
    ...mapClassFromDB(row),
    courseName: row.course_name,
    branchName: row.branch_name,
    instructorName: row.instructor_name,
  };
}

export const classesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      console.log('Creating class with data:', JSON.stringify(body, null, 2));

      const insertData = {
        company_id: context.companyId,
        course_id: body.courseId,
        branch_id: body.branchId,
        instructor_id: body.instructorId || null,
        name: body.name,
        code: body.code,
        start_date: body.startDate,
        end_date: body.endDate,
        start_time: body.startTime || null,
        end_time: body.endTime || null,
        days_of_week: body.daysOfWeek || null,
        max_students: body.maxStudents || null,
        current_enrollment: 0,
        notes: body.notes || null,
        is_active: true,
      };

      console.log('Insert data:', JSON.stringify(insertData, null, 2));

      const classRecord = await insert('classes', insertData);

      console.log('Class created successfully:', classRecord.id);

      return {
        status: 201 as const,
        body: mapClassFromDB(classRecord),
      };
    } catch (error) {
      console.error('Create class error:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: {
          message: error.message || 'Failed to create class',
          error: error instanceof Error ? error.message : 'Unknown error',
          details: error instanceof Error ? error.stack : undefined
        },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT
          c.*,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name
        FROM classes c
        LEFT JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON c.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE c.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      sql += ' ORDER BY c.start_date DESC, c.created_at DESC';

      const classes = await query(sql, params);
      return {
        status: 200 as const,
        body: classes.map(mapClassWithDetailsFromDB),
      };
    } catch (error) {
      console.error('List classes error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list classes' },
      };
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string; courseId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT
          c.*,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name
        FROM classes c
        LEFT JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON c.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE c.company_id = $1 AND c.is_active = true
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      }

      if (queryParams.courseId) {
        params.push(queryParams.courseId);
        sql += ` AND c.course_id = $${params.length}`;
      }

      sql += ' ORDER BY c.start_date DESC, c.created_at DESC';

      const classes = await query(sql, params);
      return {
        status: 200 as const,
        body: classes.map(mapClassWithDetailsFromDB),
      };
    } catch (error) {
      console.error('List active classes error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list active classes' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const sql = `
        SELECT
          c.*,
          co.name as course_name,
          b.name as branch_name,
          CONCAT(e.first_name, ' ', e.last_name) as instructor_name
        FROM classes c
        LEFT JOIN courses co ON c.course_id = co.id
        LEFT JOIN branches b ON c.branch_id = b.id
        LEFT JOIN employees e ON c.instructor_id = e.id
        WHERE c.id = $1 AND c.company_id = $2
      `;

      const result = await query(sql, [params.id, context.companyId]);

      if (!result || result.length === 0) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      if (!canAccessBranch(context, result[0].branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this class' },
        };
      }

      return {
        status: 200 as const,
        body: mapClassWithDetailsFromDB(result[0]),
      };
    } catch (error) {
      console.error('Get class error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Class not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM classes WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this class' },
        };
      }

      const updateData: any = {};

      if (body.courseId !== undefined) updateData.course_id = body.courseId;
      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
        }
        updateData.branch_id = body.branchId;
      }
      if (body.instructorId !== undefined) updateData.instructor_id = body.instructorId || null;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      if (body.startTime !== undefined) updateData.start_time = body.startTime;
      if (body.endTime !== undefined) updateData.end_time = body.endTime;
      if (body.daysOfWeek !== undefined) updateData.days_of_week = body.daysOfWeek;
      if (body.maxStudents !== undefined) updateData.max_students = body.maxStudents;
      if (body.notes !== undefined) updateData.notes = body.notes;

      const classRecord = await update('classes', params.id, updateData);

      if (!classRecord) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapClassFromDB(classRecord),
      };
    } catch (error) {
      console.error('Update class error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update class' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM classes WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this class' },
        };
      }

      const classRecord = await update('classes', params.id, { is_active: false });

      if (!classRecord) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Class deleted successfully' },
      };
    } catch (error) {
      console.error('Delete class error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete class' },
      };
    }
  },
};
