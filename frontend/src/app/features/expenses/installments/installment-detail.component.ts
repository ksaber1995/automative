import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { DividerModule } from 'primeng/divider';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { InstallmentService } from '../services/installment.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  InstallmentPlan,
  InstallmentScheduleItem,
} from '@shared/interfaces/installment.interface';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-installment-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule,
    DialogModule, TooltipModule, DividerModule, DatePickerModule, InputNumberModule,
    TextareaModule, DeleteConfirmDialogComponent, TranslateModule,
  ],
  templateUrl: './installment-detail.component.html',
})
export class InstallmentDetailComponent implements OnInit {
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  plan = signal<InstallmentPlan | null>(null);
  schedule = signal<InstallmentScheduleItem[]>([]);
  downpaymentPayment = signal<ExpensePayment | null>(null);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  planId = '';

  paidTotal = computed(() =>
    this.schedule()
      .filter(s => s.status === 'PAID')
      .reduce((sum, s) => sum + (s.paidAmount ?? 0), 0),
  );
  paidCount = computed(() => this.schedule().filter(s => s.status === 'PAID').length);
  remaining = computed(() => {
    const p = this.plan();
    if (!p) return 0;
    return Math.max(0, p.financedAmount - this.paidTotal());
  });
  branchName = computed(() => {
    const p = this.plan();
    if (!p?.branchId) return this.translate.instant('INSTALLMENTS.DETAIL.GLOBAL');
    return this.branches().find(b => b.id === p.branchId)?.name || '—';
  });

  showPayDialog = false;
  payTarget = signal<InstallmentScheduleItem | null>(null);
  payAmount = 0;
  payDate: Date = new Date();
  payNotes = '';
  paying = signal(false);

  showUnpayDialog = false;
  unpayTarget = signal<InstallmentScheduleItem | null>(null);

  showDeleteDialog = false;

  ngOnInit() {
    this.planId = this.route.snapshot.paramMap.get('id') || '';
    this.branchService.getActiveBranches().subscribe({ next: bs => this.branches.set(bs) });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.installmentService.getById(this.planId).subscribe({
      next: (res) => {
        this.plan.set(res.plan);
        this.schedule.set(res.schedule);
        this.downpaymentPayment.set(res.downpaymentPayment);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notificationService.error(this.translate.instant('INSTALLMENTS.DETAIL.MSG_LOAD_FAILED'));
      },
    });
  }

  back() { this.router.navigate(['/expenses/installments']); }

  openPay(item: InstallmentScheduleItem) {
    this.payTarget.set(item);
    this.payAmount = item.amount;
    this.payDate = new Date();
    this.payNotes = '';
    this.showPayDialog = true;
  }

  confirmPay() {
    const t = this.payTarget();
    if (!t) return;
    this.paying.set(true);
    const dateStr = this.payDate instanceof Date
      ? this.payDate.toISOString().split('T')[0]
      : this.payDate;

    this.installmentService.pay(this.planId, t.id, {
      date: dateStr,
      amount: this.payAmount,
      notes: this.payNotes || undefined,
    }).subscribe({
      next: () => {
        this.paying.set(false);
        this.showPayDialog = false;
        this.notificationService.success(this.translate.instant('INSTALLMENTS.DETAIL.MSG_PAID'));
        this.load();
      },
      error: (err) => {
        this.paying.set(false);
        this.notificationService.error(err.error?.message || this.translate.instant('INSTALLMENTS.DETAIL.MSG_PAY_FAILED'));
      },
    });
  }

  confirmUnpay(item: InstallmentScheduleItem) {
    this.unpayTarget.set(item);
    this.showUnpayDialog = true;
  }

  doUnpay() {
    const t = this.unpayTarget();
    if (!t) return;
    this.installmentService.unpay(this.planId, t.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('INSTALLMENTS.DETAIL.MSG_REVERSED'));
        this.showUnpayDialog = false;
        this.unpayTarget.set(null);
        this.load();
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || this.translate.instant('INSTALLMENTS.DETAIL.MSG_REVERSE_FAILED'));
        this.showUnpayDialog = false;
      },
    });
  }

  confirmDelete() { this.showDeleteDialog = true; }

  doDelete() {
    this.installmentService.delete(this.planId).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('INSTALLMENTS.DETAIL.MSG_DELETED'));
        this.router.navigate(['/expenses/installments']);
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || this.translate.instant('INSTALLMENTS.DETAIL.MSG_DELETE_FAILED'));
        this.showDeleteDialog = false;
      },
    });
  }

  isOverdue(item: InstallmentScheduleItem): boolean {
    if (item.status !== 'PENDING') return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(item.dueDate) < today;
  }

  statusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    switch (status) {
      case 'ACTIVE': return 'info';
      case 'COMPLETED': return 'success';
      case 'CANCELED': return 'danger';
      default: return 'secondary';
    }
  }

  schedSeverity(item: InstallmentScheduleItem): 'success' | 'info' | 'warn' | 'danger' | 'secondary' {
    if (item.status === 'PAID') return 'success';
    if (item.status === 'SKIPPED') return 'secondary';
    if (this.isOverdue(item)) return 'danger';
    return 'warn';
  }

  planStatusLabel(status: string): string {
    switch (status) {
      case 'ACTIVE': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_ACTIVE');
      case 'COMPLETED': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_COMPLETED');
      case 'CANCELED': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_CANCELED');
      default: return status;
    }
  }

  schedStatusLabel(status: string): string {
    switch (status) {
      case 'PAID': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_PAID');
      case 'PENDING': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_PENDING');
      case 'SKIPPED': return this.translate.instant('INSTALLMENTS.DETAIL.STATUS_SKIPPED');
      default: return status;
    }
  }
}
