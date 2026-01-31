import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Withdrawal, WithdrawalCategory, PaymentMethod, WithdrawalStakeholder } from '@shared/interfaces/withdrawal.interface';

export interface CreateWithdrawalDto {
  amount: number;
  stakeholders: WithdrawalStakeholder[];
  withdrawalDate: string;
  reason: string;
  category: WithdrawalCategory;
  paymentMethod: PaymentMethod;
  notes?: string;
}

export interface UpdateWithdrawalDto {
  stakeholders?: WithdrawalStakeholder[];
  reason?: string;
  category?: WithdrawalCategory;
  paymentMethod?: PaymentMethod;
  notes?: string;
}

export interface WithdrawalSummary {
  totalWithdrawals: number;
  totalAmount: number;
  byCategory: {
    category: string;
    amount: number;
    count: number;
  }[];
  byStakeholder: {
    name: string;
    amount: number;
    count: number;
  }[];
  withdrawals: Withdrawal[];
}

@Injectable({
  providedIn: 'root'
})
export class WithdrawalService {
  private api = inject(ApiService);

  createWithdrawal(createDto: CreateWithdrawalDto): Observable<Withdrawal> {
    return this.api.post('withdrawals', createDto);
  }

  findAll(startDate?: string, endDate?: string): Observable<Withdrawal[]> {
    const params: any = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return this.api.get('withdrawals', params);
  }

  getSummary(startDate?: string, endDate?: string): Observable<WithdrawalSummary> {
    const params: any = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return this.api.get('withdrawals/summary', params);
  }

  getByStakeholder(stakeholderName: string): Observable<Withdrawal[]> {
    return this.api.get(`withdrawals/stakeholder/${encodeURIComponent(stakeholderName)}`);
  }

  findOne(id: string): Observable<Withdrawal> {
    return this.api.get(`withdrawals/${id}`);
  }

  update(id: string, updateDto: UpdateWithdrawalDto): Observable<Withdrawal> {
    return this.api.patch(`withdrawals/${id}`, updateDto);
  }

  remove(id: string): Observable<{ message: string }> {
    return this.api.delete(`withdrawals/${id}`);
  }
}
