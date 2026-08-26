import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CurrentCashResponse {
  totalCash: number;
  baseCash?: number;
  adjustmentsTotal?: number;
  unallocatedAdjustments?: number;
  unallocatedRevenue?: number;
  unallocatedExpenses?: number;
  unallocatedNet?: number;
  sumBranchCash?: number;
  byBranch: BranchCash[];
  /** Student money attributed per teacher — informational, never sums to the drawer. */
  byTeacher?: TeacherCash[];
}

export interface TeacherCash {
  teacherId: string;
  teacherName: string;
  total: number;
}

export interface BranchCash {
  branchId: string;
  branchName: string;
  baseCash?: number;
  branchAdjustments?: number;
  distributedAdjustments?: number;
  cash: number;
}

export type CashAdjustmentType = 'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT';

export interface CashAdjustmentRecord {
  id: string;
  companyId: string;
  branchId: string | null;
  branchName: string | null;
  type: CashAdjustmentType;
  amount: number;
  observedAmount: number | null;
  systemAmount: number | null;
  date: string;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface CreateCashAdjustmentDto {
  type: CashAdjustmentType;
  branchId?: string | null;
  amount?: number;
  observedAmount?: number;
  date?: string;
  notes?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class CashService {
  private api = inject(ApiService);

  getCurrentCash(): Observable<CurrentCashResponse> {
    return this.api.get<CurrentCashResponse>('cash/current');
  }

  listAdjustments(branchId?: string | null): Observable<CashAdjustmentRecord[]> {
    const params: any = {};
    if (branchId === null) params.branchId = 'NULL';
    else if (branchId) params.branchId = branchId;
    return this.api.get<CashAdjustmentRecord[]>('cash/adjustments', params);
  }

  createAdjustment(dto: CreateCashAdjustmentDto): Observable<CashAdjustmentRecord> {
    return this.api.post<CashAdjustmentRecord>('cash/adjust', dto);
  }

  deleteAdjustment(id: string): Observable<{ message: string; id: string }> {
    return this.api.delete<{ message: string; id: string }>(`cash/adjustments/${id}`);
  }
}
