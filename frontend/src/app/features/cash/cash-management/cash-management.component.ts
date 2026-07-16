import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { DatePickerModule } from 'primeng/datepicker';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CashService, CurrentCashResponse, CashAdjustmentRecord, CashAdjustmentType, BranchCash } from '../../../core/services/cash.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { AuthService } from '../../../core/services/auth.service';
import { toLocalYmd } from '../../../core/utils/date.util';

const ALL = '__ALL__';
const COMPANY = '__COMPANY__';

@Component({
  selector: 'app-cash-management',
  standalone: true,
  imports: [
    CommonModule, FormsModule, CardModule, ButtonModule, TableModule, TagModule,
    DialogModule, SelectModule, InputNumberModule, TextareaModule, DatePickerModule, TooltipModule,
    DeleteConfirmDialogComponent, TranslateModule,
  ],
  templateUrl: './cash-management.component.html',
})
export class CashManagementComponent implements OnInit {
  private cashService = inject(CashService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  current = signal<CurrentCashResponse | null>(null);
  loading = signal(true);
  adjustments = signal<CashAdjustmentRecord[]>([]);
  adjustmentsLoading = signal(true);
  branches = signal<LookupOption[]>([]);

  // Filter on the page (special values: ALL, COMPANY, or a branch UUID)
  filterValue: string = ALL;

  // Computed: balance shown on the page given the current filter
  filteredBalance = computed(() => {
    const c = this.current();
    if (!c) return 0;
    if (this.filterValue === ALL) return c.totalCash;
    if (this.filterValue === COMPANY) return c.unallocatedAdjustments || 0;
    const branch = c.byBranch.find((b) => b.branchId === this.filterValue);
    return branch?.cash || 0;
  });

  filterIsBranch(): boolean {
    return this.filterValue !== ALL && this.filterValue !== COMPANY;
  }

  // Dialog state
  showDialog = false;
  dialogType: CashAdjustmentType = 'DEPOSIT';
  dialogBranchId: string | null = null; // null = company-wide (distribute equally)
  amount: number | null = null;
  observedAmount: number | null = null;
  date: Date = new Date();
  notes = '';
  saving = signal(false);

  showDeleteDialog = false;
  toDelete = signal<CashAdjustmentRecord | null>(null);

  ngOnInit() {
    this.loadBranches();
    this.loadAll();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => this.branches.set(branches),
    });
  }

  filterOptions = computed(() => {
    const isAdmin = this.authService.isGlobalAdmin();
    const opts: { label: string; value: string }[] = [
      { label: this.translate.instant('CASH.FILTER_ALL'), value: ALL },
    ];
    // Only global admins can see/filter the "Global" (unallocated) slice —
    // branch admins never own company-wide cash.
    if (isAdmin) {
      opts.push({ label: this.translate.instant('CASH.FILTER_COMPANY'), value: COMPANY });
    }
    for (const b of this.branches()) {
      opts.push({ label: b.label, value: b.id });
    }
    return opts;
  });

  branchPickerOptions = computed(() => {
    const isAdmin = this.authService.isGlobalAdmin();
    const opts: { label: string; value: string | null }[] = [];
    // "Company-wide" deposits/withdrawals (branch_id NULL) are only meaningful
    // for global admins. Branch admins must post to a specific branch they own.
    if (isAdmin) {
      opts.push({ label: this.translate.instant('CASH.SCOPE_COMPANY'), value: null });
    }
    for (const b of this.branches()) {
      opts.push({ label: b.label, value: b.id });
    }
    return opts;
  });

  loadAll() {
    this.loadCurrent();
    this.loadAdjustments();
  }

  loadCurrent() {
    this.loading.set(true);
    this.cashService.getCurrentCash().subscribe({
      next: (data) => {
        this.current.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadAdjustments() {
    this.adjustmentsLoading.set(true);
    let branchFilter: string | null | undefined;
    if (this.filterValue === ALL) branchFilter = undefined;
    else if (this.filterValue === COMPANY) branchFilter = null;
    else branchFilter = this.filterValue;
    this.cashService.listAdjustments(branchFilter).subscribe({
      next: (data) => {
        this.adjustments.set(data);
        this.adjustmentsLoading.set(false);
      },
      error: () => this.adjustmentsLoading.set(false),
    });
  }

  onFilterChange() {
    this.loadAdjustments();
  }

  openDialog(type: CashAdjustmentType) {
    this.dialogType = type;
    // Pre-fill branch from current filter when applicable. For non-global
    // admins, a null (company-wide) target isn't allowed — fall back to the
    // first branch they have access to so the picker isn't empty.
    if (this.filterIsBranch()) {
      this.dialogBranchId = this.filterValue;
    } else if (!this.authService.isGlobalAdmin()) {
      this.dialogBranchId = this.branches()[0]?.id ?? null;
    } else {
      this.dialogBranchId = null;
    }
    this.amount = null;
    this.observedAmount = null;
    this.date = new Date();
    this.notes = '';
    this.showDialog = true;
  }

  canSubmit(): boolean {
    if (this.dialogType === 'ADJUSTMENT') {
      return this.observedAmount !== null && this.observedAmount >= 0;
    }
    if (this.amount === null || this.amount <= 0) return false;
    if (this.dialogType === 'WITHDRAWAL' && this.withdrawalExceedsAvailable()) return false;
    return true;
  }

  withdrawalExceedsAvailable(): boolean {
    if (this.dialogType !== 'WITHDRAWAL' || this.amount === null) return false;
    return this.amount > this.systemCashPreview();
  }

  systemCashPreview(): number {
    const c = this.current();
    if (!c) return 0;
    if (this.dialogBranchId) {
      const b = c.byBranch.find((bb) => bb.branchId === this.dialogBranchId);
      return b?.cash || 0;
    }
    return c.totalCash;
  }

  adjustmentDelta(): number {
    if (this.dialogType !== 'ADJUSTMENT' || this.observedAmount === null) return 0;
    return (this.observedAmount || 0) - this.systemCashPreview();
  }

  submit() {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    const dto: any = {
      type: this.dialogType,
      branchId: this.dialogBranchId || undefined,
      date: toLocalYmd(this.date),
      notes: this.notes || undefined,
    };
    if (this.dialogType === 'ADJUSTMENT') {
      dto.observedAmount = this.observedAmount;
    } else {
      dto.amount = this.amount;
    }

    this.cashService.createAdjustment(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.showDialog = false;
        this.notificationService.success(this.translate.instant('CASH.SAVED'));
        this.loadAll();
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.saving.set(false);
      },
    });
  }

  confirmDelete(item: CashAdjustmentRecord) {
    this.toDelete.set(item);
    this.showDeleteDialog = true;
  }

  doDelete() {
    const item = this.toDelete();
    if (!item) return;
    this.cashService.deleteAdjustment(item.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('CASH.DELETED'));
        this.showDeleteDialog = false;
        this.toDelete.set(null);
        this.loadAll();
      },
      error: () => {
        // Interceptor toasted the translated error.
      },
    });
  }

  formatCurrency(v: number | null | undefined): string {
    if (v == null || isNaN(v)) return '0.00';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  }

  absVal(v: number): number {
    return Math.abs(v);
  }

  hasUnallocatedCashActivity(): boolean {
    const c = this.current();
    if (!c) return false;
    return (
      (c.unallocatedRevenue || 0) !== 0 ||
      (c.unallocatedExpenses || 0) !== 0 ||
      (c.unallocatedAdjustments || 0) !== 0
    );
  }

  typeSeverity(type: CashAdjustmentType): 'success' | 'danger' | 'warn' {
    if (type === 'DEPOSIT') return 'success';
    if (type === 'WITHDRAWAL') return 'danger';
    return 'warn';
  }

  typeLabel(type: CashAdjustmentType): string {
    return `CASH.TYPE_${type}`;
  }

  branchScopeLabel(row: CashAdjustmentRecord): string {
    if (row.branchName) return row.branchName;
    return this.translate.instant('CASH.SCOPE_COMPANY_TAG');
  }

  canWrite(): boolean {
    return this.authService.hasPermission('cash', 'write');
  }

  canDelete(): boolean {
    return this.authService.hasPermission('cash', 'delete');
  }
}
