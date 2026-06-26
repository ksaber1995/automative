import { randomBytes } from 'crypto';
import { insert, update, findById, query, deleteById, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// 16 random bytes → 32 hex chars. ~128 bits of entropy, matching the
// students.qr_token VARCHAR(32) column. Unguessable so the unauthenticated
// public profile page can't be enumerated.
function generateQrToken(): string {
  return randomBytes(16).toString('hex');
}

// Paid QR activation pricing (EGP), TEACHER-type companies only.
const QR_PLAN_PRICES = { ONE_YEAR: 25, LIFELONG: 45 } as const;
type QrPlan = keyof typeof QR_PLAN_PRICES;

// A student's QR is "live" when activated and not expired (NULL expiration =
// lifelong). Used to gate scan/check-in/public-profile for teacher tenants.
function isQrLive(row: any): boolean {
  if (!row?.qr_activated) return false;
  if (!row.qr_expiration) return true;
  return new Date(row.qr_expiration) >= new Date(new Date().toISOString().slice(0, 10));
}

function mapStudentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    firstName: row.first_name,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    email: row.email,
    phone: row.phone,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    parentEmail: row.parent_email,
    address: row.address,
    branchId: row.branch_id,
    isActive: row.is_active,
    enrollmentDate: row.enrollment_date,
    inactiveDate: row.inactive_date,
    inactiveReason: row.inactive_reason,
    notes: row.notes,
    acquisitionChannel: row.acquisition_channel,
    studentCode: row.student_code ?? null,
    qrToken: row.qr_token,
    qrActivated: row.qr_activated === true,
    qrExpiration: row.qr_expiration ?? null,
    qrPrice: row.qr_price === null || row.qr_price === undefined ? null : parseFloat(row.qr_price),
    qrPaid: row.qr_paid === true,
    hasSubscriptions: row.has_subscriptions === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// has_subscriptions: any past enrollment / master enrollment / event subscription
// blocks hard delete. Drives the delete-vs-deactivate UI.
const STUDENT_SUBSCRIPTIONS_EXISTS = `
  EXISTS (SELECT 1 FROM enrollments en WHERE en.student_id = s.id)
  OR EXISTS (SELECT 1 FROM master_enrollments me WHERE me.student_id = s.id)
  OR EXISTS (SELECT 1 FROM event_subscriptions es WHERE es.student_id = s.id)
`;

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

      // Next sequential code for this company (1, 2, 3, …). The
      // UNIQUE(company_id, student_code) index is the real guard: under a rare
      // concurrent insert two rows could read the same MAX, and the loser fails
      // the insert (surfaced as a 400) rather than silently sharing a code.
      const codeRow = await queryOne<{ next: number }>(
        `SELECT COALESCE(MAX(student_code), 0) + 1 AS next FROM students WHERE company_id = $1`,
        [context.companyId]
      );

      const student = await insert('students', {
        company_id: context.companyId,
        first_name: body.firstName,
        last_name: body.lastName,
        date_of_birth: body.dateOfBirth || null,
        gender: body.gender || null,
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
        qr_token: generateQrToken(),
        student_code: codeRow?.next ?? 1,
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

      let sql = `SELECT s.*, (${STUDENT_SUBSCRIPTIONS_EXISTS}) AS has_subscriptions
                 FROM students s WHERE s.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND s.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 's.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY s.created_at DESC';

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
        `SELECT s.*, (${STUDENT_SUBSCRIPTIONS_EXISTS}) AS has_subscriptions
         FROM students s WHERE s.id = $1 AND s.company_id = $2`,
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
      if (body.gender !== undefined) updateData.gender = body.gender || null;
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

      const subscriptionCheck = await queryOne<{ has_any: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM enrollments WHERE student_id = $1)
           OR EXISTS (SELECT 1 FROM master_enrollments WHERE student_id = $1)
           OR EXISTS (SELECT 1 FROM event_subscriptions WHERE student_id = $1)
         ) AS has_any`,
        [params.id]
      );

      if (subscriptionCheck?.has_any) {
        return apiError(400, 'ERRORS.STUDENTS.HAS_ENROLLMENTS', 'Cannot permanently delete a student with subscriptions or enrollments');
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

  // Rotate a student's QR token. Use when a printed code is lost/leaked — the
  // old QR stops resolving immediately and a fresh one must be reprinted.
  regenerateQr: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
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

      const student = await update('students', params.id, { qr_token: generateQrToken() });

      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Regenerate student QR error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.QR_REGENERATE_FAILED', 'Failed to regenerate QR code', 400);
    }
  },

  // Paid QR activation for TEACHER-type companies. ONE_YEAR (25 EGP) sets a
  // one-year expiry; LIFELONG (45 EGP) never expires. The charge is recorded on
  // the student (qr_price) and starts unpaid (qr_paid = false) — the owner marks
  // it paid from the admin console once the teacher settles the bill.
  activateQr: async ({ params, body, headers }: { params: { id: string }; body: { plan: QrPlan }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const plan = body?.plan;
      if (plan !== 'ONE_YEAR' && plan !== 'LIFELONG') {
        return apiError(400, 'ERRORS.STUDENTS.QR_PLAN_INVALID', 'Invalid activation plan');
      }

      const existing = await queryOne<any>(
        'SELECT * FROM students WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }
      if (!canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_UPDATE', 'Access denied to update this student');
      }

      // Don't double-charge: if the QR is already live, refuse re-activation.
      if (isQrLive(existing)) {
        return apiError(409, 'ERRORS.STUDENTS.QR_ALREADY_ACTIVE', 'QR is already activated for this student');
      }

      const price = QR_PLAN_PRICES[plan];
      const expiration =
        plan === 'ONE_YEAR'
          ? (() => {
              const d = new Date();
              d.setFullYear(d.getFullYear() + 1);
              return d.toISOString().slice(0, 10);
            })()
          : null;

      const updateData: Record<string, any> = {
        qr_activated: true,
        qr_expiration: expiration,
        qr_price: price,
        qr_paid: false,
      };
      // Self-heal: some students (e.g. bulk-imported) may have no QR token yet.
      // Without one the QR can't render or be scanned, so provision it on
      // activation — that's exactly the moment the code starts being used.
      if (!existing.qr_token) {
        updateData.qr_token = generateQrToken();
      }

      const student = await update('students', params.id, updateData);
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }

      return {
        status: 200 as const,
        body: mapStudentFromDB(student),
      };
    } catch (error) {
      console.error('Activate student QR error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.QR_ACTIVATE_FAILED', 'Failed to activate QR code', 400);
    }
  },

  lookupByQr: async ({ params, headers }: { params: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const student = await queryOne(
        `SELECT id FROM students WHERE qr_token = $1 AND company_id = $2`,
        [params.qrToken, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.NOT_FOUND', 'Student not found');
      }
      return { status: 200 as const, body: { id: student.id } };
    } catch (error) {
      console.error('Lookup student by QR error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.LOOKUP_QR_FAILED', 'Failed to lookup student by QR');
    }
  },

  // Resolve a student by their short sequential code — the QR-less fallback used
  // on the attendance and payment screens when a student forgets their QR. We
  // return the student's qr_token so the caller can drive the *existing* QR
  // check-in / payment flows with no second round trip.
  lookupByCode: async ({ params, headers }: { params: { code: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const code = parseInt(params.code, 10);
      if (!Number.isInteger(code) || code < 1) {
        return apiError(404, 'ERRORS.STUDENTS.CODE_NOT_FOUND', 'No student exists with this code');
      }

      // Codes are unique per company and only assigned to active students for
      // lookup purposes; an inactive/unknown code must not resolve.
      const student = await queryOne<any>(
        `SELECT id, qr_token FROM students
         WHERE student_code = $1 AND company_id = $2 AND is_active = true`,
        [code, context.companyId]
      );
      if (!student) {
        return apiError(404, 'ERRORS.STUDENTS.CODE_NOT_FOUND', 'No student exists with this code');
      }

      // Self-heal: legacy/bulk-imported students may have no QR token yet. Since
      // the downstream check-in/payment flows key on qr_token, provision one now
      // so a code lookup always yields a usable token.
      let qrToken: string = student.qr_token;
      if (!qrToken) {
        qrToken = generateQrToken();
        await update('students', student.id, { qr_token: qrToken });
      }

      return { status: 200 as const, body: { id: student.id, qrToken } };
    } catch (error) {
      console.error('Lookup student by code error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.LOOKUP_CODE_FAILED', 'Failed to lookup student by code');
    }
  },
};
