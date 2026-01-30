import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Expense, ExpenseCreateDto, ExpenseUpdateDto } from '@shared/interfaces/expense.interface';

@Injectable({
  providedIn: 'root'
})
export class ExpenseService {
  private api = inject(ApiService);

  getAllExpenses(params?: { branchId?: string; type?: string; startDate?: string; endDate?: string }): Observable<Expense[]> {
    return this.api.get<Expense[]>('expenses', params);
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

  autoGenerateRecurring(): Observable<{ message: string }> {
    return this.api.post<{ message: string }>('expenses/auto-generate', {});
  }
}
