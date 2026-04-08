export type SubscriptionStatus = 'TRIAL' | 'MONTHLY' | 'ANNUAL' | 'EXPIRED';

export interface Subscription {
  id: string;
  companyId: string;
  status: SubscriptionStatus;
  price: number;
  trialStartDate: string | null;
  trialEndDate: string | null;
  subscriptionStartDate: string | null;
  subscriptionEndDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
