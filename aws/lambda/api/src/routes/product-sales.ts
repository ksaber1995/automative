import { query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { getClient } from '../db/connection';
import { apiError, mapThrownError } from '../utils/api-error';

/**
 * Who bought this, kept as a name rather than only a link.
 *
 * product_sales.student_id is ON DELETE SET NULL, so deleting a student silently
 * erases the buyer from every sale they ever made — the row survives with the
 * money on it and nothing to say whose it was, indistinguishable from a walk-in
 * purchase. A name written down at sale time is the only thing that outlives the
 * student record, the same way payment_receipts snapshots its student details.
 *
 * The backfill fills this in for sales whose student is still around, so the
 * next deletion does not lose them too. It cannot recover buyers already erased.
 */
let studentSnapshotInitPromise: Promise<void> | null = null;
export async function ensureProductSaleStudentSnapshot(): Promise<void> {
  if (!studentSnapshotInitPromise) {
    studentSnapshotInitPromise = (async () => {
      try {
        await query(`ALTER TABLE product_sales ADD COLUMN IF NOT EXISTS student_name_at_sale TEXT`);
        await query(
          `UPDATE product_sales ps SET student_name_at_sale = s.name
             FROM students s
            WHERE s.id = ps.student_id AND ps.student_name_at_sale IS NULL`
        );
      } catch (e) {
        studentSnapshotInitPromise = null;
        throw e;
      }
    })();
  }
  return studentSnapshotInitPromise;
}

function mapProductSaleFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    productId: row.product_id,
    productName: row.product_name || null,
    branchId: row.branch_id,
    studentId: row.student_id || null,
    studentName: row.student_name || null,
    // The name as it was when the book was sold. Still there after the student
    // is deleted, which is the only way the page can say who bought it.
    studentNameAtSale: row.student_name_at_sale || null,
    // student_id is nulled by the FK on delete, so a snapshot with no live link
    // means exactly one thing: that student is gone.
    studentDeleted: !row.student_id && !!row.student_name_at_sale,
    courseId: row.course_id || null,
    enrollmentId: row.enrollment_id || null,
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
    totalRefunded: row.total_refunded !== undefined && row.total_refunded !== null
      ? parseFloat(row.total_refunded) || 0
      : 0,
    createdAt: row.created_at,
  };
}

/**
 * The date a sale is booked under, never later than today.
 *
 * A book bought alongside an enrolment used to inherit the ENROLMENT date, and
 * an enrolment is routinely dated to when the course starts — so cash taken on
 * 31 July for a course beginning 23 August was landing in August's revenue and
 * showing an August pay date. The money arrived when it arrived.
 *
 * Clamped rather than forced to today, so recording an enrolment that genuinely
 * happened last week still books its book sale on that day; only dates that have
 * not happened yet are pulled back.
 *
 * Plain YYYY-MM-DD string compare — same lexical order as chronological, and it
 * avoids dragging a timezone into a value that has no time attached.
 */
export function saleDateNotInFuture(requested: string | null | undefined, now = new Date()): string {
  const today = now.toISOString().substring(0, 10);
  if (!requested) return today;
  const asked = String(requested).substring(0, 10);
  return asked > today ? today : asked;
}

/**
 * Insert a single product sale on an existing transaction client: deduct stock,
 * auto-create the COGS expense, and persist optional student/course/enrollment
 * attribution. Shared by productSales.create and the enroll-and-buy flow so the
 * stock/COGS logic is never duplicated. Throws on insufficient stock or missing
 * product — the caller's transaction rolls back.
 */
