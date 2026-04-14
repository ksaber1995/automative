import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TooltipModule } from 'primeng/tooltip';
import { ProductService } from '../services/product.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { Product } from '@shared/interfaces/product.interface';
import { ProductCategory } from '@shared/enums/product.enum';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    ButtonModule,
    CardModule,
    TagModule,
    FormsModule,
    DeleteConfirmDialogComponent,
    TranslateModule,
    TooltipModule,
  ],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">{{ 'PRODUCTS.LIST.TITLE' | translate }}</h2>
            <div class="flex gap-2">
              <p-button
                [label]="'PRODUCTS.LIST.SELL' | translate"
                icon="pi pi-shopping-cart"
                severity="success"
                (onClick)="sellProduct()">
              </p-button>
              <p-button
                [label]="'PRODUCTS.LIST.NEW' | translate"
                icon="pi pi-plus"
                (onClick)="createProduct()">
              </p-button>
            </div>
          </div>
        </ng-template>

        <div class="mb-4 flex gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">{{ 'PRODUCTS.LIST.FILTER_CATEGORY' | translate }}</label>
            <select
              [(ngModel)]="selectedCategory"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded">
              <option value="">{{ 'PRODUCTS.LIST.ALL_CATEGORIES' | translate }}</option>
              @for (cat of categories; track cat.value) {
                <option [value]="cat.value">{{ cat.label }}</option>
              }
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">{{ 'PRODUCTS.LIST.FILTER_TYPE' | translate }}</label>
            <select
              [(ngModel)]="selectedType"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded">
              <option value="">{{ 'PRODUCTS.LIST.ALL' | translate }}</option>
              <option value="global">{{ 'PRODUCTS.LIST.GLOBAL' | translate }}</option>
              <option value="branch">{{ 'PRODUCTS.LIST.BRANCH_SPECIFIC' | translate }}</option>
            </select>
          </div>
          <div class="flex items-end">
            <p-button
              [label]="'PRODUCTS.LIST.CLEAR_FILTERS' | translate"
              icon="pi pi-filter-slash"
              [outlined]="true"
              (onClick)="clearFilters()">
            </p-button>
          </div>
        </div>

        <p-table
          [value]="products()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [tableStyle]="{'min-width': '50rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>{{ 'PRODUCTS.LIST.COL_CODE' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_NAME' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_CATEGORY' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_TYPE' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_COST' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_SELL' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_STOCK' | translate }}</th>
              <th>{{ 'PRODUCTS.LIST.COL_ACTIONS' | translate }}</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-product>
            <tr>
              <td><span class="font-mono">{{ product.code }}</span></td>
              <td>
                <div class="font-medium">{{ product.name }}</div>
                <div class="text-sm text-gray-500">{{ product.unit }}</div>
              </td>
              <td>{{ getCategoryLabel(product.category) }}</td>
              <td>
                @if (product.isGlobal) {
                  <p-tag [value]="'PRODUCTS.LIST.TYPE_GLOBAL' | translate" severity="success"></p-tag>
                } @else {
                  <p-tag [value]="'PRODUCTS.LIST.TYPE_BRANCH' | translate" severity="info"></p-tag>
                }
              </td>
              <td>{{ (product.costPrice || 0).toFixed(2) }}</td>
              <td class="font-semibold">{{ (product.sellingPrice || 0).toFixed(2) }}</td>
              <td>
                @if ((product.stock || 0) <= (product.minStock || 0)) {
                  <span class="text-red-600 font-bold">{{ product.stock || 0 }}</span>
                  <i class="pi pi-exclamation-triangle text-red-600 ml-1"></i>
                } @else {
                  <span class="text-green-600">{{ product.stock || 0 }}</span>
                }
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-shopping-cart"
                    [rounded]="true"
                    [text]="true"
                    severity="success"
                    [pTooltip]="'PRODUCTS.LIST.SELL_TOOLTIP' | translate"
                    (onClick)="sell(product)">
                  </p-button>
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    [pTooltip]="'PRODUCTS.LIST.EDIT_TOOLTIP' | translate"
                    (onClick)="editProduct(product.id)">
                  </p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    [pTooltip]="'PRODUCTS.LIST.DELETE_TOOLTIP' | translate"
                    (onClick)="confirmDelete(product)">
                  </p-button>
                  <p-button
                    icon="pi pi-box"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    [pTooltip]="'PRODUCTS.LIST.ADJUST_STOCK_TOOLTIP' | translate"
                    (onClick)="adjustStock(product)">
                  </p-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-8 text-gray-500">
                {{ 'PRODUCTS.LIST.NO_PRODUCTS' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <app-delete-confirm-dialog
      [visible]="showDeleteDialog"
      (visibleChange)="showDeleteDialog = $event"
      [header]="'PRODUCTS.LIST.DELETE_TITLE' | translate"
      [message]="'PRODUCTS.LIST.DELETE_MSG' | translate: { name: productToDelete()?.name || '' }"
      (confirm)="deleteProduct()"
      (cancel)="showDeleteDialog = false">
    </app-delete-confirm-dialog>
  `,
})
export class ProductListComponent implements OnInit {
  private productService = inject(ProductService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);

  products = signal<Product[]>([]);
  loading = signal(false);
  selectedCategory = '';
  selectedType = '';
  showDeleteDialog = false;
  productToDelete = signal<Product | null>(null);

  categories: { value: ProductCategory; label: string }[] = [];

  ngOnInit() {
    this.categories = [
      { value: ProductCategory.STATIONERY, label: this.translate.instant('PRODUCTS.LIST.CAT_STATIONERY') },
      { value: ProductCategory.BOOKS, label: this.translate.instant('PRODUCTS.LIST.CAT_BOOKS') },
      { value: ProductCategory.ELECTRONICS, label: this.translate.instant('PRODUCTS.LIST.CAT_ELECTRONICS') },
      { value: ProductCategory.SUPPLIES, label: this.translate.instant('PRODUCTS.LIST.CAT_SUPPLIES') },
      { value: ProductCategory.MERCHANDISE, label: this.translate.instant('PRODUCTS.LIST.CAT_MERCHANDISE') },
      { value: ProductCategory.OTHER, label: this.translate.instant('PRODUCTS.LIST.CAT_OTHER') },
    ];
    this.loadProducts();
  }

  loadProducts() {
    this.loading.set(true);
    const params: any = {};
    if (this.selectedCategory) params.category = this.selectedCategory;
    if (this.selectedType === 'global') params.isGlobal = true;
    if (this.selectedType === 'branch') params.isGlobal = false;

    this.productService.getAllProducts(params).subscribe({
      next: (data) => {
        this.products.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading products:', err);
        this.loading.set(false);
      },
    });
  }

  onFilterChange() {
    this.loadProducts();
  }

  clearFilters() {
    this.selectedCategory = '';
    this.selectedType = '';
    this.loadProducts();
  }

  createProduct() {
    this.router.navigate(['/products/create']);
  }

  editProduct(id: string) {
    this.router.navigate(['/products', id, 'edit']);
  }

  sellProduct() {
    this.router.navigate(['/products/sell']);
  }

  sell(product: Product) {
    this.router.navigate(['/products/sell'], {
      queryParams: { productId: product.id },
    });
  }

  confirmDelete(product: Product) {
    this.productToDelete.set(product);
    this.showDeleteDialog = true;
  }

  deleteProduct() {
    const product = this.productToDelete();
    if (!product) return;

    this.productService.deleteProduct(product.id).subscribe({
      next: () => {
        this.notificationService.success('Product deleted successfully');
        this.loadProducts();
        this.showDeleteDialog = false;
        this.productToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete product');
        this.showDeleteDialog = false;
      },
    });
  }

  adjustStock(product: Product) {
    const quantityStr = prompt(
      `Adjust stock for ${product.name}\\nCurrent stock: ${product.stock}\\nEnter quantity (positive to add, negative to subtract):`,
    );
    if (quantityStr) {
      const quantity = parseInt(quantityStr, 10);
      if (isNaN(quantity)) {
        this.notificationService.error('Invalid quantity');
        return;
      }

      const operation = quantity >= 0 ? 'add' : 'subtract';
      const absQuantity = Math.abs(quantity);

      this.productService
        .adjustStock(product.id, absQuantity, operation)
        .subscribe({
          next: () => {
            this.loadProducts();
          },
          error: (err) => {
            console.error('Error adjusting stock:', err);
            this.notificationService.error(err.error?.message || 'Failed to adjust stock');
          },
        });
    }
  }

  getCategoryLabel(category: ProductCategory): string {
    const keyMap: Record<string, string> = {
      [ProductCategory.STATIONERY]: 'CAT_STATIONERY',
      [ProductCategory.BOOKS]: 'CAT_BOOKS',
      [ProductCategory.ELECTRONICS]: 'CAT_ELECTRONICS',
      [ProductCategory.SUPPLIES]: 'CAT_SUPPLIES',
      [ProductCategory.MERCHANDISE]: 'CAT_MERCHANDISE',
      [ProductCategory.OTHER]: 'CAT_OTHER',
    };
    const key = keyMap[category];
    return key ? this.translate.instant('PRODUCTS.LIST.' + key) : category;
  }
}
