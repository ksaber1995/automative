import { insert, update, findById, query, queryOne } from '../db/connection';
import { extractTenantContext, canAccessBranch, checkGranularPermission, isGlobalAdmin, appendBranchSqlFilter } from '../middleware/tenant-isolation';
import { mapPaymentFromDB } from './expense-payments';
import { apiError, mapThrownError } from '../utils/api-error';
import { ensureFreeSessionSchema } from './sessions';

// Idempotent guard — ensures the session-based salary columns exist even on a
// DB that hasn't had migration 037 applied yet (mirrors ensureExamTables).
let salaryColumnsEnsured = false;
export async function ensureSalaryColumns(): Promise<void> {
  if (salaryColumnsEnsured) return;
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary_type VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'`);
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS session_rate DECIMAL(10, 2)`);
  // PERCENTAGE salary type (migration 051): a % of what students have PAID for
  // the teacher's classes. Add the rate column and widen the salary_type CHECK.
  await query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS percentage_rate DECIMAL(5, 2)`);
  // The probe names the NEWEST value in the list — UNPAID today, PERCENTAGE
  // before it. A database that already had the PERCENTAGE constraint would
  // otherwise be judged up to date and reject the value added after it.
  await query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'employees_salary_type_check'
          AND pg_get_constraintdef(oid) LIKE '%UNPAID%'
      ) THEN
        ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_salary_type_check;
        ALTER TABLE employees ADD CONSTRAINT employees_salary_type_check
          CHECK (salary_type IN ('MONTHLY', 'SESSION_BASED', 'PERCENTAGE', 'UNPAID'));
      END IF;
    END $$;
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS session_salary_payments (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id  UUID NOT NULL REFERENCES companies(id)        ON DELETE CASCADE,
      employee_id UUID NOT NULL REFERENCES employees(id)        ON DELETE CASCADE,
      session_id  UUID NOT NULL REFERENCES sessions(id)         ON DELETE CASCADE,
      payment_id  UUID NOT NULL REFERENCES expense_payments(id) ON DELETE CASCADE,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (employee_id, session_id)
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_employee ON session_salary_payments(employee_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_payment  ON session_salary_payments(payment_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_ssp_session  ON session_salary_payments(session_id)`);
  salaryColumnsEnsured = true;
}

// Session ids an employee was PRESENT for within [monthStart, monthEnd] that
// have NOT yet been covered by a salary payment. These are what's owed now.
//
// Free (trial) sessions are excluded: they bill no student, so there is no
// revenue for a per-session fee to come out of. A PERCENTAGE teacher already
// earns nothing from one for the same reason — their accrual is a share of money
// actually paid — so this keeps both salary types consistent.
async function getUnpaidSessionIds(
  companyId: string,
  employeeId: string,
  monthStart: string,
  monthEnd: string,
): Promise<string[]> {
  await ensureFreeSessionSchema();
  const rows = await query<{ id: string }>(
    `SELECT DISTINCT s.id
     FROM session_teacher_attendance sta
     JOIN sessions s ON s.id = sta.session_id
     WHERE s.company_id = $1
       AND sta.employee_id = $2
       AND sta.status = 'PRESENT'
       AND s.is_free = FALSE
       AND s.start_date::date >= $3
       AND s.start_date::date <= $4
       AND NOT EXISTS (
         SELECT 1 FROM session_salary_payments ssp
         WHERE ssp.session_id = s.id AND ssp.employee_id = $2
       )`,
    [companyId, employeeId, monthStart, monthEnd],
  );
  return rows.map((r) => r.id);
}

// ── PERCENTAGE salary accrual (migration 051) ───────────────────────────────
// A PERCENTAGE teacher earns `percentage_rate`% of the net money students have
// actually PAID for the classes they teach (classes.instructor_id = employee).
// Earnings accrue live as payments arrive; the teacher can withdraw the balance
// any time (like SESSION_BASED). No ledger table is needed because the accrual
// is a running monetary sum, not a set of discrete units:
//   owed = accrued(percentage% of total paid) − base already withdrawn.

// Net amount students have PAID across the employee's classes, summed over all
// payment models. The per-session tables are optional (created lazily per
// tenant), so guard them with to_regclass before referencing them.
async function getTeacherPaidTotal(companyId: string, employeeId: string): Promise<number> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
            to_regclass('public.session_payments')            IS NOT NULL AS has_sp,
            to_regclass('public.session_packages')            IS NOT NULL AS has_spkg`
  );

  // ONE_TIME enrollments carry class_id directly; refunds net out via total_refunded.
  const parts: string[] = [
    `COALESCE((SELECT SUM(COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0))
               FROM enrollments e
               JOIN classes c ON c.id = e.class_id
               WHERE c.instructor_id = $2 AND e.company_id = $1), 0)`,
  ];
  // MONTHLY_SUBSCRIPTION and PER_SESSION tables lack class_id → reach it through
  // enrollment_id → enrollments.class_id. COVERED session rows carry amount_paid=0
  // (their money sits on the package row), so summing both never double-counts.
  if (reg?.has_msp) {
    parts.push(`COALESCE((SELECT SUM(COALESCE(msp.amount_paid,0))
               FROM monthly_subscription_payments msp
               JOIN enrollments e ON e.id = msp.enrollment_id
               JOIN classes c ON c.id = e.class_id
               WHERE c.instructor_id = $2 AND e.company_id = $1), 0)`);
  }
  if (reg?.has_sp) {
    parts.push(`COALESCE((SELECT SUM(COALESCE(sp.amount_paid,0))
               FROM session_payments sp
               JOIN enrollments e ON e.id = sp.enrollment_id
               JOIN classes c ON c.id = e.class_id
               WHERE c.instructor_id = $2 AND e.company_id = $1), 0)`);
  }
  if (reg?.has_spkg) {
    parts.push(`COALESCE((SELECT SUM(COALESCE(spkg.amount_paid,0))
               FROM session_packages spkg
               JOIN enrollments e ON e.id = spkg.enrollment_id
               JOIN classes c ON c.id = e.class_id
               WHERE c.instructor_id = $2 AND e.company_id = $1), 0)`);
  }

  const row = await queryOne<any>(`SELECT (${parts.join(' + ')}) AS total`, [companyId, employeeId]);
  return row && row.total != null ? parseFloat(row.total) : 0;
}

// Base salary already withdrawn = the pre-bonus, pre-discount portion of past
// SALARIES payments (amount − bonus + discount). Bonuses don't reduce future
// accrual; discounts do (they mean less was actually drawn against earnings).
async function getWithdrawnSalaryBase(companyId: string, employeeId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(bonus_amount,0) + COALESCE(discount_amount,0)), 0) AS base
     FROM expense_payments
     WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'`,
    [companyId, employeeId]
  );
  return row && row.base != null ? parseFloat(row.base) : 0;
}