export async function insertProductSaleWithClient(
  client: any,
  companyId: string,
  input: {
    productId: string;
    branchId: string | null;
    quantity: number;
    discountType?: string;
    discountValue?: number;
    date: string;
    paymentMethod?: string | null;
    receiptNumber?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    notes?: string | null;
    eventId?: string | null;
    studentId?: string | null;
    courseId?: string | null;
    enrollmentId?: string | null;
  }
): Promise<any> {
  const product = (await client.query(
    'SELECT * FROM products WHERE id = $1 AND company_id = $2',
    [input.productId, companyId]
  )).rows[0];
  if (!product) {
    const err: any = new Error('Product not found');
    err.statusCode = 404;
    err.code = 'ERRORS.PRODUCTS.NOT_FOUND';
    throw err;
  }

  const currentStock = parseInt(product.stock) || 0;
  if (currentStock < input.quantity) {
    const err: any = new Error(`Insufficient stock for ${product.name}`);
    err.statusCode = 400;
    err.code = 'ERRORS.PRODUCT_SALES.INSUFFICIENT_STOCK';
    throw err;
  }

  const unitPrice = parseFloat(product.selling_price);
  const subtotal = unitPrice * input.quantity;
  const discountType: string = input.discountType || 'NONE';
  const discountValue: number = input.discountValue || 0;
  let discountAmount = 0;
  if (discountType === 'PERCENTAGE') discountAmount = (subtotal * discountValue) / 100;
  else if (discountType === 'FIXED_AMOUNT') discountAmount = discountValue;
  const totalAmount = Math.max(0, subtotal - discountAmount);

  // Written down now, because the link to the student does not survive their
  // deletion — see ensureProductSaleStudentSnapshot.
  await ensureProductSaleStudentSnapshot();
  let studentNameAtSale: string | null = null;
  if (input.studentId) {
    const st = (await client.query(
      'SELECT name FROM students WHERE id = $1 AND company_id = $2',
      [input.studentId, companyId]
    )).rows[0];
    studentNameAtSale = st?.name || null;
  }

  const saleResult = await client.query(
    `INSERT INTO product_sales
       (company_id, product_id, branch_id, quantity, unit_price, discount_type, discount_value, discount_amount, subtotal, total_amount, sale_date, payment_method, receipt_number, customer_name, customer_phone, notes, event_id, student_id, course_id, enrollment_id, student_name_at_sale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
    [companyId, input.productId, input.branchId, input.quantity, unitPrice,
     discountType, discountValue, discountAmount, subtotal, totalAmount,
     input.date, input.paymentMethod || 'CASH', input.receiptNumber || null,
     input.customerName || null, input.customerPhone || null, input.notes || null,
     input.eventId || null, input.studentId || null, input.courseId || null,
     input.enrollmentId || null, studentNameAtSale]
  );
  const sale = saleResult.rows[0];

  await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [input.quantity, input.productId]);

  const cogsAmount = parseFloat(product.cost_price) * input.quantity;
  await client.query(
    `INSERT INTO expenses (company_id, branch_id, type, category, amount, description, date, product_sale_id, product_id, event_id)
     VALUES ($1,$2,'VARIABLE','COGS',$3,$4,$5,$6,$7,$8)`,
    [companyId, input.branchId, cogsAmount, `COGS: ${product.name} × ${input.quantity} units`,
     input.date, sale.id, input.productId, input.eventId || null]
  );

  return sale;
}

export const productSalesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    const client = await getClient();
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'write')) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      await client.query('BEGIN');

      const sale = await insertProductSaleWithClient(client, context.companyId, {
        productId: body.productId,
        branchId: body.branchId,
        quantity: body.quantity,
        discountType: body.discountType,
        discountValue: body.discountValue,
        date: body.date,
        paymentMethod: body.paymentMethod,
        receiptNumber: body.receiptNumber,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        notes: body.notes,
        eventId: body.eventId,
        studentId: body.studentId,
        courseId: body.courseId,
        enrollmentId: body.enrollmentId,
      });

      await client.query('COMMIT');

      return {
        status: 201 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Create product sale error:', error);
      if (error?.statusCode && error?.code) {
        return apiError(error.statusCode, error.code, error.message);
      }
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.CREATE_FAILED', 'Failed to create product sale', 400);
    } finally {
      client.release();
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; productId?: string; studentId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      await ensureProductSaleStudentSnapshot();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `SELECT ps.*, p.name AS product_name,
                        NULLIF(TRIM(COALESCE(st.name,'')), '') AS student_name,
                        COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.product_sale_id = ps.id), 0) AS total_refunded
                 FROM product_sales ps
                 LEFT JOIN products p ON ps.product_id = p.id
                 LEFT JOIN students st ON ps.student_id = st.id
                 WHERE ps.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND ps.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'ps.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      if (queryParams.productId) {
        params.push(queryParams.productId);
        sql += ` AND ps.product_id = $${params.length}`;
      }

      if (queryParams.studentId) {
        params.push(queryParams.studentId);
        sql += ` AND ps.student_id = $${params.length}`;
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
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.LIST_FAILED', 'Failed to list product sales');
    }
  },

  summary: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Build a single branch+date filter fragment and shared params, then
      // splice it into both queries. The previous version reused params by
      // indexOf() lookups which only works for single-branch scopes.
      const params: any[] = [context.companyId];
      let filters = '';

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        filters += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) filters += ` AND ${branchClause}`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        filters += ` AND sale_date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        filters += ` AND sale_date <= $${params.length}`;
      }

      // The product breakdown (and the cost rollup) uses the same filter but
      // qualified with `ps.` since they JOIN products.
      const productFilters = filters
        .replace(/\bbranch_id\b/g, 'ps.branch_id')
        .replace(/\bsale_date\b/g, 'ps.sale_date');

      const sql = `
        SELECT
          COUNT(*) as total_sales,
          SUM(ps.quantity) as total_quantity,
          SUM(ps.total_amount) as total_revenue,
          COALESCE(SUM(ps.quantity * p.cost_price), 0) as total_cost
        FROM product_sales ps
        LEFT JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1${productFilters}
      `;
      const summaryResult = await query(sql, params);
      const summary = summaryResult[0];
      const productSql = `
        SELECT
          ps.product_id,
          p.name as product_name,
          SUM(ps.quantity) as quantity,
          SUM(ps.total_amount) as revenue
        FROM product_sales ps
        LEFT JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1${productFilters}
        GROUP BY ps.product_id, p.name ORDER BY revenue DESC
      `;
      const byProduct = await query(productSql, params);

      return {
        status: 200 as const,
        body: {
          totalSales: parseInt(summary.total_sales) || 0,
          totalQuantity: parseInt(summary.total_quantity) || 0,
          totalRevenue: parseFloat(summary.total_revenue) || 0,
          totalCost: parseFloat(summary.total_cost) || 0,
          totalProfit: (parseFloat(summary.total_revenue) || 0) - (parseFloat(summary.total_cost) || 0),
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
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.SUMMARY_FAILED', 'Failed to generate product sales summary');
    }
  },

  topProducts: async ({ query: queryParams, headers }: { query: { branchId?: string; limit?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
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
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND ps.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'ps.branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
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
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.TOP_PRODUCTS_FAILED', 'Failed to get top products');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const sale = await queryOne(
        `SELECT ps.*, p.name AS product_name,
                NULLIF(TRIM(COALESCE(st.name,'')), '') AS student_name,
                COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.product_sale_id = ps.id), 0) AS total_refunded
         FROM product_sales ps
         LEFT JOIN products p ON ps.product_id = p.id
         LEFT JOIN students st ON ps.student_id = st.id
         WHERE ps.id = $1 AND ps.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!sale) {
        return apiError(404, 'ERRORS.PRODUCT_SALES.NOT_FOUND', 'Product sale not found');
      }

      if (sale.branch_id && !canAccessBranch(context, sale.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCT_SALES.ACCESS_DENIED', 'Access denied to this product sale');
      }

      return {
        status: 200 as const,
        body: mapProductSaleFromDB(sale),
      };
    } catch (error) {
      console.error('Get product sale error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.NOT_FOUND', 'Product sale not found', 404);
    }
  },

  listRefunds: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const sale = await queryOne(
        'SELECT id, branch_id FROM product_sales WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );
      if (!sale) return apiError(404, 'ERRORS.PRODUCT_SALES.NOT_FOUND', 'Product sale not found');
      if (sale.branch_id && !canAccessBranch(context, sale.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCT_SALES.ACCESS_DENIED', 'Access denied to this product sale');
      }
      const refunds = await query(
        'SELECT * FROM refunds WHERE product_sale_id = $1 AND company_id = $2 ORDER BY refund_date ASC',
        [params.id, context.companyId]
      );
      return {
        status: 200 as const,
        body: refunds.map((r: any) => ({
          id: r.id,
          enrollmentId: r.enrollment_id,
          companyId: r.company_id,
          studentId: r.student_id,
          amount: parseFloat(r.amount),
          refundDate: r.refund_date,
          type: r.type,
          reason: r.reason,
          restockQuantity: parseInt(r.restock_quantity) || 0,
          createdAt: r.created_at,
        })),
      };
    } catch (error) {
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.LIST_REFUNDS_FAILED', 'Failed to list refunds');
    }
  },

  createRefund: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    const client = await getClient();
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'refunds', 'write')) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      const sale = (await client.query(
        'SELECT * FROM product_sales WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      )).rows[0];
      if (!sale) { client.release(); return apiError(404, 'ERRORS.PRODUCT_SALES.NOT_FOUND', 'Product sale not found'); }
      if (sale.branch_id && !canAccessBranch(context, sale.branch_id)) {
        client.release();
        return apiError(403, 'ERRORS.PRODUCT_SALES.ACCESS_DENIED', 'Access denied to this product sale');
      }

      const refundAmount = parseFloat(body.amount);
      const total = parseFloat(sale.total_amount);
      const aggregates = (await client.query(
        'SELECT COALESCE(SUM(amount), 0) AS refunded, COALESCE(SUM(restock_quantity), 0) AS restocked FROM refunds WHERE product_sale_id = $1',
        [params.id]
      )).rows[0];
      const alreadyRefunded = parseFloat(aggregates?.refunded || 0);
      const alreadyRestocked = parseInt(aggregates?.restocked || 0);
      const remaining = total - alreadyRefunded;

      if (refundAmount <= 0) {
        client.release();
        return apiError(400, 'ERRORS.PRODUCT_SALES.REFUND_NON_POSITIVE', 'Refund amount must be positive');
      }
      if (refundAmount > remaining) {
        client.release();
        return apiError(400, 'ERRORS.PRODUCT_SALES.REFUND_EXCEEDS_REMAINING', `Cannot refund more than remaining (${remaining.toFixed(2)})`);
      }

      // Optional restock: add the returned units back to inventory. Capped so
      // cumulative restocks across all refunds never exceed the sale quantity.
      const restockQuantity = Math.max(0, parseInt(body.restockQuantity || 0) || 0);
      const restockableLeft = parseInt(sale.quantity) - alreadyRestocked;
      if (restockQuantity > restockableLeft) {
        client.release();
        return apiError(400, 'ERRORS.PRODUCT_SALES.RESTOCK_EXCEEDS_QUANTITY', `Cannot return more than ${restockableLeft} unit(s) to inventory`);
      }

      await client.query('BEGIN');

      const refundResult = await client.query(
        `INSERT INTO refunds (product_sale_id, company_id, amount, refund_date, type, reason, restock_quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [params.id, context.companyId, refundAmount, body.refundDate, body.type, body.reason || null, restockQuantity]
      );
      const refund = refundResult.rows[0];

      if (restockQuantity > 0) {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2 AND company_id = $3',
          [restockQuantity, sale.product_id, context.companyId]
        );
      }

      await client.query('COMMIT');

      return {
        status: 201 as const,
        body: {
          id: refund.id,
          enrollmentId: refund.enrollment_id,
          companyId: refund.company_id,
          studentId: refund.student_id,
          amount: parseFloat(refund.amount),
          refundDate: refund.refund_date,
          type: refund.type,
          reason: refund.reason,
          restockQuantity: parseInt(refund.restock_quantity) || 0,
          createdAt: refund.created_at,
        },
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});
      return mapThrownError(error, 'ERRORS.PRODUCT_SALES.CREATE_REFUND_FAILED', 'Failed to create refund', 400);
    } finally {
      client.release();
    }
  },
};
