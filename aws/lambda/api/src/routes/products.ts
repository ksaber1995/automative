import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch } from '../middleware/tenant-isolation';

function mapProductFromDB(row: any) {
  return {
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
    isGlobal: row.is_global,
    branchId: row.branch_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const productsRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (body.branchId && !body.isGlobal && !canAccessBranch(context, body.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const product = await insert('products', {
        company_id: context.companyId,
        name: body.name,
        code: body.code,
        description: body.description,
        category: body.category,
        cost_price: body.costPrice,
        selling_price: body.sellingPrice,
        stock: body.stock,
        min_stock: body.minStock,
        unit: body.unit,
        is_global: body.isGlobal,
        branch_id: body.isGlobal ? null : body.branchId,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Create product error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 400,
        body: { message: error.message || 'Failed to create product' },
      };
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = 'SELECT * FROM products WHERE company_id = $1';
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return {
            status: 403 as const,
            body: { message: 'Access denied to this branch' },
          };
        }
        params.push(queryParams.branchId);
        sql += ` AND (branch_id = $${params.length} OR is_global = true)`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND (branch_id = $${params.length} OR is_global = true)`;
      }

      sql += ' ORDER BY created_at DESC';

      const products = await query(sql, params);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('List products error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to list products' },
      };
    }
  },

  getAvailable: async ({ params, headers }: { params: { branchId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      if (!canAccessBranch(context, params.branchId)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this branch' },
        };
      }

      const sql = `
        SELECT * FROM products
        WHERE company_id = $1
        AND is_active = true
        AND stock > 0
        AND (branch_id = $2 OR is_global = true)
        ORDER BY name ASC
      `;

      const products = await query(sql, [context.companyId, params.branchId]);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get available products error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get available products' },
      };
    }
  },

  getLowStock: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      let sql = `
        SELECT * FROM products
        WHERE company_id = $1
        AND is_active = true
        AND stock <= min_stock
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
        sql += ` AND (branch_id = $${params.length} OR is_global = true)`;
      } else if (context.role !== 'ADMIN' && context.branchId) {
        params.push(context.branchId);
        sql += ` AND (branch_id = $${params.length} OR is_global = true)`;
      }

      sql += ' ORDER BY stock ASC';

      const products = await query(sql, params);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get low stock products error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 500,
        body: { message: error.message || 'Failed to get low stock products' },
      };
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const product = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!product) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      if (product.branch_id && !canAccessBranch(context, product.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to this product' },
        };
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Get product error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Product not found' },
      };
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to update this product' },
        };
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
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Update product error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to update product' },
      };
    }
  },

  adjustStock: async ({ params, body, headers }: { params: { id: string }; body: { quantity: number; operation: 'add' | 'subtract' }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const product = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!product) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      if (product.branch_id && !canAccessBranch(context, product.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to adjust this product stock' },
        };
      }

      const currentStock = parseInt(product.stock) || 0;
      let newStock: number;

      if (body.operation === 'add') {
        newStock = currentStock + body.quantity;
      } else if (body.operation === 'subtract') {
        newStock = Math.max(0, currentStock - body.quantity);
      } else {
        return {
          status: 400 as const,
          body: { message: 'Invalid operation. Must be "add" or "subtract"' },
        };
      }

      const updatedProduct = await update('products', params.id, { stock: newStock });

      if (!updatedProduct) {
        return {
          status: 404 as const,
          body: { message: 'Failed to update product stock' },
        };
      }

      return {
        status: 200 as const,
        body: mapProductFromDB(updatedProduct),
      };
    } catch (error) {
      console.error('Adjust product stock error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to adjust product stock' },
      };
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);

      const existing = await queryOne(
        'SELECT * FROM products WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return {
          status: 403 as const,
          body: { message: 'Access denied to delete this product' },
        };
      }

      const product = await update('products', params.id, { is_active: false });

      if (!product) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      return {
        status: 200 as const,
        body: { message: 'Product deleted successfully' },
      };
    } catch (error) {
      console.error('Delete product error:', error);
      return {
        status: error.message === 'No authentication token provided' ? 401 : 404,
        body: { message: error.message || 'Failed to delete product' },
      };
    }
  },
};
