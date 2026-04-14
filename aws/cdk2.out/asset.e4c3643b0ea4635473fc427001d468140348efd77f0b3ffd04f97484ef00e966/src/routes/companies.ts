import { query, queryOne, update } from '../db/connection';
import { extractTenantContext, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export const companiesRoutes = {
  getSettings: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      const company = await queryOne(
        'SELECT id, name, global_expense_allocation FROM companies WHERE id = $1',
        [context.companyId]
      );
      if (!company) {
        return { status: 404 as const, body: { message: 'Company not found' } };
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
      return {
        status: 401 as const,
        body: { message: error.message || 'Unauthorized' },
      };
    }
  },

  updateSettings: async ({ body, headers }: { body: { globalExpenseAllocation?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (context.role !== 'ADMIN' && context.role !== 'GLOBAL_ADMIN') {
        return { status: 403 as const, body: { message: 'Only admins can update company settings' } };
      }

      const updateData: any = {};
      if (body.globalExpenseAllocation !== undefined) {
        updateData.global_expense_allocation = body.globalExpenseAllocation;
      }

      const company = await update('companies', context.companyId, updateData);
      if (!company) {
        return { status: 400 as const, body: { message: 'Failed to update settings' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to update settings' },
      };
    }
  },
};
