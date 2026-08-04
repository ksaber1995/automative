import { randomBytes } from 'crypto';
import { ensureQrCardSchema, qrStudentMatch, codeDigits, CARD_SERIAL_BASE, CARD_SERIAL_BASE_V2, CARD_SERIAL_BASE_V3 } from './qr-cards';
import { insert, update, findById, query, deleteById, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// 16 random bytes → 32 hex chars. ~128 bits of entropy, matching the
// students.qr_token VARCHAR(32) column. Unguessable so the unauthenticated
// public profile page can't be enumerated.
function generateQrToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * students.school_name (migration 081). Applied at runtime so a deploy is enough
 * — no SQL run has to be remembered before the new code starts writing it.
 * Idempotent and cheap; guarded so it runs once per warm container.
 */
let schoolColumnReady: Promise<void> | null = null;
export function ensureStudentSchoolColumn(): Promise<void> {
  if (!schoolColumnReady) {
    schoolColumnReady = query(
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS school_name VARCHAR(200)`
    ).then(() => undefined).catch((e) => {
      // Let the next call retry rather than caching a failure for the container's life.
      schoolColumnReady = null;
      throw e;
    });
  }
  return schoolColumnReady;
}

function mapStudentFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    email: row.email,
    phone: row.phone,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    address: row.address,
    schoolName: row.school_name ?? null,
    branchId: row.branch_id,
    isActive: row.is_active,
    inactiveDate: row.inactive_date,
    inactiveReason: row.inactive_reason,
    notes: row.notes,
    acquisitionChannel: row.acquisition_channel,
    studentCode: row.student_code ?? null,
    qrToken: row.qr_token,
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
      await ensureStudentSchoolColumn();
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
        // Only codes BELOW the reserved card range count: a student who took a card's
        // number must not drag the sequence up into the pool (see CARD_SERIAL_BASE).
        `SELECT COALESCE(MAX(student_code), 0) + 1 AS next FROM students
         WHERE company_id = $1 AND student_code < ${CARD_SERIAL_BASE}`,
        [context.companyId]
      );

      const student = await insert('students', {
        company_id: context.companyId,
        name: body.name.trim(),
        date_of_birth: body.dateOfBirth || null,
        gender: body.gender || null,
        email: body.email || null,
        phone: body.phone || null,
        parent_name: body.parentName || null,
        parent_phone: body.parentPhone || null,
        address: body.address || null,
        school_name: body.schoolName || null,
        branch_id: body.branchId,
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

  // Bulk-create students from a parsed spreadsheet. Every row lands in the one
  // chosen branch. Best-effort: valid rows are inserted even if others fail;
  // the response reports how many succeeded plus a per-row error list so the
  // user can fix the bad rows and re-import just those.
  bulkImport: async ({ body, headers }: { body: { branchId: string; students: any[] }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (!canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const rows = Array.isArray(body.students) ? body.students : [];
      if (rows.length === 0) {
        return apiError(400, 'ERRORS.STUDENTS.IMPORT_EMPTY', 'No students to import');
      }

      // Compute the starting sequential code once, then increment in memory.
      // The UNIQUE(company_id, student_code) index stays the real guard: a
      // concurrent import could collide and that single row's insert fails
      // (recorded as a row error) rather than silently sharing a code.
      const codeRow = await queryOne<{ next: number }>(
        // Only codes BELOW the reserved card range count: a student who took a card's
        // number must not drag the sequence up into the pool (see CARD_SERIAL_BASE).
        `SELECT COALESCE(MAX(student_code), 0) + 1 AS next FROM students
         WHERE company_id = $1 AND student_code < ${CARD_SERIAL_BASE}`,
        [context.companyId]
      );
      let nextCode = codeRow?.next ?? 1;

      const errors: { row: number; message: string }[] = [];
      let created = 0;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || {};
        // 1-based row number matching the spreadsheet's first data row.
        const rowNum = i + 1;

        const name = String(r.name ?? '').trim();
        if (!name) {
          errors.push({ row: rowNum, message: 'MISSING_NAME' });
          continue;
        }

        const gender = r.gender === 'MALE' || r.gender === 'FEMALE' ? r.gender : null;
        const emptyToNull = (v: any) => {
          const s = v === null || v === undefined ? '' : String(v).trim();
          return s === '' ? null : s;
        };

        try {
          await insert('students', {
            company_id: context.companyId,
            name,
            date_of_birth: emptyToNull(r.dateOfBirth),
            gender,
            email: emptyToNull(r.email),
            phone: emptyToNull(r.phone),
            parent_name: emptyToNull(r.parentName),
            parent_phone: emptyToNull(r.parentPhone),
            address: emptyToNull(r.address),
            branch_id: body.branchId,
            notes: emptyToNull(r.notes),
            qr_token: generateQrToken(),
            student_code: nextCode,
            is_active: true,
          });
          created++;
          nextCode++;
        } catch (rowError) {
          console.error(`Bulk import row ${rowNum} failed:`, rowError);
          errors.push({ row: rowNum, message: 'INSERT_FAILED' });
          // Advance the code so a single failed row doesn't force every later
          // row to retry the same (possibly conflicting) code.
          nextCode++;
        }
      }

      return {
        status: 200 as const,
        body: { created, failed: errors.length, errors },
      };
    } catch (error) {
      console.error('Bulk import students error:', error);
      return mapThrownError(error, 'ERRORS.STUDENTS.IMPORT_FAILED', 'Failed to import students', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureStudentSchoolColumn();
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
      await ensureStudentSchoolColumn();
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
      await ensureStudentSchoolColumn();
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

      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.dateOfBirth !== undefined) updateData.date_of_birth = body.dateOfBirth;
      if (body.gender !== undefined) updateData.gender = body.gender || null;
      if (body.email !== undefined) updateData.email = body.email;
      if (body.phone !== undefined) updateData.phone = body.phone;
      if (body.parentName !== undefined) updateData.parent_name = body.parentName;
      if (body.parentPhone !== undefined) updateData.parent_phone = body.parentPhone;
      if (body.address !== undefined) updateData.address = body.address;
      if (body.schoolName !== undefined) updateData.school_name = body.schoolName || null;
      if (body.branchId !== undefined) {
        if (!canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.STUDENTS.ACCESS_DENIED_TARGET_BRANCH', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
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

      // The user is always allowed to permanently delete a student. Any related
      // billing/subscription rows (enrollments, payments, refunds, …) are removed
      // by the ON DELETE CASCADE / SET NULL foreign keys — the UI warns first.
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

  lookupByQr: async ({ params, headers }: { params: { qrToken: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'students', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureQrCardSchema();   // the lookup below reads qr_cards
      const student = await queryOne(
        `SELECT s.id FROM students s WHERE ${qrStudentMatch('$1', '$2')} AND s.company_id = $2`,
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

      const code = codeDigits(params.code);   // pool cards print "A-100001"
      if (!Number.isInteger(code) || code < 1) {
        return apiError(404, 'ERRORS.STUDENTS.CODE_NOT_FOUND', 'No student exists with this code');
      }

      /**
       * The same typed digits can mean a card in more than one reserved range.
       *
       * A card's printed number drops its range — "005" is card 5 — and the
       * client normalises that to a range without knowing which one this academy
       * was issued. Only the company knows: it holds cards from one range, so at
       * most one of these can match. Trying the alternatives is what lets a card
       * printed "005" be typed as "005" whichever run it came from.
       *
       * Ordered exact-first, so an organic code always beats a card reading the
       * same — a student whose own code is 100 is not displaced by card 100.
       */
      const offset = code > CARD_SERIAL_BASE_V3 ? code % 100000 : code;
      const candidates = [code];
      if (offset >= 1 && offset < 100000) {
        for (const base of [CARD_SERIAL_BASE_V3, CARD_SERIAL_BASE_V2, CARD_SERIAL_BASE]) {
          const alt = base + offset;
          if (!candidates.includes(alt)) candidates.push(alt);
        }
      }

      // Codes are unique per company and only assigned to active students for
      // lookup purposes; an inactive/unknown code must not resolve.
      const student = await queryOne<any>(
        `SELECT id, qr_token FROM students
         WHERE student_code = ANY($1::int[]) AND company_id = $2 AND is_active = true
         ORDER BY array_position($1::int[], student_code)
         LIMIT 1`,
        [candidates, context.companyId]
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
