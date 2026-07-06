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

  previewEmployeeBackPay(employeeId: string, upTo?: string): Observable<BackPayPreview> {
    const params = upTo ? { upTo } : undefined;
    return this.api.get<BackPayPreview>(`expenses/employee/${employeeId}/back-pay-preview`, params);
  }

  createEmployeeBackPay(employeeId: string, upTo?: string): Observable<BackPayResult> {
    const body: any = {};
    if (upTo) body.upTo = upTo;
    return this.api.post<BackPayResult>(`expenses/employee/${employeeId}/back-pay`, body);
  }

  getDue(month?: string): Observable<{ items: any[]; totalDue: number; month: string }> {
    const params = month ? { month } : undefined;
    return this.api.get<{ items: any[]; totalDue: number; month: string }>('expenses/due', params);
  }

  getRecurringExpenses(): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses', { isRecurring: 'true' });
  }
}