// The individual student payments behind getTeacherPaidTotal, so the accrual can
// be audited line by line instead of taken on trust. Same four sources, same
// joins and filters — if you change one, change the other or the lines stop
// adding up to the total.
async function getTeacherPaidLines(companyId: string, employeeId: string): Promise<any[]> {
  const reg = await queryOne<any>(
    `SELECT to_regclass('public.monthly_subscription_payments') IS NOT NULL AS has_msp,
            to_regclass('public.session_payments')            IS NOT NULL AS has_sp,
            to_regclass('public.session_packages')            IS NOT NULL AS has_spkg`
  );

  const parts: string[] = [
    `SELECT s.name AS student_name, c.name AS class_name, co.name AS course_name,
            'ENROLLMENT' AS source,
            (COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0)) AS amount,
            e.enrollment_date::date AS paid_at
       FROM enrollments e
       JOIN classes  c  ON c.id = e.class_id
       JOIN students s  ON s.id = e.student_id
       LEFT JOIN courses co ON co.id = c.course_id
      WHERE c.instructor_id = $2 AND e.company_id = $1
        AND (COALESCE(e.amount_paid,0) - COALESCE(e.total_refunded,0)) <> 0`,
  ];
  // COVERED per-session rows carry amount_paid = 0 (the money sits on the
  // package row), so the <> 0 filter also keeps them from showing as noise.
  if (reg?.has_msp) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'MONTHLY', COALESCE(msp.amount_paid,0),
              COALESCE(msp.paid_date, msp.created_at::date)
         FROM monthly_subscription_payments msp
         JOIN enrollments e ON e.id = msp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = msp.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(msp.amount_paid,0) <> 0`
    );
  }
  if (reg?.has_sp) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'SESSION', COALESCE(sp.amount_paid,0),
              COALESCE(sp.paid_date, sp.created_at::date)
         FROM session_payments sp
         JOIN enrollments e ON e.id = sp.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = sp.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(sp.amount_paid,0) <> 0`
    );
  }
  if (reg?.has_spkg) {
    parts.push(
      `SELECT s.name, c.name, co.name, 'PACKAGE', COALESCE(spkg.amount_paid,0),
              spkg.created_at::date
         FROM session_packages spkg
         JOIN enrollments e ON e.id = spkg.enrollment_id
         JOIN classes  c  ON c.id = e.class_id
         JOIN students s  ON s.id = spkg.student_id
         LEFT JOIN courses co ON co.id = c.course_id
        WHERE c.instructor_id = $2 AND e.company_id = $1 AND COALESCE(spkg.amount_paid,0) <> 0`
    );
  }

  return query<any>(
    `${parts.join(' UNION ALL ')} ORDER BY paid_at DESC NULLS LAST, student_name`,
    [companyId, employeeId]
  );
}

