import { query } from '../db/connection';
import {
  extractTenantContext,
  canAccessBranch,
  checkGranularPermission,
  isGlobalAdmin,
  type TenantContext,
} from '../middleware/tenant-isolation';
import { apiError, mapThrownError } from '../utils/api-error';

/**
 * For non-admins, return the IDs of branches they may see; for admins return
 * null (meaning "no scoping — see everything"). Returns [] when a non-admin
 * has no branch access so callers can short-circuit to zero data.
 */
function scopedBranchIdsFor(context: TenantContext): string[] | null {
  if (isGlobalAdmin(context)) return null;
  if (context.branchIds && context.branchIds.length > 0) return context.branchIds;
  if (context.branchId) return [context.branchId];
  return [];
}

/** Build " AND alias IN ($N, $N+1, ...)" and push UUIDs onto params. */
function buildBranchInClause(alias: string, params: any[], ids: string[]): string {
  if (ids.length === 0) return ' AND FALSE';
  const placeholders = ids.map((id) => {
    params.push(id);
    return `$${params.length}`;
  }).join(', ');
  return ` AND ${alias} IN (${placeholders})`;
}

let cashSchemaInitPromise: Promise<void> | null = null;
async function ensureCashAdjustmentsTable(): Promise<void> {
  if (!cashSchemaInitPromise) {
    cashSchemaInitPromise = (async () => {
      try {
        await query(`
          CREATE TABLE IF NOT EXISTS cash_adjustments (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
            type VARCHAR(20) NOT NULL CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT')),
            amount DECIMAL(15,2) NOT NULL,
            observed_amount DECIMAL(15,2),
            system_amount DECIMAL(15,2),
            date DATE NOT NULL DEFAULT CURRENT_DATE,
            notes TEXT,
            created_by_user_id UUID,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await query(`ALTER TABLE cash_adjustments ADD COLUMN IF NOT EXISTS branch_id UUID`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cash_adj_company_date ON cash_adjustments(company_id, date DESC)`);
        await query(`CREATE INDEX IF NOT EXISTS idx_cash_adj_branch ON cash_adjustments(branch_id)`);
      } catch (e) {
        cashSchemaInitPromise = null;
        throw e;
      }
    })();
  }
  return cashSchemaInitPromise;
}

// ─── Base cash math (mirrors analytics math: amount_paid, refunds subtracted) ──
// `scoped` is null for global admins (no branch filter) or a list of branch UUIDs
// for branch-scoped users. When scoped, branch_id IS NULL rows (unallocated
// revenue/expenses) are excluded — those are company-level and not visible.
async function fetchCashAggregates(companyId: string, scoped: string[] | null) {
  const bp = (alias: string) => {
    if (scoped === null) return { clause: '', params: [companyId] };
    const p: any[] = [companyId];
    const c = buildBranchInClause(alias, p, scoped);
    return { clause: c, params: p };
  };
  const a1 = bp('branch_id');
  const a2 = bp('branch_id');
  const a3 = bp('branch_id');
  const a4 = bp('branch_id');
  const a5 = bp('branch_id');
  const a6 = bp('branch_id');
  const [enrollPaid, productSales, masterPaid, expenses, refunds, withdrawals] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total
       FROM enrollments WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')${a1.clause}`,
      a1.params
    ),
    query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM product_sales WHERE company_id = $1${a2.clause}`,
      a2.params
    ),
    query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total
       FROM master_enrollments WHERE company_id = $1 AND amount_paid > 0${a3.clause}`,
      a3.params
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expense_payments WHERE company_id = $1${a4.clause}`,
      a4.params
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM refunds WHERE company_id = $1${a5.clause}`,
      a5.params
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM withdrawals WHERE company_id = $1 AND is_active = true${a6.clause}`,
      a6.params
    ),
  ]);

  return {
    totalEnrollPaid: parseFloat(enrollPaid[0]?.total || 0),
    totalProductSales: parseFloat(productSales[0]?.total || 0),
    totalMasterPaid: parseFloat(masterPaid[0]?.total || 0),
    totalExpenses: parseFloat(expenses[0]?.total || 0),
    totalRefunds: parseFloat(refunds[0]?.total || 0),
    totalWithdrawals: parseFloat(withdrawals[0]?.total || 0),
  };
}

async function fetchAdjustmentTotals(companyId: string, scoped: string[] | null) {
  const overallParams: any[] = [companyId];
  const overallClause = scoped === null ? '' : buildBranchInClause('branch_id', overallParams, scoped);
  const byBranchParams: any[] = [companyId];
  const byBranchClause = scoped === null ? '' : buildBranchInClause('branch_id', byBranchParams, scoped);
  const overall = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM cash_adjustments WHERE company_id = $1${overallClause}`,
    overallParams
  );
  const byBranch = await query(
    `SELECT branch_id, COALESCE(SUM(amount), 0) as total
     FROM cash_adjustments WHERE company_id = $1${byBranchClause}
     GROUP BY branch_id`,
    byBranchParams
  );
  const branchMap = new Map<string | null, number>();
  let unallocated = 0;
  for (const row of byBranch) {
    const v = parseFloat(row.total);
    if (row.branch_id === null) unallocated += v;
    else branchMap.set(row.branch_id, v);
  }
  return {
    overall: parseFloat(overall[0]?.total || 0),
    branchAdjustments: branchMap,
    unallocatedAdjustments: unallocated,
  };
}

