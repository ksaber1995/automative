import { insert, update, query, queryOne } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  isGlobalAdmin,
  checkGranularPermission,
  isAuthError,
  isSubscriptionError,
  getBranchSqlFilter,
} from '../middleware/tenant-isolation';

function mapEventFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    name: row.name,
    code: row.code,
    eventType: row.event_type,
    description: row.description,
    location: row.location,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const eventsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      const row = await insert('events', {
        company_id: context.companyId,
        branch_id: body.branchId || null,
        name: body.name,
        code: body.code || null,
        event_type: body.eventType || 'OTHER',
        description: body.description || null,
        location: body.location || null,
        start_date: body.startDate || null,
        end_date: body.endDate || null,
        status: body.status || 'PLANNED',
        is_active: true,
      });

      return { status: 201 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Create event error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create event' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = 'SELECT * FROM events WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context)) {
        const branchFilter = getBranchSqlFilter(context, 'branch_id');
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list events' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const row = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!row) return { status: 404 as const, body: { message: 'Event not found' } };
      if (row.branch_id && !canAccessBranch(context, row.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to this event' } };
      }

      return { status: 200 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Get event error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Event not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'write')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const existing = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Event not found' } };
      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return { status: 403 as const, body: { message: 'Access denied to update this event' } };
      }

      const updateData: any = {};
      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to target branch' } };
        }
        updateData.branch_id = body.branchId || null;
      }
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.eventType !== undefined) updateData.event_type = body.eventType;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.location !== undefined) updateData.location = body.location;
      if (body.startDate !== undefined) updateData.start_date = body.startDate;
      if (body.endDate !== undefined) updateData.end_date = body.endDate;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const row = await update('events', params.id, updateData);
      if (!row) return { status: 404 as const, body: { message: 'Event not found' } };
      return { status: 200 as const, body: mapEventFromDB(row) };
    } catch (error: any) {
      console.error('Update event error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to update event' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      const existing = await queryOne(
        'SELECT * FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!existing) return { status: 404 as const, body: { message: 'Event not found' } };

      await update('events', params.id, { is_active: false, status: 'CANCELLED' });
      return { status: 200 as const, body: { message: 'Event deleted successfully' } };
    } catch (error: any) {
      console.error('Delete event error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Failed to delete event' },
      };
    }
  },

  // Aggregate P&L for one event: revenues + product-sale margin − expenses − refunds.
  getPL: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'events', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const event = await queryOne(
        'SELECT id FROM events WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!event) return { status: 404 as const, body: { message: 'Event not found' } };

      const revenueRow = await queryOne(
        `SELECT COALESCE(SUM(r.amount), 0) AS total, COUNT(*) AS count
         FROM revenues r
         INNER JOIN branches b ON b.id = r.branch_id
         WHERE r.event_id = $1 AND b.company_id = $2`,
        [params.id, context.companyId]
      );
      const expenseRow = await queryOne(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
         FROM expenses WHERE event_id = $1 AND company_id = $2
         AND (is_recurring IS NULL OR is_recurring = false)`,
        [params.id, context.companyId]
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to compute P&L' },
      };
    }
  },
};
