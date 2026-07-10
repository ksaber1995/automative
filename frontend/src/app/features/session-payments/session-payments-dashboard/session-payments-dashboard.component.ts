import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin, Observable } from 'rxjs';
import { Html5Qrcode } from 'html5-qrcode';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';

import { SessionPaymentsService } from '../session-payments.service';
import { SessionPayDialogComponent } from '../session-pay-dialog/session-pay-dialog.component';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { CourseService } from '../../courses/services/course.service';
import { StudentService } from '../../students/services/student.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { ScanPreferenceService } from '../../../core/services/scan-preference.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import {
  SessionPaymentWithDetails,
  SessionPaymentSummary,
  SessionPackageWithDetails,
  PackageRenewalDue,
} from '@shared/interfaces/session-payment.interface';

// Same tab set as the monthly-subscriptions dashboard. For session charges the
// stored payment_status is only PENDING/PAID/COVERED/WAIVED/REFUNDED, so the
// extra tabs are derived: PARTIAL = pending with money collected, OVERDUE =
// pending for a past session, ON_HOLD = the charge's enrollment is on hold,
// and PAID includes COVERED (a covered session was paid for via its package).
type StatusTab = 'ALL' | 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'ON_HOLD' | 'REFUNDED';

@Component({
  selector: 'app-session-payments-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslateModule,
    CardModule, TableModule, ButtonModule, TagModule, TooltipModule, SelectModule,
    DialogModule, InputNumberModule, InputTextModule, DatePickerModule, TextareaModule,
    AmountPipe, SessionPayDialogComponent,
  ],
  templateUrl: './session-payments-dashboard.component.html',
})
export class SessionPaymentsDashboardComponent implements OnInit, OnDestroy {
  private service = inject(SessionPaymentsService);
  private lookup = inject(LookupService);
  private courseService = inject(CourseService);
  private studentSvc = inject(StudentService);
  private globalScan = inject(GlobalScanService);
  private scanPref = inject(ScanPreferenceService);
  private auth = inject(AuthService);
  private notify = inject(NotificationService);

  /** Teacher-type companies have a single implicit branch — hide the filter. */
  isTeacher = (): boolean => this.auth.isTeacher();
  private translate = inject(TranslateService);

  @ViewChild(SessionPayDialogComponent) payDialog?: SessionPayDialogComponent;

  // Filters — default to the current month.
  fromDate = signal<Date>(this.startOfMonth());
  toDate = signal<Date>(new Date());
  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
  selectedTab = signal<StatusTab>('ALL');
  view = signal<'CHARGES' | 'PACKAGES'>('CHARGES');
  // Quick date-range preset: TODAY | WEEK | MONTH | CUSTOM. Defaults to MONTH.
  rangePreset = signal<'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM'>('MONTH');

  readonly statuses: StatusTab[] = ['ALL', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'ON_HOLD', 'REFUNDED'];

  branches = signal<LookupOption[]>([]);
  courses = signal<{ id: string; label: string }[]>([]);
  payments = signal<SessionPaymentWithDetails[]>([]);
  packages = signal<SessionPackageWithDetails[]>([]);
  summary = signal<SessionPaymentSummary | null>(null);
  /** Package customers out of credit — owe the next bundle. */
  renewals = signal<PackageRenewalDue[]>([]);
  loading = signal(false);

  // "Collect next package" dialog (opened from the renewals panel)
  showRenewalPay = signal(false);
  selectedRenewal = signal<PackageRenewalDue | null>(null);
  renewalAmount = signal<number | null>(null);
  renewalNotes = signal('');

  // Void / refund dialogs
  showVoid = signal(false);
  showRefund = signal(false);
  selected = signal<SessionPaymentWithDetails | null>(null);
  voidReason = signal('');
  // Refund follows the monthly-subscriptions pattern: FULL refunds the whole
  // remaining paid amount, PARTIAL asks for an amount. Same dialog serves
  // charges and prepaid packages (refundPackageTarget set = package mode).
  refundType = signal<'FULL' | 'PARTIAL'>('FULL');
  refundAmount = signal<number | null>(null);
  refundNote = signal('');
  refundPackageTarget = signal<SessionPackageWithDetails | null>(null);
  submitting = signal(false);

