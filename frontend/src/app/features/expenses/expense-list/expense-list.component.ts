import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-expense-list',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule, ConfirmDialogModule],
  providers: [ConfirmationService],
  templateUrl: './expense-list.component.html',
  styleUrl: './expense-list.component.scss'
})
export class ExpenseListComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  expenses = signal<Expense[]>([]);
  branches = signal<Branch[]>([]);
  loading = signal(true);
  selectedBranchId: string = '';
  selectedType: string = '';
  startDate: string = '';
  endDate: string = '';
  totalExpenses: number = 0;

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

  createExpense() {
    this.router.navigate(['/expenses/create']);
  }

  editExpense(expense: Expense) {
    this.router.navigate(['/expenses', expense.id, 'edit']);
  }

  deleteExpense(expense: Expense) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete this expense?',
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.expenseService.deleteExpense(expense.id).subscribe({
          next: () => {
            this.notificationService.success('Expense deleted');
            this.loadExpenses();
          }
        });
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
      default: return 'info';
    }
  }
}
