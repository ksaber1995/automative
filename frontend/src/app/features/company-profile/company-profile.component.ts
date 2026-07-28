import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { SkeletonModule } from 'primeng/skeleton';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CompanyProfile, CompanyQrSummary, CompanyService } from '../../core/services/company.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-company-profile',
  standalone: true,
  imports: [
    CommonModule, DatePipe, FormsModule, CardModule, TagModule, ButtonModule,
    InputTextModule, TooltipModule, SkeletonModule, TranslateModule,
  ],
  templateUrl: './company-profile.component.html',
})
export class CompanyProfileComponent implements OnInit {
  private companyService = inject(CompanyService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private translate = inject(TranslateService);

  loading = signal(true);
  profile = signal<CompanyProfile | null>(null);
  upgrading = signal(false);

  /** QR billing panel is only meaningful for TEACHER-type companies. */
  isTeacher = (): boolean => this.authService.isTeacher();

  /** Plan card is academy-only. */
  isAcademy = (): boolean => !this.authService.isTeacher();
  plan = computed<'SIMPLE' | 'ADVANCED'>(() => this.profile()?.company.plan === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE');

  upgrade() {
    if (this.upgrading()) return;
    this.upgrading.set(true);
    this.companyService.upgradePlan('ADVANCED').subscribe({
      next: () => {
        this.upgrading.set(false);
        this.notify.success(this.translate.instant('COMPANY_PROFILE.PLAN_UPGRADED'));
        // Reflect locally, refresh the profile, and refresh the signed-in user so
        // the CRM sidebar appears without a re-login.
        const p = this.profile();
        if (p) this.profile.set({ ...p, company: { ...p.company, plan: 'ADVANCED' } });
        this.authService.refreshUser();
      },
      error: () => this.upgrading.set(false),
    });
  }

  // ── Phone, edited in place ────────────────────────────────────────────────
  // Only an admin may save it (the API says so too); everyone else reads it.
  canEditPhone = (): boolean => this.authService.isGlobalAdmin();
  editingPhone = signal(false);
  phoneDraft = signal('');
  savingPhone = signal(false);

  startEditPhone() {
    this.phoneDraft.set(this.profile()?.company.phone ?? '');
    this.editingPhone.set(true);
  }

  cancelEditPhone() {
    this.editingPhone.set(false);
  }

  savePhone() {
    if (this.savingPhone()) return;
    this.savingPhone.set(true);
    this.companyService.updateContact(this.phoneDraft().trim()).subscribe({
      next: (res) => {
        this.savingPhone.set(false);
        this.editingPhone.set(false);
        // Show what the server stored, not what was typed — it normalises
        // spaces and turns a leading 00 into +.
        const p = this.profile();
        if (p) this.profile.set({ ...p, company: { ...p.company, phone: res.phone } });
        this.notify.success(this.translate.instant('COMPANY_PROFILE.PHONE_SAVED'));
      },
      error: (err) => {
        this.savingPhone.set(false);
        const code = err?.error?.code;
        this.notify.error(
          code ? this.translate.instant(code) : this.translate.instant('COMPANY_PROFILE.PHONE_SAVE_FAILED')
        );
      },
    });
  }

  qr = computed<CompanyQrSummary | null>(() => this.profile()?.qr ?? null);

  /** A teacher tenant, once activated (non-TRIAL), is active forever. */
  foreverActive = computed<boolean>(() => {
    const sub = this.profile()?.subscription;
    return this.isTeacher() && !!sub && sub.status !== 'TRIAL';
  });

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
