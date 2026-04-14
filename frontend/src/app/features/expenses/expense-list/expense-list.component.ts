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
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TooltipModule, TagModule, DialogModule, DatePickerModule, DeleteConfirmDialogComponent, TranslateModule],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.scss'
})
export class ExpenseListComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

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

  // Pay recurring dialog
  showPayDialog = false;
  expenseToPayId = signal<string>('');
  expenseToPayLabel = signal<string>('');
  payDate: Date = new Date();

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

  // --- Pay Recurring ---
  openPayDialog(expense: Expense) {
    this.expenseToPayId.set(expense.id);
    this.expenseToPayLabel.set(expense.description);
    this.payDate = new Date();
    this.showPayDialog = true;
  }

  confirmPayRecurring() {
    const dateStr = this.payDate instanceof Date
      ? this.payDate.toISOString().split('T')[0]
      : this.payDate;

    this.expenseService.payRecurring(this.expenseToPayId(), dateStr).subscribe({
      next: () => {
        this.notificationService.success('Expense paid for this month');
        this.showPayDialog = false;
        this.loadExpenses();
      },
      error: (err) => {
        this.notificationService.error(err.error?.message || 'Failed to pay expense');
        this.showPayDialog = false;
      }
    });
  }

  // --- Pay All Salaries ---
  openSalariesDialog() {
    this.salariesDate = new Date();
    this.salariesBranchId = '';
    this.showSalariesDialog = true;
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
}
