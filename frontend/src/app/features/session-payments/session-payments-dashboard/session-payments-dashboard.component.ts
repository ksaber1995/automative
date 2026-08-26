import { Component, OnInit, OnDestroy, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TablePageMemory } from '../../../core/utils/table-page-memory';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin, Observable } from 'rxjs';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { cameraScanConfig } from '../../../core/utils/scanner-formats.util';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
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
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptService, ReceiptSourceType } from '../../../core/services/receipt.service';
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
    DialogModule, ConfirmDialogModule, InputNumberModule, InputTextModule, DatePickerModule, TextareaModule,
    AmountPipe, SessionPayDialogComponent,
  ],
  providers: [ConfirmationService],
  templateUrl: './session-payments-dashboard.component.html',
})
export class SessionPaymentsDashboardComponent implements OnInit, OnDestroy {
  private service = inject(SessionPaymentsService);
  private lookup = inject(LookupService);
  private courseService = inject(CourseService);
  private studentSvc = inject(StudentService);
  private globalScan = inject(GlobalScanService);
  private auth = inject(AuthService);
  private notify = inject(NotificationService);
  private receiptService = inject(ReceiptService);

  /** Teacher-type companies have a single implicit branch — hide the filter. */
  isTeacher = (): boolean => this.auth.isTeacher();

  // Pagination that survives leaving the page — one memory per table, so the
  // charges and packages positions travel in their own params.
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  chargesPage = new TablePageMemory(this.router, this.route, {
    storeKey: 'sessionPaymentsChargesPage', defaultRows: 20, allowedRows: [10, 20, 50],
  });
  packagesPage = new TablePageMemory(this.router, this.route, {
    storeKey: 'sessionPaymentsPackagesPage', defaultRows: 20, allowedRows: [10, 20, 50],
    pageParam: 'pkgPage', rowsParam: 'pkgRows',
  });
  private translate = inject(TranslateService);
  private confirmationService = inject(ConfirmationService);

  @ViewChild(SessionPayDialogComponent) payDialog?: SessionPayDialogComponent;

  // Filters — default to the current month.
  fromDate = signal<Date>(this.startOfMonth());
  toDate = signal<Date>(new Date());
  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
  selectedTab = signal<StatusTab>('ALL');
  view = signal<'CHARGES' | 'PACKAGES' | 'ALL'>('CHARGES');
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
  /** Id of the row whose receipt is being fetched — spins just that print button. */
  printingId = signal<string | null>(null);

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

  /** Live student-name filter — narrows every table on the page. */
  nameSearch = signal('');
  private matchesName = (name: string | null | undefined): boolean => {
    const q = this.nameSearch().trim().toLowerCase();
    return !q || `${name ?? ''}`.toLowerCase().includes(q);
  };

  filtered = computed(() => {
    const tab = this.selectedTab();
    let rows = this.payments();
    if (tab === 'ON_HOLD') rows = rows.filter(p => p.enrollmentStatus === 'ON_HOLD');
    else if (tab !== 'ALL') rows = rows.filter(p => this.effectiveStatus(p) === tab);
    return rows.filter(p => this.matchesName(p.studentName));
  });

