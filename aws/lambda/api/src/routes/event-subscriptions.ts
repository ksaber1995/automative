import { query, queryOne, insert } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

type AuthHeaders = { authorization: string };

function mapRow(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    eventId: row.event_id,
    branchId: row.branch_id,
    studentId: row.student_id,
    studentName: row.student_name ?? null,
    externalFirstName: row.external_first_name,
    externalLastName: row.external_last_name,
    externalAge: row.external_age,
    externalMobile: row.external_mobile,
    amount: parseFloat(row.amount || '0'),
    refundedAmount: parseFloat(row.refunded_amount || '0'),
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    notes: row.notes,
    revenueId: row.revenue_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const eventSubscriptionsRoutes = {
  listByEvent: async ({ params, headers }: { params: { eventId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const event = await queryOne(
        'SELECT id, branch_id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');

      const rows = await query(
        `SELECT es.*,
                CASE WHEN s.id IS NOT NULL
                  THEN s.name
                  ELSE NULL END AS student_name,
                COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.subscription_id = es.id), 0) AS refunded_amount
         FROM event_subscriptions es
         LEFT JOIN students s ON s.id = es.student_id
         WHERE es.event_id = $1 AND es.company_id = $2
         ORDER BY es.payment_date DESC, es.created_at DESC`,
        [params.eventId, context.companyId]
      );
      return { status: 200 as const, body: rows.map(mapRow) };
    } catch (error: any) {
      console.error('List event subscriptions error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.LIST_FAILED', 'Failed to list subscriptions');
    }
  },

  create: async ({ params, body, headers }: { params: { eventId: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const event = await queryOne(
        'SELECT id, branch_id, name, status FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');
      if (event.branch_id && !canAccessBranch(context, event.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }
      if (event.status === 'CANCELLED') {
        return apiError(409, 'ERRORS.EVENTS.CANCELLED_NO_SUBSCRIPTIONS', 'Event is cancelled; no new subscriptions can be added');
      }

      const isStudent = !!body.studentId;
      if (!isStudent) {
        if (!body.externalFirstName || !body.externalLastName) {
          return apiError(400, 'ERRORS.EVENT_SUBSCRIPTIONS.EXTERNAL_NAME_REQUIRED', 'External subscriber requires first and last name');
        }
      }

      const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount || '0');
      const paymentDate = body.paymentDate || new Date().toISOString().split('T')[0];

      const sub = await insert('event_subscriptions', {
        company_id: context.companyId,
        event_id: params.eventId,
        branch_id: event.branch_id || null,
        student_id: isStudent ? body.studentId : null,
        external_first_name: isStudent ? null : body.externalFirstName,
        external_last_name: isStudent ? null : body.externalLastName,
        external_age: isStudent ? null : (body.externalAge || null),
        external_mobile: isStudent ? null : (body.externalMobile || null),
        amount,
        payment_date: paymentDate,
        payment_method: body.paymentMethod || null,
        notes: body.notes || null,
      });

      // The /revenues list now sources event revenue directly from
      // event_subscriptions, so no mirrored revenues row is needed.

      const row = await queryOne(
        `SELECT es.*,
                CASE WHEN s.id IS NOT NULL
                  THEN s.name
                  ELSE NULL END AS student_name
         FROM event_subscriptions es
         LEFT JOIN students s ON s.id = es.student_id
         WHERE es.id = $1`,
        [sub.id]
      );
      return { status: 201 as const, body: mapRow(row || sub) };
    } catch (error: any) {
      console.error('Create event subscription error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.CREATE_FAILED', 'Failed to create subscription', 400);
    }
  },

  // ─── Event-scoped expenses (read-only list; create uses /api/expenses) ────
  listExpenses: async ({ params, headers }: { params: { eventId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');

      const rows = await query(
        `SELECT e.*,
                COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
                (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
         FROM expenses e
         WHERE e.event_id = $1 AND e.company_id = $2
         ORDER BY e.date DESC, e.created_at DESC`,
        [params.eventId, context.companyId]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          eventId: r.event_id,
          branchId: r.branch_id,
          type: r.type,
          category: r.category,
          amount: parseFloat(r.amount),
          description: r.description,
          date: r.date,
          vendor: r.vendor,
          invoiceNumber: r.invoice_number,
          notes: r.notes,
          totalPaid: parseFloat(r.total_paid || '0'),
          paymentCount: parseInt(r.payment_count || '0'),
          createdAt: r.created_at,
        })),
      };
    } catch (error: any) {
      console.error('List event expenses error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.LIST_EXPENSES_FAILED', 'Failed to list expenses');
    }
  },

  // ─── Event refunds ────────────────────────────────────────────────────────
  listRefunds: async ({ params, headers }: { params: { eventId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');

      const rows = await query(
        `SELECT r.*,
                CASE WHEN s.id IS NOT NULL THEN s.name
                     WHEN es.id IS NOT NULL THEN COALESCE(
                       NULLIF(TRIM(CONCAT(es.external_first_name, ' ', es.external_last_name)), ''),
                       NULL
                     )
                     ELSE NULL END AS subscriber_name
         FROM refunds r
         LEFT JOIN students s ON s.id = r.student_id
         LEFT JOIN event_subscriptions es ON es.id = r.subscription_id
         WHERE r.event_id = $1 AND r.company_id = $2
           AND r.enrollment_id IS NULL AND r.master_enrollment_id IS NULL
         ORDER BY r.refund_date DESC, r.created_at DESC`,
        [params.eventId, context.companyId]
      );
      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          id: r.id,
          eventId: r.event_id,
          subscriptionId: r.subscription_id,
          studentId: r.student_id,
          studentName: r.subscriber_name,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      };
    } catch (error: any) {
      console.error('List event refunds error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.LIST_REFUNDS_FAILED', 'Failed to list refunds');
    }
  },

  createRefund: async ({ params, body, headers }: { params: { eventId: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const event = await queryOne(
        'SELECT id, branch_id, status FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');
      if (event.status === 'CANCELLED') {
        return apiError(409, 'ERRORS.EVENTS.CANCELLED_NO_REFUNDS', 'Event is cancelled; no new refunds can be issued');
      }

      if (!body.subscriptionId) {
        return apiError(400, 'ERRORS.EVENT_SUBSCRIPTIONS.SUBSCRIPTION_ID_REQUIRED', 'subscriptionId is required');
      }
      const sub = await queryOne(
        `SELECT id, amount, student_id
         FROM event_subscriptions
         WHERE id = $1 AND event_id = $2 AND company_id = $3`,
        [body.subscriptionId, params.eventId, context.companyId]
      );
      if (!sub) return apiError(404, 'ERRORS.EVENT_SUBSCRIPTIONS.SUBSCRIPTION_NOT_FOUND', 'Subscription not found for this event');

      const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return apiError(400, 'ERRORS.EVENT_SUBSCRIPTIONS.REFUND_NON_POSITIVE', 'Refund amount must be a positive number');
      }

      const subAmount = parseFloat(sub.amount || '0');
      const priorRow = await queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM refunds WHERE subscription_id = $1`,
        [sub.id]
      );
      const priorRefunded = parseFloat(priorRow?.total || '0');
      const remaining = +(subAmount - priorRefunded).toFixed(2);

      // Allow a tiny tolerance for floating-point drift across decimal columns.
      if (amount > remaining + 0.005) {
        return apiError(400, 'ERRORS.EVENT_SUBSCRIPTIONS.REFUND_EXCEEDS_REFUNDABLE', `Refund exceeds remaining refundable amount (${remaining.toFixed(2)})`);
      }

      const type = body.type === 'PARTIAL' ? 'PARTIAL'
        : body.type === 'FULL' ? 'FULL'
        : Math.abs(amount - remaining) < 0.005 && Math.abs(priorRefunded) < 0.005 ? 'FULL'
        : 'PARTIAL';

      const refund = await insert('refunds', {
        company_id: context.companyId,
        event_id: params.eventId,
        subscription_id: sub.id,
        student_id: sub.student_id,
        enrollment_id: null,
        master_enrollment_id: null,
        amount,
        refund_date: body.refundDate,
        type,
        reason: body.reason || null,
      });

      return {
        status: 201 as const,
        body: {
          id: refund.id,
          eventId: refund.event_id,
          subscriptionId: refund.subscription_id,
          studentId: refund.student_id,
          amount: parseFloat(refund.amount),
          refundDate: refund.refund_date,
          type: refund.type,
          reason: refund.reason,
          createdAt: refund.created_at,
        },
      };
    } catch (error: any) {
      console.error('Create event refund error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.CREATE_REFUND_FAILED', 'Failed to create refund', 400);
    }
  },

  remove: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne(
        'SELECT id, revenue_id FROM event_subscriptions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.EVENT_SUBSCRIPTIONS.SUBSCRIPTION_NOT_FOUND', 'Subscription not found');

      if (existing.revenue_id) {
        await query('DELETE FROM revenues WHERE id = $1', [existing.revenue_id]);
      }
      await query('DELETE FROM event_subscriptions WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { message: 'Subscription deleted', code: 'EVENT_SUBSCRIPTIONS.DELETED' } };
    } catch (error: any) {
      console.error('Delete event subscription error:', error);
      return mapThrownError(error, 'ERRORS.EVENT_SUBSCRIPTIONS.DELETE_FAILED', 'Failed to delete subscription', 400);
    }
  },
};
