import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { TagModule } from 'primeng/tag';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { TooltipModule } from 'primeng/tooltip';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ProductSaleService, SalesSummary } from '../services/product-sale.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { ProductSale } from '@shared/interfaces/product-sale.interface';

@Component({
  selector: 'app-sales-history',
  standalone: true,
  imports: [
    CommonModule, TableModule, ButtonModule, CardModule, DialogModule, TagModule,
    InputNumberModule, DatePickerModule, SelectModule, TextareaModule, TooltipModule,
    FormsModule, TranslateModule,
  ],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">{{ 'PRODUCTS.SALES.TITLE' | translate }}</h2>
            <p-button
              [label]="'PRODUCTS.SALES.SELL_BTN' | translate"
              icon="pi pi-plus"
              severity="success"
              (onClick)="sellProduct()">
            </p-button>
          </div>
        </ng-template>

        <!-- Filter Section -->
        <div class="mb-4 flex gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">{{ 'PRODUCTS.SALES.START_DATE' | translate }}</label>
            <input
              type="date"
              [(ngModel)]="startDate"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded"
            />
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">{{ 'PRODUCTS.SALES.END_DATE' | translate }}</label>
            <input
              type="date"
              [(ngModel)]="endDate"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded"
            />
          </div>
          <div class="flex items-end">
            <p-button
              [label]="'PRODUCTS.SALES.CLEAR_FILTERS' | translate"
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
              <div class="text-sm text-gray-600">{{ 'PRODUCTS.SALES.TOTAL_SALES' | translate }}</div>
              <div class="text-2xl font-bold">{{ summary()!.totalSales }}</div>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">{{ 'PRODUCTS.SALES.TOTAL_REVENUE' | translate }}</div>
              <div class="text-2xl font-bold text-green-600">{{ summary()!.totalRevenue.toFixed(2) }}</div>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">{{ 'PRODUCTS.SALES.TOTAL_QTY' | translate }}</div>
              <div class="text-2xl font-bold">{{ summary()!.totalQuantity }}</div>
            </div>
          </div>
        }

        <!-- Sales Table -->
        <p-table
          [value]="sales()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [tableStyle]="{'min-width': '60rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'PRODUCTS.SALES.COL_DATE' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_PRODUCT' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_QTY' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_UNIT_PRICE' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_DISCOUNT' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_TOTAL' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_REFUND_STATUS' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_PAYMENT' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_CUSTOMER' | translate }}</th>
              <th>{{ 'PRODUCTS.SALES.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-sale>
            <tr>
              <td>{{ sale.saleDate | date: 'short' }}</td>
              <td>
                <div class="font-medium">{{ sale.productName || sale.productId }}</div>
                @if (sale.receiptNumber) {
                  <div class="text-sm text-gray-500">{{ 'PRODUCTS.SALES.RECEIPT' | translate }} {{ sale.receiptNumber }}</div>
                }
              </td>
              <td>{{ sale.quantity }}</td>
              <td>{{ sale.unitPrice.toFixed(2) }}</td>
              <td>
                @if (sale.discountAmount > 0) {
                  <span class="text-orange-600">-{{ sale.discountAmount.toFixed(2) }}</span>
                } @else {
                  <span class="text-gray-400">{{ 'PRODUCTS.SALES.NO_DISCOUNT' | translate }}</span>
                }
              </td>
              <td>
                @if ((sale.totalRefunded ?? 0) > 0) {
                  <div class="line-through text-gray-400">{{ sale.totalAmount.toFixed(2) }}</div>
                  <div class="text-green-600 font-semibold">{{ (sale.totalAmount - (sale.totalRefunded ?? 0)).toFixed(2) }}</div>
                } @else {
                  <span class="font-semibold text-green-600">{{ sale.totalAmount.toFixed(2) }}</span>
                }
              </td>
              <td>
                <p-tag
                  [value]="('PRODUCTS.SALES.REFUND_' + getRefundStatus(sale)) | translate"
                  [severity]="getRefundSeverity(sale)">
                </p-tag>
                @if ((sale.totalRefunded ?? 0) > 0) {
                  <div class="text-xs text-orange-600 mt-1">-{{ sale.totalRefunded.toFixed(2) }}</div>
                }
              </td>
              <td>{{ ('PRODUCTS.SALES.METHOD_' + sale.paymentMethod) | translate }}</td>
              <td>
                @if (sale.customerName) {
                  <div class="font-medium">{{ sale.customerName }}</div>
                  @if (sale.customerPhone) {
                    <div class="text-sm text-gray-500">{{ sale.customerPhone }}</div>
                  }
                } @else {
                  <span class="text-gray-400">-</span>
                }
              </td>
              <td>
                @if (authService.canWrite('product_sales') && getRefundableAmount(sale) > 0) {
                  <p-button
                    icon="pi pi-replay"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    [pTooltip]="'PRODUCTS.SALES.REFUND' | translate"
                    (onClick)="openRefundDialog(sale)">
                  </p-button>
                } @else {
                  <span class="text-gray-300 text-xs">—</span>
                }
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="10" class="text-center py-8 text-gray-500">
                {{ 'PRODUCTS.SALES.NO_SALES' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <!-- Refund Dialog -->
    <p-dialog
      [header]="'PRODUCTS.SALES.REFUND_TITLE' | translate"
      [(visible)]="showRefundDialog"
      [modal]="true"
      [style]="{ width: '480px' }"
      [draggable]="false"
      (onHide)="onRefundDialogHide()">

      @if (refundingSale()) {
        <div class="flex flex-col gap-4 py-2">
          <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p class="text-sm text-blue-900 font-semibold">{{ refundingSale()!.productName }}</p>
            <p class="text-xs text-blue-700 mt-1">
              {{ 'PRODUCTS.SALES.SOLD_FOR' | translate }} {{ refundingSale()!.totalAmount.toFixed(2) }}
              · {{ 'PRODUCTS.SALES.REFUNDABLE' | translate }} <strong>{{ refundableNow().toFixed(2) }}</strong>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALES.REFUND_TYPE' | translate }} *</label>
            <p-select
              [(ngModel)]="refundType"
              [options]="refundTypeOptions()"
              optionLabel="label"
              optionValue="value"
              appendTo="body"
              [style]="{ width: '100%' }"
              (onChange)="onRefundTypeChange()">
            </p-select>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALES.REFUND_AMOUNT' | translate }} *</label>
            <p-inputnumber
              [(ngModel)]="refundAmount"
              [min]="0.01"
              [max]="refundableNow()"
              [minFractionDigits]="2"
              [maxFractionDigits]="2"
              [disabled]="refundType === 'FULL'"
              class="w-full">
            </p-inputnumber>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALES.REFUND_DATE' | translate }} *</label>
            <p-datepicker
              [(ngModel)]="refundDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              class="w-full">
            </p-datepicker>
          </div>

          <div>
            <label class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALES.REFUND_REASON' | translate }}</label>
            <textarea
              pTextarea
              [(ngModel)]="refundReason"
              [placeholder]="'PRODUCTS.SALES.REFUND_REASON_PLACEHOLDER' | translate"
              rows="2"
              class="w-full">
            </textarea>
          </div>
        </div>
      }

      <ng-template pTemplate="footer">
        <div class="flex justify-end gap-2">
          <p-button
            [label]="'PRODUCTS.SALES.CANCEL' | translate"
            severity="secondary"
            [outlined]="true"
            (onClick)="showRefundDialog = false">
          </p-button>
          <p-button
            [label]="'PRODUCTS.SALES.CONFIRM_REFUND' | translate"
            severity="warn"
            icon="pi pi-check"
            [loading]="processingRefund()"
            [disabled]="!canSubmitRefund()"
            (onClick)="confirmRefund()">
          </p-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
})
export class SalesHistoryComponent implements OnInit {
  private productSaleService = inject(ProductSaleService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  sales = signal<ProductSale[]>([]);
  summary = signal<SalesSummary | null>(null);
  loading = signal(false);
  startDate = '';
  endDate = '';

  // Refund dialog state
  showRefundDialog = false;
  refundingSale = signal<ProductSale | null>(null);
  refundType: 'FULL' | 'PARTIAL' = 'FULL';
  refundAmount = 0;
  refundDate: Date = new Date();
  refundReason = '';
  processingRefund = signal(false);

  refundTypeOptions = () => [
    { label: this.translate.instant('PRODUCTS.SALES.REFUND_FULL_OPT'), value: 'FULL' },
    { label: this.translate.instant('PRODUCTS.SALES.REFUND_PARTIAL_OPT'), value: 'PARTIAL' },
  ];

  ngOnInit() {
    this.loadSales();
    this.loadSummary();
  }

  loadSales() {
    this.loading.set(true);
    const params: any = {};
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.productSaleService.getAllSales(params).subscribe({
      next: (data) => {
        this.sales.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading sales:', err);
        this.loading.set(false);
      },
    });
  }

  loadSummary() {
    const params: any = {};
    if (this.startDate) params.startDate = this.startDate;
    if (this.endDate) params.endDate = this.endDate;

    this.productSaleService.getSalesSummary(params).subscribe({
      next: (data) => {
        this.summary.set(data);
      },
      error: (err) => {
        console.error('Error loading summary:', err);
      },
    });
  }

  onFilterChange() {
    this.loadSales();
    this.loadSummary();
  }

  clearFilters() {
    this.startDate = '';
    this.endDate = '';
    this.loadSales();
    this.loadSummary();
  }

  sellProduct() {
    this.router.navigate(['/products/sell']);
  }

  getRefundableAmount(sale: ProductSale): number {
    return sale.totalAmount - (sale.totalRefunded ?? 0);
  }

  getRefundStatus(sale: ProductSale): 'NONE' | 'PARTIAL' | 'FULL' {
    const refunded = sale.totalRefunded ?? 0;
    if (refunded <= 0) return 'NONE';
    if (refunded >= sale.totalAmount) return 'FULL';
    return 'PARTIAL';
  }

  getRefundSeverity(sale: ProductSale): 'success' | 'warn' | 'danger' {
    const s = this.getRefundStatus(sale);
    if (s === 'NONE') return 'success';
    if (s === 'PARTIAL') return 'warn';
    return 'danger';
  }

  openRefundDialog(sale: ProductSale) {
    this.refundingSale.set(sale);
    this.refundType = 'FULL';
    this.refundAmount = this.getRefundableAmount(sale);
    this.refundDate = new Date();
    this.refundReason = '';
    this.showRefundDialog = true;
  }

  onRefundDialogHide() {
    this.refundingSale.set(null);
  }

  onRefundTypeChange() {
    if (this.refundType === 'FULL' && this.refundingSale()) {
      this.refundAmount = this.refundableNow();
    }
  }

  refundableNow(): number {
    const sale = this.refundingSale();
    return sale ? this.getRefundableAmount(sale) : 0;
  }

  canSubmitRefund(): boolean {
    if (!this.refundingSale()) return false;
    if (this.refundAmount <= 0) return false;
    if (this.refundAmount > this.refundableNow()) return false;
    if (!this.refundDate) return false;
    return true;
  }

  confirmRefund() {
    const sale = this.refundingSale();
    if (!sale || !this.canSubmitRefund()) return;

    this.processingRefund.set(true);
    const dateStr = this.refundDate instanceof Date
      ? this.refundDate.toISOString().split('T')[0]
      : this.refundDate;

    this.productSaleService.createRefund(sale.id, {
      type: this.refundType,
      amount: this.refundAmount,
      refundDate: dateStr,
      reason: this.refundReason || undefined,
    }).subscribe({
      next: () => {
        this.processingRefund.set(false);
        this.showRefundDialog = false;
        this.notificationService.success(this.translate.instant('PRODUCTS.SALES.REFUND_SUCCESS'));
        this.loadSales();
      },
      error: (err) => {
        this.processingRefund.set(false);
        this.notificationService.error(
          err?.error?.message || this.translate.instant('PRODUCTS.SALES.REFUND_FAILED')
        );
      },
    });
  }
}
