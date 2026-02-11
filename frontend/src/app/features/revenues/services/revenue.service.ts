import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export interface RevenueItem {
  id: string;
  branchId: string;
  branchName: string;
  source: 'ENROLLMENT' | 'PRODUCT_SALE';
  sourceId: string;
  amount: number;
  description: string;
  date: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  studentName: string | null;
  courseName: string | null;
  productName: string | null;
  createdAt: string;
}

export interface RevenueSummary {
  totalRevenue: number;
  enrollmentRevenue: number;
  productRevenue: number;
  byBranch: Array<{
    branchId: string;
    branchName: string;
    revenue: number;
  }>;
  byMonth: Array<{
    month: string;
    revenue: number;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class RevenueService {
  private api = inject(ApiService);

  // Get revenue list (calculated from enrollments and product sales)
  getRevenues(params?: {
    branchId?: string;
    source?: 'ENROLLMENT' | 'PRODUCT_SALE' | 'ALL';
    startDate?: string;
    endDate?: string;
  }): Observable<RevenueItem[]> {
    return this.api.get<RevenueItem[]>('revenues', params);
  }

  // Get revenue summary with aggregated data
  getRevenueSummary(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }): Observable<RevenueSummary> {
    return this.api.get<RevenueSummary>('revenues/summary', params);
  }
}
