import { query, queryOne } from '../db/connection';
import { extractTenantContext, checkGranularPermission, canAccessBranch, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

// Students counted as "enrolled" for the books roster: everything except dropped.
const ENROLLED_STATUSES = "('ACTIVE','COMPLETED','PENDING')";

export const educationalBooksRoutes = {
  /** GET /api/educational-books/courses — courses that have ≥1 linked product, with counts. */
  courses: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];
      // Branch scope on the course; global (NULL branch) courses are always visible.
      const branchClause = appendBranchSqlFilter(context, params, 'c.branch_id');
      const branchSql = branchClause ? ` AND (c.branch_id IS NULL OR ${branchClause})` : '';

      const rows = await query(
        `SELECT
           c.id            AS course_id,
           c.name          AS course_name,
           c.code          AS course_code,
           c.branch_id     AS branch_id,
           b.name          AS branch_name,
           COUNT(DISTINCT cp.id)                                          AS linked_product_count,
           COUNT(DISTINCT e.student_id)                                   AS enrolled_count,
           COUNT(DISTINCT (e.student_id::text || ':' || cp.product_id::text))         AS total_pairs,
           COUNT(DISTINCT CASE WHEN ps.id IS NOT NULL
                               THEN (e.student_id::text || ':' || cp.product_id::text) END) AS bought_pairs
         FROM course_products cp
         JOIN courses c ON cp.course_id = c.id
         LEFT JOIN branches b ON c.branch_id = b.id
         LEFT JOIN enrollments e
           ON e.course_id = c.id AND e.company_id = cp.company_id AND e.status IN ${ENROLLED_STATUSES}
         LEFT JOIN LATERAL (
           SELECT s.id FROM product_sales s
           WHERE s.course_id = c.id AND s.product_id = cp.product_id AND s.student_id = e.student_id
             AND s.company_id = cp.company_id
             AND (s.total_amount - COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.product_sale_id = s.id), 0)) > 0
           LIMIT 1
         ) ps ON true
         WHERE cp.company_id = $1${branchSql}
         GROUP BY c.id, c.name, c.code, c.branch_id, b.name
         ORDER BY c.name ASC`,
        params
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => {
          const totalPairs = parseInt(r.total_pairs) || 0;
          const boughtPairs = parseInt(r.bought_pairs) || 0;
          return {
            courseId: r.course_id,
            courseName: r.course_name,
            courseCode: r.course_code,
            branchId: r.branch_id || null,
            branchName: r.branch_name || null,
            linkedProductCount: parseInt(r.linked_product_count) || 0,
            enrolledCount: parseInt(r.enrolled_count) || 0,
            boughtCount: boughtPairs,
            notBoughtCount: Math.max(0, totalPairs - boughtPairs),
          };
        }),
      };
    } catch (error) {
      console.error('Educational books courses error:', error);
      return mapThrownError(error, 'ERRORS.EDUCATIONAL_BOOKS.COURSES_FAILED', 'Failed to load courses');
    }
  },

  /** GET /api/educational-books/course/:courseId — per linked product, who bought / who didn't. */
  courseDetail: async ({ params, headers }: { params: { courseId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'product_sales', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const course = await queryOne<any>(
        'SELECT id, name, code, branch_id FROM courses WHERE id = $1 AND company_id = $2',
        [params.courseId, context.companyId]
      );
      if (!course) return apiError(404, 'ERRORS.EDUCATIONAL_BOOKS.COURSE_NOT_FOUND', 'Course not found');
      if (course.branch_id && !canAccessBranch(context, course.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const linked = await query(
        `SELECT cp.id AS course_product_id, cp.product_id, cp.is_required,
                cp.default_discount_type, cp.default_discount_value,
                p.name AS product_name, p.code AS product_code, p.selling_price, p.stock
         FROM course_products cp
         JOIN products p ON cp.product_id = p.id
         WHERE cp.course_id = $1 AND cp.company_id = $2
         ORDER BY cp.added_at DESC`,
        [params.courseId, context.companyId]
      );

      // Enrolled roster (one row per student, keep an enrollment id for the buy action).
      const roster = await query(
        `SELECT DISTINCT ON (e.student_id)
                e.student_id, e.id AS enrollment_id,
                NULLIF(TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')), '') AS student_name
         FROM enrollments e
         JOIN students s ON e.student_id = s.id
         WHERE e.course_id = $1 AND e.company_id = $2 AND e.status IN ${ENROLLED_STATUSES}
         ORDER BY e.student_id, e.enrollment_date DESC`,
        [params.courseId, context.companyId]
      );

      // All attributed, not-fully-refunded sales for this course.
      const sales = await query(
        `SELECT ps.id, ps.product_id, ps.student_id, ps.quantity, ps.total_amount, ps.sale_date,
                COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.product_sale_id = ps.id), 0) AS total_refunded
         FROM product_sales ps
         WHERE ps.course_id = $1 AND ps.company_id = $2 AND ps.student_id IS NOT NULL`,
        [params.courseId, context.companyId]
      );
      const saleByKey = new Map<string, any>();
      for (const s of sales) {
        if ((parseFloat(s.total_amount) - parseFloat(s.total_refunded || 0)) <= 0) continue;
        saleByKey.set(`${s.product_id}:${s.student_id}`, s);
      }

      const products = linked.map((lp: any) => {
        const buyers: any[] = [];
        const nonBuyers: any[] = [];
        for (const r of roster) {
          const sale = saleByKey.get(`${lp.product_id}:${r.student_id}`);
          if (sale) {
            buyers.push({
              studentId: r.student_id,
              studentName: r.student_name,
              saleId: sale.id,
              quantity: parseInt(sale.quantity),
              totalAmount: parseFloat(sale.total_amount),
              saleDate: sale.sale_date,
            });
          } else {
            nonBuyers.push({
              studentId: r.student_id,
              studentName: r.student_name,
              enrollmentId: r.enrollment_id,
            });
          }
        }
        return {
          courseProductId: lp.course_product_id,
          productId: lp.product_id,
          productName: lp.product_name,
          productCode: lp.product_code,
          sellingPrice: parseFloat(lp.selling_price || 0),
          stock: parseInt(lp.stock) || 0,
          isRequired: lp.is_required,
          defaultDiscountType: lp.default_discount_type || 'NONE',
          defaultDiscountValue: parseFloat(lp.default_discount_value || 0),
          buyers,
          nonBuyers,
        };
      });

      return {
        status: 200 as const,
        body: {
          courseId: course.id,
          courseName: course.name,
          courseCode: course.code,
          branchId: course.branch_id || null,
          enrolledCount: roster.length,
          products,
        },
      };
    } catch (error) {
      console.error('Educational books course detail error:', error);
      return mapThrownError(error, 'ERRORS.EDUCATIONAL_BOOKS.DETAIL_FAILED', 'Failed to load course books');
    }
  },
};
