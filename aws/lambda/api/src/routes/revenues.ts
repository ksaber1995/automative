import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch, isGlobalAdmin, checkGranularPermission, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensurePerSessionSchema } from './session-payments';
import { ensureMonthlyInstallmentLedger } from '../db/payment-ledger';

/** The revenue streams the list and the summary agree on. */
const REVENUE_SOURCES = [
  'ENROLLMENT',
  'PRODUCT_SALE',
  'MASTER_ENROLLMENT',
  'EVENT',
  'SUBSCRIPTION',
  'SESSION',
] as const;
type RevenueSourceKey = (typeof REVENUE_SOURCES)[number];

/**
 * Which refunds belong to each source.
 *
 * The refunds table is polymorphic and a refund names EVERY level it touches —
 * a monthly-subscription refund carries the enrollment it belongs to as well as
 * the bill (verified in prod: every subscription refund has enrollment_id set
 * too). So ENROLLMENT has to exclude the rows a more specific key claims, or
 * subscription and per-session money would be given back twice: once from its
 * own source and again from course revenue.
 */
const REFUND_SOURCE_MATCH: Record<RevenueSourceKey, string> = {
  ENROLLMENT:
    'r.enrollment_id IS NOT NULL AND r.monthly_payment_id IS NULL AND r.session_payment_id IS NULL AND r.session_package_id IS NULL',
  MASTER_ENROLLMENT: 'r.master_enrollment_id IS NOT NULL',
  PRODUCT_SALE: 'r.product_sale_id IS NOT NULL',
  EVENT: 'r.subscription_id IS NOT NULL',
  SUBSCRIPTION: 'r.monthly_payment_id IS NOT NULL',
  SESSION: '(r.session_payment_id IS NOT NULL OR r.session_package_id IS NOT NULL)',
};

