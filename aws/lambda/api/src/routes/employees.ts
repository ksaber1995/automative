import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureSalaryColumns } from './expenses';

// is_teacher + the subject/level join tables (migration 075). Self-applies the
// same DDL at runtime so a deploy doesn't have to wait on the SQL file, exactly
// like ensureSalaryColumns.
let teacherSchemaEnsured = false;
let coursePercentagesEnsured = false;
/**
 * Per-course percentage rates (migration 089). Self-applying like the teacher
 * tables above, so the endpoint works on a database the migration has not
 * reached yet.
 */
export async function ensureCoursePercentageSchema(): Promise<void> {
  if (coursePercentagesEnsured) return;
  await query(`
    CREATE TABLE IF NOT EXISTS employee_course_percentages (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      course_id       UUID NOT NULL REFERENCES courses(id)   ON DELETE CASCADE,
      percentage_rate DECIMAL(5, 2) NOT NULL CHECK (percentage_rate >= 0 AND percentage_rate <= 100),
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, course_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ecp_employee ON employee_course_percentages(employee_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ecp_company  ON employee_course_percentages(company_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ecp_course   ON employee_course_percentages(course_id)`);
  coursePercentagesEnsured = true;
}

export async function ensureTeacherSchema(): Promise<void> {
  if (teacherSchemaEnsured) return;
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_teacher BOOLEAN NOT NULL DEFAULT false`);
  await query(`
    CREATE TABLE IF NOT EXISTS employee_subjects (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      subject_id  UUID NOT NULL REFERENCES subjects(id)  ON DELETE CASCADE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, subject_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_employee_subjects_employee ON employee_subjects(employee_id)`);
  await query(`
    CREATE TABLE IF NOT EXISTS employee_levels (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      level_id    UUID NOT NULL REFERENCES levels(id)    ON DELETE CASCADE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, level_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_employee_levels_employee ON employee_levels(employee_id)`);
  teacherSchemaEnsured = true;
}

// Aggregate an employee's linked subjects/levels into JSON arrays. Aliased `e`
// must be the employees row in the surrounding query. Same shape as the
// LEVELS_SUBQUERY / SUBJECTS_SUBQUERY pair in courses.ts.
const EMP_SUBJECTS_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('id', s2.id, 'name', s2.name) ORDER BY s2.name ASC)
  FROM employee_subjects es2
  JOIN subjects s2 ON es2.subject_id = s2.id
  WHERE es2.employee_id = e.id
), '[]'::json) AS subjects_json`;

const EMP_LEVELS_SUBQUERY = `COALESCE((
  SELECT json_agg(json_build_object('id', l2.id, 'name', l2.name) ORDER BY l2.name ASC)
  FROM employee_levels el2
  JOIN levels l2 ON el2.level_id = l2.id
  WHERE el2.employee_id = e.id
), '[]'::json) AS levels_json`;

function parseJsonArray(raw: any): { id: string; name: string | null }[] {
  if (raw == null) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function mapEmployeeFromDB(row: any) {
  const subjects = parseJsonArray(row.subjects_json);
  const levels = parseJsonArray(row.levels_json);
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    position: row.position,
    salary: row.salary ? parseFloat(row.salary) : null,
    salaryType: row.salary_type || 'MONTHLY',
    sessionRate: row.session_rate !== null && row.session_rate !== undefined ? parseFloat(row.session_rate) : null,
    percentageRate: row.percentage_rate !== null && row.percentage_rate !== undefined ? parseFloat(row.percentage_rate) : null,
    hireDate: row.hire_date,
    branchId: row.branch_id,
    isGlobal: row.is_global,
    isActive: row.is_active,
    isTeacher: row.is_teacher === true,
    subjectIds: subjects.map((s) => s.id),
    subjects,
    levelIds: levels.map((l) => l.id),
    levels,
    linkedUserId: row.linked_user_id ?? null,
    hasSalaryHistory: row.has_salary_history === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Replace an employee's subject links with exactly `subjectIds`, ignoring ids
// that belong to another tenant.
async function setEmployeeSubjects(employeeId: string, companyId: string, subjectIds: string[]) {
  await query('DELETE FROM employee_subjects WHERE employee_id = $1', [employeeId]);
  const unique = [...new Set((subjectIds || []).filter(Boolean))];
  if (unique.length > 0) {
    await query(
      `INSERT INTO employee_subjects (employee_id, subject_id)
       SELECT $1, s.id FROM subjects s
        WHERE s.id = ANY($2::uuid[]) AND s.company_id = $3
       ON CONFLICT (employee_id, subject_id) DO NOTHING`,
      [employeeId, unique, companyId]
    );
  }
}

// Replace an employee's level links with exactly `levelIds`.
async function setEmployeeLevels(employeeId: string, companyId: string, levelIds: string[]) {
  await query('DELETE FROM employee_levels WHERE employee_id = $1', [employeeId]);
  const unique = [...new Set((levelIds || []).filter(Boolean))];
  if (unique.length > 0) {
    await query(
      `INSERT INTO employee_levels (employee_id, level_id)
       SELECT $1, l.id FROM levels l
        WHERE l.id = ANY($2::uuid[]) AND l.company_id = $3
       ON CONFLICT (employee_id, level_id) DO NOTHING`,
      [employeeId, unique, companyId]
    );
  }
}

// Re-read an employee with the aggregated joins, so create/update return the
// same body shape as list/getById.
async function fetchEmployee(id: string, companyId: string) {
  return queryOne(`${EMPLOYEE_BASE_SELECT} WHERE e.id = $1 AND e.company_id = $2`, [id, companyId]);
}

// has_salary_history: any past SALARIES payment makes the employee non-deletable
// (we can only terminate them). Drives the delete-vs-terminate UI.
const EMPLOYEE_BASE_SELECT = `
  SELECT e.*,
         u.id AS linked_user_id,
         ${EMP_SUBJECTS_SUBQUERY},
         ${EMP_LEVELS_SUBQUERY},
         EXISTS (
           SELECT 1 FROM expense_payments ep
           WHERE ep.employee_id = e.id
             AND ep.company_id = e.company_id
             AND ep.category = 'SALARIES'
         ) AS has_salary_history
  FROM employees e
  LEFT JOIN users u ON u.linked_employee_id = e.id
`;

export const employeesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      // Only global admins may create global (company-wide) employees. Branch
      // admins must scope every employee they create to a branch they own.
      if (!isGlobalAdmin(context)) {
        if (body.isGlobal || !body.branchId) {
          return apiError(403, 'ERRORS.EMPLOYEES.GLOBAL_ADMIN_ONLY_GLOBAL', 'Only Global Admins can create global employees');
        }
      }

      // Make sure percentage_rate / the widened salary_type CHECK exist before insert.
      await ensureSalaryColumns();
      await ensureTeacherSchema();
      const isTeacher = body.isTeacher === true;
      const employee = await insert('employees', {
        company_id: context.companyId,
        first_name: body.firstName,
        last_name: body.lastName,
        email: body.email || null,
        phone: body.phone || null,
        department: body.department || null,
        position: body.position || null,
        salary: body.salary || null,
        salary_type: body.salaryType || 'MONTHLY',
        session_rate: body.sessionRate ?? null,
        percentage_rate: body.percentageRate ?? null,
        hire_date: body.hireDate || null,
        branch_id: body.branchId || null,
        is_global: isGlobalAdmin(context) ? (body.isGlobal || false) : false,
        is_active: true,
        is_teacher: isTeacher,
      });

      // Subjects/levels describe what a teacher teaches, so they're only linked
      // for teachers — a plain employee sending them silently gets none.
      if (isTeacher) {
        await setEmployeeSubjects(employee.id, context.companyId, body.subjectIds || []);
        await setEmployeeLevels(employee.id, context.companyId, body.levelIds || []);
      }

      const full = await fetchEmployee(employee.id, context.companyId);
      return {
        status: 201 as const,
        body: mapEmployeeFromDB(full ?? employee),
      };
    } catch (error) {
      console.error('Create employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.CREATE_FAILED', 'Failed to create employee', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; isGlobal?: string; isTeacher?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureTeacherSchema();
      let sql = `${EMPLOYEE_BASE_SELECT} WHERE e.company_id = $1`;
      const params: any[] = [context.companyId];

      const admin = isGlobalAdmin(context);

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else if (!admin) {
        // Non-admins see only employees in branches they're assigned to.
        // Global employees (is_global = true, branch_id NULL) are hidden — those
        // are company-level and only visible to global admins.
        const accessible = (context.branchIds && context.branchIds.length > 0)
          ? context.branchIds
          : (context.branchId ? [context.branchId] : []);
        if (accessible.length === 0) {
          sql += ' AND FALSE';
        } else {
          const placeholders = accessible.map((id) => {
            params.push(id);
            return `$${params.length}`;
          }).join(', ');
          sql += ` AND e.branch_id IN (${placeholders}) AND COALESCE(e.is_global, false) = false`;
        }
      }

      if (queryParams.isGlobal !== undefined) {
        // Only global admins may filter explicitly by is_global. Non-admins
        // never see global employees regardless of the query string.
        if (admin) {
          const isGlobalBool = queryParams.isGlobal === 'true';
          params.push(isGlobalBool);
          sql += ` AND e.is_global = $${params.length}`;
        }
      }

      // Employee-vs-teacher split for the list page's filter. Anything other
      // than an explicit 'true'/'false' means "no filter", so a stray value
      // widens rather than silently empties the list.
      if (queryParams.isTeacher === 'true' || queryParams.isTeacher === 'false') {
        params.push(queryParams.isTeacher === 'true');
        sql += ` AND COALESCE(e.is_teacher, false) = $${params.length}`;
      }

      sql += ' ORDER BY e.created_at DESC';

      const employees = await query(sql, params);
      return {
        status: 200 as const,
        body: employees.map(mapEmployeeFromDB),
      };
    } catch (error) {
      console.error('List employees error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.LIST_FAILED', 'Failed to list employees');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureTeacherSchema();
      const employee = await fetchEmployee(params.id, context.companyId);

      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      // Non-admins cannot see global employees (is_global / no branch).
      if (!isGlobalAdmin(context)) {
        if (employee.is_global || !employee.branch_id) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED', 'Access denied to this employee');
        }
        if (!canAccessBranch(context, employee.branch_id)) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED', 'Access denied to this employee');
        }
      }

      return {
        status: 200 as const,
        body: mapEmployeeFromDB(employee),
      };
    } catch (error) {
      console.error('Get employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      if (!isGlobalAdmin(context)) {
        if (existing.is_global || !existing.branch_id) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_UPDATE', 'Access denied to update this employee');
        }
        if (!canAccessBranch(context, existing.branch_id)) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_UPDATE', 'Access denied to update this employee');
        }
      }

      await ensureSalaryColumns();
      await ensureTeacherSchema();
      const updateData: any = {};

      if (body.isTeacher !== undefined) updateData.is_teacher = body.isTeacher === true;
      if (body.firstName !== undefined) updateData.first_name = body.firstName;
      if (body.lastName !== undefined) updateData.last_name = body.lastName;
      // Clearing the field sends '', which should land as NULL, not an empty string.
      if (body.email !== undefined) updateData.email = body.email || null;
      if (body.phone !== undefined) updateData.phone = body.phone;
      // Now that these are optional for teachers, clearing one sends '' — land it
      // as NULL to match what create writes, rather than an empty string.
      if (body.department !== undefined) updateData.department = body.department || null;
      if (body.position !== undefined) updateData.position = body.position || null;
      if (body.salary !== undefined) updateData.salary = body.salary;
      if (body.salaryType !== undefined) updateData.salary_type = body.salaryType;
      if (body.sessionRate !== undefined) updateData.session_rate = body.sessionRate;
      if (body.percentageRate !== undefined) updateData.percentage_rate = body.percentageRate;
      if (body.hireDate !== undefined) updateData.hire_date = body.hireDate;
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.isGlobal !== undefined) updateData.is_global = body.isGlobal;

      // `update` throws on an empty patch, and a body of only subjectIds/levelIds
      // is a legitimate edit.
      const employee = Object.keys(updateData).length > 0
        ? await update('employees', params.id, updateData)
        : existing;

      if (!employee) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      // Only rewrite the links the caller actually sent — omitting them leaves
      // the existing rows alone (same contract as courses' subjectIds/levelIds).
      // Demoting a teacher to a plain employee clears both.
      const nowTeacher = updateData.is_teacher !== undefined ? updateData.is_teacher : existing.is_teacher === true;
      if (!nowTeacher) {
        await setEmployeeSubjects(params.id, context.companyId, []);
        await setEmployeeLevels(params.id, context.companyId, []);
      } else {
        if (body.subjectIds !== undefined) await setEmployeeSubjects(params.id, context.companyId, body.subjectIds);
        if (body.levelIds !== undefined) await setEmployeeLevels(params.id, context.companyId, body.levelIds);
      }

      const full = await fetchEmployee(params.id, context.companyId);
      return {
        status: 200 as const,
        body: mapEmployeeFromDB(full ?? employee),
      };
    } catch (error) {
      console.error('Update employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.UPDATE_FAILED', 'Failed to update employee', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      }

      if (!isGlobalAdmin(context)) {
        if (existing.is_global || !existing.branch_id) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_DELETE', 'Access denied to delete this employee');
        }
        if (!canAccessBranch(context, existing.branch_id)) {
          return apiError(403, 'ERRORS.EMPLOYEES.ACCESS_DENIED_DELETE', 'Access denied to delete this employee');
        }
      }

      // Block termination if the employee is still assigned as instructor on any non-finished class.
      // (company_id is derived from the linked course.)
      const assignedClasses = await query(
        `SELECT c.id, c.name
         FROM classes c
         INNER JOIN courses co ON c.course_id = co.id
         WHERE c.instructor_id = $1
           AND co.company_id = $2
           AND COALESCE(c.is_finished, FALSE) = FALSE`,
        [params.id, context.companyId]
      );

      if (assignedClasses.length > 0) {
        return {
          status: 400 as const,
          body: {
            message: 'Cannot terminate this employee while they are assigned to active classes. Please unassign them from these classes first.',
            code: 'ERRORS.EMPLOYEES.ASSIGNED_TO_ACTIVE_CLASSES',
            assignedClasses: assignedClasses.map((c: any) => ({ id: c.id, name: c.name })),
          },
        };
      }

      // If this employee was ever paid a salary we keep history-preserving rows
      // around and only deactivate. Otherwise we can safely remove the row.
      const salaryPaid = await queryOne(
        `SELECT 1 FROM expense_payments
         WHERE employee_id = $1 AND company_id = $2 AND category = 'SALARIES'
         LIMIT 1`,
        [params.id, context.companyId]
      );

      if (salaryPaid) {
        const employee = await update('employees', params.id, { is_active: false });
        if (!employee) {
          return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
        }
        return {
          status: 200 as const,
          body: { message: 'Employee terminated successfully', code: 'EMPLOYEES.TERMINATED' },
        };
      }

      // No salary history — hard delete. Unlink any user pointing at this
      // employee first (users.linked_employee_id has no FK).
      await query('UPDATE users SET linked_employee_id = NULL WHERE linked_employee_id = $1', [params.id]);
      await query('DELETE FROM employees WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return {
        status: 200 as const,
        body: { message: 'Employee deleted successfully', code: 'EMPLOYEES.DELETED' },
      };
    } catch (error) {
      console.error('Delete employee error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.DELETE_FAILED', 'Failed to delete employee', 404);
    }
  },

  /**
   * GET /api/employees/:id/course-percentages
   * The teacher's per-course rates. An empty list means they are simply on their
   * global rate for everything.
   */
  listCoursePercentages: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCoursePercentageSchema();

      const rows = await query(
        `SELECT ecp.id, ecp.course_id, ecp.percentage_rate, c.name AS course_name
           FROM employee_course_percentages ecp
           JOIN courses c ON c.id = ecp.course_id
          WHERE ecp.company_id = $1 AND ecp.employee_id = $2
          ORDER BY c.name`,
        [context.companyId, params.id],
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          courseId: r.course_id,
          courseName: r.course_name,
          percentageRate: parseFloat(r.percentage_rate),
        })),
      };
    } catch (error: any) {
      console.error('List course percentages error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.COURSE_PERCENTAGES_FAILED', 'Failed to load course percentages');
    }
  },

  /**
   * PUT /api/employees/:id/course-percentages
   * Replace the whole set in one call, because that is how the screen edits it —
   * a table of rows saved together. An empty array puts the teacher back on
   * their global rate for every course.
   */
  setCoursePercentages: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'employees', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureCoursePercentageSchema();

      const employee = await queryOne<any>(
        'SELECT id, branch_id FROM employees WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId],
      );
      if (!employee) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const rates: Array<{ courseId: string; percentageRate: number }> = Array.isArray(body?.rates) ? body.rates : [];

      // Every course must be this company's — the id arrives from a client, and
      // a rate against someone else's course would be silent cross-tenant data.
      for (const r of rates) {
        if (!(r.percentageRate >= 0 && r.percentageRate <= 100)) {
          return apiError(400, 'ERRORS.EMPLOYEES.BAD_PERCENTAGE', 'A rate must be between 0 and 100');
        }
        const course = await queryOne<any>(
          'SELECT id FROM courses WHERE id = $1 AND company_id = $2',
          [r.courseId, context.companyId],
        );
        if (!course) return apiError(400, 'ERRORS.COURSES.NOT_FOUND', 'Course not found');
      }

      const seen = new Set(rates.map((r) => r.courseId));
      if (seen.size !== rates.length) {
        return apiError(400, 'ERRORS.EMPLOYEES.DUPLICATE_COURSE_PERCENTAGE', 'One rate per course');
      }

      // Drop what is no longer listed, then upsert what is. Not a delete-all +
      // insert: that would churn ids and created_at on rows nobody touched.
      if (rates.length) {
        await query(
          `DELETE FROM employee_course_percentages
            WHERE company_id = $1 AND employee_id = $2 AND course_id <> ALL($3::uuid[])`,
          [context.companyId, params.id, rates.map((r) => r.courseId)],
        );
        for (const r of rates) {
          await query(
            `INSERT INTO employee_course_percentages
               (company_id, employee_id, course_id, percentage_rate)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (employee_id, course_id)
             DO UPDATE SET percentage_rate = EXCLUDED.percentage_rate, updated_at = NOW()`,
            [context.companyId, params.id, r.courseId, r.percentageRate],
          );
        }
      } else {
        await query(
          'DELETE FROM employee_course_percentages WHERE company_id = $1 AND employee_id = $2',
          [context.companyId, params.id],
        );
      }

      return { status: 200 as const, body: { saved: rates.length } };
    } catch (error: any) {
      console.error('Set course percentages error:', error);
      return mapThrownError(error, 'ERRORS.EMPLOYEES.COURSE_PERCENTAGES_FAILED', 'Failed to save course percentages', 400);
    }
  },
};
