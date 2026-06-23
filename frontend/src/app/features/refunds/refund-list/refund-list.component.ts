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
    if (this.filterStartDate) filters.startDate = this.filterStartDate.toISOString().split('T')[0];
    if (this.filterEndDate) filters.endDate = this.filterEndDate.toISOString().split('T')[0];

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
    this.load();
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
