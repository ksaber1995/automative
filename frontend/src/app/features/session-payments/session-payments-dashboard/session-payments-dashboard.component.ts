import { Component, OnInit, inject, signal, computed, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { forkJoin } from 'rxjs';

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
import { TabsModule } from 'primeng/tabs';

import { SessionPaymentsService } from '../session-payments.service';
import { SessionPayDialogComponent } from '../session-pay-dialog/session-pay-dialog.component';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import {
  SessionPaymentWithDetails,
  SessionPaymentSummary,
  SessionPackageWithDetails,
} from '@shared/interfaces/session-payment.interface';

type StatusTab = 'ALL' | 'PENDING' | 'PAID' | 'COVERED' | 'REFUNDED';

@Component({
  selector: 'app-session-payments-dashboard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TranslateModule,
    CardModule, TableModule, ButtonModule, TagModule, TooltipModule, SelectModule,
    DialogModule, InputNumberModule, DatePickerModule, TextareaModule, TabsModule,
    AmountPipe, SessionPayDialogComponent,
  ],
  templateUrl: './session-payments-dashboard.component.html',
})
export class SessionPaymentsDashboardComponent implements OnInit {
  private service = inject(SessionPaymentsService);
  private lookup = inject(LookupService);
  private courseService = inject(CourseService);
  private notify = inject(NotificationService);
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

  branches = signal<LookupOption[]>([]);
  courses = signal<{ id: string; label: string }[]>([]);
  payments = signal<SessionPaymentWithDetails[]>([]);
  packages = signal<SessionPackageWithDetails[]>([]);
  summary = signal<SessionPaymentSummary | null>(null);
  loading = signal(false);

  // Void / refund dialogs
  showVoid = signal(false);
  showRefund = signal(false);
  selected = signal<SessionPaymentWithDetails | null>(null);
  voidReason = signal('');
  refundAmount = signal<number | null>(null);
  refundNote = signal('');
  submitting = signal(false);

  // Package pay dialog
  showPackagePay = signal(false);
  selectedPackage = signal<SessionPackageWithDetails | null>(null);
  packagePayAmount = signal<number | null>(null);
  packagePayDate = signal<Date>(new Date());

  filtered = computed(() => {
    const tab = this.selectedTab();
    return tab === 'ALL' ? this.payments() : this.payments().filter(p => p.paymentStatus === tab);
  });

  ngOnInit(): void {
    this.lookup.branches().subscribe({ next: b => this.branches.set(b), error: () => {} });
    this.courseService.getAllCourses().subscribe({
      next: (list) => this.courses.set(
        list.filter(c => (c as any).paymentType === 'PER_SESSION').map(c => ({ id: c.id, label: c.name }))
      ),
      error: () => {},
    });
    this.loadData();
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
    }).subscribe({
      next: ({ payments, summary }) => {
        this.payments.set(payments);
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    if (this.view() === 'PACKAGES') this.loadPackages();
  }

  loadPackages(): void {
    this.service.listPackages({
      branchId: this.selectedBranchId() || undefined,
      courseId: this.selectedCourseId() || undefined,
    }).subscribe({ next: p => this.packages.set(p), error: () => {} });
  }

  switchView(v: 'CHARGES' | 'PACKAGES'): void {
    this.view.set(v);
    if (v === 'PACKAGES') this.loadPackages();
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
    this.refundAmount.set(row.amountPaid);
    this.refundNote.set('');
    this.showRefund.set(true);
  }

  confirmRefund(): void {
    const row = this.selected();
    if (!row || this.refundAmount() == null) return;
    this.submitting.set(true);
    this.service.refund(row.id, { amount: this.refundAmount() as number, note: this.refundNote() || undefined }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.showRefund.set(false);
        this.notify.success(this.translate.instant('SESSION_PAYMENTS.REFUND_SUCCESS'));
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

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'PAID': return 'success';
      case 'COVERED': return 'info';
      case 'PENDING': return 'warn';
      case 'REFUNDED': return 'danger';
      default: return 'secondary';
    }
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
