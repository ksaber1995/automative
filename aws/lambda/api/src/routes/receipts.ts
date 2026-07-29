import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { enforceByIp, RATE_LIMITS } from '../middleware/rate-limit';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureReceiptSchema, mapReceipt } from '../db/receipts';

type AuthHeaders = { authorization: string };

export const receiptsRoutes = {
  /**
   * PUBLIC, UNAUTHENTICATED — the QR target printed on every slip.
   *
   * The opaque token is the only credential, exactly like the student QR
   * profile, and it resolves to ONE receipt. It keeps working after the payment
   * is voided, the enrolment deleted or the student removed, because the row is
   * a snapshot that references nothing: that permanence is the point of printing
   * a QR on a paper receipt at all.
   *
   * What it exposes is what is already printed on the slip in the holder's hand
   * — name, phone, course, amount, date, academy. Same per-IP rate limit as the
   * student profile so the 32-hex token space cannot be swept any faster.
   */
  byToken: async ({ params }: { params: { token: string } }) => {
    enforceByIp(RATE_LIMITS.PUBLIC_PROFILE_IP);
    try {
      await ensureReceiptSchema();
      const token = (params.token || '').trim();
      if (!/^[a-f0-9]{16,64}$/i.test(token)) {
        return apiError(404, 'ERRORS.RECEIPTS.NOT_FOUND', 'Receipt not found');
      }
      const row = await queryOne<any>(
        'SELECT * FROM payment_receipts WHERE public_token = $1',
        [token],
      );
      if (!row) return apiError(404, 'ERRORS.RECEIPTS.NOT_FOUND', 'Receipt not found');
      return { status: 200 as const, body: mapReceipt(row) };
    } catch (error) {
      console.error('Public receipt error:', error);
      return mapThrownError(error, 'ERRORS.RECEIPTS.NOT_FOUND', 'Receipt not found', 404);
    }
  },

  /** Every receipt issued for one student — the reprint list on their page. */
  listByStudent: async ({ params, headers }: { params: { studentId: string }; headers: AuthHeaders }) => {
    try {
      await ensureReceiptSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const rows = await query(
        `SELECT * FROM payment_receipts
         WHERE company_id = $1 AND student_id = $2
         ORDER BY created_at DESC`,
        [context.companyId, params.studentId],
      );
      return { status: 200 as const, body: (rows as any[]).map(mapReceipt) };
    } catch (error) {
      console.error('List student receipts error:', error);
      return mapThrownError(error, 'ERRORS.RECEIPTS.LIST_FAILED', 'Failed to load receipts');
    }
  },

  /**
   * The tenant's receipts, newest first — for finding and reprinting one.
   * Bounded: a till roll grows without limit and nobody scrolls past a few hundred.
   */
  list: async ({ query: q, headers }: { query: { search?: string; limit?: string }; headers: AuthHeaders }) => {
    try {
      await ensureReceiptSchema();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'enrollments', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const params: any[] = [context.companyId];
      let sql = 'SELECT * FROM payment_receipts WHERE company_id = $1';
      const search = (q.search || '').trim();
      if (search) {
        // A bare number is a receipt number (what staff read off the slip);
        // anything else is a name or phone search.
        if (/^\d+$/.test(search)) {
          params.push(Number(search), `%${search}%`);
          sql += ` AND (receipt_number = $${params.length - 1} OR student_phone ILIKE $${params.length})`;
        } else {
          params.push(`%${search}%`);
          sql += ` AND student_name ILIKE $${params.length}`;
        }
      }
      const limit = Math.min(Math.max(parseInt(q.limit || '200', 10) || 200, 1), 500);
      sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
      const rows = await query(sql, params);
      return { status: 200 as const, body: (rows as any[]).map(mapReceipt) };
    } catch (error) {
      console.error('List receipts error:', error);
      return mapThrownError(error, 'ERRORS.RECEIPTS.LIST_FAILED', 'Failed to load receipts');
    }
  },
};
