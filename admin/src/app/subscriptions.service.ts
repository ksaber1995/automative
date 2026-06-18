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
  /** Registration type chosen at signup: ACADEMY (institution) or TEACHER (individual). */
  company_type: string | null;
  /** Owner's mobile number (E.164-ish, e.g. +201234567890), from the registrant user. */
  mobile: string | null;
  subscription_type: string | null;
  price: number | null;
  start_date: string | null;
  end_date: string | null;
  employee_count: number;
  branch_count: number;
  student_count: number;
  /** Number of students with a paid-activated QR code. */
  qr_activated_count: number;
  /** Total billed for QR activations (sum of qr_price over activated students). */
  qr_total_cost: number;
  /** Billed-but-unpaid QR activation amount. */
  qr_unpaid_cost: number;
}

// Obscure, unauthenticated endpoint on the production API. The path is the only
// gate; the read returns aggregate numbers + company names, which is accepted as
// safe to expose. The write/delete sub-routes are path-gated the same way.
const ADMIN_ENDPOINT =
  'https://xnbgr057y1.execute-api.eu-west-1.amazonaws.com/prod/api/karim-admin-secret';

@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private http = inject(HttpClient);

  getAll(): Observable<CompanySubscription[]> {
    return this.http.get<CompanySubscription[]>(ADMIN_ENDPOINT);
  }

  /** Extend a company's subscription by N months. */
  extend(companyId: string, months: number): Observable<{ success: boolean; end_date: string | null }> {
    return this.http.post<{ success: boolean; end_date: string | null }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/extend`,
      { months },
    );
  }

  /** Switch a company's registration type between ACADEMY and TEACHER. */
  setType(
    companyId: string,
    type: 'ACADEMY' | 'TEACHER',
  ): Observable<{ success: boolean; company_type: string }> {
    return this.http.post<{ success: boolean; company_type: string }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/type`,
      { type },
    );
  }

  /** Mark a company's QR activations as paid / unpaid. */
  setQrPaid(
    companyId: string,
    paid: boolean,
  ): Observable<{ success: boolean; paid: boolean; updated_count: number }> {
    return this.http.post<{ success: boolean; paid: boolean; updated_count: number }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/qr-paid`,
      { paid },
    );
  }

  /** Promote a company's subscription to ACTIVE. */
  activate(companyId: string): Observable<{ success: boolean; subscription_type: string | null }> {
    return this.http.post<{ success: boolean; subscription_type: string | null }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/activate`,
      {},
    );
  }

  /** Permanently delete a company and all its data. Irreversible. */
  delete(companyId: string): Observable<{ success: boolean; company_name: string }> {
    return this.http.delete<{ success: boolean; company_name: string }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}`,
    );
  }
}
