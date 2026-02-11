import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapCourseFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
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
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const course = await insert('courses', {
        company_id: context.companyId,
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
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create course' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT
          c.*,
          COUNT(DISTINCT e.id) FILTER (WHERE e.status != 'DROPPED') as enrollment_count
        FROM courses c
        LEFT JOIN enrollments e ON c.id = e.course_id AND e.status != 'DROPPED'
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

      sql += ' GROUP BY c.id ORDER BY c.created_at DESC';

      const courses = await query(sql, params);
      return {
        status: 200 as const,
        body: courses.map(mapCourseWithEnrollmentCountFromDB),
      };
    } catch (error) {
      console.error('List courses error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list courses' },
      };
    }
  },

  listActive: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM courses WHERE company_id = $1 AND is_active = true';
      const params: any[] = [context.companyId];

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
        params.push(context.branchId);
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
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list active courses' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const course = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!course) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, course.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this course' },
        };
      }

      return {
        status: 200 as const,
        body: mapCourseFromDB(course),
      };
    } catch (error) {
      console.error('Get course error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Course not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this course' },
        };
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to target branch' },
          };
        }
        updateData.branch_id = body.branchId;
      }
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
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update course' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM courses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Course not found' },
        };
      }

      if (!canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this course' },
        };
      }

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
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete course' },
      };
    }
  },
};
