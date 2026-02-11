import { insert, update, findById, query } from '../db/connection';

function mapClassFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const classRecord = await insert('classes', {
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
      });

      return {
        status: 201 as const,
        body: mapClassFromDB(classRecord),
      };
    } catch (error) {
      console.error('Create class error:', error);
      return {
        status: 400 as const,
        body: { message: 'Failed to create class' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string; courseId?: string } }) => {
    try {
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
        WHERE 1=1
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  listActive: async ({ query: queryParams }: { query: { branchId?: string; courseId?: string } }) => {
    try {
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
        WHERE c.is_active = true
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
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
        WHERE c.id = $1
      `;

      const result = await query(sql, [params.id]);

      if (!result || result.length === 0) {
        return {
          status: 404 as const,
          body: { message: 'Class not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapClassWithDetailsFromDB(result[0]),
      };
    } catch (error) {
      console.error('Get class error:', error);
      return {
        status: 404 as const,
        body: { message: 'Class not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.courseId !== undefined) updateData.course_id = body.courseId;
      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
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
        status: 404 as const,
        body: { message: 'Failed to update class' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
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
        status: 404 as const,
        body: { message: 'Failed to delete class' },
      };
    }
  },
};
