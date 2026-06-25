import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { Html5Qrcode } from 'html5-qrcode';
import { InputTextModule } from 'primeng/inputtext';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService } from 'primeng/api';

import { MonthlySubscriptionsService } from '../monthly-subscriptions.service';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { ScanPreferenceService } from '../../../core/services/scan-preference.service';
import { SessionService, ActiveSessionInfo } from '../../rooms/services/session.service';
import { AttendanceService } from '../../rooms/services/attendance.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { CourseService } from '../../courses/services/course.service';
import { StudentService } from '../../students/services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { WhatsappTemplatesService } from '../../../core/services/whatsapp-templates.service';
import { openWhatsappChat, renderWhatsappTemplate } from '../../../core/utils/whatsapp.util';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';

import { MonthlyPaymentWithDetails, MonthlyPaymentSummary, CourseMonthlyPriceOverride, HeldSubscription, RefundMonthlyPaymentDto } from '@shared/interfaces/monthly-subscription.interface';
import { Course } from '@shared/interfaces/course.interface';

@Component({
  selector: 'app-monthly-subscriptions-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TranslateModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    SelectModule,
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    ConfirmDialogModule,
    CheckboxModule,
    InputTextModule,
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './monthly-subscriptions-dashboard.component.html',
})
export class MonthlySubscriptionsDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Filter state
  filterForm!: FormGroup;
  branches = signal<LookupOption[]>([]);
  courses = signal<Course[]>([]);

  // Data — signals so async-loaded data renders without needing a user interaction.
  payments = signal<MonthlyPaymentWithDetails[]>([]);
  filteredPayments = signal<MonthlyPaymentWithDetails[]>([]);
  heldSubscriptions = signal<HeldSubscription[]>([]);
  summary = signal<MonthlyPaymentSummary | null>(null);

  // UI state
  loading = signal(false);
  generating = signal(false);
  payingId = signal<string | null>(null);
  voidingId = signal<string | null>(null);
  showPayDialog = signal(false);
  selectedPayment = signal<MonthlyPaymentWithDetails | null>(null);
  payAmount = 0;
  payDate: Date = new Date();
  payNotes = '';

  // Status filter
  statusFilter = signal('ALL');
  readonly statuses = ['ALL', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'ON_HOLD', 'REFUNDED'];

  // Client-side search by student name over the loaded rows.
  nameSearch = signal('');

  // ── Void (recorded by mistake) ──────────────────────────────────────────────
  showVoidDialog = signal(false);
  voidTarget = signal<MonthlyPaymentWithDetails | null>(null);
  voidNote = '';
  voiding = signal(false);

  // ── Refund (money returned; student is leaving) ─────────────────────────────
  showRefundDialog = signal(false);
  refundTarget = signal<MonthlyPaymentWithDetails | null>(null);
  refundType: 'FULL' | 'PARTIAL' = 'FULL';
  refundAmount = 0;
  refundNote = '';
  refundAction: 'KEEP' | 'HOLD' | 'CANCEL' = 'CANCEL';
  refunding = signal(false);

  // ── Monthly price override ──────────────────────────────────────────────────
  // The dialog is self-contained: the user picks course + year + month inside
  // it (not from the page filter), then sets the price for that month.
  showOverrideDialog = signal(false);
  currentOverride = signal<CourseMonthlyPriceOverride | null>(null);
  overridePrice: number | null = null;
  overrideSaving = signal(false);
  overrideLoading = signal(false);
  overrideCoursePrice = signal<number | null>(null);
  overrideCourseId: string | null = null;
  overrideYear = new Date().getFullYear();
  overrideMonth = new Date().getMonth() + 1;

  // ── Barcode scan → collect payment ──────────────────────────────────────────
  // Scan a student's barcode, pick one of their due months, then drop into the
  // existing Record Payment dialog for that month.
  scannerOpen = signal(false);
  scannerStarting = signal(false);
  cameraStarted = signal(false);
  resolvingToken = signal(false);
  manualToken = signal('');
  // QR-less scan-to-pay: staff types the student's short sequential code + Enter.
  manualCode = signal('');
  resolvingCode = signal(false);
  // The due-month picker shown after a successful scan.
  showMonthPicker = signal(false);
  scannedStudentName = signal('');
  dueMonths = signal<MonthlyPaymentWithDetails[]>([]);
  private readonly SCANNER_ELEMENT_ID = 'subscription-qr-region';
  private html5Qr?: Html5Qrcode;
  // Suppress the rapid repeat decodes html5-qrcode fires for one physical scan.
  private lastToken = '';
  private lastTokenAt = 0;
  private readonly SCAN_DEDUP_MS = 2500;

  // ── Scan-to-pay + same-time attendance ───────────────────────────────────
  // The token of the student resolved by the most recent scan, and their
  // currently-running session (if any) so we can offer to mark them present
  // while collecting payment. Set on scan; cleared when the pay dialog closes.
  private scannedToken = signal('');
  scanActiveSession = signal<ActiveSessionInfo | null>(null);
  markAttendance = signal(true);
  // Stable reference so the global scan handler can be unregistered on destroy.
  private readonly scanHandler = (token: string) => this.resolveToken(token);

  get isRtl(): boolean {
    return document.documentElement.dir === 'rtl';
  }

  /** Individual-teacher companies have a single branch, so the branch filter/column are hidden. */
  get isTeacher(): boolean {
    return this.auth.isTeacher();
  }

  constructor(
    private fb: FormBuilder,
    private svc: MonthlySubscriptionsService,
    private enrollmentService: EnrollmentService,
    private lookupService: LookupService,
    private courseSvc: CourseService,
    private studentSvc: StudentService,
    private notify: NotificationService,
    private auth: AuthService,
    private translate: TranslateService,
    private confirm: ConfirmationService,
    private templatesSvc: WhatsappTemplatesService,
    private globalScan: GlobalScanService,
    private sessionService: SessionService,
    private attendanceService: AttendanceService,
    private scanPref: ScanPreferenceService,
  ) {}

  // Per-device USB-scanner flag (exposed to the template).
  usbDetected = () => this.scanPref.usbDetected();

  ngOnInit(): void {
    const now = new Date();
    this.filterForm = this.fb.group({
      // 'MONTH' = a specific year+month, 'YEAR' = whole year up to the current
      // month, 'LAST_N' = a rolling window of the last N months (can cross a year).
      filterMode: ['MONTH'],
      billingYear: [now.getFullYear(), Validators.required],
      billingMonth: [now.getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
      lastN: [3],
      branchId: [null],
      courseId: [null],
    });

    // Warm the click-to-chat template cache (fire-and-forget).
    this.templatesSvc.load().subscribe({ error: () => {} });

    // Take over the app-wide scanner while this page is open: a scan runs the
    // pay flow here instead of navigating to the student's detail page.
    this.globalScan.register(this.scanHandler);

    forkJoin({
      branches: this.lookupService.branches(),
      courses: this.courseSvc.getAllCourses(),
    }).pipe(takeUntil(this.destroy$)).subscribe(({ branches, courses }) => {
      this.branches.set(branches);
      // Only show monthly-subscription courses in the filter
      this.courses.set(courses.filter((c: Course) => c.paymentType === 'MONTHLY_SUBSCRIPTION'));
      this.loadData();
    });
  }

  ngOnDestroy(): void {
    this.globalScan.unregister(this.scanHandler);
    this.stopCamera();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Barcode scan flow ────────────────────────────────────────────────────────

  /** Open the scanner dialog and start the camera. */
  openScanner(): void {
    this.scannerOpen.set(true);
    this.manualToken.set('');
    this.lastToken = '';
    // USB scanner is first priority: skip the camera when one is known on this
    // device (the always-on wedge handles scans). Camera is the explicit fallback.
    if (this.usbDetected()) return;
    this.cameraStarted.set(true);
    // Wait a tick so the scanner region element exists in the DOM.
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
      this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.SCAN_CAMERA_FAILED'));
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
    if (idx >= 0) {
      return raw.slice(idx + marker.length).split(/[/?#]/)[0];
    }
    return raw;
  }

  /** Camera decode callback. */
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

  /**
   * QR-less scan-to-pay by short student code (Enter key). Resolves the code to
   * the student's QR token, then reuses the normal scan-to-pay flow. A
   * non-existent code surfaces a "no student with this code" warning (toasted by
   * the HTTP error interceptor from the server's translation key).
   */
  submitManualCode(): void {
    const code = this.manualCode().trim();
    this.manualCode.set('');
    if (!code || this.resolvingCode()) return;
    this.resolvingCode.set(true);
    this.studentSvc.lookupByCode(code).pipe(takeUntil(this.destroy$)).subscribe({
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

  /** Look up the scanned student's due months and open the month picker. */
  private resolveToken(token: string): void {
    if (this.resolvingToken()) return;
    this.resolvingToken.set(true);
    this.scannedToken.set(token);
    this.scanActiveSession.set(null);
    this.svc.getDueByToken(token).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.resolvingToken.set(false);
        this.scannedStudentName.set(`${res.studentFirstName} ${res.studentLastName}`.trim());
        this.dueMonths.set(res.dueMonths);
        // Find an in-progress session for this student so the pay dialog can
        // offer to mark them present at the same time (default checked).
        this.sessionService.activeForStudent(res.studentId).pipe(takeUntil(this.destroy$)).subscribe({
          next: (sess) => this.scanActiveSession.set(sess),
          error: () => this.scanActiveSession.set(null),
        });
        // Stop the camera and swap the scanner dialog for the month picker.
        this.closeScanner();
        if (res.dueMonths.length === 0) {
          this.notify.info(
            this.translate.instant('MONTHLY_SUBSCRIPTIONS.SCAN_NO_DUE', { name: this.scannedStudentName() })
          );
          return;
        }
        this.showMonthPicker.set(true);
      },
      error: () => {
        this.resolvingToken.set(false);
        // Interceptor toasts the translated/fallback server error (unknown token).
      },
    });
  }

  closeMonthPicker(): void {
    this.showMonthPicker.set(false);
    this.dueMonths.set([]);
  }

  /** A due month was picked — hand off to the existing Record Payment dialog. */
  selectDueMonth(payment: MonthlyPaymentWithDetails): void {
    this.closeMonthPicker();
    // fromScan: keep the scanned-student context so the attendance option shows.
    this.openPayDialog(payment, true);
  }

  /** Inclusive (from..to) month range for the active filter mode. */
  computeRange(): { fromYear: number; fromMonth: number; toYear: number; toMonth: number } {
    const v = this.filterForm.value;
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;

    if (v.filterMode === 'LAST_N') {
      const n = Math.max(1, Number(v.lastN) || 1);
      const toKey = curY * 12 + curM;
      const fromKey = toKey - (n - 1);
      return {
        fromYear: Math.floor((fromKey - 1) / 12),
        fromMonth: ((fromKey - 1) % 12) + 1,
        toYear: curY,
        toMonth: curM,
      };
    }

    if (v.filterMode === 'YEAR') {
      const y = Number(v.billingYear);
      // Current year stops at the current month; past years show all 12.
      const toMonth = y === curY ? curM : 12;
      return { fromYear: y, fromMonth: 1, toYear: y, toMonth };
    }

    // MONTH — a single month.
    return {
      fromYear: Number(v.billingYear),
      fromMonth: Number(v.billingMonth),
      toYear: Number(v.billingYear),
      toMonth: Number(v.billingMonth),
    };
  }

  loadData(): void {
    const r = this.computeRange();
    const { branchId, courseId } = this.filterForm.value;
    if (!r.fromYear || !r.fromMonth) return;

    this.loading.set(true);
    forkJoin({
      payments: this.svc.list({ ...r, branchId: branchId || undefined, courseId: courseId || undefined }),
      summary: this.svc.summary({ ...r, branchId: branchId || undefined }),
      held: this.svc.listHeld(branchId || undefined),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ payments, summary, held }) => {
        this.payments.set(payments);
        this.summary.set(summary);
        this.heldSubscriptions.set(held);
        this.applyStatusFilter();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.LOAD_ERROR'));
      },
    });
  }

  applyStatusFilter(): void {
    const status = this.statusFilter();
    const q = this.nameSearch().trim().toLowerCase();
    let rows = this.payments();
    if (status !== 'ALL') rows = rows.filter(p => p.paymentStatus === status);
    if (q) rows = rows.filter(p => `${p.studentFirstName} ${p.studentLastName}`.toLowerCase().includes(q));
    this.filteredPayments.set([...rows]);
  }

  onStatusFilterChange(status: string): void {
    this.statusFilter.set(status);
    this.applyStatusFilter();
  }

  /** Live name filter over the loaded rows (the code box still does code → pay). */
  onNameSearch(value: string): void {
    this.nameSearch.set(value);
    this.applyStatusFilter();
  }

  statusCount(status: string): number {
    if (status === 'ON_HOLD') return this.heldSubscriptions().length;
    const all = this.payments();
    if (status === 'ALL') return all.length;
    return all.filter(p => p.paymentStatus === status).length;
  }

  generateBills(): void {
    // Generate bills for the most recent month in the active range.
    const r = this.computeRange();
    const { branchId, courseId } = this.filterForm.value;
    this.generating.set(true);
    this.svc.generate({
      billingYear: r.toYear,
      billingMonth: r.toMonth,
      branchId: branchId || undefined,
      courseId: courseId || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.generating.set(false);
        this.notify.success(
          this.translate.instant('MONTHLY_SUBSCRIPTIONS.GENERATED', { count: res.generated, month: res.month })
        );
        this.loadData();
      },
      error: () => {
        this.generating.set(false);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.GENERATE_ERROR'));
      },
    });
  }

  openPayDialog(payment: MonthlyPaymentWithDetails, fromScan = false): void {
    // A manual row-pay has no scanned-student context — clear any stale one so
    // the attendance option only appears for a scan-to-pay.
    if (!fromScan) {
      this.scannedToken.set('');
      this.scanActiveSession.set(null);
    }
    this.markAttendance.set(true);
    this.selectedPayment.set(payment);
    this.payAmount = payment.amountDue - payment.amountPaid;
    this.payDate = new Date();
    this.payNotes = '';
    this.showPayDialog.set(true);
  }

  closePayDialog(): void {
    this.showPayDialog.set(false);
    this.selectedPayment.set(null);
    this.scannedToken.set('');
    this.scanActiveSession.set(null);
  }

  confirmPayment(): void {
    const sel = this.selectedPayment();
    if (!sel || this.payAmount <= 0) return;
    // Capture before closePayDialog() clears the scan context.
    const session = this.scanActiveSession();
    const token = this.scannedToken();
    const alsoMarkPresent = this.markAttendance() && !!session && !!token;
    this.payingId.set(sel.id);
    this.svc.recordPayment(sel.id, {
      amount: this.payAmount,
      paymentDate: this.formatDate(this.payDate),
      notes: this.payNotes || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.payingId.set(null);
        this.closePayDialog();
        this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.PAYMENT_RECORDED'));
        if (alsoMarkPresent) this.markPresentForSession(session!, token);
        this.loadData();
      },
      error: () => {
        this.payingId.set(null);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.PAYMENT_ERROR'));
      },
    });
  }

  /** Mark the just-paid student present in their currently-running session. */
  private markPresentForSession(session: ActiveSessionInfo, token: string): void {
    this.attendanceService.checkinByQr(session.sessionId, token).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        const name = `${res.studentFirstName} ${res.studentLastName}`.trim();
        this.notify.success(
          this.translate.instant('MONTHLY_SUBSCRIPTIONS.ATTENDANCE_MARKED', { name, class: session.className })
        );
      },
      // Interceptor toasts the translated server error (e.g. not enrolled).
      error: () => {},
    });
  }

  // ── Void (recorded by mistake) ──────────────────────────────────────────────

  /** Open the void dialog (clears the payment + its revenue; for mistakes). */
  openVoidDialog(payment: MonthlyPaymentWithDetails): void {
    this.voidTarget.set(payment);
    this.voidNote = '';
    this.showVoidDialog.set(true);
  }

  closeVoidDialog(): void {
    this.showVoidDialog.set(false);
    this.voidTarget.set(null);
  }

  confirmVoid(): void {
    const payment = this.voidTarget();
    if (!payment) return;
    this.voiding.set(true);
    this.voidingId.set(payment.id);
    this.svc.voidPayment(payment.id, this.voidNote.trim() || undefined).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.voiding.set(false);
        this.voidingId.set(null);
        this.closeVoidDialog();
        this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.VOIDED'));
        this.loadData();
      },
      error: () => {
        this.voiding.set(false);
        this.voidingId.set(null);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.VOID_ERROR'));
      },
    });
  }

  // ── Refund (money returned; student is leaving) ─────────────────────────────

  /** Open the refund dialog for a paid/partially-paid bill. */
  openRefundDialog(payment: MonthlyPaymentWithDetails): void {
    this.refundTarget.set(payment);
    this.refundType = 'FULL';
    this.refundAmount = payment.amountPaid;
    this.refundNote = '';
    this.refundAction = 'CANCEL';
    this.showRefundDialog.set(true);
  }

  closeRefundDialog(): void {
    this.showRefundDialog.set(false);
    this.refundTarget.set(null);
  }

  /** Max refundable = what's currently retained as paid on this bill. */
  get refundMax(): number {
    return this.refundTarget()?.amountPaid ?? 0;
  }

  confirmRefund(): void {
    const payment = this.refundTarget();
    if (!payment) return;
    const dto: RefundMonthlyPaymentDto = {
      type: this.refundType,
      note: this.refundNote.trim() || undefined,
      subscriptionAction: this.refundAction,
    };
    if (this.refundType === 'PARTIAL') {
      if (!(this.refundAmount > 0) || this.refundAmount > payment.amountPaid) return;
      dto.amount = this.refundAmount;
    }
    this.refunding.set(true);
    this.svc.refund(payment.id, dto).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.refunding.set(false);
        this.closeRefundDialog();
        this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUNDED'));
        this.loadData();
      },
      error: () => {
        this.refunding.set(false);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_ERROR'));
      },
    });
  }

  get refundTypeOptions(): { value: string; label: string }[] {
    return [
      { value: 'FULL', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_FULL') },
      { value: 'PARTIAL', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_PARTIAL') },
    ];
  }

  get refundActionOptions(): { value: string; label: string }[] {
    return [
      { value: 'CANCEL', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_ACTION_CANCEL') },
      { value: 'HOLD', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_ACTION_HOLD') },
      { value: 'KEEP', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.REFUND_ACTION_KEEP') },
    ];
  }

  // ── Hold / Resume subscription ──────────────────────────────────────────────

  /** Pause a subscription after confirmation — no bills are generated while on hold. */
  holdSubscription(p: MonthlyPaymentWithDetails): void {
    this.confirm.confirm({
      message: this.translate.instant('MONTHLY_SUBSCRIPTIONS.HOLD_CONFIRM'),
      header: this.translate.instant('MONTHLY_SUBSCRIPTIONS.HOLD_TITLE'),
      icon: 'pi pi-pause',
      acceptButtonStyleClass: 'p-button-warning',
      acceptLabel: this.translate.instant('MONTHLY_SUBSCRIPTIONS.HOLD'),
      rejectLabel: this.translate.instant('MONTHLY_SUBSCRIPTIONS.CANCEL'),
      accept: () => {
        this.enrollmentService.holdSubscription(p.enrollmentId).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.SUBSCRIPTION_HELD'));
            this.loadData();
          },
        });
      },
    });
  }

  /** Resume a held subscription after confirmation — billing continues from the current month. */
  resumeSubscription(enrollmentId: string): void {
    this.confirm.confirm({
      message: this.translate.instant('MONTHLY_SUBSCRIPTIONS.RESUME_CONFIRM'),
      header: this.translate.instant('MONTHLY_SUBSCRIPTIONS.RESUME_TITLE'),
      icon: 'pi pi-play',
      acceptLabel: this.translate.instant('MONTHLY_SUBSCRIPTIONS.RESUME'),
      rejectLabel: this.translate.instant('MONTHLY_SUBSCRIPTIONS.CANCEL'),
      accept: () => {
        this.enrollmentService.resumeSubscription(enrollmentId).pipe(takeUntil(this.destroy$)).subscribe({
          next: () => {
            this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.SUBSCRIPTION_RESUMED'));
            this.loadData();
          },
        });
      },
    });
  }

  // ── Price Override methods ──────────────────────────────────────────────────

  openOverrideDialog(): void {
    const now = new Date();
    this.overrideCourseId = null;
    this.overrideYear = now.getFullYear();
    this.overrideMonth = now.getMonth() + 1;
    this.overridePrice = null;
    this.currentOverride.set(null);
    this.overrideCoursePrice.set(null);
    this.showOverrideDialog.set(true);
  }

  /**
   * Once a course + year + month are all chosen in the dialog, load the
   * course's base price and any existing override so the price field is
   * pre-filled and an active override can be shown / removed.
   */
  onOverrideSelectionChange(): void {
    const courseId = this.overrideCourseId;
    if (!courseId || !this.overrideYear || !this.overrideMonth) {
      this.overrideCoursePrice.set(null);
      this.currentOverride.set(null);
      this.overridePrice = null;
      return;
    }
    const course = this.courses().find(c => c.id === courseId);
    this.overrideCoursePrice.set(course ? course.price : null);
    this.overrideLoading.set(true);
    this.svc.getPriceOverride(courseId, this.overrideYear, this.overrideMonth)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (ov) => {
          this.currentOverride.set(ov);
          this.overridePrice = ov ? ov.overridePrice : (course ? course.price : null);
          this.overrideLoading.set(false);
        },
        error: () => {
          this.overrideLoading.set(false);
          this.currentOverride.set(null);
          this.overridePrice = course ? course.price : null;
        },
      });
  }

  closeOverrideDialog(): void {
    this.showOverrideDialog.set(false);
    this.currentOverride.set(null);
    this.overridePrice = null;
    this.overrideCourseId = null;
  }

  saveOverride(): void {
    const courseId = this.overrideCourseId;
    if (!courseId || !this.overrideYear || !this.overrideMonth || !this.overridePrice || this.overridePrice <= 0) return;

    this.overrideSaving.set(true);
    this.svc.setPriceOverride({
      courseId,
      billingYear: this.overrideYear,
      billingMonth: this.overrideMonth,
      overridePrice: this.overridePrice,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.overrideSaving.set(false);
        this.closeOverrideDialog();
        this.notify.success(
          this.translate.instant('MONTHLY_SUBSCRIPTIONS.OVERRIDE_SAVED', { count: res.updatedBills })
        );
        this.loadData();
      },
      error: () => {
        this.overrideSaving.set(false);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.OVERRIDE_ERROR'));
      },
    });
  }

  removeOverride(): void {
    const ov = this.currentOverride();
    if (!ov) return;

    this.overrideSaving.set(true);
    this.svc.deletePriceOverride(ov.id).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.overrideSaving.set(false);
        this.closeOverrideDialog();
        this.notify.success(
          this.translate.instant('MONTHLY_SUBSCRIPTIONS.OVERRIDE_REMOVED', { count: res.updatedBills })
        );
        this.loadData();
      },
      error: () => {
        this.overrideSaving.set(false);
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.OVERRIDE_ERROR'));
      },
    });
  }

  // ── Payment reminder (click-to-chat) ──────────────────────────────────────

  /**
   * Open WhatsApp (the staff member's own number) pre-filled with the
   * PAYMENT_DELAY reminder for this unpaid bill, addressed to the student.
   */
  sendPaymentReminder(p: MonthlyPaymentWithDetails): void {
    const text = renderWhatsappTemplate(this.templatesSvc.get('PAYMENT_DELAY'), {
      studentName: `${p.studentFirstName} ${p.studentLastName}`,
      academyName: this.auth.getCompanyName(),
      amount: String(p.amountDue - p.amountPaid),
      currency: '',
      courseName: p.courseName,
      dueDate: new Date(p.dueDate).toLocaleDateString('en-GB'),
    });
    const opened = openWhatsappChat(p.studentPhone || p.parentPhone, text);
    if (!opened) {
      this.notify.info(this.translate.instant('WHATSAPP.NO_PHONE'));
    }
  }

  private formatDate(d: Date): string {
    // Local YYYY-MM-DD (avoid UTC shift from toISOString)
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  getStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      case 'PARTIAL': return 'info';
      case 'ON_HOLD': return 'warn';
      case 'REFUNDED': return 'secondary';
      default: return 'secondary';
    }
  }

  getMonthName(month: number): string {
    return this.translate.instant('MONTHLY_SUBSCRIPTIONS.MONTHS.' + month);
  }

  get monthOptions(): { value: number; label: string }[] {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: this.getMonthName(i + 1),
    }));
  }

  get yearOptions(): { value: number; label: number }[] {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1].map(y => ({ value: y, label: y }));
  }

  get filterModeOptions(): { value: string; label: string }[] {
    return [
      { value: 'MONTH', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.MODE_MONTH') },
      { value: 'YEAR', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.MODE_YEAR') },
      { value: 'LAST_N', label: this.translate.instant('MONTHLY_SUBSCRIPTIONS.MODE_LAST_N') },
    ];
  }

  get lastNOptions(): { value: number; label: string }[] {
    return Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return {
        value: n,
        label: this.translate.instant(
          n === 1 ? 'MONTHLY_SUBSCRIPTIONS.LAST_ONE_MONTH' : 'MONTHLY_SUBSCRIPTIONS.LAST_N_MONTHS',
          { count: n }
        ),
      };
    });
  }

  get filterMode(): string {
    return this.filterForm?.get('filterMode')?.value || 'MONTH';
  }

  /** "March 2026" style label for a payment row's billing period. */
  periodLabel(p: { billingMonth: number; billingYear: number }): string {
    return `${this.getMonthName(p.billingMonth)} ${p.billingYear}`;
  }
}
