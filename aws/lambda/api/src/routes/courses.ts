import { insert, update, findById, query } from '../db/connection';

function mapCourseFromDB(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    code: row.code,
    description: row.description,
    price: parseFloat(row.price),
    duration: row.duration,
    maxStudents: row.max_students,
    instructorId: row.instructor_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCourseWithEnrollmentCountFromDB(row: any) {
  return {
    ...mapCourseFromDB(row),
    enrollmentCount: parseInt(row.enrollment_count || '0', 10),
  };
}

export const coursesRoutes = {
  create: async ({ body }: { body: any }) => {
    try {
      const course = await insert('courses', {
        branch_id: body.branchId,
        name: body.name,
        code: body.code,
        description: body.description || null,
        price: body.price,
        duration: body.duration,
        max_students: body.maxStudents || null,
        instructor_id: body.instructorId || null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Create course error:', error);
      return {
        status: 400 as const,
        body: { message: 'Failed to create course' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string } }) => {
    try {
      let sql = `
        SELECT
          c.*,
          COUNT(DISTINCT e.id) FILTER (WHERE e.status != 'DROPPED') as enrollment_count
        FROM courses c
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.status != 'DROPPED'
        WHERE 1=1
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND c.branch_id = $${params.length}`;
      }

      sql += ' GROUP BY c.id ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseWithEnrollmentCountFromDB),
      };
    } catch (error) {
      console.error('List courses error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  listActive: async ({ query: queryParams }: { query: { branchId?: string } }) => {
    try {
      let sql = 'SELECT * FROM courses WHERE is_active = true';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseFromDB),
      };
    } catch (error) {
      console.error('List active courses error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const course = await findById('courses', params.id);

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Get course error:', error);
      return {
        status: 404 as const,
        body: { message: 'Course not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.price !== undefined) updateData.price = body.price;
      if (body.duration !== undefined) updateData.duration = body.duration;
      if (body.maxStudents !== undefined) updateData.max_students = body.maxStudents;
      if (body.instructorId !== undefined) updateData.instructor_id = body.instructorId || null;

      const course = await update('courses', params.id, updateData);

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Update course error:', error);
      return {
        status: 404 as const,
        body: { message: 'Failed to update course' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
      const course = await update('courses', params.id, { is_active: false });

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Course deleted successfully' },
      };
    } catch (error) {
      console.error('Delete course error:', error);
      return {
        status: 404 as const,
        body: { message: 'Failed to delete course' },
      };
    }
  },
};
