import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DatePickerModule } from 'primeng/datepicker';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { Expense } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TooltipModule,
    TagModule, DialogModule, DatePickerModule, InputNumberModule, InputTextModule,
    TextareaModule, DeleteConfirmDialogComponent, TranslateModule
  ],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.scss'
})
export class ExpenseListComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  authService = inject(AuthService);

  expenses = signal<Expense[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);

  // Filters
  selectedBranchId: string = '';
  selectedType: string = '';
  selectedCategory: string = '';
  selectedRecurring: string = '';
  startDate: string = '';
  endDate: string = '';

  totalExpenses: number = 0;

  // Delete dialog
  showDeleteDialog = false;
  expenseToDelete = signal<Expense | null>(null);

  // Record payment dialog
  showPaymentDialog = false;
  expenseForPayment = signal<Expense | null>(null);
  paymentAmount: number = 0;
  paymentDate: Date = new Date();
  paymentNotes: string = '';
  paymentVendor: string = '';
  paymentInvoiceNumber: string = '';
  recordingPayment = signal(false);

  // Pay salaries dialog
  showSalariesDialog = false;
  salariesDate: Date = new Date();
  salariesBranchId: string = '';
  payingSalaries = signal(false);

  categories = [
    'SALARIES','RENT','UTILITIES','ELECTRICITY','INTERNET','WATER',
    'MARKETING','SUPPLIES','EQUIPMENT','MAINTENANCE','INSURANCE',
    'SOFTWARE','ADMINISTRATION','COGS','INVENTORY','OTHER'
  ];

  ngOnInit() {
    this.loadBranches();
    this.loadExpenses();
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  loadExpenses() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedBranchId) params.branchId = this.selectedBranchId;
    if (this.selectedType) params.type = this.selectedType;
    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedRecurring) params.isRecurring = this.selectedRecurring;
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.expenseService.getAllExpenses(params).subscribe({
      next: (expenses) => {
        this.expenses.set(expenses);
        this.totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  onFilterChange() {
    this.loadExpenses();
  }

  clearFilters() {
    this.selectedBranchId = '';
    this.selectedType = '';
    this.selectedCategory = '';
    this.selectedRecurring = '';
    this.startDate = '';
    this.endDate = '';
    this.loadExpenses();
  }

  createExpense() {
    this.router.navigate(['/expenses/create']);
  }

  editExpense(expense: Expense) {
    this.router.navigate(['/expenses', expense.id, 'edit']);
  }

  confirmDelete(expense: Expense) {
    this.expenseToDelete.set(expense);
    this.showDeleteDialog = true;
  }

  deleteExpense() {
    const expense = this.expenseToDelete();
    if (!expense) return;
    this.expenseService.deleteExpense(expense.id).subscribe({
      next: () => {
        this.notificationService.success('Expense deleted');
        this.showDeleteDialog = false;
        this.expenseToDelete.set(null);
        this.loadExpenses();
      },
      error: () => {
        this.notificationService.error('Failed to delete expense');
        this.showDeleteDialog = false;
      }
    });
  }

  openPaymentDialog(expense: Expense) {
    this.expenseForPayment.set(expense);
    this.paymentAmount = expense.amount;
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.paymentVendor = expense.vendor || '';
    this.paymentInvoiceNumber = '';
    this.showPaymentDialog = true;
  }

  confirmRecordPayment() {
    const expense = this.expenseForPayment();
    if (!expense) return;

    this.recordingPayment.set(true);
    const dateStr = this.paymentDate instanceof Date
      ? this.paymentDate.toISOString().split('T')[0]
      : this.paymentDate;

    this.expenseService.recordPayment({
      expenseId: expense.id,
      type: expense.type,
      category: expense.category,
      amount: this.paymentAmount,
      date: dateStr,
      branchId: expense.branchId,
      notes: this.paymentNotes || undefined,
      vendor: this.paymentVendor || undefined,
      invoiceNumber: this.paymentInvoiceNumber || undefined,
    }).subscribe({
      next: () => {
        this.recordingPayment.set(false);
        this.notificationService.success('Payment recorded successfully');
        this.showPaymentDialog = false;
        this.loadExpenses();
      },
      error: (err) => {
        this.recordingPayment.set(false);
        this.notificationService.error(err.error?.message || 'Failed to record payment');
      }
    });
  }

  openSalariesDialog() {
    this.salariesDate = new Date();
    this.salariesBranchId = '';
    this.showSalariesDialog = true;
  }

  viewExpense(expense: Expense) {
    this.router.navigate(['/expenses', expense.id]);
  }

  goToManageRecurring() {
    this.router.navigate(['/expenses/manage-recurring']);
  }

  goToSalaries() {
    this.router.navigate(['/expenses/salaries']);
  }

  confirmPaySalaries() {
    this.payingSalaries.set(true);
    const dateStr = this.salariesDate instanceof Date
      ? this.salariesDate.toISOString().split('T')[0]
      : this.salariesDate;

    this.expenseService.paySalaries(dateStr, this.salariesBranchId || undefined).subscribe({
      next: (result) => {
        this.payingSalaries.set(false);
        this.showSalariesDialog = false;
        this.notificationService.success(result.message);
        this.loadExpenses();
      },
      error: (err) => {
        this.payingSalaries.set(false);
        this.notificationService.error(err.error?.message || 'Failed to pay salaries');
        this.showSalariesDialog = false;
      }
    });
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return 'Global/Shared';
    return this.branches().find(b => b.id === branchId)?.name || 'Unknown';
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

  getPaymentStatus(expense: Expense): { label: string; severity: 'success' | 'warn' | 'danger' | 'secondary' } {
    const totalPaid = expense.totalPaid ?? 0;
    if (totalPaid >= expense.amount) {
      return { label: 'Paid', severity: 'success' };
    } else if (totalPaid > 0) {
      return { label: 'Partial', severity: 'warn' };
    }
    return { label: 'Unpaid', severity: 'danger' };
  }
}
