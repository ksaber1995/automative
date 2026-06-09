import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** One row of the cross-tenant subscriptions view (see server/index.js). */
export interface CompanySubscription {
  company_id: string;
  company_name: string;
  company_active: boolean;
  currency: string | null;
  company_created_at: string;
  subscription_type: string | null;
  price: number | null;
  start_date: string | null;
  end_date: string | null;
  employee_count: number;
  branch_count: number;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private http = inject(HttpClient);

  getAll(): Observable<CompanySubscription[]> {
    return this.http.get<CompanySubscription[]>('/api/subscriptions');
  }
}
