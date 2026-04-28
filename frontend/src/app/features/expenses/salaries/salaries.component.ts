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
import { DividerModule } from 'primeng/divider';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { Employee } from '@shared/interfaces/employee.interface';

interface SalaryAdjustment {
  bonusAmount: number;
  discountAmount: number;
  adjustmentReason: string;
}

@Component({
  selector: 'app-salaries',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    DatePickerModule,
    CheckboxModule,
    TooltipModule,
    DividerModule,
    SelectModule,
    InputNumberModule,
    InputTextModule,
    ConfirmDialogModule,
    TranslateModule,
  ],
  providers: [ConfirmationService],
  template: `
    <p-confirmDialog></p-confirmDialog>
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()"></p-button>
        <div class="flex-1">
          <h1 class="text-3xl font-bold text-gray-900">{{ 'EXPENSES.SALARIES.TITLE' | translate }}</h1>
          <p class="text-gray-500 mt-1">
            @if (viewMode() === 'pending') {
              {{ 'EXPENSES.SALARIES.SUBTITLE' | translate: { month: displayMonth() } }}
            } @else {
              Past salary payments — review or void recorded payments.
            }
          </p>
        </div>
      </div>

      <!-- View tabs -->
      <div class="flex border-b border-gray-200 mb-6">
        <button type="button"
          class="px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px"
          [class]="viewMode() === 'pending'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'"
          (click)="setViewMode('pending')">
          <i class="pi pi-clock mr-2"></i>Pending Payments
        </button>
        <button type="button"
          class="px-6 py-3 text-sm font-medium transition-colors border-b-2 -mb-px"
          [class]="viewMode() === 'history'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-500 hover:text-gray-700'"
          (click)="setViewMode('history')">
          <i class="pi pi-history mr-2"></i>Salary History
        </button>
      </div>

      @if (viewMode() === 'pending') {
      <!-- Controls -->
      <p-card styleClass="mb-6">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{ 'EXPENSES.SALARIES.MONTH_LABEL' | translate }}</label>
            <p-datepicker
              [(ngModel)]="selectedMonth"
              view="month"
              dateFormat="yy-mm"
              [showIcon]="true"
              [placeholder]="'EXPENSES.SALARIES.MONTH_PLACEHOLDER' | translate"
              (onSelect)="onMonthChange()"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{ 'EXPENSES.SALARIES.PAYMENT_DATE' | translate }}</label>
            <p-datepicker
              [(ngModel)]="paymentDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              [placeholder]="'EXPENSES.SALARIES.DATE_PLACEHOLDER' | translate"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{ 'EXPENSES.SALARIES.FILTER_BRANCH' | translate }}</label>
            <p-select
              [(ngModel)]="selectedBranchId"
              [options]="branchOptions()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'EXPENSES.SALARIES.ALL_BRANCHES' | translate"
              [style]="{ width: '100%' }"
              (onChange)="loadSalaries()"
            ></p-select>
          </div>
        </div>
      </p-card>

      <!-- Summary cards -->
      @if (!loading()) {
        <div class="grid grid-cols-3 gap-4 mb-6">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ 'EXPENSES.SALARIES.TOTAL_EMPLOYEES' | translate }}</p>
            <p class="text-3xl font-bold text-gray-800">{{ filteredEmployees().length }}</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p class="text-xs text-blue-600 uppercase tracking-wider mb-1">{{ 'EXPENSES.SALARIES.SELECTED' | translate }}</p>
            <p class="text-3xl font-bold text-blue-700">{{ selectedIds().size }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p class="text-xs text-green-600 uppercase tracking-wider mb-1">{{ 'EXPENSES.SALARIES.TOTAL_DUE' | translate }}</p>
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
                {{ selectedIds().size > 0 ? ('EXPENSES.SALARIES.SELECTED_COUNT' | translate: {count: selectedIds().size}) : ('EXPENSES.SALARIES.SELECT_ALL' | translate) }}
              </span>
            </div>
            <div class="flex gap-2">
              <p-button
                [label]="'EXPENSES.SALARIES.PAY_SELECTED' | translate"
                icon="pi pi-check"
                severity="success"
                [outlined]="true"
                [disabled]="selectedIds().size === 0 || paying()"
                [loading]="paying()"
                (onClick)="paySelected()"
              ></p-button>
              <p-button
                [label]="'EXPENSES.SALARIES.PAY_ALL' | translate"
                icon="pi pi-users"
                severity="warn"
                [disabled]="filteredEmployees().length === 0 || paying()"
                [loading]="paying()"
                (onClick)="payAll()"
              ></p-button>
            </div>
          </div>
        </ng-template>

        <p-table
          [value]="filteredEmployees()"
          [loading]="loading()"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 48px"></th>
              <th>{{ 'EXPENSES.SALARIES.COL_EMPLOYEE' | translate }}</th>
              <th>{{ 'EXPENSES.SALARIES.COL_BRANCH' | translate }}</th>
              <th class="text-right">Base Salary</th>
              <th style="width: 130px" class="text-right text-green-600">Bonus</th>
              <th style="width: 130px" class="text-right text-red-600">Discount</th>
              <th style="width: 200px">Reason</th>
              <th class="text-right font-semibold">Total</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-item>
            <tr [class.bg-blue-50]="selectedIds().has(item.employeeId)">
              <td>
                <p-checkbox
                  [binary]="true"
                  [ngModel]="selectedIds().has(item.employeeId)"
                  (onChange)="toggleOne(item.employeeId, $event.checked)"
                ></p-checkbox>
              </td>
              <td>
                <span class="font-medium">{{ item.label.replace('Salary: ', '') }}</span>
              </td>
              <td>{{ item.branchName || 'N/A' }}</td>
              <td class="text-right text-gray-700">{{ item.amount.toFixed(2) }}</td>
              <td class="text-right">
                <p-inputNumber
                  [(ngModel)]="adjustments[item.employeeId].bonusAmount"
                  [min]="0"
                  [maxFractionDigits]="2"
                  mode="decimal"
                  inputStyleClass="w-full text-right text-green-700 border-green-300"
                  [style]="{ width: '110px' }"
                  (onInput)="onAdjustmentChange()"
                ></p-inputNumber>
              </td>
              <td class="text-right">
                <p-inputNumber
                  [(ngModel)]="adjustments[item.employeeId].discountAmount"
                  [min]="0"
                  [max]="item.amount + (adjustments[item.employeeId].bonusAmount || 0)"
                  [maxFractionDigits]="2"
                  mode="decimal"
                  inputStyleClass="w-full text-right text-red-700 border-red-300"
                  [style]="{ width: '110px' }"
                  (onInput)="onAdjustmentChange()"
                ></p-inputNumber>
              </td>
              <td>
                <input
                  pInputText
                  [(ngModel)]="adjustments[item.employeeId].adjustmentReason"
                  placeholder="Reason (optional)"
                  class="w-full text-sm"
                  style="width: 100%"
                />
              </td>
              <td class="text-right font-semibold" [class.text-green-700]="getFinalAmount(item) >= item.amount" [class.text-red-700]="getFinalAmount(item) < item.amount">
                {{ getFinalAmount(item).toFixed(2) }}
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-12">
                <div class="text-gray-400">
                  <i class="pi pi-check-circle text-4xl mb-3 text-green-400"></i>
                  <p class="text-lg font-medium text-green-600">{{ 'EXPENSES.SALARIES.ALL_PAID' | translate: { month: displayMonth() } }}</p>
                  <p class="text-sm mt-1">{{ 'EXPENSES.SALARIES.NO_PENDING' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
      }

      @if (viewMode() === 'history') {
      <!-- History controls -->
      <p-card styleClass="mb-6">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">From</label>
            <p-datepicker
              [(ngModel)]="historyStartDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              placeholder="Start date"
              (onSelect)="loadHistory()"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">To</label>
            <p-datepicker
              [(ngModel)]="historyEndDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              placeholder="End date"
              (onSelect)="loadHistory()"
              [style]="{ width: '100%' }"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Branch</label>
            <p-select
              [(ngModel)]="historyBranchId"
              [options]="branchOptions()"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'EXPENSES.SALARIES.ALL_BRANCHES' | translate"
              [style]="{ width: '100%' }"
              (onChange)="loadHistory()"
            ></p-select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Employee</label>
            <p-select
              [(ngModel)]="historyEmployeeId"
              [options]="employeeOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="All employees"
              [filter]="true"
              [style]="{ width: '100%' }"
            ></p-select>
          </div>
        </div>
      </p-card>

      <!-- History summary -->
      @if (!historyLoading()) {
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
            <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Payments</p>
            <p class="text-3xl font-bold text-gray-800">{{ filteredHistory().length }}</p>
          </div>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p class="text-xs text-blue-600 uppercase tracking-wider mb-1">Employees Paid</p>
            <p class="text-3xl font-bold text-blue-700">{{ historyEmployeeCount() }}</p>
          </div>
          <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p class="text-xs text-green-600 uppercase tracking-wider mb-1">Total Paid</p>
            <p class="text-3xl font-bold text-green-700">{{ historyTotal().toFixed(2) }}</p>
          </div>
          <div class="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
            <p class="text-xs text-purple-600 uppercase tracking-wider mb-1">Avg / Payment</p>
            <p class="text-3xl font-bold text-purple-700">{{ historyAverage().toFixed(2) }}</p>
          </div>
        </div>
      }

      <!-- History table -->
      <p-card>
        <p-table
          [value]="filteredHistory()"
          [loading]="historyLoading()"
          [paginator]="true"
          [rows]="20"
          [rowsPerPageOptions]="[10, 20, 50, 100]"
          responsiveLayout="scroll"
          sortField="date"
          [sortOrder]="-1"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="date">Date <p-sortIcon field="date"></p-sortIcon></th>
              <th>Employee</th>
              <th>Branch</th>
              <th class="text-right">Base</th>
              <th class="text-right text-green-600">Bonus</th>
              <th class="text-right text-red-600">Discount</th>
              <th>Reason</th>
              <th class="text-right font-semibold">Net Paid</th>
              <th style="width: 80px"></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-p>
            <tr>
              <td class="whitespace-nowrap">{{ p.date }}</td>
              <td class="font-medium">{{ getEmployeeName(p.employeeId) }}</td>
              <td>{{ getBranchName(p.branchId) || 'N/A' }}</td>
              <td class="text-right text-gray-700">{{ getBasePaid(p).toFixed(2) }}</td>
              <td class="text-right text-green-700">{{ (p.bonusAmount || 0).toFixed(2) }}</td>
              <td class="text-right text-red-700">{{ (p.discountAmount || 0).toFixed(2) }}</td>
              <td class="text-sm text-gray-600">{{ p.adjustmentReason || '—' }}</td>
              <td class="text-right font-semibold text-green-700">{{ p.amount.toFixed(2) }}</td>
              <td>
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  size="small"
                  pTooltip="Void payment"
                  (onClick)="confirmDeletePayment(p)"
                ></p-button>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center py-12">
                <div class="text-gray-400">
                  <i class="pi pi-inbox text-4xl mb-3"></i>
                  <p class="text-lg font-medium">No salary payments found</p>
                  <p class="text-sm mt-1">Adjust your filters or pay some salaries to see history.</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
      }
    </div>
  `
})
export class SalariesComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private employeeService = inject(EmployeeService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  loading = signal(false);
  paying = signal(false);
  salaryItems = signal<any[]>([]);
  branches = signal<any[]>([]);
  employees = signal<Employee[]>([]);
  selectedMonth: Date = new Date();
  paymentDate: Date = new Date();
  selectedBranchId: string | null = null;
  selectedIds = signal<Set<string>>(new Set());
  adjustments: Record<string, SalaryAdjustment> = {};

  viewMode = signal<'pending' | 'history'>('pending');

  // History view state
  historyLoading = signal(false);
  historyPayments = signal<ExpensePayment[]>([]);
  historyStartDate: Date = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);
  historyEndDate: Date = new Date();
  historyBranchId: string | null = null;
  historyEmployeeId: string | null = null;

  branchOptions = computed(() => [
    { label: this.translate.instant('EXPENSES.SALARIES.ALL_BRANCHES'), value: null },
    ...this.branches().map(b => ({ label: b.name, value: b.id }))
  ]);

  employeeOptions = computed(() => [
    { label: 'All employees', value: null },
    ...this.employees().map(e => ({ label: `${e.firstName} ${e.lastName}`, value: e.id }))
  ]);

  filteredHistory = computed(() => {
    const empId = this.historyEmployeeId;
    const list = this.historyPayments();
    return empId ? list.filter(p => p.employeeId === empId) : list;
  });

  historyTotal = computed(() =>
    this.filteredHistory().reduce((sum, p) => sum + (p.amount || 0), 0)
  );

  historyEmployeeCount = computed(() => {
    const set = new Set<string>();
    this.filteredHistory().forEach(p => { if (p.employeeId) set.add(p.employeeId); });
    return set.size;
  });

  historyAverage = computed(() => {
    const items = this.filteredHistory();
    return items.length === 0 ? 0 : this.historyTotal() / items.length;
  });

  filteredEmployees = computed(() => {
    const branch = this.selectedBranchId;
    if (!branch) return this.salaryItems();
    return this.salaryItems().filter(i => i.branchId === branch);
  });

  selectedTotal = computed(() => {
    const ids = this.selectedIds();
    return this.filteredEmployees()
      .filter(i => ids.has(i.employeeId))
      .reduce((sum, i) => sum + this.getFinalAmount(i), 0);
  });

  allSelected = computed(() => {
    const items = this.filteredEmployees();
    return items.length > 0 && items.every(i => this.selectedIds().has(i.employeeId));
  });

  someSelected = computed(() => {
    const ids = this.selectedIds();
    const items = this.filteredEmployees();
    const count = items.filter(i => ids.has(i.employeeId)).length;
    return count > 0 && count < items.length;
  });

  displayMonth = computed(() => {
    return this.selectedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  });

  getFinalAmount(item: any): number {
    const adj = this.adjustments[item.employeeId];
    if (!adj) return item.amount;
    return item.amount + (adj.bonusAmount || 0) - (adj.discountAmount || 0);
  }

  onAdjustmentChange() {
    // trigger selectedTotal recompute by updating signal
    this.selectedIds.set(new Set(this.selectedIds()));
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({
      next: (b) => this.branches.set(b)
    });
    this.employeeService.getAllEmployees().subscribe({
      next: (e) => this.employees.set(e)
    });
    this.loadSalaries();
  }

  setViewMode(mode: 'pending' | 'history') {
    this.viewMode.set(mode);
    if (mode === 'history' && this.historyPayments().length === 0) {
      this.loadHistory();
    }
  }

  loadHistory() {
    this.historyLoading.set(true);
    const params: any = { category: 'SALARIES' };
    if (this.historyStartDate) params.startDate = this.formatDate(this.historyStartDate);
    if (this.historyEndDate) params.endDate = this.formatDate(this.historyEndDate);
    if (this.historyBranchId) params.branchId = this.historyBranchId;
    this.expenseService.getAllPayments(params).subscribe({
      next: (payments) => {
        // Only salary payments (have an employeeId)
        this.historyPayments.set(payments.filter(p => !!p.employeeId));
        this.historyLoading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load salary history');
        this.historyLoading.set(false);
      }
    });
  }

  getEmployeeName(employeeId?: string | null): string {
    if (!employeeId) return 'Unknown';
    const e = this.employees().find(x => x.id === employeeId);
    return e ? `${e.firstName} ${e.lastName}` : 'Unknown';
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return '';
    return this.branches().find(b => b.id === branchId)?.name || '';
  }

  getBasePaid(p: ExpensePayment): number {
    return (p.amount || 0) - (p.bonusAmount || 0) + (p.discountAmount || 0);
  }

  confirmDeletePayment(p: ExpensePayment) {
    this.confirmationService.confirm({
      message: `Void salary payment of ${p.amount.toFixed(2)} for ${this.getEmployeeName(p.employeeId)} on ${p.date}? This cannot be undone.`,
      header: 'Void Payment',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Void',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.expenseService.deletePayment(p.id).subscribe({
          next: () => {
            this.notificationService.success('Payment voided');
            this.historyPayments.set(this.historyPayments().filter(x => x.id !== p.id));
          },
          error: () => this.notificationService.error('Failed to void payment')
        });
      }
    });
  }

  loadSalaries() {
    this.loading.set(true);
    this.selectedIds.set(new Set());
    const month = this.formatMonth(this.selectedMonth);
    this.expenseService.getDue(month).subscribe({
      next: (res) => {
        const items = res.items.filter(i => i.type === 'salary');
        this.salaryItems.set(items);
        // initialise adjustments for each employee
        items.forEach(i => {
          if (!this.adjustments[i.employeeId]) {
            this.adjustments[i.employeeId] = { bonusAmount: 0, discountAmount: 0, adjustmentReason: '' };
          }
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load salary data');
        this.loading.set(false);
      }
    });
  }

  onMonthChange() {
    this.loadSalaries();
  }

  toggleAll(checked: boolean) {
    if (checked) {
      const ids = new Set(this.filteredEmployees().map(i => i.employeeId));
      this.selectedIds.set(ids);
    } else {
      this.selectedIds.set(new Set());
    }
  }

  toggleOne(employeeId: string, checked: boolean) {
    const ids = new Set(this.selectedIds());
    if (checked) ids.add(employeeId);
    else ids.delete(employeeId);
    this.selectedIds.set(ids);
  }

  paySelected() {
    const ids = Array.from(this.selectedIds());
    if (!ids.length) return;
    this.payEmployees(ids);
  }

  payAll() {
    const ids = this.filteredEmployees().map(i => i.employeeId);
    if (!ids.length) return;
    this.payEmployees(ids);
  }

  private payEmployees(employeeIds: string[]) {
    this.paying.set(true);
    const dateStr = this.formatDate(this.paymentDate);
    let completed = 0;
    let failed = 0;

    const next = () => {
      completed++;
      if (completed + failed === employeeIds.length) {
        this.paying.set(false);
        if (failed > 0) {
          this.notificationService.error(`Paid ${completed - failed}, failed ${failed}`);
        } else {
          this.notificationService.success(`Successfully paid ${completed} salary payment(s)`);
        }
        this.loadSalaries();
      }
    };

    for (const id of employeeIds) {
      const adj = this.adjustments[id];
      this.expenseService.payEmployeeSalary(
        id,
        dateStr,
        adj?.bonusAmount || undefined,
        adj?.discountAmount || undefined,
        adj?.adjustmentReason || undefined
      ).subscribe({
        next: () => next(),
        error: () => { failed++; next(); }
      });
    }
  }

  formatMonth(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
