import { insert, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isAuthError, isSubscriptionError, isGlobalAdmin } from '../middleware/tenant-isolation';
import { getClient } from '../db/connection';

function mapProductSaleFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    productId: row.product_id,
    productName: row.product_name || null,
    branchId: row.branch_id,
    quantity: parseInt(row.quantity),
    unitPrice: parseFloat(row.unit_price),
    discountType: row.discount_type || 'NONE',
    discountValue: parseFloat(row.discount_value || 0),
    discountAmount: parseFloat(row.discount_amount || 0),
    subtotal: parseFloat(row.subtotal || row.total_amount),
    totalAmount: parseFloat(row.total_amount),
    saleDate: row.sale_date,
    paymentMethod: row.payment_method,
    receiptNumber: row.receipt_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    notes: row.notes,
    eventId: row.event_id || null,
    createdAt: row.created_at,
  };
}

export const productSalesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    const client = await getClient();
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'write')) {
        client.release();
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      // Fetch product to get cost_price for COGS
      const product = await queryOne<any>(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [body.productId, context.companyId]
      );

      if (!product) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      // Compute pricing server-side from product's selling price
      const unitPrice = parseFloat(product.selling_price);
      const subtotal = unitPrice * body.quantity;
      const discountType: string = body.discountType || 'NONE';
      const discountValue: number = body.discountValue || 0;
      let discountAmount = 0;
      if (discountType === 'PERCENTAGE') discountAmount = (subtotal * discountValue) / 100;
      else if (discountType === 'FIXED_AMOUNT') discountAmount = discountValue;
      const totalAmount = Math.max(0, subtotal - discountAmount);

      await client.query('BEGIN');

      // 1. Create the sale record
      const saleResult = await client.query(
        `INSERT INTO product_sales
           (company_id, product_id, branch_id, quantity, unit_price, discount_type, discount_value, discount_amount, subtotal, total_amount, sale_date, payment_method, receipt_number, customer_name, customer_phone, notes, event_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
        [context.companyId, body.productId, body.branchId, body.quantity, unitPrice,
         discountType, discountValue, discountAmount, subtotal, totalAmount,
         body.date, body.paymentMethod || null, body.receiptNumber || null,
         body.customerName || null, body.customerPhone || null, body.notes || null,
         body.eventId || null]
      );
      const sale = saleResult.rows[0];

      // 2. Deduct stock
      await client.query(
        'UPDATE products SET stock = stock - $1 WHERE id = $2',
        [body.quantity, body.productId]
      );

      // 3. Auto-create COGS expense (cost_price × quantity sold)
      const cogsAmount = parseFloat(product.cost_price) * body.quantity;
      const saleDate = body.date;
      await client.query(
        `INSERT INTO expenses (company_id, branch_id, type, category, amount, description, date, product_sale_id, product_id, event_id)
         VALUES ($1,$2,'VARIABLE','COGS',$3,$4,$5,$6,$7,$8)`,
        [
          context.companyId,
          body.branchId,
          cogsAmount,
          `COGS: ${product.name} × ${body.quantity} units`,
          saleDate,
          sale.id,
          body.productId,
          body.eventId || null,
        ]
      );

      await client.query('COMMIT');

      return {
        status: 201 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create product sale error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error.message || 'Failed to create product sale' },
      };
    } finally {
      client.release();
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; productId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      let sql = `SELECT ps.*, p.name AS product_name FROM product_sales ps LEFT JOIN products p ON ps.product_id = p.id WHERE ps.company_id = $1`;
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
      } else if (!isGlobalAdmin(context) && context.branchId) {
        params.push(context.branchId);
        sql += ` AND ps.branch_id = $${params.length}`;
      }

      if (queryParams.productId) {
        params.push(queryParams.productId);
        sql += ` AND ps.product_id = $${params.length}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND ps.sale_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND ps.sale_date <= $${params.length}`;
      }

      sql += ' ORDER BY ps.sale_date DESC, ps.created_at DESC';

      const sales = await query(sql, params);
      return {
        status: 200 as const,
        body: sales.map(mapProductSaleFromDB),
      };
    } catch (error) {
      console.error('List product sales error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to list product sales' },
      };
    }
  },

  summary: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

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
      } else if (!isGlobalAdmin(context) && context.branchId) {
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
      } else if (!isGlobalAdmin(context) && context.branchId) {
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to generate product sales summary' },
      };
    }
  },

  topProducts: async ({ query: queryParams, headers }: { query: { branchId?: string; limit?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

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
      } else if (!isGlobalAdmin(context) && context.branchId) {
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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error.message || 'Failed to get top products' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

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
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 404,
        body: { message: error.message || 'Product sale not found' },
      };
    }
  },
};
