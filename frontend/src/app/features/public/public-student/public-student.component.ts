import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { PublicStudentService, PublicStudentProfile, PublicUnassignedCard } from '../public-student.service';
import { formatStudentCode } from '../../../core/utils/student-code.util';
import { ratingLabelKey } from '../../exams/homework-rating.util';

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

  // ── Course filter ───────────────────────────────────────────────────────────
  // A student with several courses (= several teachers) gets one blended page;
  // the filter answers the parent's real question — attendance and dues for
  // WHICH teacher/course. 'ALL' shows everything, as before.
  courseFilter = signal<string>('ALL');

  /** The courses to filter by, labelled with the teacher when known. */
  courseOptions = (): { name: string; label: string }[] => {
    const p = this.profile();
    if (!p) return [];
    const teacherByCourse = new Map<string, string>();
    for (const r of p.attendance?.recent ?? []) {
      if (r.courseName && r.teacherName && !teacherByCourse.has(r.courseName)) {
        teacherByCourse.set(r.courseName, r.teacherName);
      }
    }
    const names = new Set<string>();
    for (const r of p.attendance?.recent ?? []) if (r.courseName) names.add(r.courseName);
    for (const c of p.courses ?? []) if (c.courseName) names.add(c.courseName);
    for (const m of p.payments?.monthly ?? []) names.add(m.courseName);
    for (const s of p.payments?.sessions ?? []) names.add(s.courseName);
    for (const pk of p.payments?.packages ?? []) names.add(pk.courseName);
    for (const o of p.payments?.oneTime ?? []) names.add(o.courseName);
    return [...names].map((n) => ({
      name: n,
      label: teacherByCourse.has(n) ? `${n} — ${teacherByCourse.get(n)}` : n,
    }));
  };

  private matchCourse = (name: string | null | undefined): boolean =>
    this.courseFilter() === 'ALL' || name === this.courseFilter();

  attendanceRows = () =>
    (this.profile()?.attendance?.recent ?? []).filter((r) => this.matchCourse(r.courseName));
  /** The list shown — the filtered set, newest first, kept to a readable length. */
  recentRows = () => this.attendanceRows().slice(0, 15);

  /** The three tiles: server totals unfiltered, recomputed per course when filtered. */
  attendanceTiles = () => {
    const p = this.profile()!;
    if (this.courseFilter() === 'ALL') {
      return { rate: p.attendance.attendanceRate, present: p.attendance.presentCount, absent: p.attendance.absentCount };
    }
    const rows = this.attendanceRows();
    const present = rows.filter((r) => r.status !== 'ABSENT').length;
    return { rate: rows.length ? Math.round((present / rows.length) * 100) : 0, present, absent: rows.length - present };
  };

  monthlyRows = () => (this.profile()?.payments?.monthly ?? []).filter((m) => this.matchCourse(m.courseName));
  sessionRows = () => (this.profile()?.payments?.sessions ?? []).filter((s) => this.matchCourse(s.courseName));
  packageRows = () => (this.profile()?.payments?.packages ?? []).filter((pk) => this.matchCourse(pk.courseName));
  oneTimeRows = () => (this.profile()?.payments?.oneTime ?? []).filter((o) => this.matchCourse(o.courseName));
  /** Set when the token is a blank pool card rather than a student's. */
  unassignedCard = signal<PublicUnassignedCard | null>(null);

  /** The number printed on the card, e.g. "A-42". */
  cardCode = () => {
    const c = this.unassignedCard();
    return c ? formatStudentCode(c.serial) : '';
  };

  // Exams and homework arrive in one list because they share a table, but they
  // answer different questions for a parent — "how did they do on the test" vs
  // "are they doing the work" — so the page shows them as two sections.
  /**
   * Nothing owed on any billing model — worth saying out loud, since the
   * alternative is a blank space that reads as a failure. On the total, not
   * the lists: a fully-paid ACTIVE package still shows (for its remaining
   * sessions), and its presence must not hide the "all settled" banner.
   */
  nothingDue = () => {
    const p = this.profile()?.payments;
    if (!p) return false;
    return (p.totalOutstanding ?? 0) <= 0.005;
  };

  examOnly = () => (this.profile()?.exams ?? []).filter(e => !e.isHomework);
  homeworkOnly = () => (this.profile()?.exams ?? []).filter(e => e.isHomework === true);

  /**
   * A mark recorded by rating reads as the word the teacher chose — "Excellent",
   * not a bare 5, which would mean nothing to a parent without the scale. Returns
   * '' for anything that isn't one of the five, and the page falls back to the
   * number.
   */
  ratingLabel(grade: string | number | null | undefined): string {
    const key = ratingLabelKey(grade);
    return key ? this.translate.instant(key) : '';
  }

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
      // No student behind this token. Before giving up, check whether it's a
      // pool card nobody has been given yet — whoever scanned it is holding a
      // real card and deserves to know whose it is, not a dead end.
      error: () => this.lookUpUnassignedCard(token),
    });
  }

  private lookUpUnassignedCard(token: string): void {
    this.service.getUnassignedCard(token).subscribe({
      next: (card) => {
        this.unassignedCard.set(card);
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

  /**
   * en-GB writes the meridiem lowercase ("4:32 pm"); every other screen in the
   * app shows "PM". Latin-only, so Arabic's ص/م passes through untouched.
   */
  private upperMeridiem(s: string): string {
    return s.replace(/\b(am|pm)\b/gi, m => m.toUpperCase());
  }

  /**
   * Date + time of day, for a check-in ("14 Jul 2026, 04:32 PM").
   *
   * hour12 is forced: en-GB would otherwise render 16:32, and this page is read
   * by parents, who read the clock the way they say it. Arabic gets ص/م.
   */
  formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return this.upperMeridiem(d.toLocaleString(locale, {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    }));
  }

  /** Time of day only, for the arrival time beside a session's date. */
  formatTime(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const locale = this.languageService.currentLang() === 'ar' ? 'ar-EG' : 'en-GB';
    return this.upperMeridiem(d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true }));
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
