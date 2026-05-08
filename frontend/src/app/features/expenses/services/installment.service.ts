import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import {
  InstallmentPlan,
  InstallmentPlanCreateDto,
  InstallmentPlanWithSchedule,
  InstallmentPayDto,
} from '@shared/interfaces/installment.interface';
import { ExpensePayment } from '@shared/interfaces/expense.interface';

@Injectable({ providedIn: 'root' })
export class InstallmentService {
  private api = inject(ApiService);

  list(params?: { branchId?: string; status?: string }): Observable<InstallmentPlan[]> {
    return this.api.get<InstallmentPlan[]>('installments', params);
  }

  getById(id: string): Observable<InstallmentPlanWithSchedule> {
    return this.api.get<InstallmentPlanWithSchedule>(`installments/${id}`);
  }

  create(dto: InstallmentPlanCreateDto): Observable<InstallmentPlanWithSchedule> {
    return this.api.post<InstallmentPlanWithSchedule>('installments', dto);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`installments/${id}`);
  }

  pay(id: string, scheduleId: string, dto: InstallmentPayDto): Observable<{ payment: ExpensePayment; schedule: any }> {
    return this.api.post<{ payment: ExpensePayment; schedule: any }>(
      `installments/${id}/schedule/${scheduleId}/pay`,
      dto,
    );
  }

  unpay(id: string, scheduleId: string): Observable<{ message: string }> {
    return this.api.delete<{ message: string }>(`installments/${id}/schedule/${scheduleId}/pay`);
  }
}
