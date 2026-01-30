import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { DashboardMetrics, BranchFinancialSummary, DateRangeQuery } from '@shared/interfaces/analytics.interface';

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  private api = inject(ApiService);

  getDashboard(dateRange?: DateRangeQuery): Observable<DashboardMetrics> {
    const params = dateRange ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : {};
    return this.api.get<DashboardMetrics>('analytics/dashboard', params);
  }

  getBranchAnalytics(branchId: string, dateRange?: DateRangeQuery): Observable<any> {
    const params = dateRange ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : {};
    return this.api.get<any>(`analytics/branch/${branchId}`, params);
  }

  getRevenueTrends(dateRange?: DateRangeQuery): Observable<any[]> {
    const params = dateRange ? { startDate: dateRange.startDate, endDate: dateRange.endDate } : {};
    return this.api.get<any[]>('analytics/revenue-trends', params);
  }

  getProfitLoss(branchId?: string, dateRange?: DateRangeQuery): Observable<any> {
    const params: any = {};
    if (branchId) params.branchId = branchId;
    if (dateRange) {
      params.startDate = dateRange.startDate;
      params.endDate = dateRange.endDate;
    }
    return this.api.get<any>('analytics/profit-loss', params);
  }
}
