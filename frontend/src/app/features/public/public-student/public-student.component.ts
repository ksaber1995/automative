import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { PublicStudentService, PublicStudentProfile } from '../public-student.service';

/**
 * Public, read-only student profile shown when a student's QR code is scanned
 * (with any phone camera, outside the app). NO authentication. Mounted at the
 * app root, outside the LayoutComponent/authGuard wrapper, so there is no
 * sidebar/header chrome — it stands alone.
 *
 * Bilingual (EN/AR) with a language toggle at the top. LanguageService (a root
 * singleton) flips document direction to RTL for Arabic, so the whole page
 * mirrors automatically.
 *
 * Shows only low-sensitivity data (name, academy/branch, course list with
 * coarse status, attendance summary). Financial amounts, contact info, and
 * notes are deliberately NOT exposed here — see routes/public-students.ts.
 */
@Component({
  selector: 'app-public-student',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  templateUrl: './public-student.component.html',
})
export class PublicStudentComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private service = inject(PublicStudentService);
  private translate = inject(TranslateService);
  // Public so the template can bind the toggle + react to language changes.
  languageService = inject(LanguageService);

  loading = signal(true);
  error = signal(false);
  profile = signal<PublicStudentProfile | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('qrToken') || '';
    if (!token) {
      this.loading.set(false);
      this.error.set(true);
      return;
    }
    this.service.getProfile(token).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  formatDate(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Translate a payment-status enum, falling back to the raw value. */
  paymentLabel(status: string): string {
    return this.enumLabel('PUBLIC_PROFILE.PAYMENT.', status);
  }

  /** Translate an enrollment-status enum, falling back to the raw value. */
  statusLabel(status: string): string {
    return this.enumLabel('PUBLIC_PROFILE.STATUS.', status);
  }

  private enumLabel(prefix: string, value: string): string {
    if (!value) return '';
    const key = prefix + value.toUpperCase();
    const translated = this.translate.instant(key);
    return translated === key ? value : translated;
  }

  statusClass(status: string): string {
    switch ((status || '').toUpperCase()) {
      case 'PAID':
        return 'bg-green-100 text-green-700';
      case 'PARTIAL':
        return 'bg-amber-100 text-amber-700';
      case 'PENDING':
        return 'bg-gray-100 text-gray-600';
      case 'REFUNDED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }
}
