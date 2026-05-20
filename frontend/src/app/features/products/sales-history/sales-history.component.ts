import { Component, OnInit, signal, inject, computed } from '@angular/core';
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
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { ProductSale } from '@shared/interfaces/product-sale.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-sales-history',
  standalone: true,
  imports: [
    CommonModule, TableModule, ButtonModule, CardModule, DialogModule, TagModule,
    InputNumberModule, DatePickerModule, SelectModule, TextareaModule, TooltipModule,
    FormsModule, TranslateModule,
  ],
  templateUrl: './sales-history.component.html',
})
export class SalesHistoryComponent implements OnInit {
  private productSaleService = inject(ProductSaleService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  authService = inject(AuthService);

  sales = signal<ProductSale[]>([]);
  branches = signal<Branch[]>([]);
  summary = signal<SalesSummary | null>(null);
  loading = signal(false);
  startDate = '';
  endDate = '';
  selectedBranchId = signal<string | null>(null);

  branchOptions = computed(() =>
    this.branches().map(b => ({ label: b.name, value: b.id })),
  );

  filteredSales = computed(() => {
    const branch = this.selectedBranchId();
    if (!branch) return this.sales();
    return this.sales().filter(s => s.branchId === branch);
  });

  getBranchName(branchId: string | null | undefined): string {
    if (!branchId) return '—';
    return this.branches().find(b => b.id === branchId)?.name ?? branchId;
  }

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
    this.branchService.getAllBranches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  // Reload the summary when the branch filter changes. The list itself is
  // filtered client-side from the already-loaded sales so the dropdown feels
  // instant; the summary, however, is server-aggregated and needs a refetch
  // with the branchId param so totals match what's on screen.
  onBranchFilterChange(value: string | null) {
    this.selectedBranchId.set(value);
    this.loadSummary();
  }

  clearBranchFilter() {
    this.selectedBranchId.set(null);
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
    const branch = this.selectedBranchId();
    if (branch) params.branchId = branch;

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
      error: () => {
        // Interceptor toasted the translated error.
        this.processingRefund.set(false);
      },
    });
  }
}
