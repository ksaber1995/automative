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
import { RefundService, RefundSource } from '../services/refund.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { RefundWithDetails } from '@shared/interfaces/enrollment.interface';

@Component({
  selector: 'app-refund-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    CardModule, TableModule, ButtonModule, TagModule,
    SelectModule, DatePickerModule, InputTextModule, TooltipModule,
    TabsModule, TranslateModule,
  ],
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">{{ 'REFUNDS.LIST.TITLE' | translate }}</h2>
          <p class="text-gray-500 text-sm mt-1">{{ 'REFUNDS.LIST.SUBTITLE' | translate }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-sm text-gray-500">{{ 'REFUNDS.LIST.TOTAL' | translate }}</span>
          <span class="font-bold text-orange-600 text-lg">{{ totalRefunded().toFixed(2) }} EGP</span>
        </div>
      </div>

      <!-- Filters -->
      <p-card>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">{{ 'REFUNDS.LIST.FILTER_BRANCH' | translate }}</label>
            <p-select
              [(ngModel)]="filterBranch"
              [options]="branchOptions"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'REFUNDS.LIST.ALL_BRANCHES' | translate"
              [showClear]="true"
              [style]="{ width: '100%' }"
              (onChange)="load()"
            ></p-select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">{{ 'REFUNDS.LIST.FILTER_TYPE' | translate }}</label>
            <p-select
              [(ngModel)]="filterType"
              [options]="typeOptions"
              optionLabel="label"
              optionValue="value"
              [placeholder]="'REFUNDS.LIST.ALL_TYPES' | translate"
              [showClear]="true"
              [style]="{ width: '100%' }"
              (onChange)="load()"
            ></p-select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">{{ 'REFUNDS.LIST.FROM' | translate }}</label>
            <p-datepicker
              [(ngModel)]="filterStartDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              [style]="{ width: '100%' }"
              (onSelect)="load()"
            ></p-datepicker>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-600 mb-1">{{ 'REFUNDS.LIST.TO' | translate }}</label>
            <p-datepicker
              [(ngModel)]="filterEndDate"
              [showIcon]="true"
              dateFormat="yy-mm-dd"
              [style]="{ width: '100%' }"
              (onSelect)="load()"
            ></p-datepicker>
          </div>
          <div class="flex items-end">
            <button pButton [label]="'REFUNDS.LIST.CLEAR_FILTERS' | translate" icon="pi pi-filter-slash"
              class="p-button-outlined w-full" (click)="clearFilters()"></button>
          </div>
        </div>
      </p-card>

      <!-- Source tabs -->
      <p-card>
        <p-tabs [value]="activeSource()" (valueChange)="setSource($any($event))">
          <p-tablist>
            <p-tab value="ALL">
              <i class="pi pi-list mr-2"></i>
              {{ 'REFUNDS.LIST.TAB_ALL' | translate }}
            </p-tab>
            <p-tab value="ENROLLMENT">
              <i class="pi pi-book mr-2 text-green-600"></i>
              {{ 'REFUNDS.LIST.TAB_COURSE' | translate }}
            </p-tab>
            <p-tab value="MASTER_ENROLLMENT">
              <i class="pi pi-th-large mr-2 text-violet-600"></i>
              {{ 'REFUNDS.LIST.TAB_BUNDLE' | translate }}
            </p-tab>
            <p-tab value="EVENT">
              <i class="pi pi-flag mr-2 text-amber-600"></i>
              {{ 'REFUNDS.LIST.TAB_EVENT' | translate }}
            </p-tab>
            <p-tab value="PRODUCT_SALE">
              <i class="pi pi-shopping-bag mr-2 text-pink-600"></i>
              {{ 'REFUNDS.LIST.TAB_PRODUCT' | translate }}
            </p-tab>
          </p-tablist>
        </p-tabs>

        <p-table
          [value]="refunds()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="15"
          [rowsPerPageOptions]="[15, 30, 50]"
          [globalFilterFields]="['studentName', 'courseName', 'branchName', 'reason', 'productName', 'customerName']"
          responsiveLayout="scroll"
          styleClass="p-datatable-sm mt-3"
          sortField="refundDate"
          [sortOrder]="-1"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="refundDate">{{ 'REFUNDS.LIST.COL_DATE' | translate }} <p-sortIcon field="refundDate"></p-sortIcon></th>
              <th pSortableColumn="source">{{ 'REFUNDS.LIST.COL_SOURCE' | translate }} <p-sortIcon field="source"></p-sortIcon></th>
              <th>{{ 'REFUNDS.LIST.COL_DESC' | translate }}</th>
              <th pSortableColumn="branchName">{{ 'REFUNDS.LIST.COL_BRANCH' | translate }} <p-sortIcon field="branchName"></p-sortIcon></th>
              <th pSortableColumn="type">{{ 'REFUNDS.LIST.COL_TYPE' | translate }} <p-sortIcon field="type"></p-sortIcon></th>
              <th pSortableColumn="amount" class="text-right">{{ 'REFUNDS.LIST.COL_AMOUNT' | translate }} <p-sortIcon field="amount"></p-sortIcon></th>
              <th>{{ 'REFUNDS.LIST.COL_REASON' | translate }}</th>
              <th>{{ 'REFUNDS.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-refund>
            <tr>
              <td class="text-sm">{{ formatDate(refund.refundDate) }}</td>
              <td>
                <p-tag
                  [value]="('REFUNDS.LIST.SOURCE_' + refund.source) | translate"
                  [severity]="sourceSeverity(refund.source)">
                </p-tag>
              </td>
              <td>
                @if (refund.source === 'PRODUCT_SALE') {
                  <div class="font-medium">{{ refund.productName || '—' }}</div>
                  @if (refund.customerName) {
                    <div class="text-xs text-gray-500">{{ refund.customerName }}</div>
                  }
                } @else if (refund.source === 'EVENT') {
                  <div class="font-medium">{{ refund.eventName || '—' }}</div>
                  @if (refund.studentName) {
                    <div class="text-xs text-gray-500">{{ refund.studentName }}</div>
                  }
                } @else {
                  <div class="font-medium">{{ refund.studentName || '—' }}</div>
                  @if (refund.courseName) {
                    <div class="text-xs text-gray-500">{{ refund.courseName }}</div>
                  }
                }
              </td>
              <td class="text-sm text-gray-500">{{ refund.branchName || '—' }}</td>
              <td>
                <p-tag
                  [value]="refund.type === 'FULL' ? ('REFUNDS.LIST.FULL_REFUND' | translate) : ('REFUNDS.LIST.PARTIAL_REFUND' | translate)"
                  [severity]="refund.type === 'FULL' ? 'danger' : 'warn'"
                ></p-tag>
              </td>
              <td class="text-right">
                <span class="font-semibold text-orange-600">{{ refund.amount.toFixed(2) }}</span>
              </td>
              <td class="text-sm text-gray-500 max-w-xs truncate">
                {{ refund.reason || '—' }}
              </td>
              <td>
                <p-button
                  icon="pi pi-eye"
                  [rounded]="true"
                  [text]="true"
                  severity="secondary"
                  [pTooltip]="'REFUNDS.LIST.VIEW_SOURCE' | translate"
                  (onClick)="viewSource(refund)"
                ></p-button>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-12">
                <div class="text-gray-400">
                  <i class="pi pi-replay text-4xl mb-3 block"></i>
                  <p class="text-lg">{{ 'REFUNDS.LIST.NO_DATA' | translate }}</p>
                  <p class="text-sm mt-1">{{ 'REFUNDS.LIST.NO_DATA_HINT' | translate }}</p>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="footer">
            @if (refunds().length > 0) {
              <tr>
                <td colspan="5" class="text-right font-semibold text-gray-600">{{ 'REFUNDS.LIST.TOTAL_REFUNDED' | translate }}</td>
                <td class="text-right font-bold text-orange-600">{{ totalRefunded().toFixed(2) }}</td>
                <td colspan="2"></td>
              </tr>
            }
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
})
export class RefundListComponent implements OnInit {
  private refundService = inject(RefundService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

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
    this.branchService.getAllBranches().subscribe({
      next: (branches) => {
        this.branchOptions = branches.map(b => ({ label: b.name, value: b.id }));
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
