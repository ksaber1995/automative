import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Expense, ExpenseCreateDto, ExpenseUpdateDto, ExpensePayment, ExpensePaymentCreateDto } from '@shared/interfaces/expense.interface';

export interface BackPayPeriod {
  monthKey: string;
  monthLabel: string;
  startDate: string;
  endDate: string;
  daysInMonth: number;
  daysWorked: number;
  proRated: boolean;
  amount: number;
  alreadyPaid: boolean;
}

export interface BackPayPreview {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    hireDate: string;
    salary: number;
    branchId: string | null;
  };
  upTo: string;
  periods: BackPayPeriod[];
  totalToCreate: number;
  totalAlreadyPaid: number;
}

export interface BackPayResult {
  created: number;
  skipped: number;
  totalAmount: number;
  payments: ExpensePayment[];
  message: string;
  code: string;
}

export interface PercentageSummary {
  salaryType: string;
  percentageRate: number;
  totalPaid: number;   // net paid by students across the teacher's classes
  accrued: number;     // percentageRate% of totalPaid
  withdrawn: number;   // base salary already withdrawn
  owed: number;        // available to withdraw now (accrued - withdrawn, >= 0)
  // Owed BY students who attended. Not earned yet, so deliberately outside
  // totalPaid/accrued — see PercentageUnpaidLine.
  unpaidTotal: number;
  unpaidShare: number;
  unpaidStudents: number;
}

/** One student payment that fed a percentage teacher's accrual. */
export interface PercentageLine {
  studentName: string;
  className: string | null;
  courseName: string | null;
  source: 'ENROLLMENT' | 'MONTHLY' | 'SESSION' | 'PACKAGE';
  amount: number;
  /** The teacher's cut of this payment (rounded per line). */
  share: number;
  paidAt: string | null;
}

/**
 * A student who sat in this teacher's class and still owes for it. Deliberately
 * NOT counted in totalPaid/accrued — the teacher's cut is earned on money
 * received — so it reads as what's coming once the office collects.
 */
export interface PercentageUnpaidLine {
  studentName: string;
  className: string | null;
  courseName: string | null;
  source: 'ENROLLMENT' | 'MONTHLY' | 'SESSION';
  /** Still owed on this enrollment / month / session charge. */
  outstanding: number;
  /** The teacher's cut of it if it gets paid (rounded per line). */
  potentialShare: number;
  attendedSessions: number;
  lastAttendedAt: string | null;
}

/** The summary plus the payments behind it, for auditing the accrual. */
export interface PercentageBreakdown extends PercentageSummary {
  lines: PercentageLine[];
  /** Total still owed by students who attended. */
  unpaidTotal: number;
  /** percentageRate% of unpaidTotal — the accrual this would unlock. */
  unpaidShare: number;
  unpaid: PercentageUnpaidLine[];
}

/** One session a SESSION_BASED salary payment paid for. */
export interface SalarySessionLine {
  date: string | null;
  className: string | null;
  courseName: string | null;
  studentsPresent: number;
}

/**
 * How ONE salary payment in the history reached its number. Which detail block
 * is filled depends on salaryType — the others come back empty/null:
 *   PERCENTAGE    → lines/linesTotal/percentageRate + the funding window
 *   SESSION_BASED → sessions/sessionRate
 *   MONTHLY       → monthLabel alone (the base IS the salary)
 * All three end the same way: baseSalary + bonus − discount = amount.
 */
export interface SalaryPaymentBreakdown {
  salaryType: string;
  employeeName: string;
  payment: {
    id: string;
    date: string;
    amount: number;
    bonusAmount: number;
    discountAmount: number;
    adjustmentReason: string | null;
    notes: string | null;
    baseSalary: number;
  };
  percentageRate: number | null;
  /** Exclusive. null = the accrual ran from the beginning. */
  windowStart: string | null;
  windowEnd: string | null;
  linesTotal: number;
  lines: PercentageLine[];
  sessionRate: number | null;
  sessions: SalarySessionLine[];
  monthLabel: string;
}


/** One member course of a bundle, and the teacher who would be paid for it. */
export interface BundleMemberLine {
  courseId: string;
  courseName: string;
  listPrice: number;
  employeeId: string | null;
  employeeName: string | null;
  salaryType: string | null;
  rate: number | null;
  /** The rate came from a per-course arrangement rather than the global one. */
  isCourseRate: boolean;
  payable: boolean;
  /** Present on a policy's lines only: the money attributed, and what it earns. */
  share?: number;
  earning?: number;
}

export interface BundlePolicySplit {
  lines: BundleMemberLine[];
  teachersTotal: number;
  academy: number;
  /** False when the split would leave the academy nothing — never approvable. */
  feasible: boolean;
}

export interface BundleIncomeRow {
  masterCourseId: string;
  masterCourseName: string;
  paymentType: string;
  collected: number;
  listTotal: number;
  discount: number;
  /** The least the bundle can sell for under policy C. */
  academyFloor: number;
  members: BundleMemberLine[];
  /** Why this bundle's money cannot be attributed, if it cannot. */
  blockedReason: 'NO_MEMBER_COURSES' | 'NO_INSTRUCTOR' | 'NOT_PERCENTAGE_PAID' | 'NO_LIST_PRICE' | null;
  /** A decision already recorded for this bundle and month, if there is one. */
  approved: Array<{ employeeId: string; courseId: string; amount: number; policy: 'A' | 'C'; approvedAt: string }>;
  policyA: BundlePolicySplit | null;
  policyC: BundlePolicySplit | null;
}

