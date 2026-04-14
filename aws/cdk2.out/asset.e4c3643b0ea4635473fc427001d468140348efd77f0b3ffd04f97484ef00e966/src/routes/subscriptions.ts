import { query, queryOne, update, insert } from '../db/connection';
import { extractTenantContext, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';
import { extractTokenFromHeader, verifyToken } from '../utils/jwt';

function mapSubscription(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    price: parseFloat(row.price || 0),
    trialStartDate: row.trial_start_date,
    trialEndDate: row.trial_end_date,
    subscriptionStartDate: row.subscription_start_date,
    subscriptionEndDate: row.subscription_end_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const subscriptionsRoutes = {
  // GET /api/subscription — returns current company's subscription (no expiry enforcement)
  getMySubscription: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const token = extractTokenFromHeader(headers.authorization);
      if (!token) return { status: 401 as const, body: { message: 'No authentication token provided' } };
      const decoded = await verifyToken(token);
      if (!decoded.companyId) return { status: 401 as const, body: { message: 'Invalid token' } };

      const subscription = await queryOne<any>(
        'SELECT * FROM subscriptions WHERE company_id = $1',
        [decoded.companyId]
      );

      if (!subscription) {
        return { status: 404 as const, body: { message: 'Subscription not found' } };
      }

      return { status: 200 as const, body: mapSubscription(subscription) };
    } catch (error: any) {
      return { status: isAuthError(error) ? 401 : 500, body: { message: error.message || 'Failed to get subscription' } };
    }
  },

  // PATCH /api/subscription/:companyId — admin update (price, status, dates)
  updateSubscription: async ({ params, body, headers }: { params: { companyId: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return { status: 403 as const, body: { message: 'Only admins can update subscription' } };
      }

      const existing = await queryOne<any>(
        'SELECT * FROM subscriptions WHERE company_id = $1',
        [params.companyId]
      );

      if (!existing) {
        return { status: 404 as const, body: { message: 'Subscription not found' } };
      }

      const updates: any = { updated_at: new Date() };
      if (body.status !== undefined) updates.status = body.status;
      if (body.price !== undefined) updates.price = body.price;
      if (body.trialStartDate !== undefined) updates.trial_start_date = body.trialStartDate;
      if (body.trialEndDate !== undefined) updates.trial_end_date = body.trialEndDate;
      if (body.subscriptionStartDate !== undefined) updates.subscription_start_date = body.subscriptionStartDate;
      if (body.subscriptionEndDate !== undefined) updates.subscription_end_date = body.subscriptionEndDate;
      if (body.notes !== undefined) updates.notes = body.notes;

      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
      const values = [existing.id, ...Object.values(updates)];

      await query(
        `UPDATE subscriptions SET ${setClauses} WHERE id = $1`,
        values
      );

      const updated = await queryOne<any>('SELECT * FROM subscriptions WHERE id = $1', [existing.id]);
      return { status: 200 as const, body: mapSubscription(updated) };
    } catch (error: any) {
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to update subscription' },
      };
    }
  },
};
