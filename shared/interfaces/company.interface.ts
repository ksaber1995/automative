export type SubscriptionTier = 'BASIC' | 'PROFESSIONAL' | 'ENTERPRISE';
export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';

export interface Company {
  id: string;
  name: string;
  code: string;

  // Contact
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  country: string | null;

  // Business
  taxId: string | null;
  registrationNumber: string | null;
  industry: string | null;

  // Subscription (SaaS features)
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  maxBranches: number;
  maxUsers: number;

  // Settings
  timezone: string;
  currency: string;
  locale: string;

  // Status
  isActive: boolean;
  onboardingCompleted: boolean;

  // Audit
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CompanyCreateDto {
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  taxId?: string;
  registrationNumber?: string;
  industry?: string;
  subscriptionTier?: SubscriptionTier;
  timezone?: string;
  currency?: string;
  locale?: string;
}

export interface CompanyUpdateDto {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  taxId?: string;
  registrationNumber?: string;
  industry?: string;
  subscriptionTier?: SubscriptionTier;
  subscriptionStatus?: SubscriptionStatus;
  maxBranches?: number;
  maxUsers?: number;
  timezone?: string;
  currency?: string;
  locale?: string;
  isActive?: boolean;
  onboardingCompleted?: boolean;
}
