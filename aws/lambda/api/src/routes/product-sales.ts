import { insert, findById, query } from '../db/connection';

function mapProductSaleFromDB(row: any) {
  return {
    id: row.id,
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
  create: async ({ body }: { body: any }) => {
    try {
      const sale = await insert('product_sales', {
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
        status: 400 as const,
        body: { message: 'Failed to create product sale' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string; productId?: string; startDate?: string; endDate?: string } }) => {
    try {
      let sql = 'SELECT * FROM product_sales WHERE 1=1';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  summary: async ({ query: queryParams }: { query: { branchId?: string; startDate?: string; endDate?: string } }) => {
    try {
      let sql = `
        SELECT
          COUNT(*) as total_sales,
          SUM(quantity) as total_quantity,
          SUM(total_amount) as total_revenue
        FROM product_sales
        WHERE 1=1
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        WHERE 1=1
      `;

      if (queryParams.branchId) {
        productSql += ` AND ps.branch_id = $1`;
      }
      if (queryParams.startDate) {
        const idx = queryParams.branchId ? 2 : 1;
        productSql += ` AND ps.sale_date >= $${idx}`;
      }
      if (queryParams.endDate) {
        const idx = (queryParams.branchId ? 1 : 0) + (queryParams.startDate ? 1 : 0) + 1;
        productSql += ` AND ps.sale_date <= $${idx}`;
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
        status: 200 as const,
        body: {
          totalSales: 0,
          totalQuantity: 0,
          totalRevenue: 0,
          byProduct: [],
        },
      };
    }
  },

  topProducts: async ({ query: queryParams }: { query: { branchId?: string; limit?: string } }) => {
    try {
      let sql = `
        SELECT
          ps.product_id,
          p.name as product_name,
          p.code as product_code,
          SUM(ps.quantity) as quantity
        FROM product_sales ps
        LEFT JOIN products p ON ps.product_id = p.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const sale = await findById('product_sales', params.id);

      if (!sale) {
        return {
          status: 404 as const,
          body: { message: 'Product sale not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error) {
      console.error('Get product sale error:', error);
      return {
        status: 404 as const,
        body: { message: 'Product sale not found' },
      };
    }
  },
};
