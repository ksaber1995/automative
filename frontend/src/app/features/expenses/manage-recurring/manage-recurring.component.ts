import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { forkJoin } from 'rxjs';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense, ExpensePayment } from '@shared/interfaces/expense.interface';

interface RecurringRow {
  template: Expense;
  payment: ExpensePayment | null;
  overrideAmount: number;
  notes: string;
  vendor: string;
}

@Component({
  selector: 'app-manage-recurring',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, TableModule, ButtonModule, TagModule,
    DatePickerModule, CheckboxModule, TooltipModule, InputNumberModule,
    InputTextModule, SelectModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()"></p-button>
        <div class="flex-1">
          <h1 class="text-3xl font-bold text-gray-900">Manage Recurring Expenses</h1>
          <p class="text-gray-500 mt-1">{{ displayMonth() }} — review and pay recurring obligations</p>
        </div>
      </div>

      <!-- Controls -->
      <p-card styleClass="mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Month</label>
            <p-datepicker
              [(ngModel)]="selectedMonth"
              view="month"
              dateFormat="yy-mm"
              [showIcon]="true"
              placeholder="Select month"
              (onSelect)="onMonthChange()"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Payment Date</label>
            <p-datepicker
              [(ngModel)]="paymentDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              placeholder="Date to record payment"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Branch</label>
            <p-select
              [(ngModel)]="selectedBranchId"
              [options]="branchOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="All branches"
              [style]="{ width: '100%' }"
              (onChange)="applyBranchFilter()"
            ></p-select>
          </div>
        </div>
      </p-card>

      <!-- Summary cards -->
      @if (!loading()) {
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Recurring</p>
            <p class="text-3xl font-bold text-gray-800">{{ filteredRows().length }}</p>
          </div>
          <div class="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p class="text-xs text-red-600 uppercase tracking-wider mb-1">Unpaid</p>
            <p class="text-3xl font-bold text-red-700">{{ unpaidRows().length }}</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p class="text-xs text-blue-600 uppercase tracking-wider mb-1">Selected</p>
            <p class="text-3xl font-bold text-blue-700">{{ selectedIds().size }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p class="text-xs text-green-600 uppercase tracking-wider mb-1">Selected Total</p>
            <p class="text-3xl font-bold text-green-700">{{ selectedTotal().toFixed(2) }}</p>
          </div>
        </div>
      }

      <!-- Table -->
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex items-center justify-between px-4 pt-4">
            <div class="flex items-center gap-3">
              <p-checkbox
                [binary]="true"
                [ngModel]="allSelected()"
                (onChange)="toggleAll($event.checked)"
                [indeterminate]="someSelected()"
              ></p-checkbox>
              <span class="text-sm text-gray-600">
                {{ selectedIds().size > 0 ? selectedIds().size + ' selected' : 'Select unpaid to pay' }}
              </span>
            </div>
            <div class="flex gap-2">
              <p-button
                label="Pay Selected"
                icon="pi pi-check"
                severity="success"
                [outlined]="true"
                [disabled]="selectedIds().size === 0 || paying()"
                [loading]="paying()"
                (onClick)="paySelected()"
              ></p-button>
              <p-button
                label="Pay All Unpaid"
                icon="pi pi-check-circle"
                severity="warn"
                [disabled]="unpaidRows().length === 0 || paying()"
                [loading]="paying()"
                (onClick)="payAllUnpaid()"
              ></p-button>
            </div>
          </div>
        </ng-template>

        <p-table [value]="filteredRows()" [loading]="loading()" responsiveLayout="scroll">
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 48px"></th>
              <th>Description</th>
              <th>Category</th>
              <th>Branch</th>
              <th class="text-right">Expected</th>
              <th class="text-right" style="width: 140px">Pay Amount</th>
              <th style="width: 180px">Notes</th>
              <th>Status</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr [class.bg-green-50]="row.payment" [class.bg-blue-50]="!row.payment && selectedIds().has(row.template.id)">
              <td>
                @if (!row.payment) {
                  <p-checkbox
                    [binary]="true"
                    [ngModel]="selectedIds().has(row.template.id)"
                    (onChange)="toggleOne(row.template.id, $event.checked)"
                  ></p-checkbox>
                }
              </td>
              <td>
                <span class="font-medium">{{ row.template.description }}</span>
              </td>
              <td>
                <span class="text-sm text-gray-600">{{ row.template.category }}</span>
              </td>
              <td>
                <span class="text-sm text-gray-600">{{ getBranchName(row.template.branchId) }}</span>
              </td>
              <td class="text-right font-semibold">{{ row.template.amount | number:'1.2-2' }}</td>
              <td class="text-right">
                @if (!row.payment) {
                  <p-inputNumber
                    [(ngModel)]="row.overrideAmount"
                    [min]="0.01"
                    [maxFractionDigits]="2"
                    mode="decimal"
                    inputStyleClass="w-full text-right"
                    [style]="{ width: '120px' }"
                  ></p-inputNumber>
                } @else {
                  <span class="text-green-700 font-medium">{{ row.payment.amount | number:'1.2-2' }}</span>
                }
              </td>
              <td>
                @if (!row.payment) {
                  <input
                    pInputText
                    [(ngModel)]="row.notes"
                    placeholder="Notes (optional)"
                    class="w-full text-sm"
                  />
                } @else {
                  <span class="text-xs text-gray-500">{{ row.payment.notes || '—' }}</span>
                }
              </td>
              <td>
                @if (row.payment) {
                  <div>
                    <p-tag value="Paid" severity="success" icon="pi pi-check"></p-tag>
                    <p class="text-xs text-gray-400 mt-1">{{ row.payment.date | date:'mediumDate' }}</p>
                  </div>
                } @else {
                  <p-tag value="Unpaid" severity="danger"></p-tag>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-12">
                <div class="text-gray-400">
                  @if (loading()) {
                    <i class="pi pi-spin pi-spinner text-4xl"></i>
                  } @else {
                    <i class="pi pi-check-circle text-4xl mb-3 text-green-400"></i>
                    <p class="text-lg font-medium text-green-600">All caught up for {{ displayMonth() }}</p>
                    <p class="text-sm mt-1">No recurring expenses found or all are paid.</p>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class ManageRecurringComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  loading = signal(false);
  paying = signal(false);

  allRows = signal<RecurringRow[]>([]);
  branches = signal<any[]>([]);

  selectedMonth: Date = new Date();
  paymentDate: Date = new Date();
  selectedBranchId: string | null = null;
  selectedIds = signal<Set<string>>(new Set());

  branchOptions = computed(() => [
    { label: 'All Branches', value: null },
    ...this.branches().map(b => ({ label: b.name, value: b.id }))
  ]);

  filteredRows = computed(() => {
    const branch = this.selectedBranchId;
    if (!branch) return this.allRows();
    return this.allRows().filter(r => r.template.branchId === branch || (!r.template.branchId && !branch));
  });

  unpaidRows = computed(() => this.filteredRows().filter(r => !r.payment));

  selectedTotal = computed(() => {
    const ids = this.selectedIds();
    return this.unpaidRows()
      .filter(r => ids.has(r.template.id))
      .reduce((sum, r) => sum + (r.overrideAmount || r.template.amount), 0);
  });

  allSelected = computed(() => {
    const rows = this.unpaidRows();
    return rows.length > 0 && rows.every(r => this.selectedIds().has(r.template.id));
  });

  someSelected = computed(() => {
    const ids = this.selectedIds();
    const rows = this.unpaidRows();
    const count = rows.filter(r => ids.has(r.template.id)).length;
    return count > 0 && count < rows.length;
  });

  displayMonth = computed(() =>
    this.selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({ next: (b) => this.branches.set(b) });
    this.loadData();
  }

  onMonthChange() {
    this.selectedIds.set(new Set());
    this.loadData();
  }

  applyBranchFilter() {
    this.selectedIds.set(new Set());
  }

  loadData() {
    this.loading.set(true);
    const month = this.formatMonth(this.selectedMonth);
    const monthStart = `${month}-01`;
    const d = new Date(this.selectedMonth.getFullYear(), this.selectedMonth.getMonth() + 1, 0);
    const monthEnd = d.toISOString().split('T')[0];

    forkJoin({
      templates: this.expenseService.getAllExpenses({ isRecurring: 'true' }),
      payments: this.expenseService.getAllPayments({ startDate: monthStart, endDate: monthEnd }),
    }).subscribe({
      next: ({ templates, payments }) => {
        const rows: RecurringRow[] = templates.map(t => {
          const paid = payments.find(p => p.expenseId === t.id) || null;
          return {
            template: t,
            payment: paid,
            overrideAmount: t.amount,
            notes: '',
            vendor: t.vendor || '',
          };
        });
        this.allRows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load data');
        this.loading.set(false);
      }
    });
  }

  toggleAll(checked: boolean) {
    if (checked) {
      this.selectedIds.set(new Set(this.unpaidRows().map(r => r.template.id)));
    } else {
      this.selectedIds.set(new Set());
    }
  }

  toggleOne(id: string, checked: boolean) {
    const ids = new Set(this.selectedIds());
    checked ? ids.add(id) : ids.delete(id);
    this.selectedIds.set(ids);
  }

  paySelected() {
    const ids = this.selectedIds();
    const rows = this.unpaidRows().filter(r => ids.has(r.template.id));
    this.payRows(rows);
  }

  payAllUnpaid() {
    this.payRows(this.unpaidRows());
  }

  private payRows(rows: RecurringRow[]) {
    if (!rows.length) return;
    this.paying.set(true);
    const dateStr = this.formatDate(this.paymentDate);
    let done = 0;
    let failed = 0;

    const finish = () => {
      done++;
      if (done + failed === rows.length) {
        this.paying.set(false);
        if (failed > 0) {
          this.notificationService.error(`Paid ${done - failed}, failed ${failed}`);
        } else {
          this.notificationService.success(`Recorded ${done} payment(s) successfully`);
        }
        this.selectedIds.set(new Set());
        this.loadData();
      }
    };

    for (const row of rows) {
      this.expenseService.recordPayment({
        expenseId: row.template.id,
        type: row.template.type,
        category: row.template.category,
        amount: row.overrideAmount || row.template.amount,
        date: dateStr,
        branchId: row.template.branchId,
        notes: row.notes || undefined,
        vendor: row.vendor || undefined,
      }).subscribe({
        next: () => finish(),
        error: () => { failed++; finish(); }
      });
    }
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return 'Global';
    return this.branches().find(b => b.id === branchId)?.name || 'Unknown';
  }

  formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
