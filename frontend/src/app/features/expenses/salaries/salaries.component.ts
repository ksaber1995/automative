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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';

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
    TranslateModule,
  ],
  template: `
    <div class="container-custom py-8">
      <!-- Header -->
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="goBack()"></p-button>
        <div class="flex-1">
          <h1 class="text-3xl font-bold text-gray-900">{{ 'EXPENSES.SALARIES.TITLE' | translate }}</h1>
          <p class="text-gray-500 mt-1">{{ 'EXPENSES.SALARIES.SUBTITLE' | translate: { month: displayMonth() } }}</p>
        </div>
      </div>

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
    </div>
  `
})
export class SalariesComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  loading = signal(false);
  paying = signal(false);
  salaryItems = signal<any[]>([]);
  branches = signal<any[]>([]);
  selectedMonth: Date = new Date();
  paymentDate: Date = new Date();
  selectedBranchId: string | null = null;
  selectedIds = signal<Set<string>>(new Set());
  adjustments: Record<string, SalaryAdjustment> = {};

  branchOptions = computed(() => [
    { label: this.translate.instant('EXPENSES.SALARIES.ALL_BRANCHES'), value: null },
    ...this.branches().map(b => ({ label: b.name, value: b.id }))
  ]);

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
    this.loadSalaries();
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
