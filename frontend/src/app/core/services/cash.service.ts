import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { CashState } from '@shared/interfaces/cash-state.interface';

export interface AdjustCashDto {
  amount: number;
  reason: string;
  notes?: string;
}

export interface CashFlowItem {
  date: string;
  type: string;
  amount: number;
  balance: number;
  description: string;
}

export interface CashFlowResponse {
  startDate?: string;
  endDate?: string;
  items: CashFlowItem[];
}

@Injectable({
  providedIn: 'root'
})
export class CashService {
  private api = inject(ApiService);

  getCurrentCash(): Observable<{ currentCash: number; lastUpdated: string; lastTransactionType: string | null }> {
    return this.api.get('cash/current');
  }

  getCashState(): Observable<CashState> {
    return this.api.get('cash/state');
  }

  adjustCash(adjustDto: AdjustCashDto): Observable<CashState> {
    return this.api.post('cash/adjust', adjustDto);
  }

  getCashFlow(startDate?: string, endDate?: string): Observable<CashFlowResponse> {
    const params: any = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    return this.api.get('cash/flow', params);
  }
}
