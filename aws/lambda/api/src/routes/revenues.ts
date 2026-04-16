import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

export const revenuesRoutes = {
  list: async ({ query: queryParams, headers }: {
    query: {
      branchId?: string;
      source?: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'ALL';
      startDate?: string;
      endDate?: string;
    };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!checkGranularPermission(context, 'revenues', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const params: any[] = [context.companyId];

      // Unified revenue list: UNION ALL over enrollments, product sales, and
      // master course bundle enrollments. Each branch emits the same columns.
      const includeEnrollments = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'ENROLLMENT';
      const includeProducts = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'PRODUCT_SALE';
      const includeMasters = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'MASTER_ENROLLMENT';

      // Shared filters — push once, reuse positional index for every branch.
      let branchIdx: number | null = null;
      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(queryParams.branchId);
        branchIdx = params.length;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        branchIdx = params.length;
      }
      let startIdx: number | null = null;
      if (queryParams.startDate) { params.push(queryParams.startDate); startIdx = params.length; }
      let endIdx: number | null = null;
      if (queryParams.endDate) { params.push(queryParams.endDate); endIdx = params.length; }

      const parts: string[] = [];

      if (includeEnrollments) {
        let sql = `SELECT
          'ENROLLMENT' as source,
          e.id as source_id,
          e.company_id,
          e.branch_id,
          b.name as branch_name,
          e.amount_paid as amount,
          COALESCE(e.total_refunded, 0) as total_refunded,
          CONCAT('Enrollment: ', s.first_name, ' ', s.last_name, ' - ', c.name) as description,
          e.enrollment_date as date,
          e.payment_status,
          NULL as payment_method,
          CONCAT(s.first_name, ' ', s.last_name) as student_name,
          c.name as course_name,
          NULL as product_name,
          e.student_id as student_id,
          e.created_at
        FROM enrollments e
        JOIN branches b ON e.branch_id = b.id
        JOIN students s ON e.student_id = s.id
        JOIN courses c ON e.course_id = c.id
        WHERE e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')`;
        if (branchIdx) sql += ` AND e.branch_id = $${branchIdx}`;
        if (startIdx) sql += ` AND e.enrollment_date >= $${startIdx}`;
        if (endIdx) sql += ` AND e.enrollment_date <= $${endIdx}`;
        parts.push(sql);
      }

      if (includeProducts) {
        let sql = `SELECT
          'PRODUCT_SALE' as source,
          ps.id as source_id,
          ps.company_id,
          ps.branch_id,
          b.name as branch_name,
          ps.total_amount as amount,
          CAST(0 AS NUMERIC) as total_refunded,
          CONCAT('Product Sale: ', p.name, ' (', ps.quantity, ' units)') as description,
          ps.sale_date as date,
          'PAID' as payment_status,
          ps.payment_method,
          ps.customer_name as student_name,
          NULL as course_name,
          p.name as product_name,
          NULL as student_id,
          ps.created_at
        FROM product_sales ps
        JOIN branches b ON ps.branch_id = b.id
        JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1`;
        if (branchIdx) sql += ` AND ps.branch_id = $${branchIdx}`;
        if (startIdx) sql += ` AND ps.sale_date >= $${startIdx}`;
        if (endIdx) sql += ` AND ps.sale_date <= $${endIdx}`;
        parts.push(sql);
      }

      if (includeMasters) {
        let sql = `SELECT
          'MASTER_ENROLLMENT' as source,
          me.id as source_id,
          me.company_id,
          me.branch_id,
          b.name as branch_name,
          me.amount_paid as amount,
          COALESCE(me.total_refunded, 0) as total_refunded,
          CONCAT('Bundle: ', s.first_name, ' ', s.last_name, ' - ', mc.name) as description,
          me.enrollment_date as date,
          me.payment_status,
          me.payment_method,
          CONCAT(s.first_name, ' ', s.last_name) as student_name,
          mc.name as course_name,
          NULL as product_name,
          me.student_id as student_id,
          me.created_at
        FROM master_enrollments me
        JOIN branches b ON me.branch_id = b.id
        JOIN students s ON me.student_id = s.id
        JOIN master_courses mc ON me.master_course_id = mc.id
        WHERE me.company_id = $1 AND me.amount_paid > 0`;
        if (branchIdx) sql += ` AND me.branch_id = $${branchIdx}`;
        if (startIdx) sql += ` AND me.enrollment_date >= $${startIdx}`;
        if (endIdx) sql += ` AND me.enrollment_date <= $${endIdx}`;
        parts.push(sql);
      }

      if (parts.length === 0) {
        return { status: 200 as const, body: [] };
      }

      const sql = parts.join(' UNION ALL ') + ' ORDER BY date DESC, created_at DESC';
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
          studentId: row.student_id,
          amount: parseFloat(row.amount),
          totalRefunded: parseFloat(row.total_refunded || 0),
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
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

      if (!checkGranularPermission(context, 'revenues', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const params: any[] = [context.companyId];
      let enrollmentConditions = 'WHERE e.company_id = $1 AND e.payment_status IN (\'PAID\', \'PARTIAL\')';
      let productConditions = 'WHERE ps.company_id = $1';
      // Master enrollments: include any row with cash collected (amount_paid > 0).
      let masterConditions = 'WHERE me.company_id = $1 AND me.amount_paid > 0';

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
        masterConditions += ` AND me.branch_id = $${params.length}`;
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        enrollmentConditions += ` AND e.branch_id = $${params.length}`;
        productConditions += ` AND ps.branch_id = $${params.length}`;
        masterConditions += ` AND me.branch_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        const paramIndex = params.length;
        enrollmentConditions += ` AND e.enrollment_date >= $${paramIndex}`;
        productConditions += ` AND ps.sale_date >= $${paramIndex}`;
        masterConditions += ` AND me.enrollment_date >= $${paramIndex}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        const paramIndex = params.length;
        enrollmentConditions += ` AND e.enrollment_date <= $${paramIndex}`;
        productConditions += ` AND ps.sale_date <= $${paramIndex}`;
        masterConditions += ` AND me.enrollment_date <= $${paramIndex}`;
      }

      // Get total revenue from enrollments
      const enrollmentRevenueQuery = `
        SELECT COALESCE(SUM(e.amount_paid), 0) as total
        FROM enrollments e
        ${enrollmentConditions}
      `;

      // Get total revenue from product sales
      const productRevenueQuery = `
        SELECT COALESCE(SUM(ps.total_amount), 0) as total
        FROM product_sales ps
        ${productConditions}
      `;

      // Get total revenue from master (bundle) enrollments
      const masterRevenueQuery = `
        SELECT COALESCE(SUM(me.amount_paid), 0) as total
        FROM master_enrollments me
        ${masterConditions}
      `;

      // Get revenue by branch (three LEFT JOINs summed)
      const startIdx = queryParams.startDate ? params.indexOf(queryParams.startDate) + 1 : null;
      const endIdx = queryParams.endDate ? params.indexOf(queryParams.endDate) + 1 : null;
      const branchIdx = queryParams.branchId ? params.indexOf(queryParams.branchId) + 1 : null;

      const byBranchQuery = `
        SELECT
          b.id as branch_id,
          b.name as branch_name,
          COALESCE(enroll.total, 0) + COALESCE(prod.total, 0) + COALESCE(mast.total, 0) as revenue
        FROM branches b
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) as total
          FROM enrollments
          WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')
          ${startIdx ? `AND enrollment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND enrollment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) enroll ON enroll.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(total_amount) as total
          FROM product_sales
          WHERE company_id = $1
          ${startIdx ? `AND sale_date >= $${startIdx}` : ''}
          ${endIdx ? `AND sale_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) prod ON prod.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) as total
          FROM master_enrollments
          WHERE company_id = $1 AND amount_paid > 0
          ${startIdx ? `AND enrollment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND enrollment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) mast ON mast.branch_id = b.id
        WHERE b.company_id = $1
        ${branchIdx ? `AND b.id = $${branchIdx}` : ''}
        GROUP BY b.id, b.name, enroll.total, prod.total, mast.total
        ORDER BY revenue DESC
      `;

      // Get revenue by month
      const byMonthQuery = `
        SELECT
          TO_CHAR(date, 'YYYY-MM') as month,
          SUM(amount) as revenue
        FROM (
          SELECT e.enrollment_date as date, e.amount_paid as amount
          FROM enrollments e
          ${enrollmentConditions}
          UNION ALL
          SELECT ps.sale_date as date, ps.total_amount as amount
          FROM product_sales ps
          ${productConditions}
          UNION ALL
          SELECT me.enrollment_date as date, me.amount_paid as amount
          FROM master_enrollments me
          ${masterConditions}
        ) combined
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      `;

      const [enrollmentResult, productResult, masterResult, byBranchResult, byMonthResult] = await Promise.all([
        query(enrollmentRevenueQuery, params),
        query(productRevenueQuery, params),
        query(masterRevenueQuery, params),
        query(byBranchQuery, params),
        query(byMonthQuery, params),
      ]);

      const enrollmentRevenue = parseFloat(enrollmentResult[0]?.total || 0);
      const productRevenue = parseFloat(productResult[0]?.total || 0);
      const masterRevenue = parseFloat(masterResult[0]?.total || 0);

      return {
        status: 200 as const,
        body: {
          totalRevenue: enrollmentRevenue + productRevenue + masterRevenue,
          enrollmentRevenue,
          productRevenue,
          masterRevenue,
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to generate revenue summary' },
      };
    }
  },
};
