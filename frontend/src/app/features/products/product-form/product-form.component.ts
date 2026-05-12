import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ProductService } from '../services/product.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ProductCategory } from '@shared/enums/product.enum';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    CheckboxModule,
    ButtonModule,
    DatePickerModule,
    TranslateModule,
  ],
  templateUrl: './product-form.component.html',
  styles: [
    `
      :host ::ng-deep .p-inputnumber,
      :host ::ng-deep .p-dropdown {
        width: 100%;
      }

      :host ::ng-deep .p-inputnumber-input {
        width: 100%;
      }

      :host ::ng-deep .p-inputnumber.ng-touched.ng-invalid .p-inputtext,
      :host ::ng-deep .p-select.ng-touched.ng-invalid {
        border-color: var(--red-500);
      }
    `,
  ],
})
export class ProductFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);
  private branchService = inject(BranchService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private translate = inject(TranslateService);

  productForm!: FormGroup;
  isEditMode = signal(false);
  productId = signal<string | null>(null);
  submitting = signal(false);
  branches: any[] = [];

  categories: { value: ProductCategory; label: string }[] = [];
  units: { value: string; label: string }[] = [];

  ngOnInit() {
    this.categories = [
      { value: ProductCategory.STATIONERY, label: this.translate.instant('PRODUCTS.LIST.CAT_STATIONERY') },
      { value: ProductCategory.BOOKS, label: this.translate.instant('PRODUCTS.LIST.CAT_BOOKS') },
      { value: ProductCategory.ELECTRONICS, label: this.translate.instant('PRODUCTS.LIST.CAT_ELECTRONICS') },
      { value: ProductCategory.SUPPLIES, label: this.translate.instant('PRODUCTS.LIST.CAT_SUPPLIES') },
      { value: ProductCategory.MERCHANDISE, label: this.translate.instant('PRODUCTS.LIST.CAT_MERCHANDISE') },
      { value: ProductCategory.OTHER, label: this.translate.instant('PRODUCTS.LIST.CAT_OTHER') },
    ];
    this.units = [
      { value: 'piece', label: this.translate.instant('PRODUCTS.FORM.UNIT_PIECE') },
      { value: 'box', label: this.translate.instant('PRODUCTS.FORM.UNIT_BOX') },
      { value: 'pack', label: this.translate.instant('PRODUCTS.FORM.UNIT_PACK') },
      { value: 'kg', label: this.translate.instant('PRODUCTS.FORM.UNIT_KG') },
      { value: 'liter', label: this.translate.instant('PRODUCTS.FORM.UNIT_LITER') },
      { value: 'meter', label: this.translate.instant('PRODUCTS.FORM.UNIT_METER') },
      { value: 'set', label: this.translate.instant('PRODUCTS.FORM.UNIT_SET') },
    ];
    this.initForm();
    this.loadBranches();

    const id = this.route.snapshot.params['id'];
    if (id) {
      this.isEditMode.set(true);
      this.productId.set(id);
      this.loadProduct(id);
    }
  }

  initForm() {
    this.productForm = this.fb.group({
      name: ['', Validators.required],
      code: ['', Validators.required],
      description: ['', Validators.required],
      category: ['', Validators.required],
      costPrice: [null, [Validators.required, Validators.min(0)]],
      sellingPrice: [null, [Validators.required, Validators.min(0)]],
      stock: [0, [Validators.required, Validators.min(0)]],
      minStock: [0, [Validators.required, Validators.min(0)]],
      unit: ['', Validators.required],
      branchId: ['', Validators.required],
      recordStockExpense: [true],
      purchaseDate: [new Date()],
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches = branches;
      },
      error: (err) => {
        console.error('Error loading branches:', err);
      },
    });
  }

  loadProduct(id: string) {
    this.productService.getProductById(id).subscribe({
      next: (product) => {
        this.productForm.patchValue({
          name: product.name,
          code: product.code,
          description: product.description,
          category: product.category,
          costPrice: product.costPrice,
          sellingPrice: product.sellingPrice,
          stock: product.stock,
          minStock: product.minStock,
          unit: product.unit,
          branchId: product.branchId,
        });
        // Lock fields that must not be changed after creation
        this.productForm.get('stock')?.disable();
        this.productForm.get('branchId')?.disable();
        this.productForm.get('costPrice')?.disable();
      },
      error: (err) => {
        console.error('Error loading product:', err);
        this.notificationService.error('Failed to load product');
        this.cancel();
      },
    });
  }

  onSubmit() {
    if (this.productForm.invalid) {
      Object.keys(this.productForm.controls).forEach((key) => {
        this.productForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.submitting.set(true);
    // getRawValue includes disabled controls; we only want enabled ones for PATCH
    const formValue = this.isEditMode()
      ? this.productForm.value  // excludes disabled: stock, branchId, costPrice
      : this.productForm.getRawValue();

    const productData = {
      ...formValue,
      purchaseDate: formValue.purchaseDate instanceof Date
        ? formValue.purchaseDate.toISOString().split('T')[0]
        : formValue.purchaseDate,
    };

    const request = this.isEditMode()
      ? this.productService.updateProduct(this.productId()!, productData)
      : this.productService.createProduct(productData);

    request.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/products/list']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error saving product:', err);
        this.notificationService.error(err.error?.message || 'Failed to save product');
      },
    });
  }

  cancel() {
    this.router.navigate(['/products/list']);
  }
}
