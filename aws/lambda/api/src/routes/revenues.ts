import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

export const revenuesRoutes = {
  list: async ({ query: queryParams, headers }: {
    query: {
      branchId?: string;
      source?: 'ENROLLMENT' | 'PRODUCT_SALE' | 'ALL';
      startDate?: string;
      endDate?: string;
    };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const params: any[] = [context.companyId];
      const conditions: string[] = [];

      // Build the unified query to get revenues from both enrollments and product sales
      let sql = `
        SELECT
          'ENROLLMENT' as source,
          e.id as source_id,
          e.company_id,
          e.branch_id,
          b.name as branch_name,
          e.final_price as amount,
          CONCAT('Enrollment: ', s.first_name, ' ', s.last_name, ' - ', c.name) as description,
          e.enrollment_date as date,
          e.payment_status,
          NULL as payment_method,
          CONCAT(s.first_name, ' ', s.last_name) as student_name,
          c.name as course_name,
          NULL as product_name,
          e.created_at
        FROM enrollments e
        JOIN branches b ON e.branch_id = b.id
        JOIN students s ON e.student_id = s.id
        JOIN courses c ON e.course_id = c.id
        WHERE e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL')
      `;

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        conditions.push(`e.branch_id = $${params.length}`);
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        conditions.push(`e.branch_id = $${params.length}`);
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        conditions.push(`e.enrollment_date >= $${params.length}`);
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        conditions.push(`e.enrollment_date <= $${params.length}`);
      }

      if (conditions.length > 0) {
        sql += ' AND ' + conditions.join(' AND ');
      }

      // Add product sales if source is not ENROLLMENT only
      if (!queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'PRODUCT_SALE') {
        const productConditions: string[] = [];

        sql += `
          UNION ALL
          SELECT
            'PRODUCT_SALE' as source,
            ps.id as source_id,
            ps.company_id,
            ps.branch_id,
            b.name as branch_name,
            ps.total_amount as amount,
            CONCAT('Product Sale: ', p.name, ' (', ps.quantity, ' units)') as description,
            ps.sale_date as date,
            'PAID' as payment_status,
            ps.payment_method,
            ps.customer_name as student_name,
            NULL as course_name,
            p.name as product_name,
            ps.created_at
          FROM product_sales ps
          JOIN branches b ON ps.branch_id = b.id
          JOIN products p ON ps.product_id = p.id
          WHERE ps.company_id = $1
        `;

        if (queryParams.branchId) {
          const branchIdx = params.indexOf(queryParams.branchId);
          productConditions.push(`ps.branch_id = $${branchIdx + 1}`);
        } else if (context.role !== 'ADMIN' && context.branchId) {
          const branchIdx = params.indexOf(context.branchId);
          productConditions.push(`ps.branch_id = $${branchIdx + 1}`);
        }

        if (queryParams.startDate) {
          const dateIdx = params.indexOf(queryParams.startDate);
          productConditions.push(`ps.sale_date >= $${dateIdx + 1}`);
        }

        if (queryParams.endDate) {
          const dateIdx = params.indexOf(queryParams.endDate);
          productConditions.push(`ps.sale_date <= $${dateIdx + 1}`);
        }

        if (productConditions.length > 0) {
          sql += ' AND ' + productConditions.join(' AND ');
        }
      }

      sql += ' ORDER BY date DESC, created_at DESC';

      const revenues = await query(sql, params);

      return {
        status: 200 as const,
        body: revenues.map((row: any) => ({
          id: row.source_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          branchName: row.branch_name,
          source: row.source,
          sourceId: row.source_id,
          amount: parseFloat(row.amount),
          description: row.description,
          date: row.date,
          paymentMethod: row.payment_method,
          paymentStatus: row.payment_status,
          studentName: row.student_name,
          courseName: row.course_name,
          productName: row.product_name,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('List revenues error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list revenues' },
      };
    }
  },

  summary: async ({ query: queryParams, headers }: {
    query: {
      branchId?: string;
      startDate?: string;
      endDate?: string;
    };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const params: any[] = [context.companyId];
      let enrollmentConditions = 'WHERE e.company_id = $1 AND e.payment_status IN (\'PAID\', \'PARTIAL\')';
      let productConditions = 'WHERE ps.company_id = $1';

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        enrollmentConditions += ` AND e.branch_id = $${params.length}`;
        productConditions += ` AND ps.branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        enrollmentConditions += ` AND e.branch_id = $${params.length}`;
        productConditions += ` AND ps.branch_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        const paramIndex = params.length;
        enrollmentConditions += ` AND e.enrollment_date >= $${paramIndex}`;
        productConditions += ` AND ps.sale_date >= $${paramIndex}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        const paramIndex = params.length;
        enrollmentConditions += ` AND e.enrollment_date <= $${paramIndex}`;
        productConditions += ` AND ps.sale_date <= $${paramIndex}`;
      }

      // Get total revenue from enrollments
      const enrollmentRevenueQuery = `
        SELECT COALESCE(SUM(e.final_price), 0) as total
        FROM enrollments e
        ${enrollmentConditions}
      `;

      // Get total revenue from product sales
      const productRevenueQuery = `
        SELECT COALESCE(SUM(ps.total_amount), 0) as total
        FROM product_sales ps
        ${productConditions}
      `;

      // Get revenue by branch
      const byBranchQuery = `
        SELECT
          b.id as branch_id,
          b.name as branch_name,
          COALESCE(SUM(e.final_price), 0) + COALESCE(SUM(ps.total_amount), 0) as revenue
        FROM branches b
        LEFT JOIN enrollments e ON b.id = e.branch_id AND e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL')
          ${queryParams.startDate ? `AND e.enrollment_date >= $${params.indexOf(queryParams.startDate) + 1}` : ''}
          ${queryParams.endDate ? `AND e.enrollment_date <= $${params.indexOf(queryParams.endDate) + 1}` : ''}
        LEFT JOIN product_sales ps ON b.id = ps.branch_id AND ps.company_id = $1
          ${queryParams.startDate ? `AND ps.sale_date >= $${params.indexOf(queryParams.startDate) + 1}` : ''}
          ${queryParams.endDate ? `AND ps.sale_date <= $${params.indexOf(queryParams.endDate) + 1}` : ''}
        WHERE b.company_id = $1
        ${queryParams.branchId ? `AND b.id = $${params.indexOf(queryParams.branchId) + 1}` : ''}
        GROUP BY b.id, b.name
        ORDER BY revenue DESC
      `;

      // Get revenue by month
      const byMonthQuery = `
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          SUM(amount) as revenue
        FROM (
          SELECT e.enrollment_date as date, e.final_price as amount
          FROM enrollments e
          ${enrollmentConditions}
          UNION ALL
          SELECT ps.sale_date as date, ps.total_amount as amount
          FROM product_sales ps
          ${productConditions}
        ) combined
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      `;

      const [enrollmentResult, productResult, byBranchResult, byMonthResult] = await Promise.all([
        query(enrollmentRevenueQuery, params),
        query(productRevenueQuery, params),
        query(byBranchQuery, params),
        query(byMonthQuery, params),
      ]);

      const enrollmentRevenue = parseFloat(enrollmentResult[0]?.total || 0);
      const productRevenue = parseFloat(productResult[0]?.total || 0);

      return {
        status: 200 as const,
        body: {
          totalRevenue: enrollmentRevenue + productRevenue,
          enrollmentRevenue,
          productRevenue,
          byBranch: byBranchResult.map((row: any) => ({
            branchId: row.branch_id,
            branchName: row.branch_name,
            revenue: parseFloat(row.revenue),
          })),
          byMonth: byMonthResult.map((row: any) => ({
            month: row.month,
            revenue: parseFloat(row.revenue),
          })),
        },
      };
    } catch (error) {
      console.error('Revenue summary error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to generate revenue summary' },
      };
    }
  },
};
