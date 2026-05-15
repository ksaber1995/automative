import { Component, OnInit, inject, signal } from '@angular/core';
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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expense, ExpensePayment } from '@shared/interfaces/expense.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-expense-detail',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TagModule, TableModule,
    DialogModule, TooltipModule, DividerModule, InputTextModule, DeleteConfirmDialogComponent,
    TranslateModule,
  ],
  templateUrl: './expense-detail.component.html'
})
export class ExpenseDetailComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  authService = inject(AuthService);

  expense = signal<Expense | null>(null);
  payments = signal<ExpensePayment[]>([]);
  branches = signal<any[]>([]);
  loading = signal(true);
  paymentsLoading = signal(false);

  showPaymentDialog = false;
  savingPayment = signal(false);
  newPayment = { amount: 0, date: '', vendor: '', invoiceNumber: '', notes: '' };

  showDeletePaymentDialog = false;
  paymentToDelete = signal<ExpensePayment | null>(null);

  ngOnInit() {
    const id = this.route.snapshot.params['id'];
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.loadExpense(id);
    this.loadPayments(id);
  }

  private loadExpense(id: string) {
    this.loading.set(true);
    this.expenseService.getExpenseById(id).subscribe({
      next: (e) => { this.expense.set(e); this.loading.set(false); },
      error: () => { this.loading.set(false); }
    });
  }

  private loadPayments(id: string) {
    this.paymentsLoading.set(true);
    this.expenseService.getExpensePayments(id).subscribe({
      next: (p) => { this.payments.set(p); this.paymentsLoading.set(false); },
      error: () => this.paymentsLoading.set(false)
    });
  }

  openPaymentDialog() {
    const e = this.expense();
    this.newPayment = {
      amount: e?.amount ?? 0,
      date: new Date().toISOString().split('T')[0],
      vendor: e?.vendor ?? '',
      invoiceNumber: '',
      notes: '',
    };
    this.showPaymentDialog = true;
  }

  savePayment() {
    const e = this.expense();
    if (!e || !this.newPayment.amount || !this.newPayment.date) return;

    this.savingPayment.set(true);
    this.expenseService.recordPayment({
      expenseId: e.id,
      type: e.type,
      category: e.category,
      amount: Number(this.newPayment.amount),
      date: this.newPayment.date,
      branchId: e.branchId,
      vendor: this.newPayment.vendor || undefined,
      invoiceNumber: this.newPayment.invoiceNumber || undefined,
      notes: this.newPayment.notes || undefined,
    }).subscribe({
      next: () => {
        this.savingPayment.set(false);
        this.showPaymentDialog = false;
        this.notificationService.success(this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_RECORDED'));
        this.loadExpense(e.id);
        this.loadPayments(e.id);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.savingPayment.set(false);
      }
    });
  }

  confirmDeletePayment(payment: ExpensePayment) {
    this.paymentToDelete.set(payment);
    this.showDeletePaymentDialog = true;
  }

  deletePayment() {
    const p = this.paymentToDelete();
    if (!p) return;
    this.expenseService.deletePayment(p.id).subscribe({
      next: () => {
        this.showDeletePaymentDialog = false;
        this.notificationService.success(this.translate.instant('EXPENSES.DETAIL.MSG_PAYMENT_DELETED'));
        const id = this.route.snapshot.params['id'];
        this.loadExpense(id);
        this.loadPayments(id);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return this.translate.instant('EXPENSES.DETAIL.GLOBAL_SHARED');
    return this.branches().find(b => b.id === branchId)?.name || this.translate.instant('EXPENSES.DETAIL.UNKNOWN');
  }

  getTypeColor(type: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (type) {
      case 'FIXED': return 'info';
      case 'VARIABLE': return 'success';
      case 'SHARED': return 'warn';
      case 'CAPITAL': return 'danger';
      default: return 'info';
    }
  }

  /** Returns the status enum value (PAID / PARTIAL / UNPAID), used to derive both the i18n key and the color class. */
  getStatusKey(): 'PAID' | 'PARTIAL' | 'UNPAID' {
    const paid = this.expense()?.totalPaid ?? 0;
    const amount = this.expense()?.amount ?? 0;
    if (paid >= amount && amount > 0) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return 'UNPAID';
  }

  getStatusLabelKey(): string {
    return 'EXPENSES.DETAIL.STATUS_' + this.getStatusKey();
  }

  getStatusClass(): string {
    const status = this.getStatusKey();
    if (status === 'PAID') return 'bg-green-50 border-green-200 text-green-800';
    if (status === 'PARTIAL') return 'bg-yellow-50 border-yellow-200 text-yellow-800';
    return 'bg-red-50 border-red-200 text-red-800';
  }

  editExpense() {
    this.router.navigate(['/expenses', this.route.snapshot.params['id'], 'edit']);
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