// Full percentage picture for one employee: what they've earned so far and what
// remains to withdraw right now.
async function getPercentageSummary(
  companyId: string,
  emp: any,
): Promise<{ percentageRate: number; totalPaid: number; accrued: number; withdrawn: number; owed: number }> {
  const percentageRate = emp.percentage_rate ? parseFloat(emp.percentage_rate) : 0;
  const totalPaid = await getTeacherPaidTotal(companyId, emp.id);
  const accrued = Math.round(totalPaid * percentageRate) / 100; // == (totalPaid * rate/100) to 2dp
  const withdrawn = await getWithdrawnSalaryBase(companyId, emp.id);
  const owed = Math.max(0, Math.round((accrued - withdrawn) * 100) / 100);
  return { percentageRate, totalPaid, accrued, withdrawn, owed };
}

// Total PRESENT sessions for an employee in a month (paid or not) — used for
// the per-payment session count on the salary history view.

// Parse a YYYY-MM-DD string into a calendar-only date with no timezone drift.
function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function fmtDate(year: number, month0: number, day: number): string {
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

interface BackPayPeriod {
  monthKey: string;       // 'YYYY-MM'
  monthLabel: string;     // 'January 2026'
  startDate: string;      // 'YYYY-MM-DD'
  endDate: string;        // 'YYYY-MM-DD'
  daysInMonth: number;
  daysWorked: number;
  proRated: boolean;
  amount: number;
}

// Build list of owed monthly periods strictly before upTo's month.
// First month is pro-rated from hireDate.day; remaining months are full.
function buildBackPayPeriods(hireDateStr: string, upToStr: string, monthlySalary: number): BackPayPeriod[] {
  const hire = parseDateOnly(hireDateStr);
  const upTo = parseDateOnly(upToStr);
  const stopYear = upTo.getUTCFullYear();
  const stopMonth = upTo.getUTCMonth();   // exclude this month — paid normally end-of-month

  const periods: BackPayPeriod[] = [];
  let year = hire.getUTCFullYear();
  let month = hire.getUTCMonth();

  while (year < stopYear || (year === stopYear && month < stopMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const isHireMonth = year === hire.getUTCFullYear() && month === hire.getUTCMonth();
    const startDay = isHireMonth ? hire.getUTCDate() : 1;
    const daysWorked = daysInMonth - startDay + 1;
    const proRated = daysWorked < daysInMonth;
    const amount = proRated
      ? Math.round((monthlySalary * daysWorked / daysInMonth) * 100) / 100
      : monthlySalary;

    periods.push({
      monthKey: `${year}-${String(month + 1).padStart(2, '0')}`,
      monthLabel: new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      startDate: fmtDate(year, month, startDay),
      endDate: fmtDate(year, month, daysInMonth),
      daysInMonth,
      daysWorked,
      proRated,
      amount,
    });

    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return periods;
}

function mapExpenseFromDB(row: any) {
  const amount = parseFloat(row.amount);
  const amortizationMonths = row.amortization_months || null;
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    type: row.type,
    category: row.category,
    amount,
    description: row.description,
    date: row.date,
    isRecurring: row.is_recurring,
    distributionMethod: row.distribution_method,
    vendor: row.vendor,
    invoiceNumber: row.invoice_number,
    notes: row.notes,
    assetName: row.asset_name,
    amortizationMonths,
    monthlyAmount: amortizationMonths ? parseFloat((amount / amortizationMonths).toFixed(2)) : null,
    bonusAmount: row.bonus_amount ? parseFloat(row.bonus_amount) : 0,
    discountAmount: row.discount_amount ? parseFloat(row.discount_amount) : 0,
    adjustmentReason: row.adjustment_reason || null,
    eventId: row.event_id || null,
    totalPaid: row.total_paid !== undefined ? parseFloat(row.total_paid) || 0 : undefined,
    lastPaymentDate: row.last_payment_date || null,
    paymentCount: row.payment_count !== undefined ? parseInt(row.payment_count) || 0 : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const expensesRoutes = {
  create: async ({ body, headers }: { body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      if (body.branchId && !canAccessBranch(context, body.branchId)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
      }

      // If linked to an event, derive branch from the event automatically.
      // Event branch is the source of truth — explicit branchId is ignored when eventId is set.
      let resolvedBranchId: string | null = body.branchId || null;
      if (body.eventId) {
        const event = await queryOne(
          'SELECT branch_id, status FROM events WHERE id = $1 AND company_id = $2',
          [body.eventId, context.companyId]
        );
        if (event) {
          if (event.status === 'CANCELLED') {
            return apiError(409, 'ERRORS.EVENTS.CANCELLED_NO_EXPENSES', 'Event is cancelled; no new expenses can be added');
          }
          resolvedBranchId = event.branch_id || null;
        }
      }

      const expense = await insert('expenses', {
        company_id: context.companyId,
        branch_id: resolvedBranchId,
        type: body.type,
        category: body.category,
        amount: body.amount,
        description: body.description || null,
        date: body.date,
        is_recurring: body.isRecurring || false,
        distribution_method: body.distributionMethod || null,
        vendor: body.vendor || null,
        invoice_number: body.invoiceNumber || null,
        notes: body.notes || null,
        asset_name: body.assetName || null,
        amortization_months: body.type === 'CAPITAL' ? (body.amortizationMonths || null) : null,
        event_id: body.eventId || null,
      });

      return {
        status: 201 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Create expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.CREATE_FAILED', 'Failed to create expense', 400);
    }
  },

  list: async ({ query: queryParams, headers }: { query: { branchId?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string; type?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      let sql = `SELECT e.*,
        COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
        (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
        (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
        FROM expenses e WHERE e.company_id = $1`;
      const params: any[] = [context.companyId];

      if (queryParams.branchId) {
        if (!canAccessBranch(context, queryParams.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this branch');
        }
        params.push(queryParams.branchId);
        sql += ` AND e.branch_id = $${params.length}`;
      } else {
        const branchClause = appendBranchSqlFilter(context, params, 'e.branch_id');
        if (branchClause) sql += ` AND (${branchClause} OR e.branch_id IS NULL)`;
      }

      if (queryParams.startDate) {
        params.push(queryParams.startDate);
        sql += ` AND e.date >= $${params.length}`;
      }

      if (queryParams.endDate) {
        params.push(queryParams.endDate);
        sql += ` AND e.date <= $${params.length}`;
      }

      if (queryParams.isRecurring !== undefined) {
        params.push(queryParams.isRecurring === 'true');
        sql += ` AND e.is_recurring = $${params.length}`;
      }

      if (queryParams.category) {
        params.push(queryParams.category);
        sql += ` AND e.category = $${params.length}`;
      }

      if (queryParams.type) {
        params.push(queryParams.type);
        sql += ` AND e.type = $${params.length}`;
      }

      sql += ' ORDER BY e.date DESC, e.created_at DESC';

      const expenses = await query(sql, params);
      return {
        status: 200 as const,
        body: expenses.map(mapExpenseFromDB),
      };
    } catch (error) {
      console.error('List expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.LIST_FAILED', 'Failed to list expenses');
    }
  },

  getDue: async ({ query: queryParams, headers }: { query: { month?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const targetMonth = queryParams.month || new Date().toISOString().substring(0, 7);
      const monthStart = targetMonth + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      // Branch admins (etc.) see dues only for their assigned branches plus
      // the global (NULL branch_id) expenses that apply company-wide.
      const recurringParams: any[] = [context.companyId, monthStart, monthEnd];
      const recurringBranchClause = appendBranchSqlFilter(context, recurringParams, 'e.branch_id');
      const recurringScope = recurringBranchClause ? ` AND (${recurringBranchClause} OR e.branch_id IS NULL)` : '';
      const recurringTemplates = await query(
        `SELECT e.*, b.name as branch_name
         FROM expenses e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_recurring = true${recurringScope}
           AND NOT EXISTS (
             SELECT 1 FROM expense_payments ep
             WHERE ep.expense_id = e.id
               AND ep.date >= $2 AND ep.date <= $3
           )`,
        recurringParams
      );

      // Employees with unpaid salary for this month (check expense_payments).
      // Employees can have NULL branch_id (cross-branch staff); include those
      // for branch admins so company-wide hires aren't silently dropped.
      const employeeParams: any[] = [context.companyId, monthStart, monthEnd];
      const employeeBranchClause = appendBranchSqlFilter(context, employeeParams, 'e.branch_id');
      const employeeScope = employeeBranchClause ? ` AND (${employeeBranchClause} OR e.branch_id IS NULL)` : '';
      // Candidates: monthly staff with a salary not yet paid this month, AND
      // session-based staff with a rate (their "due" is computed from unpaid
      // sessions below — they may reappear after a mid-month payment).
      const unpaidEmployees = await query(
        `SELECT e.*, b.name as branch_name
         FROM employees e
         LEFT JOIN branches b ON e.branch_id = b.id
         WHERE e.company_id = $1 AND e.is_active = true${employeeScope}
           AND (e.hire_date IS NULL OR e.hire_date <= $3)
           AND (
             (COALESCE(e.salary_type, 'MONTHLY') = 'MONTHLY' AND e.salary > 0
              AND NOT EXISTS (
                SELECT 1 FROM expense_payments ep
                WHERE ep.employee_id = e.id AND ep.category = 'SALARIES'
                  AND ep.date >= $2 AND ep.date <= $3
              ))
             OR (e.salary_type = 'SESSION_BASED' AND e.session_rate > 0)
             OR (e.salary_type = 'PERCENTAGE' AND e.percentage_rate > 0)
           )`,
        employeeParams
      );

      // For session-based employees the amount = UNPAID present sessions × rate.
      const salaryItems: any[] = [];
      for (const e of unpaidEmployees as any[]) {
        const base = {
          id: e.id,
          type: 'salary' as const,
          label: `Salary: ${e.first_name} ${e.last_name}`,
          category: 'SALARIES',
          branchId: e.branch_id,
          branchName: e.branch_name,
          templateId: null,
          employeeId: e.id,
        };
        if (e.salary_type === 'SESSION_BASED') {
          const rate = e.session_rate ? parseFloat(e.session_rate) : 0;
          const unpaidIds = await getUnpaidSessionIds(context.companyId, e.id, monthStart, monthEnd);
          const amount = unpaidIds.length * rate;
          if (amount > 0) {
            salaryItems.push({ ...base, amount, salaryType: 'SESSION_BASED', sessionCount: unpaidIds.length, sessionRate: rate });
          }
        } else if (e.salary_type === 'PERCENTAGE') {
          // Owed = accrued (percentage of paid) − already withdrawn; withdraw any time.
          const { percentageRate, owed } = await getPercentageSummary(context.companyId, e);
          if (owed > 0) {
            salaryItems.push({ ...base, amount: owed, salaryType: 'PERCENTAGE', percentageRate });
          }
        } else {
          salaryItems.push({ ...base, amount: parseFloat(e.salary), salaryType: 'MONTHLY' });
        }
      }

      const items: any[] = [
        ...recurringTemplates.map((t: any) => ({
          id: t.id,
          type: 'recurring',
          label: t.description,
          amount: parseFloat(t.amount),
          category: t.category,
          branchId: t.branch_id,
          branchName: t.branch_name,
          templateId: t.id,
          employeeId: null,
        })),
        ...salaryItems,
      ];

      const totalDue = items.reduce((sum, i) => sum + i.amount, 0);

      return {
        status: 200 as const,
        body: { items, totalDue, month: targetMonth },
      };
    } catch (error) {
      console.error('Get due expenses error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DUE_FAILED', 'Failed to get due expenses');
    }
  },

  getById: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        `SELECT e.*,
          COALESCE((SELECT SUM(ep.amount) FROM expense_payments ep WHERE ep.expense_id = e.id), 0) as total_paid,
          (SELECT MAX(ep.date) FROM expense_payments ep WHERE ep.expense_id = e.id) as last_payment_date,
          (SELECT COUNT(*) FROM expense_payments ep WHERE ep.expense_id = e.id) as payment_count
         FROM expenses e WHERE e.id = $1 AND e.company_id = $2`,
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (expense.branch_id && !canAccessBranch(context, expense.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED', 'Access denied to this expense');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Get expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found', 404);
    }
  },

  update: async ({ params, body, headers }: { params: { id: string }; body: any; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      if (existing.branch_id && !canAccessBranch(context, existing.branch_id)) {
        return apiError(403, 'ERRORS.EXPENSES.ACCESS_DENIED_UPDATE', 'Access denied to update this expense');
      }

      const updateData: any = {};

      if (body.branchId !== undefined) {
        if (body.branchId && !canAccessBranch(context, body.branchId)) {
          return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS_TARGET', 'Access denied to target branch');
        }
        updateData.branch_id = body.branchId;
      }
      if (body.type !== undefined) updateData.type = body.type;
      if (body.category !== undefined) updateData.category = body.category;
      if (body.amount !== undefined) updateData.amount = body.amount;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.date !== undefined) updateData.date = body.date;
      if (body.isRecurring !== undefined) updateData.is_recurring = body.isRecurring;
      if (body.distributionMethod !== undefined) updateData.distribution_method = body.distributionMethod;
      if (body.vendor !== undefined) updateData.vendor = body.vendor;
      if (body.invoiceNumber !== undefined) updateData.invoice_number = body.invoiceNumber;
      if (body.notes !== undefined) updateData.notes = body.notes;
      if (body.eventId !== undefined) updateData.event_id = body.eventId || null;
      if (body.assetName !== undefined) updateData.asset_name = body.assetName;
      if (body.amortizationMonths !== undefined) updateData.amortization_months = body.amortizationMonths;

      const expense = await update('expenses', params.id, updateData);

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      return {
        status: 200 as const,
        body: mapExpenseFromDB(expense),
      };
    } catch (error) {
      console.error('Update expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.UPDATE_FAILED', 'Failed to update expense', 404);
    }
  },

  delete: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'delete')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const existing = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!existing) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      await query('DELETE FROM expense_payments WHERE expense_id = $1 AND company_id = $2', [params.id, context.companyId]);
      await query('DELETE FROM expenses WHERE id = $1 AND company_id = $2', [params.id, context.companyId]);

      return { status: 200 as const, body: { message: 'Expense deleted successfully', code: 'EXPENSES.DELETED' } };
    } catch (error) {
      console.error('Delete expense error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.DELETE_FAILED', 'Failed to delete expense');
    }
  },

  getPayments: async ({ params, headers }: { params: { id: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const expense = await queryOne(
        'SELECT id FROM expenses WHERE id = $1 AND company_id = $2',
        [params.id, context.companyId]
      );

      if (!expense) {
        return apiError(404, 'ERRORS.EXPENSES.NOT_FOUND', 'Expense not found');
      }

      const payments = await query(
        'SELECT * FROM expense_payments WHERE expense_id = $1 AND company_id = $2 ORDER BY date DESC',
        [params.id, context.companyId]
      );

      return { status: 200 as const, body: payments.map(mapPaymentFromDB) };
    } catch (error) {
      console.error('Get expense payments error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.GET_PAYMENTS_FAILED', 'Failed to get payments');
    }
  },

  payRecurring: async ({ params, body, headers }: { params: { id: string }; body: { date?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const template = await queryOne(
        'SELECT * FROM expenses WHERE id = $1 AND company_id = $2 AND is_recurring = true',
        [params.id, context.companyId]
      );

      if (!template) {
        return apiError(404, 'ERRORS.EXPENSES.RECURRING_NOT_FOUND', 'Recurring expense not found');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];

      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];

      const existing = await queryOne(
        `SELECT id FROM expense_payments WHERE company_id = $1 AND expense_id = $2 AND date >= $3 AND date <= $4`,
        [context.companyId, params.id, monthStart, monthEnd]
      );

      if (existing) {
        return apiError(400, 'ERRORS.EXPENSE_PAYMENTS.ALREADY_PAID_THIS_MONTH', 'This expense has already been paid for this month');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        expense_id: params.id,
        branch_id: template.branch_id,
        type: template.type,
        category: template.category,
        amount: template.amount,
        date: payDate,
        vendor: template.vendor,
        invoice_number: null,
        notes: template.notes,
        event_id: template.event_id || null,
        bonus_amount: 0,
        discount_amount: 0,
      });

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay recurring error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_RECURRING_FAILED', 'Failed to pay recurring expense');
    }
  },

  paySalaries: async ({ body, headers }: { body: { date?: string; branchId?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      let empSql = 'SELECT * FROM employees WHERE company_id = $1 AND is_active = true AND salary > 0';
      const empParams: any[] = [context.companyId];

      if (body.branchId) {
        empParams.push(body.branchId);
        empSql += ` AND branch_id = $${empParams.length}`;
      }

      const employees = await query(empSql, empParams);

      if (employees.length === 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_EMPLOYEES', 'No active employees with salary found');
      }

      const created: any[] = [];
      const skipped: string[] = [];

      for (const emp of employees) {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );

        if (existing) {
          skipped.push(emp.first_name + ' ' + emp.last_name);
          continue;
        }

        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: parseFloat(emp.salary),
          date: payDate,
          notes: `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`,
          bonus_amount: 0,
          discount_amount: 0,
        });

        created.push(mapPaymentFromDB(payment));
      }

      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped: skipped.length,
          skippedNames: skipped,
          payments: created,
          message: `Created ${created.length} salary payment(s)${skipped.length ? `, skipped ${skipped.length} already paid` : ''}.`,
          code: 'EXPENSES.SALARIES_PAID',
        },
      };
    } catch (error) {
      console.error('Pay salaries error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARIES_FAILED', 'Failed to pay salaries');
    }
  },

  payEmployeeSalary: async ({ params, body, headers }: { params: { employeeId: string }; body: { date?: string; bonusAmount?: number; discountAmount?: number; adjustmentReason?: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2 AND is_active = true',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      const isSessionBased = emp.salary_type === 'SESSION_BASED';
      const isPercentage = emp.salary_type === 'PERCENTAGE';
      if (isSessionBased) {
        if (!emp.session_rate || parseFloat(emp.session_rate) <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no session rate configured');
        }
      } else if (isPercentage) {
        if (!emp.percentage_rate || parseFloat(emp.percentage_rate) <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no percentage rate configured');
        }
      } else if (!emp.salary || parseFloat(emp.salary) <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');
      }

      const payDate = body.date || new Date().toISOString().split('T')[0];
      const monthStart = payDate.substring(0, 7) + '-01';
      const monthEnd = new Date(new Date(monthStart).getFullYear(), new Date(monthStart).getMonth() + 1, 0).toISOString().split('T')[0];
      const monthLabel = new Date(payDate).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      // Session-based: base = UNPAID present sessions in the month × rate, and
      // multiple payments per month are allowed (one per batch of new sessions).
      // Monthly: base = salary, and only one payment per month is allowed.
      let baseSalary: number;
      let baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel}`;
      let unpaidSessionIds: string[] = [];
      if (isSessionBased) {
        const rate = parseFloat(emp.session_rate);
        unpaidSessionIds = await getUnpaidSessionIds(context.companyId, emp.id, monthStart, monthEnd);
        if (unpaidSessionIds.length === 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_UNPAID_SESSIONS', 'No unpaid sessions for this month');
        }
        baseSalary = unpaidSessionIds.length * rate;
        baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel} (${unpaidSessionIds.length} sessions × ${rate})`;
      } else if (isPercentage) {
        // Withdraw the currently-available balance (accrued − already withdrawn).
        // No monthly lock: pay out whatever has accrued since the last withdrawal.
        const { percentageRate, owed } = await getPercentageSummary(context.companyId, emp);
        if (owed <= 0) {
          return apiError(400, 'ERRORS.EXPENSES.NO_PERCENTAGE_DUE', 'No percentage earnings available to withdraw');
        }
        baseSalary = owed;
        baseNote = `Salary: ${emp.first_name} ${emp.last_name} — ${monthLabel} (${percentageRate}% revenue share)`;
      } else {
        const existing = await queryOne(
          `SELECT id FROM expense_payments WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES' AND date >= $3 AND date <= $4`,
          [context.companyId, emp.id, monthStart, monthEnd]
        );
        if (existing) {
          return apiError(400, 'ERRORS.EXPENSES.SALARY_ALREADY_PAID', `Salary already paid for ${monthLabel}`);
        }
        baseSalary = parseFloat(emp.salary);
      }
      const bonus = body.bonusAmount || 0;
      const discount = body.discountAmount || 0;
      const finalAmount = baseSalary + bonus - discount;

      if (finalAmount <= 0) {
        return apiError(400, 'ERRORS.EXPENSES.SALARY_NON_POSITIVE', 'Final salary amount must be greater than zero');
      }

      const payment = await insert('expense_payments', {
        company_id: context.companyId,
        branch_id: emp.branch_id,
        employee_id: emp.id,
        type: 'FIXED',
        category: 'SALARIES',
        amount: finalAmount,
        date: payDate,
        notes: baseNote,
        bonus_amount: bonus,
        discount_amount: discount,
        adjustment_reason: body.adjustmentReason || null,
      });

      // Mark the covered sessions as paid (links cascade-delete if voided).
      for (const sid of unpaidSessionIds) {
        await query(
          `INSERT INTO session_salary_payments (company_id, employee_id, session_id, payment_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (employee_id, session_id) DO NOTHING`,
          [context.companyId, emp.id, sid, payment.id],
        );
      }

      return { status: 201 as const, body: mapPaymentFromDB(payment) };
    } catch (error) {
      console.error('Pay employee salary error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PAY_SALARY_FAILED', 'Failed to pay salary');
    }
  },

  getEmployeeSalaryHistory: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      await ensureSalaryColumns();
      const emp = await queryOne(
        'SELECT id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );

      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const rows = await query(
        `SELECT ep.*,
                (SELECT COUNT(*) FROM session_salary_payments ssp WHERE ssp.payment_id = ep.id) AS session_count
         FROM expense_payments ep
         WHERE ep.company_id = $1 AND ep.employee_id = $2 AND ep.category = 'SALARIES'
         ORDER BY ep.date DESC`,
        [context.companyId, params.employeeId]
      );

      return {
        status: 200 as const,
        body: rows.map((r: any) => ({
          ...mapPaymentFromDB(r),
          sessionCount: r.session_count !== null && r.session_count !== undefined ? parseInt(r.session_count, 10) : 0,
        })),
      };
    } catch (error) {
      console.error('Get employee salary history error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.SALARY_HISTORY_FAILED', 'Failed to get salary history');
    }
  },

  // Live percentage earnings for one teacher: total paid across their classes,
  // accrued share, already withdrawn, and what's available to withdraw now.
  getEmployeePercentageSummary: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const summary = await getPercentageSummary(context.companyId, emp);
      return {
        status: 200 as const,
        body: { salaryType: emp.salary_type || 'MONTHLY', ...summary },
      };
    } catch (error) {
      console.error('Get employee percentage summary error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PERCENTAGE_SUMMARY_FAILED', 'Failed to get percentage summary');
    }
  },

  /**
   * GET /api/expenses/employee/:employeeId/percentage-breakdown
   * The summary plus every student payment behind it — who paid, for which
   * class, when, and the teacher's cut of each. Read-only audit of the accrual.
   */
  getEmployeePercentageBreakdown: async ({ params, headers }: { params: { employeeId: string }; headers: { authorization: string } }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }
      await ensureSalaryColumns();

      const emp = await queryOne<any>(
        'SELECT * FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');

      const summary = await getPercentageSummary(context.companyId, emp);
      const rows = await getTeacherPaidLines(context.companyId, params.employeeId);

      return {
        status: 200 as const,
        body: {
          salaryType: emp.salary_type || 'MONTHLY',
          ...summary,
          lines: rows.map((r) => {
            const amount = r.amount != null ? parseFloat(r.amount) : 0;
            return {
              studentName: r.student_name || '',
              className: r.class_name ?? null,
              courseName: r.course_name ?? null,
              source: r.source,
              amount,
              // The teacher's cut of this one payment. Rounded per line, so the
              // column can drift a cent or two from `accrued` (rounded once on
              // the total) — accrued stays the figure of record.
              share: Math.round(amount * summary.percentageRate) / 100,
              paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
            };
          }),
        },
      };
    } catch (error) {
      console.error('Get employee percentage breakdown error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.PERCENTAGE_SUMMARY_FAILED', 'Failed to get percentage breakdown');
    }
  },

  previewEmployeeBackPay: async ({ params, query: q, headers }: {
    params: { employeeId: string };
    query: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'read')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id, is_active FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (q?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);

      // Detect already-paid months so the user knows what will be skipped.
      const paidRows = periods.length === 0 ? [] : await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const enriched = periods.map(p => ({ ...p, alreadyPaid: paidMonths.has(p.monthKey) }));
      const toCreate = enriched.filter(p => !p.alreadyPaid);

      return {
        status: 200 as const,
        body: {
          employee: {
            id: emp.id,
            firstName: emp.first_name,
            lastName: emp.last_name,
            hireDate: hireStr,
            salary,
            branchId: emp.branch_id,
          },
          upTo: upToStr,
          periods: enriched,
          totalToCreate: Math.round(toCreate.reduce((s, p) => s + p.amount, 0) * 100) / 100,
          totalAlreadyPaid: Math.round(enriched.filter(p => p.alreadyPaid).reduce((s, p) => s + p.amount, 0) * 100) / 100,
        },
      };
    } catch (error) {
      console.error('Preview back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_PREVIEW_FAILED', 'Failed to preview back pay');
    }
  },

  createEmployeeBackPay: async ({ params, body, headers }: {
    params: { employeeId: string };
    body: { upTo?: string };
    headers: { authorization: string };
  }) => {
    try {
      const context = await extractTenantContext(headers.authorization);
      if (!checkGranularPermission(context, 'expenses', 'write')) {
        return apiError(403, 'ERRORS.PERMISSION.INSUFFICIENT', 'Insufficient permissions');
      }

      const emp = await queryOne<any>(
        'SELECT id, first_name, last_name, salary, hire_date, branch_id FROM employees WHERE id = $1 AND company_id = $2',
        [params.employeeId, context.companyId]
      );
      if (!emp) return apiError(404, 'ERRORS.EMPLOYEES.NOT_FOUND', 'Employee not found');
      if (emp.branch_id && !canAccessBranch(context, emp.branch_id)) {
        return apiError(403, 'ERRORS.PERMISSION.BRANCH_ACCESS', 'Access denied to this employee');
      }
      if (!emp.hire_date) return apiError(400, 'ERRORS.EXPENSES.NO_HIRE_DATE', 'Employee has no hire date');
      const salary = emp.salary ? parseFloat(emp.salary) : 0;
      if (salary <= 0) return apiError(400, 'ERRORS.EXPENSES.NO_SALARY_CONFIGURED', 'Employee has no salary configured');

      const hireStr = typeof emp.hire_date === 'string' ? emp.hire_date.substring(0, 10) : emp.hire_date.toISOString().substring(0, 10);
      const upToStr = (body?.upTo || new Date().toISOString().substring(0, 10));

      const periods = buildBackPayPeriods(hireStr, upToStr, salary);
      if (periods.length === 0) {
        return {
          status: 200 as const,
          body: { created: 0, skipped: 0, totalAmount: 0, payments: [], message: 'No back-pay periods to create.', code: 'EXPENSES.BACK_PAY_NONE' },
        };
      }

      const paidRows = await query<any>(
        `SELECT date FROM expense_payments
         WHERE company_id = $1 AND employee_id = $2 AND category = 'SALARIES'
           AND date >= $3 AND date <= $4`,
        [context.companyId, params.employeeId, periods[0].startDate, periods[periods.length - 1].endDate]
      );
      const paidMonths = new Set(
        paidRows.map(r => {
          const d = typeof r.date === 'string' ? r.date : r.date.toISOString().substring(0, 10);
          return d.substring(0, 7);
        })
      );

      const created: any[] = [];
      let skipped = 0;
      for (const p of periods) {
        if (paidMonths.has(p.monthKey)) { skipped += 1; continue; }
        const notes = p.proRated
          ? `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel} (pro-rated ${p.daysWorked}/${p.daysInMonth} days)`
          : `Back pay: ${emp.first_name} ${emp.last_name} — ${p.monthLabel}`;
        const payment = await insert('expense_payments', {
          company_id: context.companyId,
          branch_id: emp.branch_id,
          employee_id: emp.id,
          type: 'FIXED',
          category: 'SALARIES',
          amount: p.amount,
          date: p.endDate,
          notes,
          bonus_amount: 0,
          discount_amount: 0,
        });
        created.push(mapPaymentFromDB(payment));
      }

      const totalAmount = Math.round(created.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      return {
        status: 201 as const,
        body: {
          created: created.length,
          skipped,
          totalAmount,
          payments: created,
          message: `Created ${created.length} back-pay entr${created.length === 1 ? 'y' : 'ies'}${skipped ? `, skipped ${skipped} already-paid month${skipped === 1 ? '' : 's'}` : ''}.`,
          code: 'EXPENSES.BACK_PAY_CREATED',
        },
      };
    } catch (error) {
      console.error('Create back-pay error:', error);
      return mapThrownError(error, 'ERRORS.EXPENSES.BACK_PAY_FAILED', 'Failed to create back pay');
    }
  },

};
