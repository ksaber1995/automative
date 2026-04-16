import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { TranslateModule } from '@ngx-translate/core';
import { ProductService } from '../services/product.service';
import { ProductSaleService } from '../services/product-sale.service';
import { EventService } from '../../events/services/event.service';
import { AuthService } from '../../../core/services/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Product } from '@shared/interfaces/product.interface';
import { EventModel } from '@shared/interfaces/event.interface';
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
    TranslateModule,
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">{{ 'PRODUCTS.SALE.TITLE' | translate }}</h2>
            <p class="text-sm text-gray-600 mt-1">{{ 'PRODUCTS.SALE.AUTO_HINT' | translate }}</p>
          </div>
        </ng-template>

        <form [formGroup]="saleForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 gap-4">
            <!-- Product Selection -->
            <div class="field">
              <label for="productId" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.PRODUCT_LABEL' | translate }} *</label>
              <select id="productId" formControlName="productId" class="w-full p-2 border rounded">
                <option value="">{{ 'PRODUCTS.SALE.PRODUCT_PLACEHOLDER' | translate }}</option>
                @for (product of products(); track product.id) {
                  <option [value]="product.id">{{ product.name }} ({{ product.code }}) - Stock: {{ product.stock }}</option>
                }
              </select>
              @if (saleForm.get('productId')?.invalid && saleForm.get('productId')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.SALE.PRODUCT_REQUIRED' | translate }}</small>
              }
              @if (selectedProduct()) {
                <div class="mt-2 p-3 bg-blue-50 rounded">
                  <div class="flex justify-between items-center">
                    <span class="text-sm font-medium">{{ 'PRODUCTS.SALE.SELL_PRICE_LABEL' | translate }}</span>
                    <span class="text-lg font-bold text-blue-600">{{ selectedProduct()!.sellingPrice.toFixed(2) }}</span>
                  </div>
                  <div class="flex justify-between items-center mt-1">
                    <span class="text-sm font-medium">{{ 'PRODUCTS.SALE.STOCK_LABEL' | translate }}</span>
                    <span class="text-sm" [class.text-red-600]="selectedProduct()!.stock <= selectedProduct()!.minStock" [class.text-green-600]="selectedProduct()!.stock > selectedProduct()!.minStock">
                      {{ selectedProduct()!.stock }} {{ selectedProduct()!.unit }}
                    </span>
                  </div>
                </div>
              }
            </div>

            <!-- Quantity -->
            <div class="field">
              <label for="quantity" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.QTY_LABEL' | translate }} *</label>
              <p-inputNumber inputId="quantity" formControlName="quantity" [min]="1" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (saleForm.get('quantity')?.invalid && saleForm.get('quantity')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.SALE.QTY_REQUIRED' | translate }}</small>
              }
              @if (!stockAvailable()) {
                <small class="text-red-500">{{ 'PRODUCTS.SALE.INSUFFICIENT_STOCK' | translate }} {{ selectedProduct()?.stock || 0 }}</small>
              }
            </div>

            <!-- Discount -->
            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="discountType" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.DISCOUNT_TYPE_LABEL' | translate }} *</label>
                <select id="discountType" formControlName="discountType" class="w-full p-2 border rounded">
                  <option [value]="DiscountType.NONE">{{ 'PRODUCTS.SALE.NO_DISCOUNT' | translate }}</option>
                  <option [value]="DiscountType.PERCENTAGE">{{ 'PRODUCTS.SALE.PERCENT_DISCOUNT' | translate }}</option>
                  <option [value]="DiscountType.FIXED_AMOUNT">{{ 'PRODUCTS.SALE.FIXED_DISCOUNT' | translate }}</option>
                </select>
              </div>
              <div class="field">
                <label for="discountValue" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.DISCOUNT_VALUE' | translate }}</label>
                <p-inputNumber inputId="discountValue" formControlName="discountValue" [min]="0" [disabled]="saleForm.get('discountType')?.value === DiscountType.NONE" class="w-full"></p-inputNumber>
              </div>
            </div>

            <!-- Real-time Calculation Display -->
            <div class="mt-4 p-4 bg-gradient-to-r from-green-50 to-green-100 rounded-lg border-2 border-green-300">
              <h3 class="font-bold text-lg mb-3">{{ 'PRODUCTS.SALE.SUMMARY_TITLE' | translate }}</h3>
              <div class="space-y-2">
                <div class="flex justify-between items-center">
                  <span class="font-medium">{{ 'PRODUCTS.SALE.SUBTOTAL' | translate }}</span>
                  <span class="text-lg">{{ subtotal().toFixed(2) }}</span>
                </div>
                @if (discountAmount() > 0) {
                  <div class="flex justify-between items-center text-orange-600">
                    <span class="font-medium">{{ 'PRODUCTS.SALE.DISCOUNT' | translate }}</span>
                    <span class="text-lg">-{{ discountAmount().toFixed(2) }}</span>
                  </div>
                }
                <hr class="border-green-300" />
                <div class="flex justify-between items-center">
                  <span class="font-bold text-xl">{{ 'PRODUCTS.SALE.TOTAL' | translate }}</span>
                  <span class="text-2xl font-bold text-green-600">{{ totalAmount().toFixed(2) }}</span>
                </div>
              </div>
            </div>

            <!-- Payment Method -->
            <div class="field">
              <label for="paymentMethod" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.PAYMENT_METHOD_LABEL' | translate }} *</label>
              <select id="paymentMethod" formControlName="paymentMethod" class="w-full p-2 border rounded">
                <option value="">{{ 'PRODUCTS.SALE.PAYMENT_PLACEHOLDER' | translate }}</option>
                <option [value]="PaymentMethod.CASH">{{ 'PRODUCTS.SALE.CASH' | translate }}</option>
                <option [value]="PaymentMethod.CREDIT_CARD">{{ 'PRODUCTS.SALE.CREDIT_CARD' | translate }}</option>
                <option [value]="PaymentMethod.DEBIT_CARD">{{ 'PRODUCTS.SALE.DEBIT_CARD' | translate }}</option>
                <option [value]="PaymentMethod.BANK_TRANSFER">{{ 'PRODUCTS.SALE.BANK_TRANSFER' | translate }}</option>
                <option [value]="PaymentMethod.CHECK">{{ 'PRODUCTS.SALE.CHECK' | translate }}</option>
                <option [value]="PaymentMethod.OTHER">{{ 'PRODUCTS.SALE.OTHER' | translate }}</option>
              </select>
              @if (saleForm.get('paymentMethod')?.invalid && saleForm.get('paymentMethod')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.SALE.PAYMENT_REQUIRED' | translate }}</small>
              }
            </div>

            <!-- Optional Fields -->
            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="receiptNumber" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.RECEIPT_LABEL' | translate }}</label>
                <input pInputText id="receiptNumber" formControlName="receiptNumber" class="w-full" />
              </div>
              <div class="field">
                <label for="date" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.DATE_LABEL' | translate }} *</label>
                <input type="date" id="date" formControlName="date" class="w-full p-2 border rounded" />
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <div class="field">
                <label for="customerName" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.CUSTOMER_NAME' | translate }}</label>
                <input pInputText id="customerName" formControlName="customerName" class="w-full" />
              </div>
              <div class="field">
                <label for="customerPhone" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.CUSTOMER_PHONE' | translate }}</label>
                <input pInputText id="customerPhone" formControlName="customerPhone" class="w-full" />
              </div>
            </div>

            <div class="field">
              <label for="eventId" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.EVENT_LABEL' | translate }}</label>
              <select id="eventId" formControlName="eventId" class="w-full p-2 border rounded">
                <option value="">{{ 'PRODUCTS.SALE.EVENT_PLACEHOLDER' | translate }}</option>
                @for (event of events(); track event.id) {
                  <option [value]="event.id">{{ event.name }}</option>
                }
              </select>
              <small class="text-gray-500">{{ 'PRODUCTS.SALE.EVENT_HINT' | translate }}</small>
            </div>

            <div class="field">
              <label for="notes" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.SALE.NOTES_LABEL' | translate }}</label>
              <textarea id="notes" formControlName="notes" rows="2" class="w-full p-2 border rounded"></textarea>
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <p-button type="submit" [label]="'PRODUCTS.SALE.COMPLETE_SALE' | translate" icon="pi pi-check" severity="success" [disabled]="saleForm.invalid || !stockAvailable() || submitting()"></p-button>
            <p-button type="button" [label]="'PRODUCTS.SALE.CANCEL' | translate" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="cancel()"></p-button>
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
  private eventService = inject(EventService);
  private authService = inject(AuthService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  saleForm!: FormGroup;
  products = signal<Product[]>([]);
  events = signal<EventModel[]>([]);
  submitting = signal(false);

  // Reactive signals synced from form values
  selectedProductId = signal<string>('');
  quantityValue = signal<number>(1);
  discountTypeValue = signal<string>(DiscountType.NONE);
  discountValueNum = signal<number>(0);

  // Expose enums to template
  DiscountType = DiscountType;
  PaymentMethod = PaymentMethod;

  // Computed signals that now properly react to form changes via signals
  selectedProduct = computed(() => this.products().find((p) => p.id === this.selectedProductId()));

  unitPrice = computed(() => this.selectedProduct()?.sellingPrice || 0);

  subtotal = computed(() => this.unitPrice() * (this.quantityValue() || 0));

  discountAmount = computed(() => {
    const type = this.discountTypeValue();
    const value = this.discountValueNum() || 0;
    const sub = this.subtotal();
    if (type === DiscountType.PERCENTAGE) return (sub * value) / 100;
    if (type === DiscountType.FIXED_AMOUNT) return value;
    return 0;
  });

  totalAmount = computed(() => Math.max(0, this.subtotal() - this.discountAmount()));

  stockAvailable = computed(() => {
    const product = this.selectedProduct();
    const qty = this.quantityValue() || 0;
    return product ? product.stock >= qty : false;
  });

  ngOnInit() {
    this.initForm();
    this.loadProducts();
    this.loadEvents();

    // Sync form values into signals so computed() reacts to changes
    this.saleForm.get('productId')!.valueChanges.subscribe(v => this.selectedProductId.set(v || ''));
    this.saleForm.get('quantity')!.valueChanges.subscribe(v => this.quantityValue.set(v || 1));
    this.saleForm.get('discountType')!.valueChanges.subscribe(v => this.discountTypeValue.set(v));
    this.saleForm.get('discountValue')!.valueChanges.subscribe(v => this.discountValueNum.set(v || 0));

    // Pre-select product from query params
    this.route.queryParams.subscribe((params) => {
      if (params['productId']) {
        this.saleForm.patchValue({ productId: params['productId'] });
        this.selectedProductId.set(params['productId']);
      }
    });

    // Patch branchId from authenticated user context
    const user = this.authService.currentUser();
    if (user?.branchId) {
      this.saleForm.patchValue({ branchId: user.branchId });
    }

    // Watch discount type changes
    this.saleForm.get('discountType')?.valueChanges.subscribe((type) => {
      if (type === DiscountType.NONE) {
        this.saleForm.get('discountValue')?.setValue(0);
      }
    });
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    this.saleForm = this.fb.group({
      branchId: [''],
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
      eventId: [''],
    });
  }

  loadEvents() {
    this.eventService.getAll().subscribe({
      next: (evts) => {
        this.events.set(evts.filter((e) => e.isActive && e.status !== 'CANCELLED'));
      },
    });
  }

  loadProducts() {
    this.productService.getAllProducts().subscribe({
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
    const formValue = {
      ...this.saleForm.value,
      eventId: this.saleForm.value.eventId || undefined,
    };

    this.productSaleService.createSale(formValue).subscribe({
      next: (sale: any) => {
        this.submitting.set(false);
        this.notificationService.success(`Sale completed! Total: ${sale.totalAmount.toFixed(2)}`);
        this.router.navigate(['/products/sales']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error creating sale:', err);
        this.notificationService.error(err.error?.message || 'Failed to complete sale');
      },
    });
  }

  cancel() {
    this.router.navigate(['/products/list']);
  }
}
