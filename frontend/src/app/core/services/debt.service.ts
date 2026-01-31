import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  Debt,
  DebtPayment,
  DebtType,
  CompoundingFrequency,
  PaymentSchedule,
  DebtStatus
} from '@shared/interfaces/debt.interface';
import { PaymentMethod } from '@shared/interfaces/withdrawal.interface';

export interface CreateDebtDto {
  debtType: DebtType;
  creditorName: string;
  creditorEmail?: string;
  creditorPhone?: string;
  principalAmount: number;
  interestRate: number;
  compoundingFrequency: CompoundingFrequency;
  takenDate: string;
  dueDate: string;
  paymentSchedule: PaymentSchedule;
  branchId?: string;
  purpose?: string;
  collateral?: string;
  notes?: string;
}

export interface UpdateDebtDto {
  debtType?: DebtType;
  creditorName?: string;
  creditorEmail?: string;
  creditorPhone?: string;
  interestRate?: number;
  dueDate?: string;
  paymentSchedule?: PaymentSchedule;
  purpose?: string;
  collateral?: string;
  notes?: string;
}

export interface CreatePaymentDto {
  paymentDate: string;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  lateFee?: number;
  notes?: string;
}

export interface DebtSummary {
  totalOutstanding: number;
  totalBorrowed: number;
  totalInterestPaid: number;
  activeDebtsCount: number;
  debts: Debt[];
}

@Injectable({
  providedIn: 'root'
})
export class DebtService {
  private api = inject(ApiService);

  create(createDto: CreateDebtDto): Observable<Debt> {
    return this.api.post('debts', createDto);
  }

  findAll(status?: DebtStatus): Observable<Debt[]> {
    const params: any = {};
    if (status) params.status = status;
    return this.api.get('debts', params);
  }

  getSummary(): Observable<DebtSummary> {
    return this.api.get('debts/summary');
  }

  findOne(id: string, includePayments: boolean = false): Observable<Debt> {
    return this.api.get(`debts/${id}`, { includePayments: includePayments.toString() });
  }

  update(id: string, updateDto: UpdateDebtDto): Observable<Debt> {
    return this.api.patch(`debts/${id}`, updateDto);
  }

  remove(id: string): Observable<Debt> {
    return this.api.delete(`debts/${id}`);
  }

  // Debt payments
  createPayment(debtId: string, paymentDto: CreatePaymentDto): Observable<DebtPayment> {
    return this.api.post(`debts/${debtId}/payments`, paymentDto);
  }

  getPayments(debtId: string): Observable<DebtPayment[]> {
    return this.api.get(`debts/${debtId}/payments`);
  }

  deletePayment(debtId: string, paymentId: string): Observable<{ message: string }> {
    return this.api.delete(`debts/${debtId}/payments/${paymentId}`);
  }
}
