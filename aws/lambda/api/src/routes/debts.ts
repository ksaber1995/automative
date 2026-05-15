import { query } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

export const debtsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!checkGranularPermission(context, 'debts', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement debts table and insert logic with company_id
      // When implemented, use: company_id: context.companyId
      return {
        status: 201 as const,
        body: {
          id: '00000000-0000-0000-0000-000000000000',
          companyId: context.companyId,
          ...body,
          currentBalance: body.principalAmount,
          totalInterestPaid: 0,
          totalPaid: 0,
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error('Create debt error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.CREATE_FAILED', 'Failed to create debt', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { status?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!checkGranularPermission(context, 'debts', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement when debts table is created
      // When implemented, use: WHERE company_id = $1
      return {
        status: 200 as const,
        body: [],
      };
    } catch (error) {
      console.error('List debts error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.LIST_FAILED', 'Failed to list debts');
    }
  },

  summary: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!checkGranularPermission(context, 'debts', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement when debts table is created
      // When implemented, filter by company_id
      return {
        status: 200 as const,
        body: {
          totalOutstanding: 0,
          totalBorrowed: 0,
          totalInterestPaid: 0,
          activeDebtsCount: 0,
          debts: [],
        },
      };
    } catch (error) {
      console.error('Debts summary error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.SUMMARY_FAILED', 'Failed to generate debts summary');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'debts', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement when debts table is created
      // When implemented, verify: WHERE id = $1 AND company_id = $2
      return apiError(404, 'ERRORS.DEBTS.NOT_FOUND', 'Debt not found');
    } catch (error) {
      console.error('Get debt error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.NOT_FOUND', 'Debt not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'debts', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement when debts table is created
      // When implemented, verify ownership: WHERE id = $1 AND company_id = $2
      return apiError(404, 'ERRORS.DEBTS.NOT_FOUND', 'Debt not found');
    } catch (error) {
      console.error('Update debt error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.UPDATE_FAILED', 'Failed to update debt', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'debts', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // TODO: Implement when debts table is created
      // When implemented, verify ownership: WHERE id = $1 AND company_id = $2
      return apiError(404, 'ERRORS.DEBTS.NOT_FOUND', 'Debt not found');
    } catch (error) {
      console.error('Delete debt error:', error);
      return mapThrownError(error, 'ERRORS.DEBTS.DELETE_FAILED', 'Failed to delete debt', 404);
    }
  },
};
