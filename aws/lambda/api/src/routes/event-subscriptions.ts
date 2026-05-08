import { query, queryOne, insert } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
} from '../middleware/tenant-isolation';

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
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const event = await queryOne(
        'SELECT id, branch_id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };

      const rows = await query(
        `SELECT es.*,
                CASE WHEN s.id IS NOT NULL
                  THEN s.first_name || ' ' || s.last_name
                  ELSE NULL END AS student_name
         FROM event_subscriptions es
         LEFT JOIN students s ON s.id = es.student_id
         WHERE es.event_id = $1 AND es.company_id = $2
         ORDER BY es.payment_date DESC, es.created_at DESC`,
        [params.eventId, context.companyId]
      );
      return { status: 200 as const, body: rows.map(mapRow) };
    } catch (error: any) {
      console.error('List event subscriptions error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list subscriptions' },
      };
    }
  },

  create: async ({ params, body, headers }: { params: { eventId: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const event = await queryOne(
        'SELECT id, branch_id, name FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };
      if (event.branch_id && !canAccessBranch(context, event.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      const isStudent = !!body.studentId;
      if (!isStudent) {
        if (!body.externalFirstName || !body.externalLastName) {
          return { status: 400 as const, body: { message: 'External subscriber requires first and last name' } };
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

      // Auto-create a revenue row so the subscription shows on /revenues.
      // revenues.branch_id is NOT NULL — only auto-create when event has a branch.
      if (amount > 0 && event.branch_id) {
        const description = isStudent
          ? `Event subscription: ${event.name}`
          : `Event subscription (external: ${body.externalFirstName} ${body.externalLastName}): ${event.name}`;
        const revenue = await insert('revenues', {
          branch_id: event.branch_id,
          event_id: params.eventId,
          student_id: isStudent ? body.studentId : null,
          amount,
          description,
          date: paymentDate,
          payment_method: body.paymentMethod || null,
          notes: body.notes || null,
        });
        await query(
          'UPDATE event_subscriptions SET revenue_id = $1 WHERE id = $2',
          [revenue.id, sub.id]
        );
        sub.revenue_id = revenue.id;
      }

      const row = await queryOne(
        `SELECT es.*,
                CASE WHEN s.id IS NOT NULL
                  THEN s.first_name || ' ' || s.last_name
                  ELSE NULL END AS student_name
         FROM event_subscriptions es
         LEFT JOIN students s ON s.id = es.student_id
         WHERE es.id = $1`,
        [sub.id]
      );
      return { status: 201 as const, body: mapRow(row || sub) };
    } catch (error: any) {
      console.error('Create event subscription error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create subscription' },
      };
    }
  },

  // ─── Event-scoped expenses (read-only list; create uses /api/expenses) ────
  listExpenses: async ({ params, headers }: { params: { eventId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };

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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list expenses' },
      };
    }
  },

  // ─── Event refunds ────────────────────────────────────────────────────────
  listRefunds: async ({ params, headers }: { params: { eventId: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };

      const rows = await query(
        `SELECT r.*,
                CASE WHEN s.id IS NOT NULL THEN s.first_name || ' ' || s.last_name ELSE NULL END AS student_name
         FROM refunds r
         LEFT JOIN students s ON s.id = r.student_id
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
          studentId: r.student_id,
          studentName: r.student_name,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          createdAt: r.created_at,
        })),
      };
    } catch (error: any) {
      console.error('List event refunds error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list refunds' },
      };
    }
  },

  createRefund: async ({ params, body, headers }: { params: { eventId: string }; body: any; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const event = await queryOne(
        'SELECT id, branch_id FROM events WHERE id = $1 AND company_id = $2',
        [params.eventId, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };

      const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return { status: 400 as const, body: { message: 'Refund amount must be a positive number' } };
      }
      const type = body.type === 'PARTIAL' ? 'PARTIAL' : 'FULL';

      const refund = await insert('refunds', {
        company_id: context.companyId,
        event_id: params.eventId,
        student_id: body.studentId || null,
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create refund' },
      };
    }
  },

  remove: async ({ params, headers }: { params: { id: string }; headers: AuthHeaders }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const existing = await queryOne(
        'SELECT id, revenue_id FROM event_subscriptions WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Subscription not found' } };

      if (existing.revenue_id) {
        await query('DELETE FROM revenues WHERE id = $1', [existing.revenue_id]);
      }
      await query('DELETE FROM event_subscriptions WHERE id = $1', [params.id]);
      return { status: 200 as const, body: { message: 'Subscription deleted' } };
    } catch (error: any) {
      console.error('Delete event subscription error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to delete subscription' },
      };
    }
  },
};
