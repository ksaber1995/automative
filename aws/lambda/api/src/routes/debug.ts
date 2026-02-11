import { query } from '../db/connection';
import { extractTenantContext } from '../middleware/tenant-isolation';

export const debugRoutes = {
  checkClassesTable: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      // Only allow ADMIN users to access debug endpoints
      if (context.role !== 'ADMIN') {
        return {
          status: 403 as const,
          body: {
            success: false,
            error: 'Only administrators can access debug endpoints',
          },
        };
      }

      // Get all columns in classes table
      const columns = await query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'classes'
        ORDER BY ordinal_position;
      `);

      return {
        status: 200 as const,
        body: {
          success: true,
          columns: columns
        },
      };
    } catch (error) {
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  },
};
