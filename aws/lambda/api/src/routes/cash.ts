import { query } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isAuthError, isSubscriptionError } from '../middleware/tenant-isolation';

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
async function fetchCashAggregates(companyId: string) {
  const [enrollPaid, productSales, masterPaid, expenses, refunds, withdrawals] = await Promise.all([
    query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total
       FROM enrollments WHERE company_id = $1 AND payment_status IN ('PAID', 'PARTIAL', 'REFUNDED')`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(SUM(total_amount), 0) as total
       FROM product_sales WHERE company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(SUM(amount_paid), 0) as total
       FROM master_enrollments WHERE company_id = $1 AND amount_paid > 0`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expense_payments WHERE company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM refunds WHERE company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM withdrawals WHERE company_id = $1 AND is_active = true`,
      [companyId]
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

async function fetchAdjustmentTotals(companyId: string) {
  const overall = await query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM cash_adjustments WHERE company_id = $1`,
    [companyId]
  );
  const byBranch = await query(
    `SELECT branch_id, COALESCE(SUM(amount), 0) as total
     FROM cash_adjustments WHERE company_id = $1
     GROUP BY branch_id`,
    [companyId]
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
      if (!checkGranularPermission(context, 'cash', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const aggs = await fetchCashAggregates(context.companyId);
      const baseCash = aggs.totalEnrollPaid + aggs.totalProductSales + aggs.totalMasterPaid
        - aggs.totalExpenses - aggs.totalRefunds - aggs.totalWithdrawals;

      // Surface activity that isn't tagged to any branch — product_sales with no
      // branch_id and expense_payments with no branch_id. These are part of the
      // company total but never roll up into a branch row, so callers need to
      // know about them to reconcile sum(byBranch) with totalCash.
      const unallocActivity = await query(
        `SELECT
           COALESCE((SELECT SUM(total_amount) FROM product_sales
                     WHERE company_id = $1 AND branch_id IS NULL), 0) AS unalloc_revenue,
           COALESCE((SELECT SUM(amount) FROM expense_payments
                     WHERE company_id = $1 AND branch_id IS NULL), 0) AS unalloc_expenses`,
        [context.companyId]
      );
      const unallocatedRevenue = parseFloat(unallocActivity[0]?.unalloc_revenue || '0');
      const unallocatedExpenses = parseFloat(unallocActivity[0]?.unalloc_expenses || '0');
      const unallocatedNet = unallocatedRevenue - unallocatedExpenses;

      const adj = await fetchAdjustmentTotals(context.companyId);
      const totalCash = baseCash + adj.overall;

      // Per-branch breakdown — mirrors the same formula scoped to one branch.
      // Cash adjustments with branch_id IS NULL are distributed equally across active branches.
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
        WHERE b.company_id = $1 AND b.is_active = true
        ORDER BY b.name ASC
        `,
        [context.companyId]
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error instanceof Error ? error.message : 'Failed to get current cash' },
      };
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
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const type = String(body.type || '').toUpperCase();
      if (!['DEPOSIT', 'WITHDRAWAL', 'ADJUSTMENT'].includes(type)) {
        return { status: 400 as const, body: { message: 'Invalid type. Must be DEPOSIT, WITHDRAWAL, or ADJUSTMENT.' } };
      }

      const branchId: string | null = body.branchId || null;
      if (branchId && !canAccessBranch(context, branchId)) {
        return { status: 403 as const, body: { message: 'Access denied to this branch' } };
      }

      const date = body.date || new Date().toISOString().split('T')[0];
      const notes = body.notes || null;

      let amount: number;
      let observedAmount: number | null = null;
      let systemAmount: number | null = null;

      if (type === 'ADJUSTMENT') {
        if (body.observedAmount === undefined || body.observedAmount === null) {
          return { status: 400 as const, body: { message: 'observedAmount is required for ADJUSTMENT' } };
        }
        observedAmount = Number(body.observedAmount);
        if (!isFinite(observedAmount) || observedAmount < 0) {
          return { status: 400 as const, body: { message: 'observedAmount must be a non-negative number' } };
        }
        // Compute system cash for the chosen scope (branch or company-wide)
        const currentResp = await cashRoutes.current({ headers });
        if (currentResp.status !== 200) {
          return { status: 400 as const, body: { message: 'Could not compute system cash' } };
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
          return { status: 400 as const, body: { message: 'amount must be a positive number' } };
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error instanceof Error ? error.message : 'Failed to adjust cash' },
      };
    }
  },

  listAdjustments: async ({ query: queryParams, headers }: { query: { branchId?: string }; headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const params: any[] = [context.companyId];
      let where = `ca.company_id = $1`;
      const filterBranch = queryParams.branchId;
      if (filterBranch === 'NULL') {
        where += ` AND ca.branch_id IS NULL`;
      } else if (filterBranch) {
        if (!canAccessBranch(context, filterBranch)) {
          return { status: 403 as const, body: { message: 'Access denied to this branch' } };
        }
        params.push(filterBranch);
        where += ` AND ca.branch_id = $${params.length}`;
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
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error instanceof Error ? error.message : 'Failed to list cash adjustments' },
      };
    }
  },

  deleteAdjustment: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      await ensureCashAdjustmentsTable();
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'delete')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }

      const result = await query(
        `DELETE FROM cash_adjustments WHERE id = $1 AND company_id = $2 RETURNING id`,
        [params.id, context.companyId]
      );

      if (!result || result.length === 0) {
        return { status: 404 as const, body: { message: 'Cash adjustment not found' } };
      }

      return { status: 200 as const, body: { message: 'Cash adjustment deleted', id: result[0].id } };
    } catch (error) {
      console.error('Delete cash adjustment error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 400,
        body: { message: error instanceof Error ? error.message : 'Failed to delete cash adjustment' },
      };
    }
  },

  flow: async ({ headers }: { headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'cash', 'read')) {
        return { status: 403 as const, body: { message: 'Insufficient permissions' } };
      }
      return { status: 200 as const, body: [] };
    } catch (error) {
      console.error('Get cash flow error:', error);
      return {
        status: isSubscriptionError(error) ? 402 : isAuthError(error) ? 401 : 500,
        body: { message: error instanceof Error ? error.message : 'Failed to get cash flow' },
      };
    }
  },
};
