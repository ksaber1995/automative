import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { FormsModule } from '@angular/forms';
import { ProductService } from '../services/product.service';
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
  ],
  template: `
    <div class="container mx-auto p-4">
      <p-card>
        <ng-template pTemplate="header">
          <div class="flex justify-between items-center p-4">
            <h2 class="text-2xl font-bold">Products</h2>
            <div class="flex gap-2">
              <p-button
                label="Sell Product"
                icon="pi pi-shopping-cart"
                severity="success"
                (onClick)="sellProduct()">
              </p-button>
              <p-button
                label="New Product"
                icon="pi pi-plus"
                (onClick)="createProduct()">
              </p-button>
            </div>
          </div>
        </ng-template>

        <div class="mb-4 flex gap-4">
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">Category</label>
            <select
              [(ngModel)]="selectedCategory"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded">
              <option value="">All Categories</option>
              @for (cat of categories; track cat.value) {
                <option [value]="cat.value">{{ cat.label }}</option>
              }
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-sm font-medium mb-1">Type</label>
            <select
              [(ngModel)]="selectedType"
              (change)="onFilterChange()"
              class="w-full p-2 border rounded">
              <option value="">All</option>
              <option value="global">Global</option>
              <option value="branch">Branch-Specific</option>
            </select>
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

        <p-table
          [value]="products()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [tableStyle]="{'min-width': '50rem'}">

          <ng-template pTemplate="header">
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Category</th>
              <th>Type</th>
              <th>Cost Price</th>
              <th>Selling Price</th>
              <th>Stock</th>
              <th>Actions</th>
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
                  <p-tag value="Global" severity="success"></p-tag>
                } @else {
                  <p-tag value="Branch" severity="info"></p-tag>
                }
              </td>
              <td>\${{ product.costPrice.toFixed(2) }}</td>
              <td class="font-semibold">\${{ product.sellingPrice.toFixed(2) }}</td>
              <td>
                @if (product.stock <= product.minStock) {
                  <span class="text-red-600 font-bold">{{ product.stock }}</span>
                  <i class="pi pi-exclamation-triangle text-red-600 ml-1"></i>
                } @else {
                  <span class="text-green-600">{{ product.stock }}</span>
                }
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-shopping-cart"
                    [rounded]="true"
                    [text]="true"
                    severity="success"
                    pTooltip="Sell"
                    (onClick)="sell(product)">
                  </p-button>
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    pTooltip="Edit"
                    (onClick)="editProduct(product.id)">
                  </p-button>
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    pTooltip="Delete"
                    (onClick)="deleteProduct(product.id)">
                  </p-button>
                  <p-button
                    icon="pi pi-box"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    pTooltip="Adjust Stock"
                    (onClick)="adjustStock(product)">
                  </p-button>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8" class="text-center py-8 text-gray-500">
                No products found
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
})
export class ProductListComponent implements OnInit {
  private productService = inject(ProductService);
  private router = inject(Router);

  products = signal<Product[]>([]);
  loading = signal(false);
  selectedCategory = '';
  selectedType = '';

  categories = [
    { value: ProductCategory.STATIONERY, label: 'Stationery' },
    { value: ProductCategory.BOOKS, label: 'Books' },
    { value: ProductCategory.ELECTRONICS, label: 'Electronics' },
    { value: ProductCategory.SUPPLIES, label: 'Supplies' },
    { value: ProductCategory.MERCHANDISE, label: 'Merchandise' },
    { value: ProductCategory.OTHER, label: 'Other' },
  ];

  ngOnInit() {
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

  deleteProduct(id: string) {
    if (
      confirm(
        'Are you sure you want to delete this product? This action cannot be undone.',
      )
    ) {
      this.productService.deleteProduct(id).subscribe({
        next: () => {
          this.loadProducts();
        },
        error: (err) => {
          console.error('Error deleting product:', err);
          alert(
            'Failed to delete product: ' +
              (err.error?.message || 'Unknown error'),
          );
        },
      });
    }
  }

  adjustStock(product: Product) {
    const quantityStr = prompt(
      `Adjust stock for ${product.name}\\nCurrent stock: ${product.stock}\\nEnter quantity (positive to add, negative to subtract):`,
    );
    if (quantityStr) {
      const quantity = parseInt(quantityStr, 10);
      if (isNaN(quantity)) {
        alert('Invalid quantity');
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
            alert(
              'Failed to adjust stock: ' +
                (err.error?.message || 'Unknown error'),
            );
          },
        });
    }
  }

  getCategoryLabel(category: ProductCategory): string {
    const cat = this.categories.find((c) => c.value === category);
    return cat ? cat.label : category;
  }
}
