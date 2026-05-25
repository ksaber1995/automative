import { query, queryOne, update } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

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
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne(
        'SELECT id, name, global_expense_allocation FROM companies WHERE id = $1',
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
        },
      };
    } catch (error) {
      console.error('Get company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.SETTINGS_FAILED', 'Unauthorized', 401);
    }
  },

  updateSettings: async ({ body, headers }: { body: { globalExpenseAllocation?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return apiError(403, 'ERRORS.COMPANIES.ADMIN_ONLY', 'Only admins can update company settings');
      }

      const updateData: any = {};
      if (body.globalExpenseAllocation !== undefined) {
        updateData.global_expense_allocation = body.globalExpenseAllocation;
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
        },
      };
    } catch (error) {
      console.error('Update company settings error:', error);
      return mapThrownError(error, 'ERRORS.COMPANIES.UPDATE_FAILED', 'Failed to update settings', 400);
    }
  },
};
