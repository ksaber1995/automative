import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

export type RevenueSource = 'ENROLLMENT' | 'PRODUCT_SALE' | 'MASTER_ENROLLMENT' | 'EVENT' | 'SUBSCRIPTION' | 'SESSION';

export interface RevenueItem {
  id: string;
  branchId: string | null;
  branchName: string | null;
  source: RevenueSource;
  sourceId: string;
  studentId: string | null;
  amount: number;
  totalRefunded: number;
  description: string;
  date: string;
  paymentMethod: string | null;
  paymentStatus: string | null;
  studentName: string | null;
  courseName: string | null;
  productName: string | null;
  eventId: string | null;
  eventName: string | null;
  createdAt: string;
}

export interface RevenueSummary {
  /** Net of refunds — the per-source figures below are gross. */
  totalRevenue: number;
  totalRefunds: number;
  enrollmentRevenue: number;
  productRevenue: number;
  masterRevenue: number;
  eventRevenue: number;
  /** Monthly subscription collections, dated per payment. */
  subscriptionRevenue: number;
  sessionRevenue: number;
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

  // Get revenue list (calculated from enrollments, product sales, master bundles,
  // and event subscriptions).
  getRevenues(params?: {
    branchId?: string;
    source?: RevenueSource | 'ALL';
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