export const revenuesRoutes = {
  list: async ({ query: queryParams, headers }: {
    query: {
      branchId?: string;
      source?: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'SUBSCRIPTION' | 'SESSION' | 'ALL';
      startDate?: string;
      endDate?: string;
    };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      // session_packages / session_payments and the two installment ledgers are
      // created lazily — make sure they exist before the UNION below references them.
      await ensurePerSessionSchema();
      await ensureMonthlyInstallmentLedger();

      if (!checkGranularPermission(context, 'revenues', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];

      // Unified revenue list: UNION ALL over enrollments, product sales, and
      // master course bundle enrollments. Each branch emits the same columns.
      const includeEnrollments = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'ENROLLMENT';
      const includeProducts = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'PRODUCT_SALE';
      const includeMasters = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'MASTER_ENROLLMENT';
      const includeEvents = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'EVENT';
      const includeSubscriptions = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'SUBSCRIPTION';
      const includeSessions = !queryParams.source || queryParams.source === 'ALL' || queryParams.source === 'SESSION';

      // Shared filters — push once, reuse positional index for every branch.
      // Sentinel value "NULL" means "company-level only" (no branch_id) — only
      // global admins / accountants are allowed to see this slice.
      const companyLevelOnly = queryParams.branchId === 'NULL';
      // branchTemplate is an SQL fragment with a `__COL__` placeholder for the
      // per-table branch column; we substitute it (e.g. `e.branch_id`) per
      // query below so a multi-branch user gets one IN(...) clause that
      // reuses the same param placeholders across every source SELECT.
      let branchTemplate: string | null = null;
      if (companyLevelOnly) {
        if (!isGlobalAdmin(context)) {
          return apiError(403, 'ERRORS.REVENUES.GLOBAL_ADMIN_ONLY_COMPANY_LEVEL', 'Only Global Admins can view company-level revenue');
        }
      } else if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        branchTemplate = `__COL__ = $${params.length}`;
      } else {
        const clause = appendBranchSqlFilter(context, params, '__COL__');
        if (clause) branchTemplate = clause;
      }
      const applyBranch = (col: string) => branchTemplate ? branchTemplate.replace(/__COL__/g, col) : null;
      let startIdx: number | null = null;
      if (queryParams.startDate) { params.push(queryParams.startDate); startIdx = params.length; }
      let endIdx: number | null = null;
      if (queryParams.endDate) { params.push(queryParams.endDate); endIdx = params.length; }

      const parts: string[] = [];

      // Company-level (branch_id IS NULL) revenue can only come from product_sales —
      // enrollments and master_enrollments have NOT NULL branch_id.
      if (includeEnrollments && !companyLevelOnly) {
        let sql = `SELECT
          'ENROLLMENT' as source,
          e.id as source_id,
          e.company_id,
          e.branch_id,
          b.name as branch_name,
          e.amount_paid as amount,
          COALESCE(e.total_refunded, 0) as total_refunded,
          CONCAT('Enrollment: ', s.name, ' - ', c.name) as description,
          e.enrollment_date as date,
          e.payment_status,
          NULL::text as payment_method,
          s.name as student_name,
          c.name as course_name,
          NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') as teacher_name,
          NULL::text as product_name,
          e.student_id as student_id,
          e.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM enrollments e
        JOIN branches b ON e.branch_id = b.id
        JOIN students s ON e.student_id = s.id
        JOIN courses c ON e.course_id = c.id
        LEFT JOIN classes cle ON cle.id = e.class_id
        LEFT JOIN employees emp ON emp.id = COALESCE(cle.instructor_id, c.instructor_id)
        WHERE e.company_id = $1 AND e.payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')`;
        const b = applyBranch('e.branch_id');
        if (b) sql += ` AND ${b}`;
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
          COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.product_sale_id = ps.id), 0) as total_refunded,
          CONCAT('Product Sale: ', p.name, ' (', ps.quantity, ' units)') as description,
          ps.sale_date as date,
          'PAID' as payment_status,
          ps.payment_method,
          ps.customer_name as student_name,
          NULL::text as course_name,
          NULL::text as teacher_name,
          p.name as product_name,
          NULL::uuid as student_id,
          ps.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM product_sales ps
        LEFT JOIN branches b ON ps.branch_id = b.id
        JOIN products p ON ps.product_id = p.id
        WHERE ps.company_id = $1`;
        if (companyLevelOnly) sql += ` AND ps.branch_id IS NULL`;
        else {
          const b = applyBranch('ps.branch_id');
          if (b) sql += ` AND ${b}`;
        }
        if (startIdx) sql += ` AND ps.sale_date >= $${startIdx}`;
        if (endIdx) sql += ` AND ps.sale_date <= $${endIdx}`;
        parts.push(sql);
      }

      if (includeMasters && !companyLevelOnly) {
        let sql = `SELECT
          'MASTER_ENROLLMENT' as source,
          me.id as source_id,
          me.company_id,
          me.branch_id,
          b.name as branch_name,
          me.amount_paid as amount,
          COALESCE(me.total_refunded, 0) as total_refunded,
          CONCAT('Bundle: ', s.name, ' - ', mc.name) as description,
          me.enrollment_date as date,
          me.payment_status,
          me.payment_method,
          s.name as student_name,
          mc.name as course_name,
          NULL::text as teacher_name,
          NULL::text as product_name,
          me.student_id as student_id,
          me.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM master_enrollments me
        JOIN branches b ON me.branch_id = b.id
        JOIN students s ON me.student_id = s.id
        JOIN master_courses mc ON me.master_course_id = mc.id
        WHERE me.company_id = $1 AND me.amount_paid > 0`;
        const b = applyBranch('me.branch_id');
        if (b) sql += ` AND ${b}`;
        if (startIdx) sql += ` AND me.enrollment_date >= $${startIdx}`;
        if (endIdx) sql += ` AND me.enrollment_date <= $${endIdx}`;
        parts.push(sql);
      }

      // Event subscriptions can be branch-scoped OR company-level (branch_id NULL),
      // so they appear regardless of companyLevelOnly — filter by branch when set.
      if (includeEvents) {
        let sql = `SELECT
          'EVENT' as source,
          es.id as source_id,
          es.company_id,
          es.branch_id,
          b.name as branch_name,
          es.amount as amount,
          COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.subscription_id = es.id), 0) as total_refunded,
          CONCAT('Event subscription: ', ev.name, ' — ',
            COALESCE(s.name,
                     NULLIF(TRIM(CONCAT(es.external_first_name, ' ', es.external_last_name)), ''),
                     'subscriber')) as description,
          es.payment_date as date,
          'PAID' as payment_status,
          es.payment_method,
          COALESCE(s.name,
                   NULLIF(TRIM(CONCAT(es.external_first_name, ' ', es.external_last_name)), '')) as student_name,
          NULL::text as course_name,
          NULL::text as teacher_name,
          NULL::text as product_name,
          es.student_id,
          es.created_at,
          ev.id as event_id,
          ev.name::text as event_name
        FROM event_subscriptions es
        JOIN events ev ON ev.id = es.event_id
        LEFT JOIN branches b ON es.branch_id = b.id
        LEFT JOIN students s ON s.id = es.student_id
        WHERE es.company_id = $1 AND es.amount > 0`;
        if (companyLevelOnly) sql += ` AND es.branch_id IS NULL`;
        else {
          const b = applyBranch('es.branch_id');
          if (b) sql += ` AND ${b}`;
        }
        if (startIdx) sql += ` AND es.payment_date >= $${startIdx}`;
        if (endIdx) sql += ` AND es.payment_date <= $${endIdx}`;
        // Pad the other branches with NULLs for event_id/event_name columns.
        // We do this by re-projecting each existing part with NULL placeholders.
        parts.push(sql);
      }

      // Monthly subscription money: ONE LINE PER COLLECTION, from the installment
      // ledger, each on the day it was actually taken. Reading the bill's
      // cumulative amount_paid + paid_date instead put the whole amount on the last
      // payment's date — 100 taken last week and 200 today showed as 300 today.
      // branch_id is NOT NULL on these, so they never appear in the company-level slice.
      if (includeSubscriptions && !companyLevelOnly) {
        let sql = `SELECT
          'SUBSCRIPTION' as source,
          msi.id as source_id,
          msi.company_id,
          msi.branch_id,
          b.name as branch_name,
          msi.amount as amount,
          -- A refund is recorded on the parent bill (amount_paid stays gross), so
          -- spread it across that bill's collections in proportion — the same way
          -- session charges do. This used to be a hard-coded 0, so a refunded
          -- subscription payment showed at full value and counted toward the total.
          COALESCE(ROUND(COALESCE(msp.refunded_amount, 0) * msi.amount / NULLIF(msp.amount_paid, 0), 2), 0) as total_refunded,
          CONCAT('Monthly subscription: ', s.name, ' - ', c.name,
            ' (', msp.billing_year, '-', LPAD(msp.billing_month::text, 2, '0'), ')') as description,
          msi.payment_date as date,
          msp.payment_status,
          NULL::text as payment_method,
          s.name as student_name,
          c.name as course_name,
          NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') as teacher_name,
          NULL::text as product_name,
          msi.student_id as student_id,
          msi.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM monthly_subscription_installments msi
        JOIN monthly_subscription_payments msp ON msp.id = msi.monthly_payment_id
        JOIN branches b ON msi.branch_id = b.id
        JOIN students s ON msi.student_id = s.id
        JOIN courses c ON msi.course_id = c.id
        LEFT JOIN enrollments em ON em.id = msi.enrollment_id
        LEFT JOIN classes clm ON clm.id = em.class_id
        LEFT JOIN employees emp ON emp.id = COALESCE(clm.instructor_id, c.instructor_id)
        WHERE msi.company_id = $1 AND msi.amount > 0`;
        const b = applyBranch('msi.branch_id');
        if (b) sql += ` AND ${b}`;
        if (startIdx) sql += ` AND msi.payment_date >= $${startIdx}`;
        if (endIdx) sql += ` AND msi.payment_date <= $${endIdx}`;
        parts.push(sql);
      }

      // Per-session money enters through two tables: session_packages (prepaid
      // bundles — amount collected up-front for N sessions) and session_payments
      // (pay-as-you-go charges). COVERED charges carry amount_paid = 0 (their
      // money lives on the package row), so summing both never double-counts.
      // branch_id is NOT NULL on both, so they never appear company-level.
      if (includeSessions && !companyLevelOnly) {
        // Package money also comes from its ledger: the purchase payment and any
        // later top-up are separate lines on the days they were collected, rather
        // than one lump on purchased_at (which a top-up used to grow after the fact).
        let pkgSql = `SELECT
          'SESSION' as source,
          pki.id as source_id,
          pki.company_id,
          pki.branch_id,
          b.name as branch_name,
          pki.amount as amount,
          -- Package refunds live in the refunds table; spread over the package's
          -- collections in proportion so no single line reads as over-refunded.
          COALESCE(ROUND(
            COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.session_package_id = spkg.id), 0)
              * pki.amount / NULLIF(spkg.amount_paid, 0), 2), 0) as total_refunded,
          CONCAT('Session package: ', s.name, ' - ', c.name,
            ' (', spkg.sessions_total, ' sessions)') as description,
          pki.payment_date as date,
          'PAID' as payment_status,
          NULL::text as payment_method,
          s.name as student_name,
          c.name as course_name,
          NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') as teacher_name,
          NULL::text as product_name,
          pki.student_id as student_id,
          pki.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM session_package_installments pki
        JOIN session_packages spkg ON spkg.id = pki.session_package_id
        JOIN branches b ON pki.branch_id = b.id
        JOIN students s ON pki.student_id = s.id
        JOIN courses c ON pki.course_id = c.id
        LEFT JOIN enrollments ep ON ep.id = spkg.enrollment_id
        LEFT JOIN classes clp ON clp.id = ep.class_id
        LEFT JOIN employees emp ON emp.id = COALESCE(clp.instructor_id, c.instructor_id)
        WHERE pki.company_id = $1 AND pki.amount > 0`;
        const bp = applyBranch('pki.branch_id');
        if (bp) pkgSql += ` AND ${bp}`;
        if (startIdx) pkgSql += ` AND pki.payment_date >= $${startIdx}`;
        if (endIdx) pkgSql += ` AND pki.payment_date <= $${endIdx}`;
        parts.push(pkgSql);

        // Charge money, like subscription money, comes from its installment ledger —
        // one line per collection on its own date.
        let spSql = `SELECT
          'SESSION' as source,
          spi.id as source_id,
          spi.company_id,
          spi.branch_id,
          b.name as branch_name,
          spi.amount as amount,
          -- A refund is recorded on the parent charge, so spread it across that
          -- charge's collections in proportion: a half-refunded charge reads as
          -- half-refunded on each of its lines instead of fully on one.
          COALESCE(ROUND(COALESCE(sp.refunded_amount, 0) * spi.amount / NULLIF(sp.amount_paid, 0), 2), 0) as total_refunded,
          CONCAT('Session payment: ', s.name, ' - ', c.name) as description,
          spi.payment_date as date,
          sp.payment_status,
          NULL::text as payment_method,
          s.name as student_name,
          c.name as course_name,
          NULLIF(TRIM(CONCAT(emp.first_name, ' ', emp.last_name)), '') as teacher_name,
          NULL::text as product_name,
          spi.student_id as student_id,
          spi.created_at,
          NULL::uuid as event_id,
          NULL::text as event_name
        FROM session_payment_installments spi
        JOIN session_payments sp ON sp.id = spi.session_payment_id
        JOIN branches b ON spi.branch_id = b.id
        JOIN students s ON spi.student_id = s.id
        JOIN courses c ON spi.course_id = c.id
        LEFT JOIN enrollments es2 ON es2.id = sp.enrollment_id
        LEFT JOIN classes cls ON cls.id = es2.class_id
        LEFT JOIN employees emp ON emp.id = COALESCE(cls.instructor_id, c.instructor_id)
        WHERE spi.company_id = $1 AND spi.amount > 0`;
        const bs = applyBranch('spi.branch_id');
        if (bs) spSql += ` AND ${bs}`;
        if (startIdx) spSql += ` AND spi.payment_date >= $${startIdx}`;
        if (endIdx) spSql += ` AND spi.payment_date <= $${endIdx}`;
        parts.push(spSql);
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
          teacherName: row.teacher_name ?? null,
          productName: row.product_name,
          eventId: row.event_id,
          eventName: row.event_name,
          createdAt: row.created_at,
        })),
      };
    } catch (error) {
      console.error('List revenues error:', error);
      return mapThrownError(error, 'ERRORS.REVENUES.LIST_FAILED', 'Failed to list revenues');
    }
  },

  summary: async ({ query: queryParams, headers }: {
    query: {
      branchId?: string;
      source?: 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'SUBSCRIPTION' | 'SESSION' | 'ALL';
      startDate?: string;
      endDate?: string;
    };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      await ensurePerSessionSchema();
      await ensureMonthlyInstallmentLedger();

      if (!checkGranularPermission(context, 'revenues', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];
      let enrollmentConditions = 'WHERE e.company_id = $1 AND e.payment_status IN (\'PAID\', \'PARTIAL\')';
      let productConditions = 'WHERE ps.company_id = $1';
      // Master enrollments: include any row with cash collected (amount_paid > 0).
      let masterConditions = 'WHERE me.company_id = $1 AND me.amount_paid > 0';
      // Event subscriptions with cash collected (amount > 0).
      let eventConditions = 'WHERE es.company_id = $1 AND es.amount > 0';
      // Monthly subscription money — from the installment ledger, dated per
      // collection. The summary used to leave subscriptions out altogether, so a
      // monthly-billing academy saw a total that was missing most of its income
      // (the revenues LIST has always shown them, which made the two disagree).
      let subscriptionConditions = 'WHERE msi.company_id = $1 AND msi.amount > 0';
      // Per-session money: prepaid packages + pay-as-you-go charges (COVERED
      // charges carry 0, their cash lives on the package row — no double count).
      // Both are read from their installment ledgers (one row per collection,
      // dated when it was taken).
      let pkgConditions = 'WHERE pki.company_id = $1 AND pki.amount > 0';
      let sessionConditions = 'WHERE spi.company_id = $1 AND spi.amount > 0';
      // Money given back. The summary reported GROSS collections — it subtracted
      // nothing — so it disagreed with both the dashboard (which nets refunds
      // globally) and the revenues list (whose rows show their own refunds).
      //
      // The refunds table is polymorphic: one nullable FK per source. A refund is
      // attributed to the branch of whatever it refunds, falling back to its own
      // branch_id — product-sale refunds carry no branch_id of their own, so
      // without the fallback chain they would net out of the company total while
      // appearing on no branch at all (the same trap analytics.ts documents).
      const REFUND_JOINS = `
        FROM refunds r
        LEFT JOIN enrollments er ON r.enrollment_id = er.id
        LEFT JOIN master_enrollments mer ON r.master_enrollment_id = mer.id
        LEFT JOIN product_sales psr ON r.product_sale_id = psr.id
        LEFT JOIN event_subscriptions esr ON r.subscription_id = esr.id`;
      const REFUND_BRANCH = 'COALESCE(er.branch_id, mer.branch_id, psr.branch_id, esr.branch_id, r.branch_id)';
      let refundConditions = 'WHERE r.company_id = $1';

      // ── Source filter ────────────────────────────────────────────────────────
      //
      // The headline has to mean what the page is showing. Filtering the list to
      // one source used to leave the total reading the whole company's income,
      // because `source` never reached this endpoint at all.
      //
      // Each stream is switched OFF with `AND FALSE` rather than by rebuilding
      // the queries: a filtered summary keeps the exact shape of an unfiltered
      // one, so the total, the per-source tiles, the by-month plot and the
      // by-branch split all narrow together and cannot drift apart.
      const source =
        queryParams.source && queryParams.source !== 'ALL' ? queryParams.source : null;
      if (source && !REVENUE_SOURCES.includes(source)) {
        return apiError(400, 'ERRORS.REVENUES.BAD_SOURCE', 'Unknown revenue source');
      }
      /** '' for the selected source (or no filter), ' AND FALSE' for the rest. */
      const off = (s: RevenueSourceKey): string => (source && source !== s ? ' AND FALSE' : '');
      /** Refunds belong to a source too — see REFUND_SOURCE_MATCH. */
      const refundSourceClause = source ? ` AND ${REFUND_SOURCE_MATCH[source]}` : '';

      enrollmentConditions += off('ENROLLMENT');
      productConditions += off('PRODUCT_SALE');
      masterConditions += off('MASTER_ENROLLMENT');
      eventConditions += off('EVENT');
      subscriptionConditions += off('SUBSCRIPTION');
      // Per-session money arrives on two ledgers; both are the SESSION source.
      pkgConditions += off('SESSION');
      sessionConditions += off('SESSION');
      refundConditions += refundSourceClause;

      // Placeholder positions are captured where the value is PUSHED. They used
      // to be recovered further down with params.indexOf(value), which silently
      // collapses when two params hold the same string: a single-day range
      // (startDate === endDate, i.e. the Today preset) made both resolve to the
      // first one, so the by-branch query never referenced $3 while three params
      // were still bound — "bind message supplies 3 parameters, but prepared
      // statement requires 2", and the whole summary 500'd.
      let branchIdx: number | null = null;
      let startIdx: number | null = null;
      let endIdx: number | null = null;
      /** A multi-branch admin's branch filter, as an SQL fragment with a __COL__ hole. */
      let branchTemplate: string | null = null;

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        branchIdx = params.length;
        enrollmentConditions += ` AND e.branch_id = $${params.length}`;
        productConditions += ` AND ps.branch_id = $${params.length}`;
        masterConditions += ` AND me.branch_id = $${params.length}`;
        eventConditions += ` AND es.branch_id = $${params.length}`;
        subscriptionConditions += ` AND msi.branch_id = $${params.length}`;
        pkgConditions += ` AND pki.branch_id = $${params.length}`;
        sessionConditions += ` AND spi.branch_id = $${params.length}`;
        refundConditions += ` AND ${REFUND_BRANCH} = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, '__COL__');
        if (branchClause) {
          // Kept so the by-branch query can reuse these same placeholders.
          branchTemplate = branchClause;
          enrollmentConditions += ` AND ${branchClause.replace(/__COL__/g, 'e.branch_id')}`;
          productConditions += ` AND ${branchClause.replace(/__COL__/g, 'ps.branch_id')}`;
          masterConditions += ` AND ${branchClause.replace(/__COL__/g, 'me.branch_id')}`;
          eventConditions += ` AND ${branchClause.replace(/__COL__/g, 'es.branch_id')}`;
          subscriptionConditions += ` AND ${branchClause.replace(/__COL__/g, 'msi.branch_id')}`;
          pkgConditions += ` AND ${branchClause.replace(/__COL__/g, 'pki.branch_id')}`;
          sessionConditions += ` AND ${branchClause.replace(/__COL__/g, 'spi.branch_id')}`;
          refundConditions += ` AND ${branchClause.replace(/__COL__/g, REFUND_BRANCH)}`;
        }
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        const paramIndex = params.length;
        startIdx = paramIndex;
        enrollmentConditions += ` AND e.enrollment_date >= $${paramIndex}`;
        productConditions += ` AND ps.sale_date >= $${paramIndex}`;
        masterConditions += ` AND me.enrollment_date >= $${paramIndex}`;
        eventConditions += ` AND es.payment_date >= $${paramIndex}`;
        subscriptionConditions += ` AND msi.payment_date >= $${paramIndex}`;
        pkgConditions += ` AND pki.payment_date >= $${paramIndex}`;
        sessionConditions += ` AND spi.payment_date >= $${paramIndex}`;
        refundConditions += ` AND r.refund_date >= $${paramIndex}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        const paramIndex = params.length;
        endIdx = paramIndex;
        enrollmentConditions += ` AND e.enrollment_date <= $${paramIndex}`;
        productConditions += ` AND ps.sale_date <= $${paramIndex}`;
        masterConditions += ` AND me.enrollment_date <= $${paramIndex}`;
        eventConditions += ` AND es.payment_date <= $${paramIndex}`;
        subscriptionConditions += ` AND msi.payment_date <= $${paramIndex}`;
        pkgConditions += ` AND pki.payment_date <= $${paramIndex}`;
        sessionConditions += ` AND spi.payment_date <= $${paramIndex}`;
        refundConditions += ` AND r.refund_date <= $${paramIndex}`;
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

      // Get total revenue from event subscriptions
      const eventRevenueQuery = `
        SELECT COALESCE(SUM(es.amount), 0) as total
        FROM event_subscriptions es
        ${eventConditions}
      `;

      // Get total revenue from monthly subscriptions
      const subscriptionRevenueQuery = `
        SELECT COALESCE(SUM(msi.amount), 0) as total
        FROM monthly_subscription_installments msi
        ${subscriptionConditions}
      `;

      // Get total revenue from per-session money (packages + direct charges)
      const sessionRevenueQuery = `
        SELECT
          COALESCE((SELECT SUM(pki.amount) FROM session_package_installments pki ${pkgConditions}), 0)
          + COALESCE((SELECT SUM(spi.amount) FROM session_payment_installments spi ${sessionConditions}), 0) as total
      `;

      // Money refunded in the window, by refund_date — subtracted from the total
      // and from every breakdown below.
      const refundQuery = `
        SELECT COALESCE(SUM(r.amount), 0) as total
        ${REFUND_JOINS}
        ${refundConditions}
      `;

      // Get revenue by branch (three LEFT JOINs summed).
      // startIdx / endIdx / branchIdx were captured at push time above.
      // For multi-branch admins with no explicit branchId filter, scope the
      // by-branch breakdown to their assigned branches. Push fresh params so
      // we don't have to chase indices through the param array above.
      // Reuses the placeholders pushed above rather than appending a second copy
      // of the same branch list. Pushing again left every OTHER query in this
      // handler bound to params it never referenced, which Postgres rejects
      // outright — so the summary 500'd for any branch-scoped admin.
      const adminBranchClause = !queryParams.branchId && branchTemplate
        ? ` AND ${branchTemplate.replace(/__COL__/g, 'b.id')}`
        : '';

      const byBranchQuery = `
        SELECT
          b.id as branch_id,
          b.name as branch_name,
          COALESCE(enroll.total, 0) + COALESCE(prod.total, 0) + COALESCE(mast.total, 0) + COALESCE(evt.total, 0) + COALESCE(subs.total, 0) + COALESCE(spkg.total, 0) + COALESCE(sess.total, 0) - COALESCE(refs.total, 0) as revenue
        FROM branches b
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) as total
          FROM enrollments
          WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL')${off('ENROLLMENT')}
          ${startIdx ? `AND enrollment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND enrollment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) enroll ON enroll.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(total_amount) as total
          FROM product_sales
          WHERE company_id = $1${off('PRODUCT_SALE')}
          ${startIdx ? `AND sale_date >= $${startIdx}` : ''}
          ${endIdx ? `AND sale_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) prod ON prod.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) as total
          FROM master_enrollments
          WHERE company_id = $1 AND amount_paid > 0${off('MASTER_ENROLLMENT')}
          ${startIdx ? `AND enrollment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND enrollment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) mast ON mast.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) as total
          FROM event_subscriptions
          WHERE company_id = $1 AND amount > 0 AND branch_id IS NOT NULL${off('EVENT')}
          ${startIdx ? `AND payment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND payment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) evt ON evt.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) as total
          FROM monthly_subscription_installments
          WHERE company_id = $1 AND amount > 0${off('SUBSCRIPTION')}
          ${startIdx ? `AND payment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND payment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) subs ON subs.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) as total
          FROM session_package_installments
          WHERE company_id = $1 AND amount > 0${off('SESSION')}
          ${startIdx ? `AND payment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND payment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) spkg ON spkg.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) as total
          FROM session_payment_installments
          WHERE company_id = $1 AND amount > 0${off('SESSION')}
          ${startIdx ? `AND payment_date >= $${startIdx}` : ''}
          ${endIdx ? `AND payment_date <= $${endIdx}` : ''}
          GROUP BY branch_id
        ) sess ON sess.branch_id = b.id
        LEFT JOIN (
          SELECT ${REFUND_BRANCH} as branch_id, SUM(r.amount) as total
          ${REFUND_JOINS}
          WHERE r.company_id = $1${refundSourceClause}
          ${startIdx ? `AND r.refund_date >= $${startIdx}` : ''}
          ${endIdx ? `AND r.refund_date <= $${endIdx}` : ''}
          GROUP BY 1
        ) refs ON refs.branch_id = b.id
        WHERE b.company_id = $1
        ${branchIdx ? `AND b.id = $${branchIdx}` : ''}${adminBranchClause}
        GROUP BY b.id, b.name, enroll.total, prod.total, mast.total, evt.total, subs.total, spkg.total, sess.total, refs.total
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
          UNION ALL
          SELECT es.payment_date as date, es.amount
          FROM event_subscriptions es
          ${eventConditions}
          UNION ALL
          SELECT msi.payment_date as date, msi.amount as amount
          FROM monthly_subscription_installments msi
          ${subscriptionConditions}
          UNION ALL
          SELECT pki.payment_date as date, pki.amount as amount
          FROM session_package_installments pki
          ${pkgConditions}
          UNION ALL
          SELECT spi.payment_date as date, spi.amount as amount
          FROM session_payment_installments spi
          ${sessionConditions}
          UNION ALL
          -- Refunds ride along as negative amounts on their refund_date, so a
          -- month shows what was actually kept.
          SELECT r.refund_date as date, -r.amount as amount
          ${REFUND_JOINS}
          ${refundConditions}
        ) combined
        GROUP BY TO_CHAR(date, 'YYYY-MM')
        ORDER BY month DESC
        LIMIT 12
      `;

      const [enrollmentResult, productResult, masterResult, eventResult, subscriptionResult, sessionResult, refundResult, byBranchResult, byMonthResult] = await Promise.all([
        query(enrollmentRevenueQuery, params),
        query(productRevenueQuery, params),
        query(masterRevenueQuery, params),
        query(eventRevenueQuery, params),
        query(subscriptionRevenueQuery, params),
        query(sessionRevenueQuery, params),
        query(refundQuery, params),
        query(byBranchQuery, params),
        query(byMonthQuery, params),
      ]);

      const enrollmentRevenue = parseFloat(enrollmentResult[0]?.total || 0);
      const productRevenue = parseFloat(productResult[0]?.total || 0);
      const masterRevenue = parseFloat(masterResult[0]?.total || 0);
      const eventRevenue = parseFloat(eventResult[0]?.total || 0);
      const subscriptionRevenue = parseFloat(subscriptionResult[0]?.total || 0);
      const sessionRevenue = parseFloat(sessionResult[0]?.total || 0);
      const totalRefunds = parseFloat(refundResult[0]?.total || 0);

      return {
        status: 200 as const,
        body: {
          // Net of refunds, like the dashboard. The per-source figures stay GROSS
          // (a refund is not attributable to one source without double work), so
          // they sum to totalRevenue + totalRefunds, not to totalRevenue.
          totalRevenue: enrollmentRevenue + productRevenue + masterRevenue + eventRevenue + subscriptionRevenue + sessionRevenue - totalRefunds,
          totalRefunds,
          enrollmentRevenue,
          productRevenue,
          masterRevenue,
          eventRevenue,
          subscriptionRevenue,
          sessionRevenue,
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
      return mapThrownError(error, 'ERRORS.REVENUES.SUMMARY_FAILED', 'Failed to generate revenue summary');
    }
  },
};
