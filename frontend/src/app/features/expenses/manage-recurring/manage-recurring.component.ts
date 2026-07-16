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
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { ExpenseService } from '../services/expense.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense, ExpensePayment } from '@shared/interfaces/expense.interface';
import { toLocalYmd } from '../../../core/utils/date.util';

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
    InputTextModule, SelectModule, TranslateModule,
    AmountPipe,
  ],
  templateUrl: './manage-recurring.component.html'
})
export class ManageRecurringComponent implements OnInit {
  private expenseService = inject(ExpenseService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private router = inject(Router);

  loading = signal(false);
  paying = signal(false);

  allRows = signal<RecurringRow[]>([]);
  branches = signal<LookupOption[]>([]);

  selectedMonth: Date = new Date();
  paymentDate: Date = new Date();
  selectedBranchId: string | null = null;
  selectedIds = signal<Set<string>>(new Set());

  branchOptions = computed(() => [
    { label: this.translate.instant('EXPENSES.MANAGE_RECURRING.ALL_BRANCHES'), value: null },
    ...this.branches().map(b => ({ label: b.label, value: b.id }))
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
    this.lookupService.branches().subscribe({ next: (b) => this.branches.set(b) });
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
    const monthEnd = toLocalYmd(d);

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
        // Interceptor toasted the translated error.
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
          this.notificationService.error(
            this.translate.instant('EXPENSES.RECURRING_PAID_PARTIAL', { paid: done - failed, failed })
          );
        } else {
          this.notificationService.success(
            this.translate.instant('EXPENSES.RECURRING_RECORDED', { count: done })
          );
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
    if (!branchId) return this.translate.instant('EXPENSES.MANAGE_RECURRING.GLOBAL_BRANCH');
    return this.branches().find(b => b.id === branchId)?.label || this.translate.instant('EXPENSES.MANAGE_RECURRING.UNKNOWN_BRANCH');
  }

  formatMonth(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  formatDate(date: Date): string {
    return toLocalYmd(date);
  }

  goBack() {
    this.router.navigate(['/expenses']);
  }
}