  // Package pay dialog
  showPackagePay = signal(false);
  selectedPackage = signal<SessionPackageWithDetails | null>(null);
  packagePayAmount = signal<number | null>(null);
  packagePayDate = signal<Date>(new Date());

  // ── QR scan → collect due sessions ─────────────────────────────────────────
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  cameraStarted = signal(false);
  resolvingToken = signal(false);
  manualToken = signal('');
  // QR-less scan-to-pay: staff types the student's short sequential code + Enter.
  manualCode = signal('');
  resolvingCode = signal(false);
  private readonly SCANNER_ELEMENT_ID = 'session-payments-qr-region';
  private html5Qr?: Html5Qrcode;
  // Suppress the rapid repeat decodes html5-qrcode fires for one physical scan.
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;
  // Stable reference so the global scan handler can be unregistered on destroy.
  private readonly scanHandler = (token: string) => this.resolveToken(token);

  usbDetected = () => this.scanPref.usbDetected();

  filtered = computed(() => {
    const tab = this.selectedTab();
    if (tab === 'ALL') return this.payments();
    if (tab === 'ON_HOLD') return this.payments().filter(p => p.enrollmentStatus === 'ON_HOLD');
    return this.payments().filter(p => this.effectiveStatus(p) === tab);
  });

  /** Packages filtered by the shared status tabs (same set as charges). */
  filteredPackages = computed(() => {
    const tab = this.selectedTab();
    if (tab === 'ALL') return this.packages();
    return this.packages().filter(p => this.packageEffectiveStatus(p) === tab);
  });

  /**
   * Status tabs to show for the active view. Packages can't be OVERDUE or
   * ON_HOLD (those are per-session concepts), and COVERED only ever applies to a
   * per-session charge — so the packages view sticks to paid/owed statuses.
   */
  get visibleStatuses(): StatusTab[] {
    if (this.view() === 'PACKAGES') {
      return ['ALL', 'PENDING', 'PARTIAL', 'PAID', 'REFUNDED'];
    }
    return this.statuses;
  }

  ngOnInit(): void {
    this.lookup.branches().subscribe({ next: b => this.branches.set(b), error: () => {} });
    this.courseService.getAllCourses().subscribe({
      next: (list) => this.courses.set(
        list.filter(c => (c as any).paymentType === 'PER_SESSION').map(c => ({ id: c.id, label: c.name }))
      ),
      error: () => {},
    });
    // Take over the app-wide scanner while this page is open: a scan opens the
    // pay flow here instead of navigating to the student's detail page.
    this.globalScan.register(this.scanHandler);
    this.loadData();
  }

  ngOnDestroy(): void {
    this.globalScan.unregister(this.scanHandler);
    this.stopCamera();
  }

