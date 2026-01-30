import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Revenue, RevenueCreateDto, RevenueUpdateDto } from '@shared/interfaces/revenue.interface';

export interface RevenueSummary {
  total: number;
  count: number;
  average: number;
  byPaymentMethod: Record<string, number>;
}

@Injectable({
  providedIn: 'root'
})
export class RevenueService {
  private api = inject(ApiService);

  getAllRevenues(params?: { branchId?: string; startDate?: string; endDate?: string }): Observable<Revenue[]> {
    return this.api.get<Revenue[]>('revenues', params);
  }

  getRevenueSummary(params?: { branchId?: string; startDate?: string; endDate?: string }): Observable<RevenueSummary> {
    return this.api.get<RevenueSummary>('revenues/summary', params);
  }

  getRevenueById(id: string): Observable<Revenue> {
    return this.api.get<Revenue>(`revenues/${id}`);
  }

  createRevenue(revenue: RevenueCreateDto): Observable<Revenue> {
    return this.api.post<Revenue>('revenues', revenue);
  }

  updateRevenue(id: string, revenue: RevenueUpdateDto): Observable<Revenue> {
    return this.api.patch<Revenue>(`revenues/${id}`, revenue);
  }

  deleteRevenue(id: string): Observable<Revenue> {
    return this.api.delete<Revenue>(`revenues/${id}`);
  }
}
