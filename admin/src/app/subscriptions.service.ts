import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../environments/environment';

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
  /** SMS entitlement: switched on, until when, and whether that adds up today. */
  sms_activated: boolean;
  /** YYYY-MM-DD, or null for no end date — which is NOT the same as expired. */
  sms_expiration: string | null;
  /** The derived answer the server computes; never re-derive it here. */
  sms_active: boolean;
  subscription_type: string | null;
  price: number | null;
  start_date: string | null;
  end_date: string | null;
  employee_count: number;
  branch_count: number;
  student_count: number;
  course_count: number;
}

// Where the admin API lives. Absolute against the execute-api host in local
// development; a relative /api path when deployed, where CloudFront proxies it
// same-origin — see src/environments/.
//
// Exported because the Cards section and the sign-in talk to the same endpoint:
// one constant, so a moved API can never leave half the console pointing at the
// old one.
export const ADMIN_ENDPOINT = environment.adminEndpoint;

/** A user account inside a tenant, as this console sees it. Never a password. */
export interface TenantUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  company_id: string | null;
  company_name: string | null;
  created_at: string | null;
}

/** Mirrors the users.role CHECK constraint in the database. */
export const USER_ROLES = [
  'ADMIN', 'ACADEMIC_MANAGER', 'SALES_MANAGER',
  'BRANCH_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'VIEWER',
];

@Injectable({ providedIn: 'root' })
export class SubscriptionsService {
  private http = inject(HttpClient);

  getAll(): Observable<CompanySubscription[]> {
    return this.http.get<CompanySubscription[]>(ADMIN_ENDPOINT);
  }

  /** Extend a company's subscription by N months. */
  extend(
    companyId: string,
    months: number,
  ): Observable<{ success: boolean; end_date: string | null; subscription_type?: string | null }> {
    return this.http.post<{ success: boolean; end_date: string | null; subscription_type?: string | null }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/extend`,
      { months },
    );
  }

  /**
   * Switch a tenant's SMS entitlement on or off, and set the date it runs to.
   *
   * Pass `expiration: null` for no end date, or omit it entirely to leave the
   * stored date untouched — flipping the flag back on should not wipe the date
   * the tenant was sold.
   */
  setSmsAccess(
    companyId: string,
    activated: boolean,
    expiration?: string | null,
  ): Observable<{ success: boolean; sms_activated: boolean; sms_expiration: string | null; sms_active: boolean }> {
    const body: { activated: boolean; expiration?: string | null } = { activated };
    if (expiration !== undefined) body.expiration = expiration;
    return this.http.post<{ success: boolean; sms_activated: boolean; sms_expiration: string | null; sms_active: boolean }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/sms`,
      body,
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

  // ── Pre-printed QR cards, per client ──────────────────────────────────────
  // The pool is sold per academy: off until we switch it on, and we can mint a
  // print run for them without signing in as them.

  /** Is the pool on for this client, and how big is it. */
  qrCardStats(companyId: string): Observable<{ qr_cards_enabled: boolean; total: number; linked: number }> {
    return this.http.get<{ qr_cards_enabled: boolean; total: number; linked: number }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/qr-cards`,
    );
  }

  /** Turn the pool on or off for one client. */
  setQrCardsEnabled(companyId: string, enabled: boolean): Observable<{ success: boolean; qr_cards_enabled: boolean }> {
    return this.http.post<{ success: boolean; qr_cards_enabled: boolean }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/qr-cards/enabled`,
      { enabled },
    );
  }

  /**
   * Mint a print run for a client. Serials continue from their last one.
   * poolType (1/2/3) labels the run; it does not affect serials.
   */
  generateQrCards(companyId: string, count: number, poolType: PoolType): Observable<GenerateQrCardsResult> {
    return this.http.post<GenerateQrCardsResult>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/qr-cards`,
      { count, poolType },
    );
  }

  /**
   * Throw away a client's pool. Cards already linked to a student are kept
   * unless includeLinked is set — those are in a student's pocket.
   */
  deleteQrCards(companyId: string, includeLinked: boolean): Observable<DeleteQrCardsResult> {
    return this.http.delete<DeleteQrCardsResult>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/qr-cards?includeLinked=${includeLinked}`,
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

  /** Park a tenant who stopped paying. Reversible: activate() puts them back. */
  deactivate(companyId: string): Observable<{ success: boolean; subscription_type: string | null }> {
    return this.http.post<{ success: boolean; subscription_type: string | null }>(
      `${ADMIN_ENDPOINT}/companies/${companyId}/deactivate`,
      {},
    );
  }

  /** Every user account, or just one tenant's. */
  listUsers(companyId?: string): Observable<TenantUser[]> {
    const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
    return this.http.get<TenantUser[]>(`${ADMIN_ENDPOINT}/users${qs}`);
  }

  createUser(body: {
    companyId: string; email: string; password: string; firstName: string; lastName: string; role: string;
  }): Observable<TenantUser> {
    return this.http.post<TenantUser>(`${ADMIN_ENDPOINT}/users`, body);
  }

  deleteUser(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${ADMIN_ENDPOINT}/users/${id}`);
  }

  /**
   * Move an account into another tenant (for a debugging login). Drops the
   * user's branch, linked employee and permissions — they belong to the old
   * tenant. The moved account must log in again before it sees the new one.
   */
  moveUserCompany(id: string, companyId: string): Observable<TenantUser> {
    return this.http.patch<TenantUser>(`${ADMIN_ENDPOINT}/users/${id}/company`, { companyId });
  }
}

/** The types a QR card print run can be stamped with. Meaning is not fixed yet. */
export type PoolType = 1 | 2 | 3;
export const POOL_TYPES: PoolType[] = [1, 2, 3];

export interface GenerateQrCardsResult {
  success: boolean;
  created: number;
  from: number;
  to: number;
  poolType: number;
}

export interface DeleteQrCardsResult {
  success: boolean;
  deleted: number;
  unlinkedStudents: number;
  keptLinked: number;
  remaining: number;
}

/** One bot in the platform-owned Telegram pool. */
export interface PoolBot {
  id: string;
  bot_username: string;
  assigned_company_id: string | null;
  company_name: string | null;
  assigned_at: string | null;
}
