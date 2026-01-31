import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { FormsModule } from '@angular/forms';
import { WithdrawalService } from '../../../core/services/withdrawal.service';
import { Withdrawal } from '@shared/interfaces/withdrawal.interface';

@Component({
  selector: 'app-withdrawal-list',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    CardModule,
    TagModule,
    FormsModule
  ],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">Withdrawals</h2>
            <p-button
              label="New Withdrawal"
              icon="pi pi-plus"
              (onClick)="createWithdrawal()">
            </p-button>
          </div>
        </ng-template>

        <div class="mb-4 flex gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">Start Date</label>
            <input
              type="date"
              [(ngModel)]="startDateStr"
              (change)="onDateChange()"
              class="w-full p-2 border rounded" />
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">End Date</label>
            <input
              type="date"
              [(ngModel)]="endDateStr"
              (change)="onDateChange()"
              class="w-full p-2 border rounded" />
          </div>
          <div class="flex items-end">
            <p-button
              label="Clear Filters"
              icon="pi pi-filter-slash"
              [outlined]="true"
              (onClick)="clearFilters()">
            </p-button>
          </div>
        </div>

        <!-- Summary Cards -->
        @if (summary()) {
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="bg-blue-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Total Withdrawals</div>
              <div class="text-2xl font-bold">{{ summary()!.totalWithdrawals }}</div>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Total Amount</div>
              <div class="text-2xl font-bold">\${{ summary()!.totalAmount.toLocaleString() }}</div>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Categories</div>
              <div class="text-2xl font-bold">{{ summary()!.byCategory.length }}</div>
            </div>
          </div>
        }

        <p-table
          [value]="withdrawals()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [tableStyle]="{'min-width': '50rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Stakeholders</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Payment Method</th>
              <th>Reason</th>
              <th>Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-withdrawal>
            <tr>
              <td>{{ withdrawal.withdrawalDate | date: 'short' }}</td>
              <td>
                @if (withdrawal.stakeholders.length === 1) {
                  <div class="font-medium">{{ withdrawal.stakeholders[0].stakeholderName }}</div>
                  @if (withdrawal.stakeholders[0].stakeholderEmail) {
                    <div class="text-sm text-gray-500">{{ withdrawal.stakeholders[0].stakeholderEmail }}</div>
                  }
                } @else {
                  <div class="font-medium">{{ withdrawal.stakeholders.length }} Stakeholders</div>
                  <div class="text-sm text-gray-500">
                    @for (s of withdrawal.stakeholders; track s.stakeholderName; let i = $index) {
                      {{ s.stakeholderName }}@if (i < withdrawal.stakeholders.length - 1) {, }
                    }
                  </div>
                }
              </td>
              <td class="font-semibold text-red-600">-\${{ withdrawal.amount.toLocaleString() }}</td>
              <td>
                <p-tag [value]="withdrawal.category" [severity]="getCategorySeverity(withdrawal.category)"></p-tag>
              </td>
              <td>{{ withdrawal.paymentMethod }}</td>
              <td>{{ withdrawal.reason }}</td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-eye"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="viewWithdrawal(withdrawal.id)">
                  </p-button>
                  @if (canEdit(withdrawal)) {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      (onClick)="editWithdrawal(withdrawal.id)">
                    </p-button>
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="deleteWithdrawal(withdrawal.id)">
                    </p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center py-8 text-gray-500">
                No withdrawals found
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
export class WithdrawalListComponent implements OnInit {
  private withdrawalService = inject(WithdrawalService);
  private router = inject(Router);

  withdrawals = signal<Withdrawal[]>([]);
  summary = signal<any>(null);
  loading = signal(false);
  startDateStr: string = '';
  endDateStr: string = '';

  ngOnInit() {
    this.loadWithdrawals();
    this.loadSummary();
  }

  onDateChange() {
    this.loadWithdrawals();
    this.loadSummary();
  }

  loadWithdrawals() {
    this.loading.set(true);
    const startDateStr = this.startDateStr || undefined;
    const endDateStr = this.endDateStr || undefined;

    this.withdrawalService.findAll(startDateStr, endDateStr).subscribe({
      next: (data) => {
        this.withdrawals.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading withdrawals:', err);
        this.loading.set(false);
      }
    });
  }

  loadSummary() {
    const startDateStr = this.startDateStr || undefined;
    const endDateStr = this.endDateStr || undefined;

    this.withdrawalService.getSummary(startDateStr, endDateStr).subscribe({
      next: (data) => {
        this.summary.set(data);
      },
      error: (err) => {
        console.error('Error loading summary:', err);
      }
    });
  }

  clearFilters() {
    this.startDateStr = '';
    this.endDateStr = '';
    this.loadWithdrawals();
    this.loadSummary();
  }

  createWithdrawal() {
    this.router.navigate(['/withdrawals/new']);
  }

  viewWithdrawal(id: string) {
    this.router.navigate(['/withdrawals', id]);
  }

  editWithdrawal(id: string) {
    this.router.navigate(['/withdrawals/edit', id]);
  }

  deleteWithdrawal(id: string) {
    if (confirm('Are you sure you want to delete this withdrawal? This action cannot be undone.')) {
      this.withdrawalService.remove(id).subscribe({
        next: () => {
          this.loadWithdrawals();
          this.loadSummary();
        },
        error: (err) => {
          console.error('Error deleting withdrawal:', err);
          alert('Failed to delete withdrawal: ' + (err.error?.message || 'Unknown error'));
        }
      });
    }
  }

  canEdit(withdrawal: Withdrawal): boolean {
    // Can only edit/delete within 24 hours
    const createdAt = new Date(withdrawal.createdAt);
    const now = new Date();
    const hoursSince = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    return hoursSince <= 24;
  }

  getCategorySeverity(category: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (category) {
      case 'OWNER_DRAW': return 'info';
      case 'PROFIT_DISTRIBUTION': return 'success';
      case 'DIVIDEND': return 'success';
      default: return 'warn';
    }
  }
}
