import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { NumberFormatService } from '../../../shared/services/number-format.service';
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
    AmountPipe,
  ],
  templateUrl: './product-sale.component.html',
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
  private translate = inject(TranslateService);
  private numberFormat = inject(NumberFormatService);
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
      paymentMethod: ['CASH', Validators.required],
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
        this.notificationService.success(
          this.translate.instant('PRODUCTS.SALE_COMPLETED', { total: this.numberFormat.format(sale.totalAmount) })
        );
        this.router.navigate(['/products/sales']);
      },
      error: (err) => {
        // Interceptor toasted the translated error.
        this.submitting.set(false);
        console.error('Error creating sale:', err);
      },
    });
  }

  cancel() {
    this.router.navigate(['/products/list']);
  }
}