  /** Packages filtered by the shared status tabs (same set as charges). */
  filteredPackages = computed(() => {
    const tab = this.selectedTab();
    let rows = this.packages();
    if (tab !== 'ALL') rows = rows.filter(p => this.packageEffectiveStatus(p) === tab);
    return rows.filter(p => this.matchesName(p.studentName));
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

  // ── Cash collected, split by money source ────────────────────────────────────
  // cashCollected (server) = session-charge cash + prepaid-package cash. We show
  // the slice that matches the active view: sessions, packages, or the total.
  /**
   * Whether this user is shown money at all. The API omits every figure for
   * users without `revenues: read` (a fee collector records payments without
   * seeing what the academy takes), so the presence of the number is the
   * permission — the policy is not restated here.
   */
  showMoney = computed(() => this.summary()?.totalRevenue != null);

  packageCash = computed(() => this.summary()?.packageCashCollected ?? 0);
  sessionCash = computed(() => Math.max(0, (this.summary()?.cashCollected ?? 0) - this.packageCash()));
  totalCash = computed(() => this.summary()?.cashCollected ?? 0);

  /** The Cash Collected figure for the active view. */
  cashForView = computed(() => {
    switch (this.view()) {
      case 'PACKAGES': return this.packageCash();
      case 'ALL': return this.totalCash();
      default: return this.sessionCash();
    }
  });

  /**
   * A renewal-due student owes the next bundle, so they belong under Pending —
   * and under All, which must be a superset of every other tab or the counts
   * stop adding up.
   */
  private renewalsVisible = computed(() =>
    this.selectedTab() === 'PENDING' || this.selectedTab() === 'ALL'
  );

  /**
   * Rows for the Packages table: the prepaid-package rows, plus — under the
   * Pending (or All) status filter — the renewal-due students (last bundle used
   * up, owe the next). Renewals sit on top since they need action.
   */
  packagesTableRows = computed(() => {
    const pkgRows = this.filteredPackages().map(p => ({ kind: 'package' as const, p }));
    const renewalRows = this.renewalsVisible()
      ? this.renewals().filter(r => this.matchesName(r.studentName)).map(r => ({ kind: 'renewal' as const, r }))
      : [];
    return [...renewalRows, ...pkgRows];
  });

  /**
   * Reversing money is its own permission now: recording a payment is
   * `enrollments: write`, undoing one is `refunds: write`, so whoever collects
   * fees cannot quietly un-collect them. Hides the button the API would 403.
   */
  canRefund = (): boolean => this.auth.canWrite('refunds');

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
    // Packages feed the Packages view and the combined All view.
    if (this.view() !== 'CHARGES') this.loadPackages();
  }

  // ── Package renewal collection ──────────────────────────────────────────────

  openRenewalPay(r: PackageRenewalDue): void {
    this.selectedRenewal.set(r);
    this.renewalAmount.set(r.packagePrice ?? 0);
    this.renewalNotes.set('');
    this.showRenewalPay.set(true);
  }

  /**
   * Offer the alternative to renewing: this student pays for each session they
   * attend instead of buying the next bundle. The confirmation spells out what
   * happens to the sessions they've already attended — those stay as individual
   * dues, they are not written off — because "convert" could easily be read as
   * "clear the balance".
   */
  confirmPayPerSession(r: PackageRenewalDue): void {
    this.confirmationService.confirm({
      header: this.translate.instant('SESSION_PAYMENTS.PER_SESSION_TITLE'),
      message: r.unpaidSessions > 0
        ? this.translate.instant('SESSION_PAYMENTS.PER_SESSION_CONFIRM_OWING', {
            name: r.studentName, count: r.unpaidSessions })
        : this.translate.instant('SESSION_PAYMENTS.PER_SESSION_CONFIRM', { name: r.studentName }),
      icon: 'pi pi-wallet',
      acceptLabel: this.translate.instant('SESSION_PAYMENTS.PER_SESSION_ACCEPT'),
      rejectLabel: this.translate.instant('SESSION_PAYMENTS.PER_SESSION_CANCEL'),
      accept: () => {
        this.submitting.set(true);
        this.service.payPerSession(r.enrollmentId).subscribe({
          next: (res) => {
            this.submitting.set(false);
            this.notify.success(res.unpaidSessions > 0
              ? this.translate.instant('SESSION_PAYMENTS.PER_SESSION_DONE_OWING', { count: res.unpaidSessions })
              : this.translate.instant('SESSION_PAYMENTS.PER_SESSION_DONE'));
            this.loadData();
          },
          error: () => this.submitting.set(false),
        });
      },
    });
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

  onViewChange(): void {
    if (this.view() !== 'CHARGES') this.loadPackages();
  }

  /** Switch the CHARGES / PACKAGES / ALL view (rendered as tabs). Reset the
   *  status filter so we never land on a tab that's empty in the other view. */
  setView(v: 'CHARGES' | 'PACKAGES' | 'ALL'): void {
    if (this.view() === v) return;
    this.view.set(v);
    this.selectedTab.set('ALL');
    if (v !== 'CHARGES') this.loadPackages();
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
    // Nothing owed is settled, not pending. A bundle for a student on a zero
    // price costs 0, and `paid <= 0` below is true of it forever — so it sat in
    // the unpaid tab permanently, with nothing anyone could ever collect to
    // clear it. Checked before `paid`, because both are 0.
    if (due <= 0) return 'PAID';
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
        // Same rule as packages: a charge for nothing is already settled, and
        // would otherwise show as OVERDUE the day after the lesson with no
        // amount anyone could collect.
        if ((p.amountDue ?? 0) <= 0) return 'PAID';
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
      // Renewals-due are rows in this table too (students whose bundle ran out
      // and owe the next one). Counting only the prepaid-package rows made the
      // Pending badge read 0 while the tab itself listed every student waiting
      // to renew — so nobody clicked through to collect from them.
      const renewals = (st === 'ALL' || st === 'PENDING') ? this.renewals().length : 0;
      if (st === 'ALL') return this.packages().length + renewals;
      return this.packages().filter(p => this.packageEffectiveStatus(p) === st).length + renewals;
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

  /** Opens on the USB-reader panel; the camera is opt-in — see useCamera. */
  openScanner(): void {
    this.scannerOpen.set(true);
    this.manualToken.set('');
    this.lastToken = '';
  }

  /** The one way the camera starts: the operator asks for it. */
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
        cameraScanConfig(Html5QrcodeSupportedFormats),
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

  /**
   * A camera decode — a QR, or a barcode of the student's printed code. The
   * service turns either into a token, so the flow below is unchanged.
   */
  private handleScan(decodedText: string): void {
    // Dedup on the RAW scan: a camera repeats the same frame, and a barcode must
    // not fire a lookup per frame while the first one is still resolving.
    const raw = (decodedText || '').trim();
    if (!raw) return;
    const now = Date.now();
    if (raw === this.lastToken && now - this.lastTokenAt < this.SCAN_DEDUP_MS) return;
    this.lastToken = raw;
    this.lastTokenAt = now;

    this.globalScan.resolveScan(raw).subscribe({
      next: (token) => { if (token) this.resolveToken(token); },
      error: () => this.notify.error(this.translate.instant('NAV.QR_STUDENT_NOT_FOUND')),
    });
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
        const name = `${res.studentName}`.trim();
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

  /**
   * Reprint the slip for a collection. Printing at pay time is opt-in, so most
   * money is taken without a slip and the parent asks for one afterwards —
   * until now that meant leaving the page for the receipts desk.
   *
   * It reprints the receipt that was already issued; it never creates one, so a
   * payment collected before receipts existed reports that instead.
   */
  printReceipt(row: SessionPaymentWithDetails, mode: 'print' | 'download' = 'print'): void {
    this.printFor('SESSION', row.id, mode);
  }

  printPackageReceipt(p: SessionPackageWithDetails, mode: 'print' | 'download' = 'print'): void {
    this.printFor('PACKAGE', p.id, mode);
  }

  private printFor(sourceType: ReceiptSourceType, sourceId: string, mode: 'print' | 'download' = 'print'): void {
    if (this.printingId()) return;
    this.printingId.set(sourceId);
    this.receiptService.bySource(sourceType, sourceId).subscribe({
      next: (list) => {
        this.printingId.set(null);
        const receipt = list[0];   // newest first
        if (!receipt) {
          this.notify.info(this.translate.instant('RECEIPT.NONE_FOR_PAYMENT'));
          return;
        }
        this.receiptService.open(receipt, mode);
      },
      error: () => this.printingId.set(null),
    });
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
