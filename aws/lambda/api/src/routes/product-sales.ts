import { insert, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapProductSaleFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    productId: row.product_id,
    branchId: row.branch_id,
    quantity: parseInt(row.quantity),
    unitPrice: parseFloat(row.unit_price),
    totalAmount: parseFloat(row.total_amount),
    saleDate: row.sale_date,
    paymentMethod: row.payment_method,
    customerName: row.customer_name,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export const productSalesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const sale = await insert('product_sales', {
        company_id: context.companyId,
        product_id: body.productId,
        branch_id: body.branchId,
        quantity: body.quantity,
        unit_price: body.unitPrice,
        total_amount: body.totalAmount,
        sale_date: body.saleDate,
        payment_method: body.paymentMethod || null,
        customer_name: body.customerName || null,
        notes: body.notes || null,
      });

      return {
        status: 201 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error) {
      console.error('Create product sale error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create product sale' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; productId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM product_sales WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      if (queryParams.productId) {
        params.push(queryParams.productId);
        sql += ` AND product_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND sale_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND sale_date <= $${params.length}`;
      }

      sql += ' ORDER BY sale_date DESC, created_at DESC';

      const sales = await query(sql, params);
      return {
        status: 200 as const,
        body: sales.map(mapProductSaleFromDB),
      };
    } catch (error) {
      console.error('List product sales error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list product sales' },
      };
    }
  },

  summary: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT
          COUNT(*) as total_sales,
          SUM(quantity) as total_quantity,
          SUM(total_amount) as total_revenue
        FROM product_sales
        WHERE company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND sale_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND sale_date <= $${params.length}`;
      }

      const summaryResult = await query(sql, params);
      const summary = summaryResult[0];

      // Get by product breakdown
      let productSql = `
        SELECT
          ps.product_id,
          p.name as product_name,
          SUM(ps.quantity) as quantity,
          SUM(ps.total_amount) as revenue
        FROM product_sales ps
        LEFT JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1
      `;

      if (queryParams.branchId) {
        const branchIdx = params.indexOf(queryParams.branchId);
        productSql += ` AND ps.branch_id = $${branchIdx + 1}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        const branchIdx = params.indexOf(context.branchId);
        productSql += ` AND ps.branch_id = $${branchIdx + 1}`;
      }

      if (queryParams.startDate) {
        const dateIdx = params.indexOf(queryParams.startDate);
        productSql += ` AND ps.sale_date >= $${dateIdx + 1}`;
      }

      if (queryParams.endDate) {
        const dateIdx = params.indexOf(queryParams.endDate);
        productSql += ` AND ps.sale_date <= $${dateIdx + 1}`;
      }

      productSql += ' GROUP BY ps.product_id, p.name ORDER BY revenue DESC';

      const byProduct = await query(productSql, params);

      return {
        status: 200 as const,
        body: {
          totalSales: parseInt(summary.total_sales) || 0,
          totalQuantity: parseInt(summary.total_quantity) || 0,
          totalRevenue: parseFloat(summary.total_revenue) || 0,
          byProduct: byProduct.map((row: any) => ({
            productId: row.product_id,
            productName: row.product_name || 'Unknown',
            quantity: parseInt(row.quantity),
            revenue: parseFloat(row.revenue),
          })),
        },
      };
    } catch (error) {
      console.error('Product sales summary error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to generate product sales summary' },
      };
    }
  },

  topProducts: async ({ query: queryParams, headers }: { query: { branchId?: string; limit?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT
          ps.product_id,
          p.name as product_name,
          p.code as product_code,
          SUM(ps.quantity) as quantity
        FROM product_sales ps
        LEFT JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND ps.branch_id = $${params.length}`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND ps.branch_id = $${params.length}`;
      }

      sql += ' GROUP BY ps.product_id, p.name, p.code ORDER BY quantity DESC';

      if (queryParams.limit) {
        params.push(queryParams.limit);
        sql += ` LIMIT $${params.length}`;
      } else {
        sql += ' LIMIT 10';
      }

      const topProducts = await query(sql, params);

      return {
        status: 200 as const,
        body: topProducts.map((row: any) => ({
          productId: row.product_id,
          productName: row.product_name || 'Unknown',
          productCode: row.product_code || '',
          quantity: parseInt(row.quantity),
        })),
      };
    } catch (error) {
      console.error('Top products error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get top products' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const sale = await queryOne(
        'SELECT * FROM product_sales WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!sale) {
        return {
          status: 404 as const,
          body: { message: 'Product sale not found' },
        };
      }

      if (sale.branch_id && !canAccessBranch(context, sale.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this product sale' },
        };
      }

      return {
        status: 200 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error) {
      console.error('Get product sale error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Product sale not found' },
      };
    }
  },
};
