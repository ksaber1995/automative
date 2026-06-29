import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type GlobalExpenseAllocation = 'PROPORTIONAL' | 'EQUAL' | 'OVERHEAD';

export interface CompanySettings {
  id: string;
  name: string;
  globalExpenseAllocation: GlobalExpenseAllocation;
  /** Opt-in: auto start/end sessions on their scheduled times (client-polled). */
  autoManageSessions: boolean;
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
}
