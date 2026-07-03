import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { TabsModule } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { RefundService, RefundSource } from '../services/refund.service';
import { LookupService } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { RefundWithDetails } from '@shared/interfaces/enrollment.interface';

@Component({
  selector: 'app-refund-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    CardModule, TableModule, ButtonModule, TagModule,
    SelectModule, DatePickerModule, InputTextModule, TooltipModule,
    TabsModule, TranslateModule,
    AmountPipe,
  ],
  templateUrl: './refund-list.component.html',
})
export class RefundListComponent implements OnInit {
  private refundService = inject(RefundService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  refunds = signal<RefundWithDetails[]>([]);
  loading = signal(true);
  activeSource = signal<RefundSource>('ALL');

  // Filters
  filterBranch: string | null = null;
  filterType: 'FULL' | 'PARTIAL' | null = null;
  filterStartDate: Date | null = null;
  filterEndDate: Date | null = null;
  rangePreset = signal<'TODAY' | 'MONTH' | 'YEAR' | 'LAST_12M' | null>(null);

  branchOptions: { label: string; value: string }[] = [];
  typeOptions: { label: string; value: string }[] = [];

  totalRefunded = signal(0);

  ngOnInit() {
    this.typeOptions = [
      { label: this.translate.instant('REFUNDS.LIST.FULL_REFUND'), value: 'FULL' },
      { label: this.translate.instant('REFUNDS.LIST.PARTIAL_REFUND'), value: 'PARTIAL' },
    ];
    this.loadBranches();
    this.load();
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branchOptions = branches.map(b => ({ label: b.label, value: b.id }));
      },
      error: () => {}
    });
  }

  setSource(source: RefundSource) {
    this.activeSource.set(source);
    this.load();
  }

  sourceSeverity(source: string): 'success' | 'info' | 'warn' | 'secondary' | 'danger' {
    switch (source) {
      case 'ENROLLMENT': return 'success';
      case 'MASTER_ENROLLMENT': return 'secondary';
      case 'EVENT': return 'warn';
      case 'PRODUCT_SALE': return 'info';
      default: return 'secondary';
    }
  }

  load() {
    this.loading.set(true);
    const filters: any = {};
    if (this.filterBranch) filters.branchId = this.filterBranch;
    if (this.filterType) filters.type = this.filterType;
    if (this.activeSource() !== 'ALL') filters.source = this.activeSource();
    if (this.filterStartDate) filters.startDate = this.fmt(this.filterStartDate);
    if (this.filterEndDate) filters.endDate = this.fmt(this.filterEndDate);

    this.refundService.getAllRefunds(filters).subscribe({
      next: (data) => {
        this.refunds.set(data);
        this.totalRefunded.set(data.reduce((sum, r) => sum + r.amount, 0));
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load refunds');
        this.loading.set(false);
      }
    });
  }

  clearFilters() {
    this.filterBranch = null;
    this.filterType = null;
    this.filterStartDate = null;
    this.filterEndDate = null;
    this.rangePreset.set(null);
    this.load();
  }

  /** Apply a quick date-range preset (Today / This Month / This Year / Last 12 Months). */
  setRange(preset: 'TODAY' | 'MONTH' | 'YEAR' | 'LAST_12M') {
    this.rangePreset.set(preset);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (preset === 'TODAY') {
      this.filterStartDate = today;
    } else if (preset === 'MONTH') {
      this.filterStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (preset === 'YEAR') {
      this.filterStartDate = new Date(now.getFullYear(), 0, 1);
    } else {
      this.filterStartDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    }
    this.filterEndDate = today;
    this.load();
  }

  /** Manual datepicker edits drop the preset highlight — the range is custom now. */
  onManualDateChange() {
    this.rangePreset.set(null);
    this.load();
  }

  private fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  viewSource(refund: RefundWithDetails) {
    if (refund.source === 'PRODUCT_SALE') {
      this.router.navigate(['/products/sales']);
    } else if (refund.source === 'EVENT' && refund.eventId) {
      this.router.navigate(['/events', refund.eventId]);
    } else if (refund.studentId) {
      this.router.navigate(['/students', refund.studentId]);
    } else {
      this.router.navigate(['/refunds']);
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }
}
