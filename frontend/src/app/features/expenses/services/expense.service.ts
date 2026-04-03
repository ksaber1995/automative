import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Expense, ExpenseCreateDto, ExpenseUpdateDto } from '@shared/interfaces/expense.interface';

@Injectable({
  providedIn: 'root'
})
export class ExpenseService {
  private api = inject(ApiService);

  getAllExpenses(params?: { branchId?: string; type?: string; startDate?: string; endDate?: string; isRecurring?: string; category?: string }): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses', params);
  }

  payRecurring(id: string, date?: string): Observable<Expense> {
    return this.api.post<Expense>(`expenses/${id}/pay`, date ? { date } : {});
  }

  paySalaries(date?: string, branchId?: string): Observable<{ created: number; skipped: number; skippedNames: string[]; message: string }> {
    const body: any = {};
    if (date) body.date = date;
    if (branchId) body.branchId = branchId;
    return this.api.post<any>('expenses/pay-salaries', body);
  }

  getRecurringExpenses(): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses/recurring');
  }

  getExpensesByType(type: string): Observable<Expense[]> {
    return this.api.get<Expense[]>(`expenses/type/${type}`);
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

  payEmployeeSalary(employeeId: string, date?: string): Observable<Expense> {
    return this.api.post<Expense>(`expenses/employee/${employeeId}/pay`, date ? { date } : {});
  }

  getDue(month?: string): Observable<{ items: any[]; totalDue: number; month: string }> {
    const params = month ? { month } : undefined;
    return this.api.get<{ items: any[]; totalDue: number; month: string }>('expenses/due', params);
  }

  autoGenerateRecurring(): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('expenses/auto-generate', {});
  }
}
