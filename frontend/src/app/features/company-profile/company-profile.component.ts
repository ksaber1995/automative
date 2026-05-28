import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { SkeletonModule } from 'primeng/skeleton';
import { TranslateModule } from '@ngx-translate/core';
import { CompanyProfile, CompanyService } from '../../core/services/company.service';

@Component({
  selector: 'app-company-profile',
  standalone: true,
  imports: [CommonModule, DatePipe, CardModule, TagModule, SkeletonModule, TranslateModule],
  templateUrl: './company-profile.component.html',
})
export class CompanyProfileComponent implements OnInit {
  private companyService = inject(CompanyService);

  loading = signal(true);
  profile = signal<CompanyProfile | null>(null);

  registrationType = computed<'TRIAL' | 'SUBSCRIPTION' | null>(() => {
    const sub = this.profile()?.subscription;
    if (!sub) return null;
    return sub.status === 'TRIAL' ? 'TRIAL' : 'SUBSCRIPTION';
  });

  expirationDate = computed<string | null>(() => {
    const sub = this.profile()?.subscription;
    if (!sub) return null;
    return sub.status === 'TRIAL' ? sub.trialEndDate : sub.subscriptionEndDate;
  });

  daysUntilExpiry = computed<number | null>(() => {
    const date = this.expirationDate();
    if (!date) return null;
    const diff = new Date(date).getTime() - new Date(new Date().toDateString()).getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  });

  expirySeverity = computed<'success' | 'warn' | 'danger'>(() => {
    const days = this.daysUntilExpiry();
    if (days === null) return 'success';
    if (days < 0) return 'danger';
    if (days <= 7) return 'warn';
    return 'success';
  });

  fullAddress = computed<string>(() => {
    const c = this.profile()?.company;
    if (!c) return '';
    const parts = [c.address, c.city, c.state, c.zipCode, c.country].filter((v): v is string => !!v);
    return parts.join(', ');
  });

  ngOnInit() {
    this.companyService.getProfile().subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
