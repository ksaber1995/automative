import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { CardDesign } from '@shared/interfaces/card-design.interface';

export type GlobalExpenseAllocation = 'PROPORTIONAL' | 'EQUAL' | 'OVERHEAD';

/**
 * How a homework mark is entered. RATING replaces the number box with a fixed
 * list — Excellent down to Weak — which is still stored as a number (5…1), so
 * results, reports and the student page are unchanged.
 */
export type HomeworkGradingMode = 'NUMERIC' | 'RATING';

export interface CompanySettings {
  id: string;
  name: string;
  globalExpenseAllocation: GlobalExpenseAllocation;
  /** Opt-in: auto start/end sessions on their scheduled times (client-polled). */
  autoManageSessions: boolean;
  homeworkGradingMode: HomeworkGradingMode;
  /** Free (trial) sessions one student may ever attend. 0 = unlimited. */
  freeSessionTrialLimit: number;
}

export interface CompanyProfileData {
  id: string;
  name: string;
  code: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  industry: string | null;
  plan?: 'SIMPLE' | 'ADVANCED';
  timezone: string | null;
  currency: string | null;
  locale: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyProfileSubscription {
  status: 'TRIAL' | 'MONTHLY' | 'ANNUAL' | 'EXPIRED' | string;
  price: number;
  trialStartDate: string | null;
  trialEndDate: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
}

export interface CompanyQrSummary {
  studentCount: number;
  activatedCount: number;
  oneYearCount: number;
  lifelongCount: number;
  totalCost: number;
  paidCost: number;
  unpaidCost: number;
  currency: string;
}

export interface CompanyProfile {
  company: CompanyProfileData;
  subscription: CompanyProfileSubscription | null;
  qr?: CompanyQrSummary;
}

@Injectable({ providedIn: 'root' })
export class CompanyService {
  private api = inject(ApiService);

  getSettings(): Observable<CompanySettings> {
    return this.api.get<CompanySettings>('companies/settings');
  }

  updateSettings(settings: Partial<CompanySettings>): Observable<CompanySettings> {
    return this.api.patch<CompanySettings>('companies/settings', settings);
  }

  getProfile(): Observable<CompanyProfile> {
    return this.api.get<CompanyProfile>('companies/profile');
  }

  /** The tenant's own contact number. Empty string clears it. */
  updateContact(phone: string): Observable<{ id: string; phone: string | null }> {
    return this.api.patch<{ id: string; phone: string | null }>('companies/contact', { phone });
  }

  upgradePlan(plan: 'SIMPLE' | 'ADVANCED'): Observable<{ plan: string }> {
    return this.api.post<{ plan: string }>('companies/upgrade-plan', { plan });
  }

  /** Shared back face of the printed student ID cards. Server fills in defaults. */
  getCardDesign(): Observable<CardDesign> {
    return this.api.get<CardDesign>('companies/card-design');
  }

  updateCardDesign(design: CardDesign): Observable<CardDesign> {
    return this.api.put<CardDesign>('companies/card-design', design);
  }
}
