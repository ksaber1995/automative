import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, takeUntil, forkJoin } from 'rxjs';

import { MonthlySubscriptionsService } from '../monthly-subscriptions.service';
import { BranchService } from '../../branches/services/branch.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';

import { MonthlyPaymentWithDetails, MonthlyPaymentSummary } from '@shared/interfaces/monthly-subscription.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { Course } from '@shared/interfaces/course.interface';

@Component({
  selector: 'app-monthly-subscriptions-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, TranslateModule],
  templateUrl: './monthly-subscriptions-dashboard.component.html',
})
export class MonthlySubscriptionsDashboardComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Filter state
  filterForm!: FormGroup;
  branches: Branch[] = [];
  courses: Course[] = [];

  // Data
  payments: MonthlyPaymentWithDetails[] = [];
  filteredPayments: MonthlyPaymentWithDetails[] = [];
  summary: MonthlyPaymentSummary | null = null;

  // UI state
  loading = false;
  generating = false;
  payingId: string | null = null;
  showPayDialog = false;
  selectedPayment: MonthlyPaymentWithDetails | null = null;
  payAmount = 0;
  payDate = '';
  payNotes = '';

  // Status filter
  statusFilter = 'ALL';
  readonly statuses = ['ALL', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE'];

  get isRtl(): boolean {
    return document.documentElement.dir === 'rtl';
  }

  constructor(
    private fb: FormBuilder,
    private svc: MonthlySubscriptionsService,
    private branchSvc: BranchService,
    private courseSvc: CourseService,
    private notify: NotificationService,
    private auth: AuthService,
    private translate: TranslateService,
  ) {}

  ngOnInit(): void {
    const now = new Date();
    this.filterForm = this.fb.group({
      billingYear: [now.getFullYear(), Validators.required],
      billingMonth: [now.getMonth() + 1, [Validators.required, Validators.min(1), Validators.max(12)]],
      branchId: [''],
      courseId: [''],
    });

    this.payDate = now.toISOString().split('T')[0];

    forkJoin({
      branches: this.branchSvc.getAllBranches(),
      courses: this.courseSvc.getAllCourses(),
    }).pipe(takeUntil(this.destroy$)).subscribe(({ branches, courses }) => {
      this.branches = branches;
      // Only show monthly-subscription courses in the filter
      this.courses = courses.filter((c: Course) => c.paymentType === 'MONTHLY_SUBSCRIPTION');
      this.loadData();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadData(): void {
    const { billingYear, billingMonth, branchId, courseId } = this.filterForm.value;
    if (!billingYear || !billingMonth) return;

    this.loading = true;
    forkJoin({
      payments: this.svc.list({ billingYear, billingMonth, branchId: branchId || undefined, courseId: courseId || undefined }),
      summary: this.svc.summary({ billingYear, billingMonth, branchId: branchId || undefined }),
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ payments, summary }) => {
        this.payments = payments;
        this.summary = summary;
        this.applyStatusFilter();
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.LOAD_ERROR'));
      },
    });
  }

  applyStatusFilter(): void {
    if (this.statusFilter === 'ALL') {
      this.filteredPayments = [...this.payments];
    } else {
      this.filteredPayments = this.payments.filter(p => p.paymentStatus === this.statusFilter);
    }
  }

  onStatusFilterChange(status: string): void {
    this.statusFilter = status;
    this.applyStatusFilter();
  }

  generateBills(): void {
    const { billingYear, billingMonth, branchId, courseId } = this.filterForm.value;
    this.generating = true;
    this.svc.generate({
      billingYear,
      billingMonth,
      branchId: branchId || undefined,
      courseId: courseId || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.generating = false;
        this.notify.success(
          this.translate.instant('MONTHLY_SUBSCRIPTIONS.GENERATED', { count: res.generated, month: res.month })
        );
        this.loadData();
      },
      error: () => {
        this.generating = false;
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.GENERATE_ERROR'));
      },
    });
  }

  openPayDialog(payment: MonthlyPaymentWithDetails): void {
    this.selectedPayment = payment;
    this.payAmount = payment.amountDue - payment.amountPaid;
    this.payDate = new Date().toISOString().split('T')[0];
    this.payNotes = '';
    this.showPayDialog = true;
  }

  closePayDialog(): void {
    this.showPayDialog = false;
    this.selectedPayment = null;
  }

  confirmPayment(): void {
    if (!this.selectedPayment || this.payAmount <= 0) return;
    this.payingId = this.selectedPayment.id;
    this.svc.recordPayment(this.selectedPayment.id, {
      amount: this.payAmount,
      paymentDate: this.payDate,
      notes: this.payNotes || undefined,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.payingId = null;
        this.closePayDialog();
        this.notify.success(this.translate.instant('MONTHLY_SUBSCRIPTIONS.PAYMENT_RECORDED'));
        this.loadData();
      },
      error: () => {
        this.payingId = null;
        this.notify.error(this.translate.instant('MONTHLY_SUBSCRIPTIONS.PAYMENT_ERROR'));
      },
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'PAID': return 'badge-success';
      case 'PARTIAL': return 'badge-warning';
      case 'OVERDUE': return 'badge-danger';
      default: return 'badge-secondary';
    }
  }

  getMonthName(month: number): string {
    return new Date(2000, month - 1, 1).toLocaleString('default', { month: 'long' });
  }

  get months(): { value: number; label: string }[] {
    return Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: this.getMonthName(i + 1),
    }));
  }

  get years(): number[] {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }
}
