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
  /** Owner (registrant) user's email. */
  owner_email: string | null;
  subscription_type: string | null;
  price: number | null;
  start_date: string | null;
  end_date: string | null;
  employee_count: number;
  branch_count: number;
  student_count: number;
  course_count: number;
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

  /** Platform-owned Telegram bot pool: list bots + which company claimed each. */
  listTelegramBots(): Observable<{ bots: PoolBot[]; total: number; available: number }> {
    return this.http.get<{ bots: PoolBot[]; total: number; available: number }>(
      `${ADMIN_ENDPOINT}/telegram-bots`,
    );
  }

  /** Add a bot (created in @BotFather) to the pool. */
  addTelegramBot(botToken: string): Observable<{ success: boolean; bot_username: string; total: number; available: number }> {
    return this.http.post<{ success: boolean; bot_username: string; total: number; available: number }>(
      `${ADMIN_ENDPOINT}/telegram-bots`,
      { botToken },
    );
  }

  // ── Offline licenses (desktop app keys) ────────────────────────────────────

  /** List every offline license key issued. */
  listLicenses(): Observable<OfflineLicense[]> {
    return this.http.get<OfflineLicense[]>(`${ADMIN_ENDPOINT}/licenses`);
  }

  /** Mint a new license key. Returns the created row (has the licenseKey to email). */
  createLicense(body: { tier?: 'TEACHER' | 'ACADEMY'; label?: string; phone?: string; notes?: string }): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses`, body);
  }

  /** Set/clear the customer's contact phone number. */
  setPhone(id: string, phone: string | null): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/phone`, { phone });
  }

  /** Issue the product license key for a paid customer (generates it on their row). */
  issueLicense(id: string): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/issue`, {});
  }

  /** Change the trial expiry to a specific date (ISO / YYYY-MM-DD). */
  setTrialEndDate(id: string, trialEndsAt: string): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/trial-end`, { trialEndsAt });
  }

  /**
   * Activate a license. Renewal day defaults to one year out when
   * activationEndsAt is null/omitted. `price` records the annual renewal fee.
   */
  activateLicense(
    id: string,
    activationEndsAt?: string | null,
    price?: number | null
  ): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/activate`, {
      activationEndsAt,
      price,
    });
  }

  /** Set/clear the recorded annual renewal price. */
  setPrice(id: string, price: number | null): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/price`, { price });
  }

  /** Push the trial end out by N days. */
  extendTrial(id: string, days: number): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/extend-trial`, { days });
  }

  /** Unbind the license from its current device so it can be re-activated elsewhere. */
  resetDevice(id: string): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/reset-device`, {});
  }

  /** Switch a license between TEACHER and ACADEMY tiers. */
  setTier(id: string, tier: 'TEACHER' | 'ACADEMY'): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/tier`, { tier });
  }

  /** Revoke / un-revoke a license. */
  setRevoked(id: string, revoked: boolean): Observable<OfflineLicense> {
    return this.http.post<OfflineLicense>(`${ADMIN_ENDPOINT}/licenses/${id}/revoke`, { revoked });
  }

  /** Permanently delete a license row. */
  deleteLicense(id: string): Observable<{ deleted: true }> {
    return this.http.delete<{ deleted: true }>(`${ADMIN_ENDPOINT}/licenses/${id}`);
  }
}

/** One offline (desktop) license key. Dates are ISO strings or null. */
export interface OfflineLicense {
  id: string;
  licenseKey: string | null;
  tier: 'TEACHER' | 'ACADEMY';
  label: string | null;
  name: string | null;
  phone: string | null;
  notes: string | null;
  deviceId: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  activated: boolean;
  activationEndsAt: string | null;
  revoked: boolean;
  /** Annual renewal fee recorded at activation (owner bookkeeping). */
  price: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One bot in the platform-owned Telegram pool. */
export interface PoolBot {
  id: string;
  bot_username: string;
  assigned_company_id: string | null;
  company_name: string | null;
  assigned_at: string | null;
}
