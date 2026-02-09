import { insert, update, findById, query } from '../db/connection';

function mapProductFromDB(row: any) {
  return {
    id: row.id,
    branchId: row.branch_id,
    name: row.name,
    code: row.code,
    description: row.description,
    price: parseFloat(row.price),
    cost: row.cost ? parseFloat(row.cost) : null,
    stockQuantity: parseInt(row.stock_quantity) || 0,
    minStockLevel: row.min_stock_level ? parseInt(row.min_stock_level) : null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const productsRoutes = {
  create: async ({ body }: { body: any }) => {
    try {
      const product = await insert('products', {
        branch_id: body.branchId,
        name: body.name,
        code: body.code || null,
        description: body.description || null,
        price: body.price,
        cost: body.cost || null,
        stock_quantity: body.stockQuantity || 0,
        min_stock_level: body.minStockLevel || null,
        is_active: true,
      });

      return {
        status: 201 as const,
        body: mapProductFromDB(product),
      };
    } catch (error) {
      console.error('Create product error:', error);
      return {
        status: 400 as const,
        body: { message: 'Failed to create product' },
      };
    }
  },

  list: async ({ query: queryParams }: { query: { branchId?: string } }) => {
    try {
      let sql = 'SELECT * FROM products WHERE 1=1';
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
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
        status: 200 as const,
        body: [],
      };
    }
  },

  getAvailable: async ({ params }: { params: { branchId: string } }) => {
    try {
      // Get products that are active and have stock > 0 for this branch
      const sql = `
        SELECT * FROM products
        WHERE is_active = true
        AND stock_quantity > 0
        AND branch_id = $1
        ORDER BY name ASC
      `;

      const products = await query(sql, [params.branchId]);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get available products error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getLowStock: async ({ query: queryParams }: { query: { branchId?: string } }) => {
    try {
      // Get products where stock is below minimum stock level
      let sql = `
        SELECT * FROM products
        WHERE is_active = true
        AND min_stock_level IS NOT NULL
        AND stock_quantity <= min_stock_level
      `;
      const params: any[] = [];

      if (queryParams.branchId) {
        params.push(queryParams.branchId);
        sql += ` AND branch_id = $${params.length}`;
      }

      sql += ' ORDER BY stock_quantity ASC';

      const products = await query(sql, params);
      return {
        status: 200 as const,
        body: products.map(mapProductFromDB),
      };
    } catch (error) {
      console.error('Get low stock products error:', error);
      return {
        status: 200 as const,
        body: [],
      };
    }
  },

  getById: async ({ params }: { params: { id: string } }) => {
    try {
      const product = await findById('products', params.id);

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
      console.error('Get product error:', error);
      return {
        status: 404 as const,
        body: { message: 'Product not found' },
      };
    }
  },

  update: async ({ params, body }: { params: { id: string }; body: any }) => {
    try {
      const updateData: any = {};

      if (body.branchId !== undefined) updateData.branch_id = body.branchId;
      if (body.name !== undefined) updateData.name = body.name;
      if (body.code !== undefined) updateData.code = body.code;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.price !== undefined) updateData.price = body.price;
      if (body.cost !== undefined) updateData.cost = body.cost;
      if (body.stockQuantity !== undefined) updateData.stock_quantity = body.stockQuantity;
      if (body.minStockLevel !== undefined) updateData.min_stock_level = body.minStockLevel;

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
        status: 404 as const,
        body: { message: 'Failed to update product' },
      };
    }
  },

  adjustStock: async ({ params, body }: { params: { id: string }; body: { quantity: number; operation: 'add' | 'subtract' } }) => {
    try {
      // Get current product
      const product = await findById('products', params.id);

      if (!product) {
        return {
          status: 404 as const,
          body: { message: 'Product not found' },
        };
      }

      const currentStock = parseInt(product.stock_quantity) || 0;
      let newStock: number;

      if (body.operation === 'add') {
        newStock = currentStock + body.quantity;
      } else if (body.operation === 'subtract') {
        newStock = Math.max(0, currentStock - body.quantity); // Don't go below 0
      } else {
        return {
          status: 400 as const,
          body: { message: 'Invalid operation. Must be "add" or "subtract"' },
        };
      }

      // Update stock
      const updatedProduct = await update('products', params.id, { stock_quantity: newStock });

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
        status: 404 as const,
        body: { message: 'Failed to adjust product stock' },
      };
    }
  },

  delete: async ({ params }: { params: { id: string } }) => {
    try {
      // Soft delete by setting is_active to false
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
        status: 404 as const,
        body: { message: 'Failed to delete product' },
      };
    }
  },
};
