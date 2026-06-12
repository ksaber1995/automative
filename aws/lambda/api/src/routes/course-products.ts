import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

function mapCourseProductFromDB(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    courseId: row.course_id,
    productId: row.product_id,
    isRequired: row.is_required,
    defaultDiscountType: row.default_discount_type || 'NONE',
    defaultDiscountValue: parseFloat(row.default_discount_value || 0),
    addedAt: row.added_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // joined product fields (present on list)
    productName: row.product_name ?? undefined,
    productCode: row.product_code ?? undefined,
    sellingPrice: row.selling_price !== undefined && row.selling_price !== null ? parseFloat(row.selling_price) : undefined,
    stock: row.stock !== undefined && row.stock !== null ? parseInt(row.stock) : undefined,
  };
}

export const courseProductsRoutes = {
  /** GET /api/course-products?courseId= — products linked to a course. */
  list: async ({ query: q, headers }: { query: { courseId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const conditions: string[] = ['cp.company_id = $1'];
      const params: any[] = [context.companyId];
      if (q.courseId) {
        params.push(q.courseId);
        conditions.push(`cp.course_id = $${params.length}`);
      }

      const rows = await query(
        `SELECT cp.*, p.name AS product_name, p.code AS product_code, p.selling_price, p.stock
         FROM course_products cp
         JOIN products p ON cp.product_id = p.id
         WHERE ${conditions.join(' AND ')}
         ORDER BY cp.added_at DESC`,
        params
      );
      return { status: 200 as const, body: rows.map(mapCourseProductFromDB) };
    } catch (error) {
      console.error('List course products error:', error);
      return mapThrownError(error, 'ERRORS.COURSE_PRODUCTS.LIST_FAILED', 'Failed to list course products');
    }
  },

  /** POST /api/course-products — link a product to a course (also the mid-course add). Upsert. */
  link: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      // Both course and product must belong to the caller's company.
      const course = await queryOne('SELECT id FROM courses WHERE id = $1 AND company_id = $2', [body.courseId, context.companyId]);
      if (!course) return apiError(404, 'ERRORS.COURSE_PRODUCTS.COURSE_NOT_FOUND', 'Course not found');
      const product = await queryOne('SELECT id FROM products WHERE id = $1 AND company_id = $2', [body.productId, context.companyId]);
      if (!product) return apiError(404, 'ERRORS.PRODUCTS.NOT_FOUND', 'Product not found');

      const row = await queryOne(
        `INSERT INTO course_products (company_id, course_id, product_id, is_required, default_discount_type, default_discount_value)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (course_id, product_id)
         DO UPDATE SET is_required = EXCLUDED.is_required,
                       default_discount_type = EXCLUDED.default_discount_type,
                       default_discount_value = EXCLUDED.default_discount_value,
                       updated_at = NOW()
         RETURNING *`,
        [context.companyId, body.courseId, body.productId,
         body.isRequired ?? true, body.defaultDiscountType || 'NONE', body.defaultDiscountValue || 0]
      );
      return { status: 201 as const, body: mapCourseProductFromDB(row) };
    } catch (error) {
      console.error('Link course product error:', error);
      return mapThrownError(error, 'ERRORS.COURSE_PRODUCTS.LINK_FAILED', 'Failed to link product to course', 400);
    }
  },

  /** PATCH /api/course-products/:id — toggle required / change default discount. */
  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne('SELECT * FROM course_products WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.COURSE_PRODUCTS.NOT_FOUND', 'Course product link not found');

      const row = await queryOne(
        `UPDATE course_products
         SET is_required = COALESCE($1, is_required),
             default_discount_type = COALESCE($2, default_discount_type),
             default_discount_value = COALESCE($3, default_discount_value),
             updated_at = NOW()
         WHERE id = $4 AND company_id = $5 RETURNING *`,
        [body.isRequired ?? null, body.defaultDiscountType ?? null, body.defaultDiscountValue ?? null, params.id, context.companyId]
      );
      return { status: 200 as const, body: mapCourseProductFromDB(row) };
    } catch (error) {
      console.error('Update course product error:', error);
      return mapThrownError(error, 'ERRORS.COURSE_PRODUCTS.UPDATE_FAILED', 'Failed to update course product', 400);
    }
  },

  /** DELETE /api/course-products/:id — unlink. */
  unlink: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'academy', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne('SELECT id FROM course_products WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      if (!existing) return apiError(404, 'ERRORS.COURSE_PRODUCTS.NOT_FOUND', 'Course product link not found');

      await query('DELETE FROM course_products WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);
      return { status: 200 as const, body: { message: 'Unlinked', code: 'COURSE_PRODUCTS.UNLINKED' } };
    } catch (error) {
      console.error('Unlink course product error:', error);
      return mapThrownError(error, 'ERRORS.COURSE_PRODUCTS.UNLINK_FAILED', 'Failed to unlink product', 400);
    }
  },
};
