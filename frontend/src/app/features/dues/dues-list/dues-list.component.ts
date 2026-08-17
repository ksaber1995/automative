import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DuesService } from '../services/dues.service';
import { LookupService } from '../../../core/services/lookup.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { MasterEnrollmentService } from '../../master-courses/services/master-enrollment.service';
import { MonthlySubscriptionsService } from '../../monthly-subscriptions/monthly-subscriptions.service';
import { SessionPaymentsService } from '../../session-payments/session-payments.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptService } from '../../../core/services/receipt.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { DueEnrollment } from '@shared/interfaces/enrollment.interface';
import { toLocalYmd } from '../../../core/utils/date.util';

@Component({
  selector: 'app-dues-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    CardModule, TableModule, ButtonModule, TagModule,
    SelectModule, TooltipModule, DialogModule,
    InputNumberModule, DatePickerModule, TextareaModule, ProgressBarModule,
    TranslateModule, TagModule,
  ],
  templateUrl: './dues-list.component.html',
})
export class DuesListComponent implements OnInit {
  private duesService = inject(DuesService);
  private enrollmentService = inject(EnrollmentService);
  private masterEnrollmentService = inject(MasterEnrollmentService);
  private monthlyService = inject(MonthlySubscriptionsService);
  private sessionService = inject(SessionPaymentsService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private receiptService = inject(ReceiptService);
  private api = inject(ApiService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  dues = signal<DueEnrollment[]>([]);
  loading = signal(true);
  actionLoading = signal(false);

  filterBranch: string | null = null;
  branchOptions: { label: string; value: string }[] = [];

  // Client-side filter by billing model (One-time / Monthly / Session).
  filterType = signal<'ALL' | 'ONE_TIME' | 'MONTHLY_SUBSCRIPTION' | 'PER_SESSION'>('ALL');

  /** Inclusive date range, either end optional. Both are day-precision. */
  dateFrom = signal<Date | null>(null);
  dateTo = signal<Date | null>(null);

  /**
   * The date this row is ABOUT — the same one its date column shows: the month
   * owed for a monthly bill, the enrolment date for everything else.
   *
   * Filtering on anything else (created_at, say) would put rows outside a range
   * the table appears to place inside it, which is worse than having no filter.
   * Returned as YYYY-MM-DD so comparisons are plain string compares — those are
   * chronological for this format and immune to timezone drift.
   */
  private rowDate(due: DueEnrollment): string | null {
    if (due.type === 'MONTHLY' && due.billingYear && due.billingMonth) {
      return `${due.billingYear}-${String(due.billingMonth).padStart(2, '0')}-01`;
    }
    return due.enrollmentDate ? String(due.enrollmentDate).slice(0, 10) : null;
  }

  displayedDues = computed(() => {
    const t = this.filterType();
    const from = this.dateFrom() ? toLocalYmd(this.dateFrom()!) : null;
    const to = this.dateTo() ? toLocalYmd(this.dateTo()!) : null;

    let list = this.dues();
    if (t !== 'ALL') list = list.filter(d => d.paymentType === t);
    if (from || to) {
      list = list.filter(d => {
        const day = this.rowDate(d);
        // A row with no date cannot be placed in a range. Dropping it is the
        // honest answer; showing it would claim it falls inside one.
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
    }
    return list;
  });

  /** Any filter beyond the defaults is on — drives the Clear button's state. */
  hasFilters = computed(() =>
    !!this.filterBranch || this.filterType() !== 'ALL' || !!this.dateFrom() || !!this.dateTo(),
  );

  // Totals follow the active type filter, so the header matches the table.
  totalFinal = computed(() => this.displayedDues().reduce((s, d) => s + d.finalPrice, 0));
  totalPaid = computed(() => this.displayedDues().reduce((s, d) => s + d.amountPaid, 0));
  totalRemaining = computed(() => this.displayedDues().reduce((s, d) => s + d.remaining, 0));

  get typeOptions() {
    return [
      { label: this.translate.instant('DUES.LIST.TYPE_ALL'), value: 'ALL' },
      { label: this.translate.instant('DUES.LIST.TYPE_ONE_TIME'), value: 'ONE_TIME' },
      { label: this.translate.instant('DUES.LIST.TYPE_MONTHLY'), value: 'MONTHLY_SUBSCRIPTION' },
      { label: this.translate.instant('DUES.LIST.TYPE_SESSION'), value: 'PER_SESSION' },
    ];
  }

  /** "August 2026" for a monthly row; empty for the others. */
  monthLabel(due: DueEnrollment): string {
    if (due.type !== 'MONTHLY' || !due.billingMonth) return '';
    const m = this.translate.instant('MONTHLY_SUBSCRIPTIONS.MONTHS.' + due.billingMonth);
    return `${m} ${due.billingYear}`;
  }

  /** Localised label + colour for the "pay type" badge. */
  typeLabel(due: DueEnrollment): string {
    return this.translate.instant('DUES.LIST.PT_' + due.paymentType);
  }
  typeSeverity(paymentType: string): 'success' | 'warn' | 'info' {
    return paymentType === 'MONTHLY_SUBSCRIPTION' ? 'warn'
      : paymentType === 'PER_SESSION' ? 'info' : 'success';
  }

  // Payment dialog
  selectedDue = signal<DueEnrollment | null>(null);
  showPaymentDialog = false;
  paymentAmount: number | null = null;
  paymentDate: Date = new Date();
  paymentNotes = '';

  ngOnInit() {
    this.loadBranches();
    this.load();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branchOptions = branches.map(b => ({ label: b.label, value: b.id }));
      },
      error: () => {}
    });
  }

  load() {
    this.loading.set(true);
    this.duesService.getDues(this.filterBranch || undefined).subscribe({
      next: (data) => {
        this.dues.set(data);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
      }
    });
  }

  clearFilters() {
    this.filterBranch = null;
    this.filterType.set('ALL');
    this.dateFrom.set(null);
    this.dateTo.set(null);
    // Only the branch is server-side, so this is the one that needs a refetch.
    this.load();
  }

  getProgress(due: DueEnrollment): number {
    if (due.finalPrice === 0) return 100;
    return Math.round((due.amountPaid / due.finalPrice) * 100);
  }

  openPaymentDialog(due: DueEnrollment) {
    this.selectedDue.set(due);
    this.paymentAmount = null;
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.showPaymentDialog = true;
  }

  /** Printing is OPT-IN — see the two dialog buttons. */
  submitPayment(print = false) {
    const due = this.selectedDue();
    if (!due || !this.paymentAmount || !this.paymentDate) return;

    this.actionLoading.set(true);
    const dateStr = toLocalYmd(this.paymentDate);
    const dto = { amount: this.paymentAmount, paymentDate: dateStr, notes: this.paymentNotes || undefined };

    // Each due type records its payment through its own endpoint.
    let request$: Observable<any>;
    switch (due.type) {
      case 'MASTER_ENROLLMENT': request$ = this.masterEnrollmentService.addPayment(due.id, dto); break;
      case 'MONTHLY': request$ = this.monthlyService.recordPayment(due.id, dto); break;
      case 'SESSION': request$ = this.sessionService.recordPayment(due.id, dto); break;
      default: request$ = this.enrollmentService.addPayment(due.id, dto);
    }

    request$.subscribe({
      next: (res: any) => {
        this.notificationService.success(this.translate.instant('DUES.PAYMENT_RECORDED'));
        this.showPaymentDialog = false;
        this.actionLoading.set(false);
        this.load();
        // Straight to the printer while the payer is still at the desk.
        if (print) this.receiptService.openPrint(res?.receipt);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.actionLoading.set(false);
      }
    });
  }

  /**
   * Reprint the last receipt for THIS due.
   *
   * A due is usually part-paid rather than untouched, so there is normally a
   * slip behind it. Looked up on click rather than pre-fetched for every row:
   * one request when someone asks beats a request per page load.
   *
   * Monthly and per-session dues match their receipt exactly — the due id IS
   * the bill/charge the receipt was issued against. A one-time course payment
   * has no such handle (its receipt points at the payment row, not the
   * enrolment), so it falls back to that student's most recent receipt of the
   * same kind, which at a front desk is the one being asked for.
   */
  printReceipt(due: DueEnrollment) {
    const wanted = due.type === 'MASTER_ENROLLMENT' ? 'MASTER'
      : due.type === 'MONTHLY' ? 'MONTHLY'
      : due.type === 'SESSION' ? 'SESSION' : 'ENROLLMENT';
    this.printingFor.set(due.id);
    this.api.get<any[]>(`receipts/student/${due.studentId}`).subscribe({
      next: (rows) => {
        this.printingFor.set(null);
        const mine = (rows || []).filter(r => !r.voidedAt);
        const exact = mine.find(r => r.sourceId === due.id);
        const hit = exact || mine.find(r => r.sourceType === wanted);
        if (!hit) {
          this.notificationService.error(this.translate.instant('DUES.LIST.NO_RECEIPT'));
          return;
        }
        this.receiptService.openPrint(hit);
      },
      error: () => this.printingFor.set(null),
    });
  }

  /** Which row is mid-lookup, so only its button spins. */
  printingFor = signal<string | null>(null);

  viewStudent(due: DueEnrollment) {
    this.router.navigate(['/students', due.studentId]);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
}
