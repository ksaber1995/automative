import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TooltipModule } from 'primeng/tooltip';
import { ProductService } from '../services/product.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
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
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    InputTextModule,
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
                  @if (authService.canWrite('products')) {
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      severity="warn"
                      [pTooltip]="'PRODUCTS.LIST.EDIT_TOOLTIP' | translate"
                      (onClick)="editProduct(product.id)">
                    </p-button>
                  }
                  @if (authService.canDelete('products')) {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      [pTooltip]="'PRODUCTS.LIST.DELETE_TOOLTIP' | translate"
                      (onClick)="confirmDelete(product)">
                    </p-button>
                  }
                  <p-button
                    icon="pi pi-box"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    [pTooltip]="'PRODUCTS.LIST.ADJUST_STOCK_TOOLTIP' | translate"
                    (onClick)="openStockDialog(product)">
                  </p-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7" class="text-center py-8 text-gray-500">
                {{ 'PRODUCTS.LIST.NO_PRODUCTS' | translate }}
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>

    <!-- Stock Management Dialog -->
    <p-dialog
      [(visible)]="showStockDialog"
      [header]="selectedProduct()?.name || 'Stock Management'"
      [modal]="true"
      [style]="{width: '480px'}"
      [closable]="!stockSubmitting()"
      [draggable]="false">

      @if (selectedProduct()) {
        <!-- Current stock banner -->
        <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-5">
          <i class="pi pi-box text-blue-500 text-xl"></i>
          <div>
            <div class="text-xs text-gray-500 uppercase tracking-wide">Current Stock</div>
            <div class="text-2xl font-bold" [class.text-red-600]="(selectedProduct()!.stock || 0) <= (selectedProduct()!.minStock || 0)" [class.text-gray-800]="(selectedProduct()!.stock || 0) > (selectedProduct()!.minStock || 0)">
              {{ selectedProduct()!.stock || 0 }}
              <span class="text-sm font-normal text-gray-500">{{ selectedProduct()!.unit }}</span>
            </div>
          </div>
          @if ((selectedProduct()!.stock || 0) <= (selectedProduct()!.minStock || 0)) {
            <div class="ml-auto text-xs text-red-500 flex items-center gap-1">
              <i class="pi pi-exclamation-triangle"></i> Low stock
            </div>
          }
        </div>

        <!-- Tab switcher -->
        <div class="flex mb-5 border-b">
          <button
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
            [class.border-blue-500]="activeTab === 'adjust'"
            [class.text-blue-600]="activeTab === 'adjust'"
            [class.border-transparent]="activeTab !== 'adjust'"
            [class.text-gray-500]="activeTab !== 'adjust'"
            (click)="activeTab = 'adjust'">
            <i class="pi pi-sliders-h mr-2"></i>Adjust Stock
          </button>
          <button
            class="px-4 py-2 text-sm font-medium border-b-2 transition-colors"
            [class.border-blue-500]="activeTab === 'restock'"
            [class.text-blue-600]="activeTab === 'restock'"
            [class.border-transparent]="activeTab !== 'restock'"
            [class.text-gray-500]="activeTab !== 'restock'"
            (click)="activeTab = 'restock'">
            <i class="pi pi-shopping-bag mr-2"></i>Buy More
          </button>
        </div>

        <!-- Adjust Stock tab -->
        @if (activeTab === 'adjust') {
          <div class="flex flex-col gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Operation</label>
              <div class="flex gap-2">
                <button
                  class="flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all"
                  [class.border-green-500]="adjustForm.operation === 'add'"
                  [class.bg-green-50]="adjustForm.operation === 'add'"
                  [class.text-green-700]="adjustForm.operation === 'add'"
                  [class.border-gray-200]="adjustForm.operation !== 'add'"
                  [class.text-gray-600]="adjustForm.operation !== 'add'"
                  (click)="adjustForm.operation = 'add'">
                  <i class="pi pi-plus mr-1"></i> Add
                </button>
                <button
                  class="flex-1 py-2 px-4 rounded-lg border-2 text-sm font-medium transition-all"
                  [class.border-red-500]="adjustForm.operation === 'subtract'"
                  [class.bg-red-50]="adjustForm.operation === 'subtract'"
                  [class.text-red-700]="adjustForm.operation === 'subtract'"
                  [class.border-gray-200]="adjustForm.operation !== 'subtract'"
                  [class.text-gray-600]="adjustForm.operation !== 'subtract'"
                  (click)="adjustForm.operation = 'subtract'">
                  <i class="pi pi-minus mr-1"></i> Subtract
                </button>
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Quantity *</label>
              <p-inputNumber
                [(ngModel)]="adjustForm.quantity"
                [min]="1"
                [showButtons]="true"
                [style]="{'width':'100%'}">
              </p-inputNumber>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <input
                pInputText
                [(ngModel)]="adjustForm.notes"
                placeholder="Optional reason for adjustment"
                class="w-full" />
            </div>

            @if (adjustForm.quantity > 0) {
              <div class="p-3 rounded-lg text-sm" [class.bg-green-50]="adjustForm.operation === 'add'" [class.bg-red-50]="adjustForm.operation === 'subtract'">
                <span [class.text-green-700]="adjustForm.operation === 'add'" [class.text-red-700]="adjustForm.operation === 'subtract'">
                  New stock will be:
                  <strong>
                    {{ adjustForm.operation === 'add'
                        ? (selectedProduct()!.stock || 0) + (adjustForm.quantity || 0)
                        : Math.max(0, (selectedProduct()!.stock || 0) - (adjustForm.quantity || 0)) }}
                  </strong>
                  {{ selectedProduct()!.unit }}
                </span>
              </div>
            }
          </div>
        }

        <!-- Buy More tab -->
        @if (activeTab === 'restock') {
          <div class="flex flex-col gap-4">
            <div class="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              <i class="pi pi-info-circle mr-1"></i>
              Adds stock and records an inventory expense for accounting.
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Quantity *</label>
              <p-inputNumber
                [(ngModel)]="restockForm.quantity"
                [min]="1"
                [showButtons]="true"
                [style]="{'width':'100%'}">
              </p-inputNumber>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                Cost per unit *
                <span class="text-xs text-gray-400 ml-1">(current: {{ (selectedProduct()!.costPrice || 0).toFixed(2) }})</span>
              </label>
              <p-inputNumber
                [(ngModel)]="restockForm.costPerUnit"
                mode="decimal"
                [minFractionDigits]="2"
                [min]="0"
                [style]="{'width':'100%'}">
              </p-inputNumber>
            </div>

            <div class="p-3 bg-gray-50 rounded-lg flex justify-between items-center">
              <span class="text-sm text-gray-600">Total cost</span>
              <span class="text-lg font-bold text-gray-800">
                {{ ((restockForm.quantity || 0) * (restockForm.costPerUnit || 0)).toFixed(2) }}
              </span>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Purchase date *</label>
              <p-datepicker
                [(ngModel)]="restockForm.date"
                dateFormat="yy-mm-dd"
                [showIcon]="true"
                [style]="{'width':'100%'}">
              </p-datepicker>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <input
                pInputText
                [(ngModel)]="restockForm.notes"
                placeholder="Optional notes"
                class="w-full" />
            </div>

            @if (restockForm.quantity > 0) {
              <div class="p-3 bg-green-50 rounded-lg text-sm text-green-700">
                New stock will be:
                <strong>{{ (selectedProduct()!.stock || 0) + (restockForm.quantity || 0) }}</strong>
                {{ selectedProduct()!.unit }}
              </div>
            }
          </div>
        }
      }

      <ng-template pTemplate="footer">
        <div class="flex gap-2 justify-end">
          <p-button
            label="Cancel"
            severity="secondary"
            [outlined]="true"
            [disabled]="stockSubmitting()"
            (onClick)="closeStockDialog()">
          </p-button>
          <p-button
            [label]="activeTab === 'adjust' ? 'Apply Adjustment' : 'Confirm Purchase'"
            [icon]="activeTab === 'adjust' ? 'pi pi-check' : 'pi pi-shopping-bag'"
            [loading]="stockSubmitting()"
            (onClick)="confirmStockAction()">
          </p-button>
        </div>
      </ng-template>
    </p-dialog>

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
  authService = inject(AuthService);

  readonly Math = Math;

  products = signal<Product[]>([]);
  loading = signal(false);
  selectedCategory = '';
  showDeleteDialog = false;
  productToDelete = signal<Product | null>(null);

  // Stock dialog state
  showStockDialog = false;
  selectedProduct = signal<Product | null>(null);
  activeTab: 'adjust' | 'restock' = 'adjust';
  stockSubmitting = signal(false);

  adjustForm = {
    operation: 'add' as 'add' | 'subtract',
    quantity: 1,
    notes: '',
  };

  restockForm = {
    quantity: 1,
    costPerUnit: 0,
    date: new Date(),
    notes: '',
  };

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

  onFilterChange() { this.loadProducts(); }
  clearFilters() { this.selectedCategory = ''; this.loadProducts(); }
  createProduct() { this.router.navigate(['/products/create']); }
  editProduct(id: string) { this.router.navigate(['/products', id, 'edit']); }
  sellProduct() { this.router.navigate(['/products/sell']); }
  sell(product: Product) { this.router.navigate(['/products/sell'], { queryParams: { productId: product.id } }); }

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

  openStockDialog(product: Product) {
    this.selectedProduct.set(product);
    this.activeTab = 'adjust';
    this.adjustForm = { operation: 'add', quantity: 1, notes: '' };
    this.restockForm = {
      quantity: 1,
      costPerUnit: product.costPrice || 0,
      date: new Date(),
      notes: '',
    };
    this.showStockDialog = true;
  }

  closeStockDialog() {
    this.showStockDialog = false;
    this.selectedProduct.set(null);
  }

  confirmStockAction() {
    const product = this.selectedProduct();
    if (!product) return;

    if (this.activeTab === 'adjust') {
      if (!this.adjustForm.quantity || this.adjustForm.quantity < 1) {
        this.notificationService.error('Please enter a valid quantity');
        return;
      }
      this.stockSubmitting.set(true);
      this.productService.adjustStock(product.id, this.adjustForm.quantity, this.adjustForm.operation).subscribe({
        next: () => {
          this.notificationService.success('Stock adjusted successfully');
          this.stockSubmitting.set(false);
          this.closeStockDialog();
          this.loadProducts();
        },
        error: (err) => {
          this.notificationService.error(err.error?.message || 'Failed to adjust stock');
          this.stockSubmitting.set(false);
        },
      });
    } else {
      if (!this.restockForm.quantity || this.restockForm.quantity < 1) {
        this.notificationService.error('Please enter a valid quantity');
        return;
      }
      if (!this.restockForm.costPerUnit || this.restockForm.costPerUnit < 0) {
        this.notificationService.error('Please enter a valid cost per unit');
        return;
      }
      this.stockSubmitting.set(true);
      const date = this.restockForm.date instanceof Date
        ? this.restockForm.date.toISOString().split('T')[0]
        : this.restockForm.date;

      this.productService.restockProduct(product.id, {
        quantity: this.restockForm.quantity,
        costPerUnit: this.restockForm.costPerUnit,
        date,
        notes: this.restockForm.notes || undefined,
      }).subscribe({
        next: () => {
          this.notificationService.success('Stock purchased and recorded successfully');
          this.stockSubmitting.set(false);
          this.closeStockDialog();
          this.loadProducts();
        },
        error: (err) => {
          this.notificationService.error(err.error?.message || 'Failed to restock product');
          this.stockSubmitting.set(false);
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