export interface BundleIncomeReport {
  year: number;
  month: number;
  totalCollected: number;
  unattributable: number;
  bundles: BundleIncomeRow[];
}

@Injectable({
  providedIn: 'root'
})
export class ExpenseService {
  private api = inject(ApiService);

  getAllExpenses(params?: { branchId?: string; type?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string }): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses', params);
  }

  getExpenseById(id: string): Observable<Expense> {
    return this.api.get<Expense>(`expenses/${id}`);
  }

  createExpense(expense: ExpenseCreateDto): Observable<Expense> {
    return this.api.post<Expense>('expenses', expense);
  }

  updateExpense(id: string, expense: ExpenseUpdateDto): Observable<Expense> {
    return this.api.patch<Expense>(`expenses/${id}`, expense);
  }

  deleteExpense(id: string): Observable<Expense> {
    return this.api.delete<Expense>(`expenses/${id}`);
  }

  getExpensePayments(expenseId: string): Observable<ExpensePayment[]> {
    return this.api.get<ExpensePayment[]>(`expenses/${expenseId}/payments`);
  }

  recordPayment(payment: ExpensePaymentCreateDto): Observable<ExpensePayment> {
    return this.api.post<ExpensePayment>('expense-payments', payment);
  }

  deletePayment(paymentId: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`expense-payments/${paymentId}`);
  }

  getAllPayments(params?: { expenseId?: string; branchId?: string; startDate?: string; endDate?: string; category?: string }): Observable<ExpensePayment[]> {
    return this.api.get<ExpensePayment[]>('expense-payments', params);
  }

  payRecurring(id: string, date?: string): Observable<ExpensePayment> {
    return this.api.post<ExpensePayment>(`expenses/${id}/pay`, date ? { date } : {});
  }

  paySalaries(date?: string, branchId?: string): Observable<{ created: number; skipped: number; skippedNames: string[]; message: string }> {
    const body: any = {};
    if (date) body.date = date;
    if (branchId) body.branchId = branchId;
    return this.api.post<any>('expenses/pay-salaries', body);
  }

  payEmployeeSalary(employeeId: string, date?: string, bonusAmount?: number, discountAmount?: number, adjustmentReason?: string): Observable<ExpensePayment> {
    const body: any = {};
    if (date) body.date = date;
    if (bonusAmount) body.bonusAmount = bonusAmount;
    if (discountAmount) body.discountAmount = discountAmount;
    if (adjustmentReason) body.adjustmentReason = adjustmentReason;
    return this.api.post<ExpensePayment>(`expenses/pay-employee/${employeeId}`, body);
  }

  getEmployeeSalaryHistory(employeeId: string): Observable<ExpensePayment[]> {
    return this.api.get<ExpensePayment[]>(`expenses/employee/${employeeId}/salary-history`);
  }

  getEmployeePercentageSummary(employeeId: string): Observable<PercentageSummary> {
    return this.api.get<PercentageSummary>(`expenses/employee/${employeeId}/percentage-summary`);
  }

  getEmployeePercentageBreakdown(employeeId: string): Observable<PercentageBreakdown> {
    return this.api.get<PercentageBreakdown>(`expenses/employee/${employeeId}/percentage-breakdown`);
  }

  getSalaryPaymentBreakdown(paymentId: string): Observable<SalaryPaymentBreakdown> {
    return this.api.get<SalaryPaymentBreakdown>(`expenses/salary-payment/${paymentId}/breakdown`);
  }

  previewEmployeeBackPay(employeeId: string, upTo?: string): Observable<BackPayPreview> {
    const params = upTo ? { upTo } : undefined;
    return this.api.get<BackPayPreview>(`expenses/employee/${employeeId}/back-pay-preview`, params);
  }

  createEmployeeBackPay(employeeId: string, upTo?: string): Observable<BackPayResult> {
    const body: any = {};
    if (upTo) body.upTo = upTo;
    return this.api.post<BackPayResult>(`expenses/employee/${employeeId}/back-pay`, body);
  }

  /**
   * Record who gets what of one bundle's month. Replaces any earlier decision
   * for that bundle and month; the server refuses a split that would leave the
   * academy nothing once each teacher's rate is applied.
   */
  approveBundleSplit(body: {
    masterCourseId: string;
    year: number;
    month: number;
    policy: 'A' | 'C';
    lines: Array<{ employeeId: string; courseId: string; amount: number; suggestedAmount?: number }>;
  }): Observable<{ approved: number; allocated: number; teacherEarnings: number; academy: number }> {
    return this.api.post<{ approved: number; allocated: number; teacherEarnings: number; academy: number }>(
      'expenses/bundle-income/approve', body,
    );
  }

  /**
   * Read-only bundle income for a month: what each master course collected and
   * how a split between its teachers would look under either policy. Nothing is
   * stored — see the endpoint.
   */
  getBundleIncome(year: number, month: number, branchId?: string): Observable<BundleIncomeReport> {
    const params: any = { year: String(year), month: String(month) };
    if (branchId) params.branchId = branchId;
    return this.api.get<BundleIncomeReport>('expenses/bundle-income', params);
  }

  getDue(month?: string): Observable<{ items: any[]; totalDue: number; month: string }> {
    const params = month ? { month } : undefined;
    return this.api.get<{ items: any[]; totalDue: number; month: string }>('expenses/due', params);
  }

  getRecurringExpenses(): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses', { isRecurring: 'true' });
  }
}
