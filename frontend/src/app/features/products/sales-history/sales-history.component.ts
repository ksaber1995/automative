import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FormsModule } from '@angular/forms';
import { ProductSaleService, SalesSummary } from '../services/product-sale.service';
import { ProductSale } from '@shared/interfaces/product-sale.interface';

@Component({
  selector: 'app-sales-history',
  standalone: true,
  imports: [CommonModule, TableModule, ButtonModule, CardModule, FormsModule],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">Sales History</h2>
            <p-button
              label="Sell Product"
              icon="pi pi-plus"
              severity="success"
              (onClick)="sellProduct()">
            </p-button>
          </div>
        </ng-template>

        <!-- Filter Section -->
        <div class="mb-4 flex gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">Start Date</label>
            <input
              type="date"
              [(ngModel)]="startDate"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded"
            />
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">End Date</label>
            <input
              type="date"
              [(ngModel)]="endDate"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded"
            />
          </div>
          <div class="flex items-end">
            <p-button
              label="Clear Filters"
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
              <div class="text-sm text-gray-600">Total Sales</div>
              <div class="text-2xl font-bold">{{ summary()!.totalSales }}</div>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Total Revenue</div>
              <div class="text-2xl font-bold text-green-600">\${{ summary()!.totalRevenue.toFixed(2) }}</div>
            </div>
            <div class="bg-purple-50 p-4 rounded-lg">
              <div class="text-sm text-gray-600">Total Quantity Sold</div>
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
          [tableStyle]="{'min-width': '50rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Unit Price</th>
              <th>Discount</th>
              <th>Total</th>
              <th>Payment Method</th>
              <th>Customer</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-sale>
            <tr>
              <td>{{ sale.date | date: 'short' }}</td>
              <td>
                <div class="font-medium">{{ sale.productId }}</div>
                @if (sale.receiptNumber) {
                  <div class="text-sm text-gray-500">Receipt: {{ sale.receiptNumber }}</div>
                }
              </td>
              <td>{{ sale.quantity }}</td>
              <td>\${{ sale.unitPrice.toFixed(2) }}</td>
              <td>
                @if (sale.discountAmount > 0) {
                  <span class="text-orange-600">-\${{ sale.discountAmount.toFixed(2) }}</span>
                } @else {
                  <span class="text-gray-400">None</span>
                }
              </td>
              <td class="font-semibold text-green-600">\${{ sale.totalAmount.toFixed(2) }}</td>
              <td>{{ sale.paymentMethod }}</td>
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
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-8 text-gray-500">
                No sales found
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
})
export class SalesHistoryComponent implements OnInit {
  private productSaleService = inject(ProductSaleService);
  private router = inject(Router);

  sales = signal<ProductSale[]>([]);
  summary = signal<SalesSummary | null>(null);
  loading = signal(false);
  startDate = '';
  endDate = '';

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
}
