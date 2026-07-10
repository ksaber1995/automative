import { query, queryOne, update } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// Auto start/end sessions on schedule (opt-in per company). Added idempotently
// at runtime so the setting works even before a SQL migration is applied.
let autoManageColumnInitPromise: Promise<void> | null = null;
export async function ensureAutoManageSessionsColumn(): Promise<void> {
  if (!autoManageColumnInitPromise) {
    autoManageColumnInitPromise = (async () => {
      try {
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS auto_manage_sessions BOOLEAN NOT NULL DEFAULT FALSE`);
      } catch (e) {
        autoManageColumnInitPromise = null;
        throw e;
      }
    })();
  }
  return autoManageColumnInitPromise;
}

function mapCompanyProfile(row: any) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    zipCode: row.zip_code,
    country: row.country,
    taxId: row.tax_id,
    registrationNumber: row.registration_number,
    industry: row.industry,
    plan: row.plan ?? 'SIMPLE',
    timezone: row.timezone,
    currency: row.currency,
    locale: row.locale,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const companiesRoutes = {
  getProfile: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne<any>(
        'SELECT * FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) {
        return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      }
      const subscription = await queryOne<any>(
        'SELECT status, price, trial_start_date, trial_end_date, subscription_start_date, subscription_end_date FROM subscriptions WHERE company_id = $1',
        [context.companyId]
      );

      return {
        status: 200 as const,
        body: {
          company: mapCompanyProfile(company),
          subscription: subscription
            ? {
                status: subscription.status,
                price: parseFloat(subscription.price || 0),
                trialStartDate: subscription.trial_start_date,
                trialEndDate: subscription.trial_end_date,
                subscriptionStartDate: subscription.subscription_start_date,
                subscriptionEndDate: subscription.subscription_end_date,
              }
            : null,
        },
      };
    } catch (error) {
      console.error('Get company profile error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.PROFILE_FAILED', 'Failed to load company profile', 401);
    }
  },

  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      await ensureAutoManageSessionsColumn();
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne(
        'SELECT id, name, global_expense_allocation, auto_manage_sessions FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) {
        return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      }
      return {
        status: 200 as const,
        body: {
          id: company.id,
          name: company.name,
          globalExpenseAllocation: company.global_expense_allocation || 'OVERHEAD',
          autoManageSessions: company.auto_manage_sessions === true,
        },
      };
    } catch (error) {
      console.error('Get company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.SETTINGS_FAILED', 'Unauthorized', 401);
    }
  },

  updateSettings: async ({ body, headers }: { body: { globalExpenseAllocation?: string; autoManageSessions?: boolean }; headers: { authorization: string } }) => {
    try {
      await ensureAutoManageSessionsColumn();
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can update company settings');
      }

      const updateData: any = {};
      if (body.globalExpenseAllocation !== undefined) {
        updateData.global_expense_allocation = body.globalExpenseAllocation;
      }
      if (body.autoManageSessions !== undefined) {
        updateData.auto_manage_sessions = body.autoManageSessions === true;
      }

      const company = await update('companies', context.companyId, updateData);
      if (!company) {
        return apiError(400, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update settings');
      }

      return {
        status: 200 as const,
        body: {
          id: company.id,
          name: company.name,
          globalExpenseAllocation: company.global_expense_allocation || 'OVERHEAD',
          autoManageSessions: company.auto_manage_sessions === true,
        },
      };
    } catch (error) {
      console.error('Update company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update settings', 400);
    }
  },

  // Self-service plan change (academies only): SIMPLE ⇄ ADVANCED. ADVANCED
  // unlocks CRM & add-ons. Admin-gated. No billing enforced yet.
  upgradePlan: async ({ body, headers }: { body: { plan?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can change the plan');
      }
      const company = await queryOne<any>('SELECT type FROM companies WHERE id = $1', [context.companyId]);
      if (!company) return apiError(404, 'ERRORS.COMPANIES.NOT_FOUND', 'Company not found');
      if (company.type !== 'ACADEMY') {
        return apiError(400, 'ERRORS.COMPANIES.PLAN_ACADEMY_ONLY', 'Plans apply to academies only');
      }
      const plan = body?.plan === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE';
      const updated = await update('companies', context.companyId, { plan });
      if (!updated) return apiError(400, 'ERRORS.COMPANIES.PLAN_UPDATE_FAILED', 'Failed to update plan');
      return { status: 200 as const, body: { plan: updated.plan ?? plan } };
    } catch (error) {
      console.error('Upgrade plan error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.PLAN_UPDATE_FAILED', 'Failed to update plan', 400);
    }
  },
};