  loadData(): void {
    this.loading.set(true);
    const params = {
      from: this.fmt(this.fromDate()),
      to: this.fmt(this.toDate()),
      branchId: this.selectedBranchId() || undefined,
      courseId: this.selectedCourseId() || undefined,
    };
    forkJoin({
      payments: this.service.list(params),
      summary: this.service.summary(params),
      renewals: this.service.renewalsDue({ branchId: params.branchId, courseId: params.courseId }),
    }).subscribe({
      next: ({ payments, summary, renewals }) => {
        this.payments.set(payments);
        this.summary.set(summary);
        this.renewals.set(renewals);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    if (this.view() === 'PACKAGES') this.loadPackages();
  }

  // ── Package renewal collection ──────────────────────────────────────────────

  openRenewalPay(r: PackageRenewalDue): void {
    this.selectedRenewal.set(r);
    this.renewalAmount.set(r.packagePrice ?? 0);
    this.renewalNotes.set('');
    this.showRenewalPay.set(true);
  }

  confirmRenewalPay(): void {
    const r = this.selectedRenewal();
    if (!r) return;
    this.submitting.set(true);
    this.service.buyPackage({
      enrollmentId: r.enrollmentId,
      amount: this.renewalAmount() != null ? (this.renewalAmount() as number) : undefined,
      notes: this.renewalNotes() || undefined,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showRenewalPay.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PACKAGE_SUCCESS'));
        this.loadData();
      },
      error: () => this.submitting.set(false),
    });
  }

  loadPackages(): void {
    this.service.listPackages({
      branchId: this.selectedBranchId() || undefined,
      courseId: this.selectedCourseId() || undefined,
    }).subscribe({ next: p => this.packages.set(p), error: () => {} });
  }

  get viewOptions(): { value: 'CHARGES' | 'PACKAGES'; label: string }[] {
    return [
      { value: 'CHARGES', label: this.translate.instant('SESSION_PAYMENTS.VIEW_CHARGES') },
      { value: 'PACKAGES', label: this.translate.instant('SESSION_PAYMENTS.VIEW_PACKAGES') },
    ];
  }

  onViewChange(): void {
    if (this.view() === 'PACKAGES') this.loadPackages();
  }

  /** Switch the CHARGES / PACKAGES view (rendered as tabs). Reset the status
   *  filter so we never land on a tab that's empty in the other view. */
  setView(v: 'CHARGES' | 'PACKAGES'): void {
    if (this.view() === v) return;
    this.view.set(v);
    this.selectedTab.set('ALL');
    if (v === 'PACKAGES') this.loadPackages();
  }

  /**
   * Map a prepaid package to a display status using the same tab set as charges:
   * PENDING (nothing collected), PARTIAL (some collected), PAID (fully collected),
   * REFUNDED (fully refunded). Never COVERED — that's a per-session-charge state.
   */
  packageEffectiveStatus(p: SessionPackageWithDetails): StatusTab {
    const due = p.amountDue ?? 0;
    const paid = p.amountPaid || 0;
    const refunded = p.refundedAmount || 0;
    if (p.status === 'REFUNDED' || (refunded > 0 && paid - refunded <= 0)) return 'REFUNDED';
    if (paid <= 0) return 'PENDING';
    if (paid < due) return 'PARTIAL';
    return 'PAID';
  }

  // ── Derived status (tabs / tags) ────────────────────────────────────────────

  /** Map a charge to its display status (the monthly-subscriptions tab set). */
  effectiveStatus(p: SessionPaymentWithDetails): StatusTab | 'WAIVED' {
    switch (p.paymentStatus) {
      case 'REFUNDED': return 'REFUNDED';
      case 'PAID':
      case 'COVERED': return 'PAID';
      case 'WAIVED': return 'WAIVED';
      default: {
        if ((p.amountPaid || 0) > 0) return 'PARTIAL';
        return this.isPastSession(p) ? 'OVERDUE' : 'PENDING';
      }
    }
  }

  /** Unpaid charges for sessions before today are overdue (due date = session day). */
  private isPastSession(p: SessionPaymentWithDetails): boolean {
    if (!p.sessionDate) return false;
    const d = new Date(p.sessionDate);
    const today = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
      < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  }

  statusCount(st: StatusTab): number {
    if (this.view() === 'PACKAGES') {
      if (st === 'ALL') return this.packages().length;
      return this.packages().filter(p => this.packageEffectiveStatus(p) === st).length;
    }
    if (st === 'ALL') return this.payments().length;
    if (st === 'ON_HOLD') return this.payments().filter(p => p.enrollmentStatus === 'ON_HOLD').length;
    return this.payments().filter(p => this.effectiveStatus(p) === st).length;
  }

  onStatusFilterChange(st: StatusTab): void {
    this.selectedTab.set(st);
  }

  /** Paid metric includes COVERED — a covered session was paid via its package. */
  paidTotal(): number {
    const s = this.summary();
    return (s?.paidCount ?? 0) + (s?.coveredCount ?? 0);
  }

  /** Tag label for a row: the derived status, keeping COVERED visible. */
  rowTag(p: SessionPaymentWithDetails): string {
    if (p.paymentStatus === 'COVERED') return 'COVERED';
    const st = this.effectiveStatus(p);
    return st;
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'PAID': return 'success';
      case 'COVERED': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      case 'ON_HOLD': return 'warn';
      case 'REFUNDED': return 'danger';
      default: return 'secondary';
    }
  }

  // ── QR scan flow (mirrors the monthly-subscriptions dashboard) ─────────────

  openScanner(): void {
    this.scannerOpen.set(true);
    this.manualToken.set('');
    this.lastToken = '';
    // USB scanner is first priority: skip the camera when one is known on this
    // device (the always-on wedge handles scans). Camera is the explicit fallback.
    if (this.usbDetected()) return;
    this.cameraStarted.set(true);
    setTimeout(() => this.startCamera(), 0);
  }

  /** Explicit fallback: start the camera even when a USB scanner exists. */
  useCamera(): void {
    this.cameraStarted.set(true);
    setTimeout(() => this.startCamera(), 50);
  }

  closeScanner(): void {
    this.stopCamera();
    this.scannerOpen.set(false);
  }

  private async startCamera(): Promise<void> {
    if (this.html5Qr) return;
    this.scannerStarting.set(true);
    try {
      this.html5Qr = new Html5Qrcode(this.SCANNER_ELEMENT_ID);
      await this.html5Qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (decodedText) => this.handleScan(decodedText),
        // Per-frame decode failures are normal (no code in view) — ignore.
        () => {},
      );
    } catch {
      this.notify.error(this.translate.instant('SESSION_PAYMENTS.SCAN_CAMERA_FAILED'));
      this.html5Qr = undefined;
    } finally {
      this.scannerStarting.set(false);
    }
  }

