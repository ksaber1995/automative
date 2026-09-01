import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { DebtService } from '../../../core/services/debt.service';
import { Debt, DebtStatus } from '@shared/interfaces/debt.interface';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-debt-list',
  standalone: true,
  imports: [
    TablePageUxDirective,
    CommonModule,
    TableModule,
    ButtonModule,
    CardModule,
    TagModule,
    ProgressBarModule
  ],
  templateUrl: './debt-list.component.html',
  styleUrl: './debt-list.component.scss'})
export class DebtListComponent implements OnInit {
  private debtService = inject(DebtService);
  private router = inject(Router);
  authService = inject(AuthService);

  debts = signal<Debt[]>([]);
  summary = signal<any>(null);
  loading = signal(false);

  ngOnInit() {
    this.loadDebts();
    this.loadSummary();
  }

  loadDebts() {
    this.loading.set(true);
    this.debtService.findAll().subscribe({
      next: (data) => {
        this.debts.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading debts:', err);
        this.loading.set(false);
      }
    });
  }

  loadSummary() {
    this.debtService.getSummary().subscribe({
      next: (data) => {
        this.summary.set(data);
      },
      error: (err) => {
        console.error('Error loading summary:', err);
      }
    });
  }

  createDebt() {
    this.router.navigate(['/debts/new']);
  }

  viewDebt(id: string) {
    this.router.navigate(['/debts', id]);
  }

  editDebt(id: string) {
    this.router.navigate(['/debts/edit', id]);
  }

  makePayment(id: string) {
    this.router.navigate(['/debts', id, 'payment']);
  }

  getPaymentProgress(debt: Debt): number {
    if (debt.principalAmount === 0) return 0;
    const paid = debt.principalAmount - debt.currentBalance;
    return Math.round((paid / debt.principalAmount) * 100);
  }

  getStatusSeverity(status: DebtStatus): 'success' | 'info' | 'warn' | 'danger' {
    switch (status) {
      case 'ACTIVE': return 'warn';
      case 'PAID_OFF': return 'success';
      case 'DEFAULTED': return 'danger';
      default: return 'info';
    }
  }

  formatDebtType(type: string): string {
    return type.replace(/_/g, ' ');
  }

  isOverdue(dueDate: string): boolean {
    return new Date(dueDate) < new Date();
  }
}
