import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { ProductService } from '../services/product.service';
import { ProductSaleService } from '../services/product-sale.service';
import { Product } from '@shared/interfaces/product.interface';
import { DiscountType } from '@shared/enums/product.enum';
import { PaymentMethod } from '@shared/enums/enrollment-status.enum';

@Component({
  selector: 'app-product-sale',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    InputNumberModule,
    ButtonModule,
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">Sell Product</h2>
            <p class="text-sm text-gray-600 mt-1">Revenue will be created automatically</p>
          </div>
        </ng-template>

        <form [formGroup]="saleForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 gap-4">
            <!-- Product Selection -->
            <div class="field">
              <label for="productId" class="block text-sm font-medium mb-2">Product *</label>
              <select id="productId" formControlName="productId" class="w-full p-2 border rounded">
                <option value="">Select product</option>
                @for (product of products(); track product.id) {
                  <option [value]="product.id">{{ product.name }} ({{ product.code }}) - Stock: {{ product.stock }}</option>
                }
              </select>
              @if (saleForm.get('productId')?.invalid && saleForm.get('productId')?.touched) {
                <small class="text-red-500">Please select a product</small>
              }
              @if (selectedProduct()) {
                <div class="mt-2 p-3 bg-blue-50 rounded">
                  <div class="flex justify-between items-center">
                    <span class="text-sm font-medium">Selling Price:</span>
                    <span class="text-lg font-bold text-blue-600">\${{ selectedProduct()!.sellingPrice.toFixed(2) }}</span>
                  </div>
                  <div class="flex justify-between items-center mt-1">
                    <span class="text-sm font-medium">Available Stock:</span>
                    <span class="text-sm" [class.text-red-600]="selectedProduct()!.stock <= selectedProduct()!.minStock" [class.text-green-600]="selectedProduct()!.stock > selectedProduct()!.minStock">
                      {{ selectedProduct()!.stock }} {{ selectedProduct()!.unit }}
                    </span>
                  </div>
                </div>
              }
            </div>

            <!-- Quantity -->
            <div class="field">
              <label for="quantity" class="block text-sm font-medium mb-2">Quantity *</label>
              <p-inputNumber inputId="quantity" formControlName="quantity" [min]="1" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (saleForm.get('quantity')?.invalid && saleForm.get('quantity')?.touched) {
                <small class="text-red-500">Quantity must be at least 1</small>
              }
              @if (!stockAvailable()) {
                <small class="text-red-500">Insufficient stock! Available: {{ selectedProduct()?.stock || 0 }}</small>
              }
            </div>

            <!-- Discount -->
            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="discountType" class="block text-sm font-medium mb-2">Discount Type *</label>
                <select id="discountType" formControlName="discountType" class="w-full p-2 border rounded">
                  <option [value]="DiscountType.NONE">No Discount</option>
                  <option [value]="DiscountType.PERCENTAGE">Percentage (%)</option>
                  <option [value]="DiscountType.FIXED_AMOUNT">Fixed Amount ($)</option>
                </select>
              </div>
              <div class="field">
                <label for="discountValue" class="block text-sm font-medium mb-2">Discount Value</label>
                <p-inputNumber inputId="discountValue" formControlName="discountValue" [min]="0" [disabled]="saleForm.get('discountType')?.value === DiscountType.NONE" class="w-full"></p-inputNumber>
              </div>
            </div>

            <!-- Real-time Calculation Display -->
            <div class="mt-4 p-4 bg-gradient-to-r from-green-50 to-green-100 rounded-lg border-2 border-green-300">
              <h3 class="font-bold text-lg mb-3">Sale Summary</h3>
              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <span class="font-medium">Subtotal:</span>
                  <span class="text-lg">\${{ subtotal().toFixed(2) }}</span>
                </div>
                @if (discountAmount() > 0) {
                  <div class="flex justify-between items-center text-orange-600">
                    <span class="font-medium">Discount:</span>
                    <span class="text-lg">-\${{ discountAmount().toFixed(2) }}</span>
                  </div>
                }
                <hr class="border-green-300" />
                <div class="flex justify-between items-center">
                  <span class="font-bold text-xl">Total Amount:</span>
                  <span class="text-2xl font-bold text-green-600">\${{ totalAmount().toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Payment Method -->
            <div class="field">
              <label for="paymentMethod" class="block text-sm font-medium mb-2">Payment Method *</label>
              <select id="paymentMethod" formControlName="paymentMethod" class="w-full p-2 border rounded">
                <option value="">Select payment method</option>
                <option [value]="PaymentMethod.CASH">Cash</option>
                <option [value]="PaymentMethod.CREDIT_CARD">Credit Card</option>
                <option [value]="PaymentMethod.DEBIT_CARD">Debit Card</option>
                <option [value]="PaymentMethod.BANK_TRANSFER">Bank Transfer</option>
                <option [value]="PaymentMethod.CHECK">Check</option>
                <option [value]="PaymentMethod.OTHER">Other</option>
              </select>
              @if (saleForm.get('paymentMethod')?.invalid && saleForm.get('paymentMethod')?.touched) {
                <small class="text-red-500">Payment method is required</small>
              }
            </div>

            <!-- Optional Fields -->
            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="receiptNumber" class="block text-sm font-medium mb-2">Receipt Number</label>
                <input pInputText id="receiptNumber" formControlName="receiptNumber" class="w-full" />
              </div>
              <div class="field">
                <label for="date" class="block text-sm font-medium mb-2">Sale Date *</label>
                <input type="date" id="date" formControlName="date" class="w-full p-2 border rounded" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="customerName" class="block text-sm font-medium mb-2">Customer Name</label>
                <input pInputText id="customerName" formControlName="customerName" class="w-full" />
              </div>
              <div class="field">
                <label for="customerPhone" class="block text-sm font-medium mb-2">Customer Phone</label>
                <input pInputText id="customerPhone" formControlName="customerPhone" class="w-full" />
              </div>
            </div>

            <div class="field">
              <label for="notes" class="block text-sm font-medium mb-2">Notes</label>
              <textarea id="notes" formControlName="notes" rows="2" class="w-full p-2 border rounded"></textarea>
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <p-button type="submit" label="Complete Sale" icon="pi pi-check" severity="success" [disabled]="saleForm.invalid || !stockAvailable() || submitting()"></p-button>
            <p-button type="button" label="Cancel" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="cancel()"></p-button>
          </div>
        </form>
      </p-card>
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .p-inputnumber {
        width: 100%;
      }
    `,
  ],
})
export class ProductSaleComponent implements OnInit {
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);
  private productSaleService = inject(ProductSaleService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  saleForm!: FormGroup;
  products = signal<Product[]>([]);
  submitting = signal(false);

  // Expose enums to template
  DiscountType = DiscountType;
  PaymentMethod = PaymentMethod;

  // Computed signals for real-time calculations
  selectedProduct = computed(() => {
    const productId = this.saleForm?.get('productId')?.value;
    return this.products().find((p) => p.id === productId);
  });

  unitPrice = computed(() => this.selectedProduct()?.sellingPrice || 0);

  subtotal = computed(() => {
    const qty = this.saleForm?.get('quantity')?.value || 0;
    return this.unitPrice() * qty;
  });

  discountAmount = computed(() => {
    const type = this.saleForm?.get('discountType')?.value;
    const value = this.saleForm?.get('discountValue')?.value || 0;
    const sub = this.subtotal();

    if (type === DiscountType.PERCENTAGE) {
      return (sub * value) / 100;
    } else if (type === DiscountType.FIXED_AMOUNT) {
      return value;
    }
    return 0;
  });

  totalAmount = computed(() => Math.max(0, this.subtotal() - this.discountAmount()));

  stockAvailable = computed(() => {
    const product = this.selectedProduct();
    const qty = this.saleForm?.get('quantity')?.value || 0;
    return product ? product.stock >= qty : false;
  });

  ngOnInit() {
    this.initForm();
    this.loadProducts();

    // Check for pre-selected product from query params
    this.route.queryParams.subscribe((params) => {
      if (params['productId']) {
        this.saleForm.patchValue({ productId: params['productId'] });
      }
    });

    // Watch discount type changes
    this.saleForm.get('discountType')?.valueChanges.subscribe((type) => {
      const discountValueControl = this.saleForm.get('discountValue');
      if (type === DiscountType.NONE) {
        discountValueControl?.setValue(0);
      }
    });
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    this.saleForm = this.fb.group({
      branchId: ['', Validators.required], // TODO: Get from auth or select
      productId: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      discountType: [DiscountType.NONE, Validators.required],
      discountValue: [0, Validators.min(0)],
      paymentMethod: ['', Validators.required],
      receiptNumber: [''],
      customerName: [''],
      customerPhone: [''],
      notes: [''],
      date: [today, Validators.required],
    });
  }

  loadProducts() {
    // TODO: Filter by branch if needed
    this.productService.getAllProducts({ isActive: true }).subscribe({
      next: (data) => {
        this.products.set(data.filter((p) => p.stock > 0));
      },
      error: (err) => {
        console.error('Error loading products:', err);
      },
    });
  }

  onSubmit() {
    if (this.saleForm.invalid || !this.stockAvailable()) {
      Object.keys(this.saleForm.controls).forEach((key) => {
        this.saleForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.saleForm.value;

    this.productSaleService.createSale(formValue).subscribe({
      next: (sale: any) => {
        this.submitting.set(false);
        alert(`Sale completed successfully!\\n\\nSale ID: ${sale.id}\\nRevenue ID: ${sale.revenueId}\\nTotal Amount: $${sale.totalAmount.toFixed(2)}\\n\\nRevenue has been automatically created.`);
        this.router.navigate(['/products/sales']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error creating sale:', err);
        alert('Failed to complete sale: ' + (err.error?.message || 'Unknown error'));
      },
    });
  }

  cancel() {
    this.router.navigate(['/products/list']);
  }
}
