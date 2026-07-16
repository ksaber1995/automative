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
 * Shows the student's academy/branch, courses, attendance, exam grades and — at
 * the owner's explicit request — their full payment history across all three
 * billing models. Contact info, address and notes are still withheld.
 *
 * NOTE: the payment history is behind nothing but the QR token, which is printed
 * on a card the student carries. See the PRIVACY note on routes/public-students.ts.
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

  /** Date + time of day, for a check-in ("14 Jul 2026, 16:32"). */
  formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return d.toLocaleString(locale, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  /** Time of day only, for the arrival time beside a session's date. */
  formatTime(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }

  /** "August 2026" for a billing period. */
  monthLabel(year: number, month: number): string {
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  /** Money as the parent should read it. Kept plain — no currency guessing. */
  money(value: number | null | undefined): string {
    const n = Number(value ?? 0);
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      // A session covered by a prepaid bundle, or waived, is settled as far as the
      // parent is concerned — nothing more to hand over.
      case 'COVERED':
      case 'WAIVED':
      case 'ACTIVE':
        return 'bg-green-100 text-green-700';
      case 'PARTIAL':
        return 'bg-amber-100 text-amber-700';
      case 'OVERDUE':
        return 'bg-red-100 text-red-700';
      case 'PENDING':
      case 'EXHAUSTED':
        return 'bg-gray-100 text-gray-600';
      case 'REFUNDED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }
}
