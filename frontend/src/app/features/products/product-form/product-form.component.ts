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
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">{{ isEditMode() ? ('PRODUCTS.FORM.EDIT_TITLE' | translate) : ('PRODUCTS.FORM.CREATE_TITLE' | translate) }}</h2>
          </div>
        </ng-template>

        <form [formGroup]="productForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="field">
              <label for="name" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.NAME_LABEL' | translate }} *</label>
              <input pInputText id="name" formControlName="name" class="w-full" />
              @if (productForm.get('name')?.invalid && productForm.get('name')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.NAME_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="code" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.CODE_LABEL' | translate }} *</label>
              <input pInputText id="code" formControlName="code" class="w-full" />
              @if (productForm.get('code')?.invalid && productForm.get('code')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.CODE_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field md:col-span-2">
              <label for="description" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.DESC_LABEL' | translate }} *</label>
              <textarea pInputTextarea id="description" formControlName="description" rows="3" class="w-full"></textarea>
              @if (productForm.get('description')?.invalid && productForm.get('description')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.DESC_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="category" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.CATEGORY_LABEL' | translate }} *</label>
              <p-select
                id="category"
                formControlName="category"
                [options]="categories"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'PRODUCTS.FORM.CATEGORY_PLACEHOLDER' | translate"
                class="w-full"
                [style]="{'width': '100%'}">
              </p-select>
              @if (productForm.get('category')?.invalid && productForm.get('category')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.CATEGORY_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="unit" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.UNIT_LABEL' | translate }} *</label>
              <p-select
                id="unit"
                formControlName="unit"
                [options]="units"
                optionLabel="label"
                optionValue="value"
                [placeholder]="'PRODUCTS.FORM.UNIT_PLACEHOLDER' | translate"
                class="w-full"
                [style]="{'width': '100%'}">
              </p-select>
              @if (productForm.get('unit')?.invalid && productForm.get('unit')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.UNIT_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="costPrice" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.COST_LABEL' | translate }} *</label>
              <p-inputNumber inputId="costPrice" formControlName="costPrice" mode="currency" currency="USD" [minFractionDigits]="2" [min]="0" class="w-full"></p-inputNumber>
              @if (productForm.get('costPrice')?.invalid && productForm.get('costPrice')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.COST_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="sellingPrice" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.SELL_LABEL' | translate }} *</label>
              <p-inputNumber inputId="sellingPrice" formControlName="sellingPrice" mode="currency" currency="USD" [minFractionDigits]="2" [min]="0" class="w-full"></p-inputNumber>
              @if (productForm.get('sellingPrice')?.invalid && productForm.get('sellingPrice')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.SELL_REQUIRED' | translate }}</small>
              }
              @if (productForm.get('sellingPrice')?.value < productForm.get('costPrice')?.value) {
                <small class="text-orange-500">{{ 'PRODUCTS.FORM.SELL_WARNING' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="stock" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.STOCK_LABEL' | translate }} *</label>
              <p-inputNumber inputId="stock" formControlName="stock" [min]="0" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (productForm.get('stock')?.invalid && productForm.get('stock')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.STOCK_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field">
              <label for="minStock" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.MIN_STOCK_LABEL' | translate }} *</label>
              <p-inputNumber inputId="minStock" formControlName="minStock" [min]="0" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (productForm.get('minStock')?.invalid && productForm.get('minStock')?.touched) {
                <small class="text-red-500">{{ 'PRODUCTS.FORM.MIN_STOCK_REQUIRED' | translate }}</small>
              }
            </div>

            <div class="field md:col-span-2">
              <div class="flex items-center gap-2">
                <p-checkbox
                  inputId="isGlobal"
                  formControlName="isGlobal"
                  [binary]="true">
                </p-checkbox>
                <label for="isGlobal" class="text-sm font-medium">{{ 'PRODUCTS.FORM.GLOBAL_LABEL' | translate }}</label>
              </div>
            </div>

            @if (!productForm.get('isGlobal')?.value) {
              <div class="field md:col-span-2">
                <label for="branchId" class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.BRANCH_LABEL' | translate }} *</label>
                <p-select
                  id="branchId"
                  formControlName="branchId"
                  [options]="branches"
                  optionLabel="name"
                  optionValue="id"
                  [placeholder]="'PRODUCTS.FORM.BRANCH_PLACEHOLDER' | translate"
                  class="w-full"
                  [style]="{'width': '100%'}">
                </p-select>
                @if (productForm.get('branchId')?.invalid && productForm.get('branchId')?.touched) {
                  <small class="text-red-500">{{ 'PRODUCTS.FORM.BRANCH_REQUIRED' | translate }}</small>
                }
              </div>
            }
          </div>

          @if (!isEditMode()) {
            <div class="md:col-span-2 p-4 bg-blue-50 border border-blue-200 rounded-lg mt-2">
              <div class="flex items-center gap-2 mb-3">
                <p-checkbox
                  inputId="recordStockExpense"
                  formControlName="recordStockExpense"
                  [binary]="true">
                </p-checkbox>
                <label for="recordStockExpense" class="font-semibold text-blue-800">{{ 'PRODUCTS.FORM.STOCK_EXPENSE_LABEL' | translate }}</label>
              </div>
              @if (productForm.get('recordStockExpense')?.value) {
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  <div>
                    <label class="block text-sm font-medium mb-2">{{ 'PRODUCTS.FORM.PURCHASE_DATE' | translate }} <span class="text-red-500">*</span></label>
                    <p-datepicker
                      formControlName="purchaseDate"
                      dateFormat="yy-mm-dd"
                      [showIcon]="true"
                      class="w-full">
                    </p-datepicker>
                  </div>
                  <div class="flex items-end pb-1">
                    @if (productForm.get('costPrice')?.value && productForm.get('stock')?.value) {
                      <div class="text-blue-700 font-medium">
                        {{ 'PRODUCTS.FORM.TOTAL_EXPENSE' | translate }} {{ (productForm.get('costPrice')!.value * productForm.get('stock')!.value) | number:'1.2-2' }} EGP
                      </div>
                    }
                  </div>
                </div>
                <small class="text-blue-600 block mt-2">{{ 'PRODUCTS.FORM.STOCK_EXPENSE_HINT' | translate }}</small>
              }
              @if (!productForm.get('recordStockExpense')?.value) {
                <small class="text-gray-500">{{ 'PRODUCTS.FORM.NO_STOCK_EXPENSE_HINT' | translate }}</small>
              }
            </div>
          }

          <div class="flex gap-3 mt-6">
            <p-button type="submit" [label]="isEditMode() ? ('PRODUCTS.FORM.UPDATE_BTN' | translate) : ('PRODUCTS.FORM.CREATE_BTN' | translate)" icon="pi pi-check" [disabled]="productForm.invalid || submitting()"></p-button>
            <p-button type="button" [label]="'PRODUCTS.FORM.CANCEL' | translate" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="cancel()"></p-button>
          </div>
        </form>
      </p-card>
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .p-inputnumber,
      :host ::ng-deep .p-dropdown {
        width: 100%;
      }

      :host ::ng-deep .p-inputnumber-input {
        width: 100%;
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

    // Watch isGlobal changes
    this.productForm.get('isGlobal')?.valueChanges.subscribe((isGlobal) => {
      const branchControl = this.productForm.get('branchId');
      if (isGlobal) {
        branchControl?.clearValidators();
        branchControl?.setValue(null);
      } else {
        branchControl?.setValidators([Validators.required]);
      }
      branchControl?.updateValueAndValidity();
    });
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
      isGlobal: [false],
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
        // Still allow form to work, just with no branches available
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
          isGlobal: product.isGlobal,
          branchId: product.branchId,
        });
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
    const formValue = this.productForm.value;

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
