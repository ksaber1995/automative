import { insert, update, findById, query, queryOne, getClient } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapProductFromDB(row: any) {
  const mapped: any = {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    code: row.code,
    description: row.description,
    category: row.category,
    costPrice: parseFloat(row.cost_price),
    sellingPrice: parseFloat(row.selling_price),
    stock: parseInt(row.stock) || 0,
    minStock: parseInt(row.min_stock) || 0,
    unit: row.unit,
    branchId: row.branch_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.total_sold !== undefined) {
    mapped.totalSold = parseInt(row.total_sold) || 0;
  }
  return mapped;
}

export const productsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    const client = await getClient();
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'write')) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (!body.branchId || !canAccessBranch(context, body.branchId)) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      await client.query('BEGIN');

      const productResult = await client.query(
        `INSERT INTO products (company_id, name, code, description, category, cost_price, selling_price, stock, min_stock, unit, branch_id, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING *`,
        [
          context.companyId, body.name, body.code, body.description, body.category,
          body.costPrice, body.sellingPrice, body.stock, body.minStock, body.unit,
          body.branchId,
        ]
      );
      const product = productResult.rows[0];

      if (body.recordStockExpense && body.stock > 0) {
        const totalCost = parseFloat(body.costPrice) * body.stock;
        const purchaseDate = body.purchaseDate || new Date().toISOString().split('T')[0];
        const description = `Stock purchase: ${body.name} × ${body.stock} units @ ${body.costPrice}`;
        const expenseResult = await client.query(
          `INSERT INTO expenses (company_id, branch_id, type, category, amount, description, date, product_id)
           VALUES ($1,$2,'VARIABLE','INVENTORY',$3,$4,$5,$6) RETURNING id`,
          [
            context.companyId,
            body.branchId,
            totalCost,
            description,
            purchaseDate,
            product.id,
          ]
        );
        // Settle the expense immediately so cash reflects the outflow.
        await client.query(
          `INSERT INTO expense_payments (company_id, expense_id, branch_id, type, category, amount, date, notes)
           VALUES ($1,$2,$3,'VARIABLE','INVENTORY',$4,$5,$6)`,
          [
            context.companyId,
            expenseResult.rows[0].id,
            body.branchId,
            totalCost,
            purchaseDate,
            description,
          ]
        );
      }

      await client.query('COMMIT');

      return {
        status: 201 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Create product error:', error);
      if (error?.code === '23505') {
        return apiError(400, 'ERRORS.PRODUCTS.CODE_TAKEN', 'A product with this code already exists in this branch.');
      }
      return mapThrownError(error, 'ERRORS.PRODUCTS.CREATE_FAILED', 'Failed to create product', 400);
    } finally {
      client.release();
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `SELECT products.*,
                        COALESCE((SELECT SUM(ps.quantity) FROM product_sales ps WHERE ps.product_id = products.id), 0) AS total_sold
                 FROM products
                 WHERE company_id = $1 AND is_active = true`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY created_at DESC';

      const products = await query(sql, params);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('List products error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.LIST_FAILED', 'Failed to list products');
    }
  },

  getAvailable: async ({ params, headers }: { params: { branchId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (!canAccessBranch(context, params.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const sql = `
        SELECT * FROM products
        WHERE company_id = $1
        AND is_active = true
        AND stock > 0
        AND branch_id = $2
        ORDER BY name ASC
      `;

      const products = await query(sql, [context.companyId, params.branchId]);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get available products error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.AVAILABLE_FAILED', 'Failed to get available products');
    }
  },

  getLowStock: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `
        SELECT * FROM products
        WHERE company_id = $1
        AND is_active = true
        AND stock <= min_stock
      `;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'branch_id');
        if (branchClause) sql += ` AND ${branchClause}`;
      }

      sql += ' ORDER BY stock ASC';

      const products = await query(sql, params);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get low stock products error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.LOW_STOCK_FAILED', 'Failed to get low stock products');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const product = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!product) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      if (product.branch_id && !canAccessBranch(context, product.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCTS.ACCESS_DENIED', 'Access denied to this product');
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Get product error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCTS.ACCESS_DENIED_UPDATE', 'Access denied to update this product');
      }

      const updateData: any = {};

      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.costPrice !== undefined) updateData.cost_price = body.costPrice;
      if (body.sellingPrice !== undefined) updateData.selling_price = body.sellingPrice;
      if (body.stock !== undefined) updateData.stock = body.stock;
      if (body.minStock !== undefined) updateData.min_stock = body.minStock;
      if (body.unit !== undefined) updateData.unit = body.unit;
      if (body.isActive !== undefined) updateData.is_active = body.isActive;

      const product = await update('products', params.id, updateData);

      if (!product) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Update product error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.UPDATE_FAILED', 'Failed to update product', 404);
    }
  },

  adjustStock: async ({ params, body, headers }: { params: { id: string }; body: { quantity: number; operation: 'add' | 'subtract' }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const product = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!product) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      if (product.branch_id && !canAccessBranch(context, product.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCTS.ACCESS_DENIED_ADJUST', 'Access denied to adjust this product stock');
      }

      const currentStock = parseInt(product.stock) || 0;
      let newStock: number;

      if (body.operation === 'add') {
        newStock = currentStock + body.quantity;
      } else if (body.operation === 'subtract') {
        newStock = Math.max(0, currentStock - body.quantity);
      } else {
        return apiError(400, 'ERRORS.PRODUCTS.INVALID_OPERATION', 'Invalid operation. Must be "add" or "subtract"');
      }

      const updatedProduct = await update('products', params.id, { stock: newStock });

      if (!updatedProduct) {
        return apiError(404, 'ERRORS.PRODUCTS.STOCK_UPDATE_FAILED', 'Failed to update product stock');
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(updatedProduct),
      };
    } catch (error) {
      console.error('Adjust product stock error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.STOCK_ADJUST_FAILED', 'Failed to adjust product stock', 404);
    }
  },

  restock: async ({ params, body, headers }: { params: { id: string }; body: { quantity: number; costPerUnit: number; date?: string; notes?: string }; headers: { authorization: string } }) => {
    const client = await getClient();
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'write')) {
        client.release();
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const product = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2 AND is_active = true',
        [params.id, context.companyId]
      );
      if (!product) {
        client.release();
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }
      if (product.branch_id && !canAccessBranch(context, product.branch_id)) {
        client.release();
        return apiError(403, 'ERRORS.PRODUCTS.ACCESS_DENIED', 'Access denied to this product');
      }

      const quantity = body.quantity;
      const costPerUnit = body.costPerUnit;
      const totalCost = costPerUnit * quantity;
      const date = body.date || new Date().toISOString().split('T')[0];
      const newStock = (parseInt(product.stock) || 0) + quantity;

      await client.query('BEGIN');

      await client.query(
        'UPDATE products SET stock = $1, updated_at = NOW() WHERE id = $2',
        [newStock, params.id]
      );

      const expenseResult = await client.query(
        `INSERT INTO expenses (company_id, branch_id, type, category, amount, description, date, product_id)
         VALUES ($1,$2,'VARIABLE','INVENTORY',$3,$4,$5,$6) RETURNING id`,
        [
          context.companyId,
          product.branch_id,
          totalCost,
          `Restock: ${product.name} × ${quantity} units @ ${costPerUnit}`,
          date,
          params.id,
        ]
      );

      await client.query(
        `INSERT INTO stock_purchases (company_id, product_id, quantity, cost_per_unit, total_cost, date, notes, expense_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          context.companyId,
          params.id,
          quantity,
          costPerUnit,
          totalCost,
          date,
          body.notes || null,
          expenseResult.rows[0].id,
        ]
      );

      await client.query('COMMIT');

      const updated = await queryOne('SELECT * FROM products WHERE id = $1', [params.id]);
      return { status: 200 as const, body: mapProductFromDB(updated) };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Restock product error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.RESTOCK_FAILED', 'Failed to restock product', 400);
    } finally {
      client.release();
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'products', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.PRODUCTS.ACCESS_DENIED_DELETE', 'Access denied to delete this product');
      }

      const product = await update('products', params.id, { is_active: false });

      if (!product) {
        return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');
      }

      return {
        status: 200 as const,
        body: { message: 'Product deleted successfully', code: 'PRODUCTS.DELETED' },
      };
    } catch (error) {
      console.error('Delete product error:', error);
      return mapThrownError(error, 'ERRORS.PRODUCTS.DELETE_FAILED', 'Failed to delete product', 404);
    }
  },
};
