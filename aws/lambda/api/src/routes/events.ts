import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  appendBranchSqlFilter,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapEventFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    name: row.name,
    eventType: row.event_type,
    description: row.description,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    subscriptionPrice: row.subscription_price !== null && row.subscription_price !== undefined
      ? parseFloat(row.subscription_price)
      : null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const eventsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const row = await insert('events', {
        company_id: context.companyId,
        branch_id: body.branchId || null,
        name: body.name,
        event_type: body.eventType || 'OTHER',
        description: body.description || null,
        location: body.location || null,
        start_date: body.startDate || null,
        end_date: body.endDate || null,
        status: body.status || 'PLANNED',
        subscription_price: body.subscriptionPrice ?? null,
        is_active: true,
      });

      return { status: 201 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Create event error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.CREATE_FAILED', 'Failed to create event', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = 'SELECT * FROM events WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context)) {
        const branchFilter = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchFilter) sql += ` AND (${branchFilter} OR branch_id IS NULL)`;
      }

      if (queryParams.status) {
        params.push(queryParams.status);
        sql += ` AND status = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';

      const rows = await query(sql, params);
      return { status: 200 as const, body: rows.map(mapEventFromDB) };
    } catch (error: any) {
      console.error('List events error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.LIST_FAILED', 'Failed to list events');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const row = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return apiError(403, 'ERRORS.EVENTS.ACCESS_DENIED', 'Access denied to this event');
      }

      return { status: 200 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Get event error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EVENTS.ACCESS_DENIED_UPDATE', 'Access denied to update this event');
      }

      const updateData: any = {};
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId || null;
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.eventType !== undefined) updateData.event_type = body.eventType;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.location !== undefined) updateData.location = body.location;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.subscriptionPrice !== undefined) {
        updateData.subscription_price = body.subscriptionPrice;
      }
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const row = await update('events', params.id, updateData);
      if (!row) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');
      return { status: 200 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Update event error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.UPDATE_FAILED', 'Failed to update event', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const existing = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');

      await update('events', params.id, { is_active: false, status: 'CANCELLED' });
      return { status: 200 as const, body: { message: 'Event deleted successfully', code: 'EVENTS.DELETED' } };
    } catch (error: any) {
      console.error('Delete event error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.DELETE_FAILED', 'Failed to delete event', 404);
    }
  },

  // Aggregate P&L for one event: revenues + product-sale margin − expenses − refunds.
  getPL: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!event) return apiError(404, 'ERRORS.EVENTS.NOT_FOUND', 'Event not found');

      // Revenue: use event_subscriptions as the source of truth.
      // The auto-mirrored revenues row only exists when the event has a branch_id
      // (revenues.branch_id is NOT NULL), so events with no branch would otherwise
      // report zero revenue even when subscriptions exist.
      const revenueRow = await queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM event_subscriptions WHERE event_id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      // Expenses: match payments by their own event_id OR by the parent expense's
      // event_id. recordPayment historically didn't propagate eventId, so payments
      // linked to event-tagged expenses can have event_id NULL on the payment row.
      const expenseRow = await queryOne(
        `SELECT COALESCE(SUM(ep.amount), 0) AS total, COUNT(*) AS count
         FROM expense_payments ep
         LEFT JOIN expenses e ON e.id = ep.expense_id
         WHERE ep.company_id = $1
           AND (ep.event_id = $2 OR e.event_id = $2)`,
        [context.companyId, params.id]
      );
      const refundRow = await queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM refunds WHERE event_id = $1 AND company_id = $2`,
        [params.id, context.companyId]
      );
      const productRow = await queryOne(
        `SELECT
           COALESCE(SUM(ps.total_amount), 0) AS revenue,
           COALESCE(SUM(COALESCE(p.cost_price, 0) * ps.quantity), 0) AS cost,
           COUNT(*) AS count
         FROM product_sales ps
         LEFT JOIN products p ON p.id = ps.product_id
         WHERE ps.event_id = $1 AND ps.company_id = $2`,
        [params.id, context.companyId]
      );

      const revenueTotal = parseFloat(revenueRow?.total || '0');
      const expenseTotal = parseFloat(expenseRow?.total || '0');
      const refundTotal = parseFloat(refundRow?.total || '0');
      const productRevenue = parseFloat(productRow?.revenue || '0');
      const productCost = parseFloat(productRow?.cost || '0');
      const productMargin = productRevenue - productCost;

      return {
        status: 200 as const,
        body: {
          eventId: params.id,
          revenue: revenueTotal,
          revenueCount: parseInt(revenueRow?.count || '0', 10),
          expenses: expenseTotal,
          expenseCount: parseInt(expenseRow?.count || '0', 10),
          refunds: refundTotal,
          refundCount: parseInt(refundRow?.count || '0', 10),
          productRevenue,
          productCost,
          productMargin,
          productSaleCount: parseInt(productRow?.count || '0', 10),
          netProfit: revenueTotal + productMargin - expenseTotal - refundTotal,
        },
      };
    } catch (error: any) {
      console.error('Event P&L error:', error);
      return mapThrownError(error, 'ERRORS.EVENTS.PL_FAILED', 'Failed to compute P&L');
    }
  },
};
