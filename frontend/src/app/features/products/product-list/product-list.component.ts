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
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { TooltipModule } from 'primeng/tooltip';
import { ProductService } from '../services/product.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';
import { Product } from '@shared/interfaces/product.interface';
import { ProductCategory } from '@shared/enums/product.enum';
import { toLocalYmd } from '../../../core/utils/date.util';

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
    SelectModule,
    FormsModule,
    DeleteConfirmDialogComponent,
    TranslateModule,
    TooltipModule,
    AmountPipe,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit {
  private productService = inject(ProductService);
  private lookupService = inject(LookupService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  readonly Math = Math;

  products = signal<Product[]>([]);
  branches = signal<LookupOption[]>([]);
  loading = signal(false);
  selectedCategory = '';
  selectedBranchId = signal<string | null>(null);

  branchOptions = computed(() =>
    this.branches().map(b => ({ label: b.label, value: b.id })),
  );

  filteredProducts = computed(() => {
    const branch = this.selectedBranchId();
    if (!branch) return this.products();
    return this.products().filter(p => p.branchId === branch);
  });
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
    this.lookupService.branches().subscribe({
      next: (b) => this.branches.set(b),
    });
  }

  getBranchName(branchId: string | null | undefined): string {
    if (!branchId) return '—';
    return this.branches().find(b => b.id === branchId)?.label ?? branchId;
  }

  clearBranchFilter() { this.selectedBranchId.set(null); }

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
        this.notificationService.success(this.translate.instant('PRODUCTS.DELETED'));
        this.loadProducts();
        this.showDeleteDialog = false;
        this.productToDelete.set(null);
      },
      error: () => {
        // Interceptor toasted the translated error.
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
        this.notificationService.error(this.translate.instant('PRODUCTS.INVALID_QUANTITY'));
        return;
      }
      this.stockSubmitting.set(true);
      this.productService.adjustStock(product.id, this.adjustForm.quantity, this.adjustForm.operation).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('PRODUCTS.STOCK_ADJUSTED'));
          this.stockSubmitting.set(false);
          this.closeStockDialog();
          this.loadProducts();
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.stockSubmitting.set(false);
        },
      });
    } else {
      if (!this.restockForm.quantity || this.restockForm.quantity < 1) {
        this.notificationService.error(this.translate.instant('PRODUCTS.INVALID_QUANTITY'));
        return;
      }
      if (!this.restockForm.costPerUnit || this.restockForm.costPerUnit < 0) {
        this.notificationService.error(this.translate.instant('PRODUCTS.INVALID_COST'));
        return;
      }
      this.stockSubmitting.set(true);
      const date = toLocalYmd(this.restockForm.date);

      this.productService.restockProduct(product.id, {
        quantity: this.restockForm.quantity,
        costPerUnit: this.restockForm.costPerUnit,
        date,
        notes: this.restockForm.notes || undefined,
      }).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('PRODUCTS.STOCK_PURCHASED'));
          this.stockSubmitting.set(false);
          this.closeStockDialog();
          this.loadProducts();
        },
        error: () => {
          // Interceptor toasted the translated error.
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