  private stopCamera(): void {
    this.cameraStarted.set(false);
    const qr = this.html5Qr;
    this.html5Qr = undefined;
    if (!qr) return;
    // stop() rejects if already stopped; swallow it.
    qr.stop().then(() => qr.clear()).catch(() => {});
  }

  /** Extract the token from a scanned value: either a full profile URL or the raw token. */
  private extractToken(text: string): string {
    const raw = (text || '').trim();
    const marker = '/p/s/';
    const idx = raw.indexOf(marker);
    if (idx >= 0) return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    return raw;
  }

  private handleScan(decodedText: string): void {
    const token = this.extractToken(decodedText);
    if (!token) return;
    const now = Date.now();
    if (token === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = token;
    this.lastTokenAt = now;
    this.resolveToken(token);
  }

  /** USB scanner / manual entry submit (Enter key). */
  submitManualToken(): void {
    const token = this.extractToken(this.manualToken());
    this.manualToken.set('');
    if (!token) return;
    this.resolveToken(token);
  }

  /** QR-less scan-to-pay by short student code (Enter key). */
  submitManualCode(): void {
    const code = this.manualCode().trim();
    this.manualCode.set('');
    if (!code || this.resolvingCode()) return;
    this.resolvingCode.set(true);
    this.studentSvc.lookupByCode(code).subscribe({
      next: ({ qrToken }) => {
        this.resolvingCode.set(false);
        this.resolveToken(qrToken);
      },
      error: () => {
        // Interceptor toasts the translated "no student with this code" message.
        this.resolvingCode.set(false);
      },
    });
  }

  /** Look up the scanned student's due session charges and queue them for payment. */
  private resolveToken(token: string): void {
    if (this.resolvingToken()) return;
    this.resolvingToken.set(true);
    this.service.getDueByToken(token).subscribe({
      next: (res) => {
        this.resolvingToken.set(false);
        this.closeScanner();
        const name = `${res.studentFirstName} ${res.studentLastName}`.trim();
        if (!res.dueSessions.length) {
          this.notify.info(this.translate.instant('SESSION_PAYMENTS.SCAN_NO_DUE', { name }));
          return;
        }
        this.payDialog?.enqueue(res.dueSessions);
      },
      error: () => {
        this.resolvingToken.set(false);
        // Interceptor toasts the translated/fallback server error (unknown token).
      },
    });
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  openPay(row: SessionPaymentWithDetails): void {
    this.payDialog?.enqueue([row]);
  }

  openVoid(row: SessionPaymentWithDetails): void {
    this.selected.set(row);
    this.voidReason.set('');
    this.showVoid.set(true);
  }

  confirmVoid(): void {
    const row = this.selected();
    if (!row) return;
    this.submitting.set(true);
    this.service.voidPayment(row.id, this.voidReason() || undefined).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showVoid.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.VOID_SUCCESS'));
        this.loadData();
      },
      error: () => this.submitting.set(false),
    });
  }

  openRefund(row: SessionPaymentWithDetails): void {
    this.selected.set(row);
    this.refundPackageTarget.set(null);
    this.refundType.set('FULL');
    this.refundAmount.set(this.refundMax());
    this.refundNote.set('');
    this.showRefund.set(true);
  }

  openPackageRefund(p: SessionPackageWithDetails): void {
    this.selected.set(null);
    this.refundPackageTarget.set(p);
    this.refundType.set('FULL');
    this.refundAmount.set(this.refundMax());
    this.refundNote.set('');
    this.showRefund.set(true);
  }

  /** Max refundable = what's currently retained as paid on the target. */
  refundMax(): number {
    const pkg = this.refundPackageTarget();
    if (pkg) return Math.max(0, (pkg.amountPaid || 0) - (pkg.refundedAmount || 0));
    const row = this.selected();
    return row ? Math.max(0, (row.amountPaid || 0) - (row.refundedAmount || 0)) : 0;
  }

  get refundTypeOptions(): { value: 'FULL' | 'PARTIAL'; label: string }[] {
    return [
      { value: 'FULL', label: this.translate.instant('SESSION_PAYMENTS.REFUND_FULL') },
      { value: 'PARTIAL', label: this.translate.instant('SESSION_PAYMENTS.REFUND_PARTIAL') },
    ];
  }

  confirmRefund(): void {
    const type = this.refundType();
    const dto = {
      type,
      amount: type === 'PARTIAL' ? (this.refundAmount() as number) : undefined,
      note: this.refundNote() || undefined,
    };
    if (type === 'PARTIAL' && (!dto.amount || dto.amount <= 0 || dto.amount > this.refundMax())) return;

    const pkg = this.refundPackageTarget();
    const row = this.selected();
    if (!pkg && !row) return;
    this.submitting.set(true);
    const req: Observable<unknown> = pkg ? this.service.refundPackage(pkg.id, dto) : this.service.refund(row!.id, dto);
    req.subscribe({
      next: () => {
        this.submitting.set(false);
        this.showRefund.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.REFUND_SUCCESS'));
        if (pkg) this.loadPackages();
        this.loadData();
      },
      error: () => this.submitting.set(false),
    });
  }

  // ── Package payment (collect remaining balance) ──────────────────────────────
  packageRemaining(p: SessionPackageWithDetails): number {
    return Math.max(0, (p.amountDue ?? 0) - (p.amountPaid || 0));
  }

  openPackagePay(p: SessionPackageWithDetails): void {
    this.selectedPackage.set(p);
    this.packagePayAmount.set(this.packageRemaining(p));
    this.packagePayDate.set(new Date());
    this.showPackagePay.set(true);
  }

  confirmPackagePay(): void {
    const p = this.selectedPackage();
    if (!p || this.packagePayAmount() == null) return;
    this.submitting.set(true);
    this.service.payPackage(p.id, {
      amount: this.packagePayAmount() as number,
      paymentDate: this.fmt(this.packagePayDate()),
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showPackagePay.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.PAY_SUCCESS'));
        this.loadPackages();
        this.loadData();
      },
      error: () => this.submitting.set(false),
    });
  }

  /** Apply a quick date-range preset (Today / This Week / This Month). */
  setRange(preset: 'TODAY' | 'WEEK' | 'MONTH'): void {
    this.rangePreset.set(preset);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === 'TODAY') {
      this.fromDate.set(today);
      this.toDate.set(today);
    } else if (preset === 'WEEK') {
      // Week starts Saturday (common in the region); go back to the last Saturday.
      const day = today.getDay(); // 0=Sun..6=Sat
      const daysSinceSat = (day + 1) % 7;
      const start = new Date(today);
      start.setDate(today.getDate() - daysSinceSat);
      this.fromDate.set(start);
      this.toDate.set(today);
    } else {
      this.fromDate.set(this.startOfMonth());
      this.toDate.set(today);
    }
    this.loadData();
  }

  /** Manual date edits switch the preset to CUSTOM, then reload. */
  onDateChanged(): void {
    this.rangePreset.set('CUSTOM');
    this.loadData();
  }

  private startOfMonth(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  private fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