function mapAdjustmentRow(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id || null,
    branchName: row.branch_name || null,
    type: row.type,
    amount: parseFloat(row.amount),
    observedAmount: row.observed_amount !== null && row.observed_amount !== undefined ? parseFloat(row.observed_amount) : null,
    systemAmount: row.system_amount !== null && row.system_amount !== undefined ? parseFloat(row.system_amount) : null,
    date: row.date,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

export const cashRoutes = {
  current: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (
        !checkGranularPermission(context, 'cash', 'read') &&
        !checkGranularPermission(context, 'dashboard', 'read')
      ) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const scoped = scopedBranchIdsFor(context);
      const aggs = await fetchCashAggregates(context.companyId, scoped);
      const baseCash = aggs.totalEnrollPaid + aggs.totalProductSales + aggs.totalMasterPaid
        - aggs.totalExpenses - aggs.totalRefunds - aggs.totalWithdrawals;

      // Surface activity that isn't tagged to any branch — product_sales with no
      // branch_id and expense_payments with no branch_id. These are part of the
      // company total but never roll up into a branch row, so callers need to
      // know about them to reconcile sum(byBranch) with totalCash. Scoped users
      // don't see unallocated activity (it's company-level overhead).
      let unallocatedRevenue = 0;
      let unallocatedExpenses = 0;
      if (scoped === null) {
        const unallocActivity = await query(
          `SELECT
             COALESCE((SELECT SUM(total_amount) FROM product_sales
                       WHERE company_id = $1 AND branch_id IS NULL), 0) AS unalloc_revenue,
             COALESCE((SELECT SUM(amount) FROM expense_payments
                       WHERE company_id = $1 AND branch_id IS NULL), 0) AS unalloc_expenses`,
          [context.companyId]
        );
        unallocatedRevenue = parseFloat(unallocActivity[0]?.unalloc_revenue || '0');
        unallocatedExpenses = parseFloat(unallocActivity[0]?.unalloc_expenses || '0');
      }
      const unallocatedNet = unallocatedRevenue - unallocatedExpenses;

      const adj = await fetchAdjustmentTotals(context.companyId, scoped);
      const totalCash = baseCash + adj.overall;

      // Per-branch breakdown — mirrors the same formula scoped to one branch.
      // Cash adjustments with branch_id IS NULL are distributed equally across active branches.
      const branchAggParams: any[] = [context.companyId];
      const branchAggClause = scoped === null ? '' : buildBranchInClause('b.id', branchAggParams, scoped);
      const branchAggs = await query(
        `
        SELECT
          b.id, b.name,
          COALESCE(enroll.total, 0) AS enroll_paid,
          COALESCE(prod.total, 0)   AS product_sales,
          COALESCE(mast.total, 0)   AS master_paid,
          COALESCE(exp.total, 0)    AS expenses,
          COALESCE(ref.total, 0)    AS refunds,
          COALESCE(w.total, 0)      AS withdrawals
        FROM branches b
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) AS total FROM enrollments
          WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')
          GROUP BY branch_id
        ) enroll ON enroll.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(total_amount) AS total FROM product_sales
          WHERE company_id = $1
          GROUP BY branch_id
        ) prod ON prod.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount_paid) AS total FROM master_enrollments
          WHERE company_id = $1 AND amount_paid > 0
          GROUP BY branch_id
        ) mast ON mast.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) AS total FROM expense_payments
          WHERE company_id = $1
          GROUP BY branch_id
        ) exp ON exp.branch_id = b.id
        LEFT JOIN (
          SELECT COALESCE(e.branch_id, me.branch_id) AS branch_id, SUM(r.amount) AS total
          FROM refunds r
          LEFT JOIN enrollments e ON r.enrollment_id = e.id
          LEFT JOIN master_enrollments me ON r.master_enrollment_id = me.id
          WHERE r.company_id = $1
          GROUP BY COALESCE(e.branch_id, me.branch_id)
        ) ref ON ref.branch_id = b.id
        LEFT JOIN (
          SELECT branch_id, SUM(amount) AS total FROM withdrawals
          WHERE company_id = $1 AND is_active = true
          GROUP BY branch_id
        ) w ON w.branch_id = b.id
        WHERE b.company_id = $1 AND b.is_active = true ${branchAggClause}
        ORDER BY b.name ASC
        `,
        branchAggParams
      );

      const branchCount = branchAggs.length;
      const distributedShare = branchCount > 0 ? adj.unallocatedAdjustments / branchCount : 0;

      const byBranch = branchAggs.map((r: any) => {
        const baseBranch = parseFloat(r.enroll_paid) + parseFloat(r.product_sales) + parseFloat(r.master_paid)
          - parseFloat(r.expenses) - parseFloat(r.refunds) - parseFloat(r.withdrawals);
        const branchAdj = adj.branchAdjustments.get(r.id) || 0;
        const cash = baseBranch + branchAdj + distributedShare;
        return {
          branchId: r.id,
          branchName: r.name,
          baseCash: Math.round(baseBranch * 100) / 100,
          branchAdjustments: Math.round(branchAdj * 100) / 100,
          distributedAdjustments: Math.round(distributedShare * 100) / 100,
          cash: Math.round(cash * 100) / 100,
        };
      });

      const sumBranchCash = byBranch.reduce((s: number, r: any) => s + r.cash, 0);

      return {
        status: 200 as const,
        body: {
          totalCash: Math.round(totalCash * 100) / 100,
          baseCash: Math.round(baseCash * 100) / 100,
          adjustmentsTotal: Math.round(adj.overall * 100) / 100,
          unallocatedAdjustments: Math.round(adj.unallocatedAdjustments * 100) / 100,
          unallocatedRevenue: Math.round(unallocatedRevenue * 100) / 100,
          unallocatedExpenses: Math.round(unallocatedExpenses * 100) / 100,
          unallocatedNet: Math.round(unallocatedNet * 100) / 100,
          sumBranchCash: Math.round(sumBranchCash * 100) / 100,
          byBranch,
        },
      };
    } catch (error) {
      console.error('Get current cash error:', error);
      return mapThrownError(error, 'ERRORS.CASH.CURRENT_FAILED', 'Failed to get current cash');
    }
  },

  state: async ({ headers }: { headers: { authorization: string } }) => {
    return cashRoutes.current({ headers });
  },

  adjust: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const type = String(body.type || '').toUpperCase();
      if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) {
        return apiError(400, 'ERRORS.CASH.INVALID_TYPE', 'Invalid type. Must be DEPOSIT, WITHDRAWAL, or ADJUSTMENT.');
      }

      const branchId: string | null = body.branchId || null;
      if (branchId && !canAccessBranch(context, branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      const date = body.date || new Date().toISOString().split('T')[0];
      const notes = body.notes || null;

      let amount: number;
      let observedAmount: number | null = null;
      let systemAmount: number | null = null;

      if (type === 'ADJUSTMENT') {
        if (body.observedAmount === undefined || body.observedAmount === null) {
          return apiError(400, 'ERRORS.CASH.OBSERVED_AMOUNT_REQUIRED', 'observedAmount is required for ADJUSTMENT');
        }
        observedAmount = Number(body.observedAmount);
        if (!isFinite(observedAmount) || observedAmount < 0) {
          return apiError(400, 'ERRORS.CASH.OBSERVED_AMOUNT_INVALID', 'observedAmount must be a non-negative number');
        }
        // Compute system cash for the chosen scope (branch or company-wide)
        const currentResp = await cashRoutes.current({ headers });
        if (currentResp.status !== 200) {
          return apiError(400, 'ERRORS.CASH.SYSTEM_CASH_FAILED', 'Could not compute system cash');
        }
        const cur = currentResp.body as any;
        if (branchId) {
          const branch = (cur.byBranch || []).find((b: any) => b.branchId === branchId);
          systemAmount = branch ? branch.cash : 0;
        } else {
          systemAmount = cur.totalCash;
        }
        amount = observedAmount - (systemAmount ?? 0);
      } else {
        const raw = Number(body.amount);
        if (!isFinite(raw) || raw <= 0) {
          return apiError(400, 'ERRORS.CASH.AMOUNT_INVALID', 'amount must be a positive number');
        }
        amount = type === 'WITHDRAWAL' ? -raw : raw;
      }

      const inserted = await query(
        `INSERT INTO cash_adjustments
          (company_id, branch_id, type, amount, observed_amount, system_amount, date, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [context.companyId, branchId, type, amount, observedAmount, systemAmount, date, notes, context.userId]
      );

      return {
        status: 201 as const,
        body: mapAdjustmentRow(inserted[0]),
      };
    } catch (error) {
      console.error('Adjust cash error:', error);
      return mapThrownError(error, 'ERRORS.CASH.ADJUST_FAILED', 'Failed to adjust cash', 400);
    }
  },

  listAdjustments: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const params: any[] = [context.companyId];
      let where = `ca.company_id = $1`;
      const filterBranch = queryParams.branchId;
      const scoped = scopedBranchIdsFor(context);
      if (filterBranch === 'NULL') {
        // Scoped users have no visibility into unallocated (company-level) adjustments.
        if (scoped !== null) {
          return { status: 200 as const, body: [] };
        }
        where += ` AND ca.branch_id IS NULL`;
      } else if (filterBranch) {
        if (!canAccessBranch(context, filterBranch)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(filterBranch);
        where += ` AND ca.branch_id = $${params.length}`;
      } else if (scoped !== null) {
        // No explicit branch filter and user is scoped → restrict to their branches.
        where += buildBranchInClause('ca.branch_id', params, scoped);
      }

      const rows = await query(
        `SELECT ca.*, b.name AS branch_name
         FROM cash_adjustments ca
         LEFT JOIN branches b ON ca.branch_id = b.id
         WHERE ${where}
         ORDER BY ca.date DESC, ca.created_at DESC`,
        params
      );

      return {
        status: 200 as const,
        body: rows.map(mapAdjustmentRow),
      };
    } catch (error) {
      console.error('List cash adjustments error:', error);
      return mapThrownError(error, 'ERRORS.CASH.LIST_ADJUSTMENTS_FAILED', 'Failed to list cash adjustments');
    }
  },

  deleteAdjustment: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const result = await query(
        `DELETE FROM cash_adjustments WHERE id = $1 AND company_id = $2 RETURNING id`,
        [params.id, context.companyId]
      );

      if (!result || result.length === 0) {
        return apiError(404, 'ERRORS.CASH.ADJUSTMENT_NOT_FOUND', 'Cash adjustment not found');
      }

      return { status: 200 as const, body: { message: 'Cash adjustment deleted', code: 'CASH.ADJUSTMENT_DELETED', id: result[0].id } };
    } catch (error) {
      console.error('Delete cash adjustment error:', error);
      return mapThrownError(error, 'ERRORS.CASH.DELETE_ADJUSTMENT_FAILED', 'Failed to delete cash adjustment', 400);
    }
  },

  flow: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      return { status: 200 as const, body: [] };
    } catch (error) {
      console.error('Get cash flow error:', error);
      return mapThrownError(error, 'ERRORS.CASH.FLOW_FAILED', 'Failed to get cash flow');
    }
  },
};
