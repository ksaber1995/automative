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
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService } from 'primeng/api';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { NumberFormatService } from '../../../shared/services/number-format.service';
import { ExpenseService, PercentageBreakdown } from '../services/expense.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { ExpensePayment } from '@shared/interfaces/expense.interface';
import { Employee } from '@shared/interfaces/employee.interface';
import { toLocalYmd } from '../../../core/utils/date.util';

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
    DialogModule,
    TranslateModule,
    AmountPipe,
  ],
  providers: [ConfirmationService],
  templateUrl: './salaries.component.html'
})
export class SalariesComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private lookupService = inject(LookupService);
  private employeeService = inject(EmployeeService);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  private numberFormat = inject(NumberFormatService);
  protected branchState = inject(BranchStateService);

  loading = signal(false);
  paying = signal(false);
  salaryItems = signal<any[]>([]);
  branches = signal<LookupOption[]>([]);
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
    ...this.branches().map(b => ({ label: b.label, value: b.id }))
  ]);

  employeeOptions = computed(() => [
    { label: this.translate.instant('EXPENSES.SALARIES.HISTORY_ALL_EMPLOYEES'), value: null },
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
    this.lookupService.branches().subscribe({
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
        // Interceptor toasted the translated error.
        this.historyLoading.set(false);
      }
    });
  }

  getEmployeeName(employeeId?: string | null): string {
    if (!employeeId) return this.translate.instant('EXPENSES.SALARIES.UNKNOWN');
    const e = this.employees().find(x => x.id === employeeId);
    return e ? `${e.firstName} ${e.lastName}` : this.translate.instant('EXPENSES.SALARIES.UNKNOWN');
  }

  getBranchName(branchId?: string | null): string {
    if (!branchId) return '';
    return this.branches().find(b => b.id === branchId)?.label || '';
  }

  getBasePaid(p: ExpensePayment): number {
    return (p.amount || 0) - (p.bonusAmount || 0) + (p.discountAmount || 0);
  }

  // ── How a PERCENTAGE salary was worked out ───────────────────────────────
  // A percentage teacher's pay is a share of what their students actually paid,
  // so the amount moves on its own and needs to be explainable: the sum, the
  // rate, what's already been drawn — and, on demand, the individual payments
  // it came from.
  pctDialogVisible = signal(false);
  pctLoading = signal(false);
  pctEmployeeName = signal('');
  pctData = signal<PercentageBreakdown | null>(null);
  /** The dialog opens on the summary; the history is a click away. */
  pctShowHistory = signal(false);

  openPercentageDetails(item: any) {
    this.pctEmployeeName.set(this.getEmployeeName(item.employeeId));
    this.pctData.set(null);
    this.pctShowHistory.set(false);
    this.pctLoading.set(true);
    this.pctDialogVisible.set(true);
    this.expenseService.getEmployeePercentageBreakdown(item.employeeId).subscribe({
      next: (data) => {
        this.pctData.set(data);
        this.pctLoading.set(false);
      },
      error: () => {
        this.pctLoading.set(false);
        this.pctDialogVisible.set(false);
      },
    });
  }

  /** Payment lines, newest first, as the API returned them. */
  pctLines = computed(() => this.pctData()?.lines ?? []);

  /** Distinct students in the history — the headline for "who paid". */
  pctStudentCount = computed(
    () => new Set(this.pctLines().map((l) => l.studentName)).size
  );

  // ── Payment details view dialog ──────────────────────────────────────────
  viewDialogVisible = signal(false);
  viewPayment = signal<ExpensePayment | null>(null);

  openPaymentDetails(p: ExpensePayment) {
    this.viewPayment.set(p);
    this.viewDialogVisible.set(true);
  }

  confirmDeletePayment(p: ExpensePayment) {
    this.confirmationService.confirm({
      message: this.translate.instant('EXPENSES.SALARIES.VOID_CONFIRM', {
        amount: this.numberFormat.format(p.amount),
        name: this.getEmployeeName(p.employeeId),
        date: p.date,
      }),
      header: this.translate.instant('EXPENSES.SALARIES.VOID_HEADER'),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('EXPENSES.SALARIES.VOID_BTN'),
      rejectLabel: this.translate.instant('EXPENSES.SALARIES.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.expenseService.deletePayment(p.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('EXPENSES.SALARIES.VOIDED'));
            this.historyPayments.set(this.historyPayments().filter(x => x.id !== p.id));
          },
          error: () => {
            // Interceptor toasted the translated error.
          }
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
        // Interceptor toasted the translated error.
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
          this.notificationService.error(this.translate.instant('EXPENSES.SALARIES.PAID_RESULT_PARTIAL', { paid: completed - failed, failed }));
        } else {
          this.notificationService.success(this.translate.instant('EXPENSES.SALARIES.PAID_RESULT', { count: completed }));
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
    return toLocalYmd(date);
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
