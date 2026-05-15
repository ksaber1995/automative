import { query, queryOne, update } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

export const companiesRoutes = {
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
