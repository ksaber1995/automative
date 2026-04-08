import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { Subscription } from '@shared/interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private api = inject(ApiService);

  subscription = signal<Subscription | null>(null);

  /** True if trial has expired */
  isTrialExpired = computed(() => {
    const s = this.subscription();
    if (!s || s.status !== 'TRIAL') return false;
    if (!s.trialEndDate) return false;
    return new Date(s.trialEndDate) < new Date(new Date().toDateString());
  });

  /** True if paid subscription has expired */
  isSubscriptionExpired = computed(() => {
    const s = this.subscription();
    if (!s || (s.status !== 'MONTHLY' && s.status !== 'ANNUAL')) return false;
    if (!s.subscriptionEndDate) return false;
    return new Date(s.subscriptionEndDate) < new Date(new Date().toDateString());
  });

  /** Days until expiry (negative = already expired) */
  daysUntilExpiry = computed(() => {
    const s = this.subscription();
    if (!s) return null;
    const endDate = s.status === 'TRIAL' ? s.trialEndDate : s.subscriptionEndDate;
    if (!endDate) return null;
    const diff = new Date(endDate).getTime() - new Date(new Date().toDateString()).getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  });

  /** Show 7-day warning for paid subscriptions */
  showExpiryWarning = computed(() => {
    const s = this.subscription();
    if (!s || (s.status !== 'MONTHLY' && s.status !== 'ANNUAL')) return false;
    const days = this.daysUntilExpiry();
    return days !== null && days >= 0 && days <= 7;
  });

  /** True if access should be completely blocked */
  isBlocked = computed(() => this.isTrialExpired() || this.isSubscriptionExpired());

  load(): Observable<Subscription> {
    return this.api.get<Subscription>('subscription').pipe(
      tap(s => this.subscription.set(s))
    );
  }
}
