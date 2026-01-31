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

@Component({
  selector: 'app-debt-list',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    CardModule,
    TagModule,
    ProgressBarModule
  ],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">Debts & Loans</h2>
            <p-button
              label="New Debt/Loan"
              icon="pi pi-plus"
              (onClick)="createDebt()">
            </p-button>
          </div>
        </ng-template>

        <!-- Summary Cards -->
        @if (summary()) {
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-blue-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Active Debts</div>
              <div class="text-2xl font-bold">{{ summary()!.activeDebtsCount }}</div>
            </div>
            <div class="bg-red-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Total Borrowed</div>
              <div class="text-2xl font-bold">\${{ summary()!.totalBorrowed.toLocaleString() }}</div>
            </div>
            <div class="bg-orange-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Outstanding Balance</div>
              <div class="text-2xl font-bold text-red-600">\${{ summary()!.totalOutstanding.toLocaleString() }}</div>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Interest Paid</div>
              <div class="text-2xl font-bold">\${{ summary()!.totalInterestPaid.toLocaleString() }}</div>
            </div>
          </div>
        }

        <p-table
          [value]="debts()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [tableStyle]="{'min-width': '50rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>Creditor</th>
              <th>Type</th>
              <th>Principal</th>
              <th>Current Balance</th>
              <th>Progress</th>
              <th>Interest Rate</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-debt>
            <tr>
              <td>
                <div class="font-medium">{{ debt.creditorName }}</div>
                @if (debt.creditorEmail) {
                  <div class="text-sm text-gray-500">{{ debt.creditorEmail }}</div>
                }
              </td>
              <td>{{ formatDebtType(debt.debtType) }}</td>
              <td>\${{ debt.principalAmount.toLocaleString() }}</td>
              <td class="font-semibold text-red-600">\${{ debt.currentBalance.toLocaleString() }}</td>
              <td>
                <div class="w-full">
                  <p-progressBar
                    [value]="getPaymentProgress(debt)"
                    [showValue]="false"
                    [style]="{'height': '20px'}">
                  </p-progressBar>
                  <div class="text-xs text-center mt-1">
                    {{ getPaymentProgress(debt) }}% paid
                  </div>
                </div>
              </td>
              <td>{{ debt.interestRate }}%</td>
              <td>
                <div [class.text-red-600]="isOverdue(debt.dueDate)">
                  {{ debt.dueDate | date: 'shortDate' }}
                </div>
              </td>
              <td>
                <p-tag [value]="debt.status" [severity]="getStatusSeverity(debt.status)"></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="viewDebt(debt.id)"
                    pTooltip="View Details">
                  </p-button>
                  @if (debt.status === 'ACTIVE') {
                    <p-button
                      icon="pi pi-dollar"
                      [rounded]="true"
                      [text]="true"
                      severity="success"
                      (onClick)="makePayment(debt.id)"
                      pTooltip="Make Payment">
                    </p-button>
                  }
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    (onClick)="editDebt(debt.id)"
                    pTooltip="Edit">
                  </p-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center py-8 text-gray-500">
                No debts found
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
  styles: [`
    :host ::ng-deep .p-datatable .p-datatable-thead > tr > th {
      background-color: #f8f9fa;
      font-weight: 600;
    }
  `]
})
export class DebtListComponent implements OnInit {
  private debtService = inject(DebtService);
  private router = inject(Router);

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
