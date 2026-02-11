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
import { ProductService } from '../services/product.service';
import { BranchService } from '../../branches/services/branch.service';
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
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">{{ isEditMode() ? 'Edit' : 'Create' }} Product</h2>
          </div>
        </ng-template>

        <form [formGroup]="productForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="field">
              <label for="name" class="block text-sm font-medium mb-2">Product Name *</label>
              <input pInputText id="name" formControlName="name" class="w-full" />
              @if (productForm.get('name')?.invalid && productForm.get('name')?.touched) {
                <small class="text-red-500">Product name is required</small>
              }
            </div>

            <div class="field">
              <label for="code" class="block text-sm font-medium mb-2">Product Code *</label>
              <input pInputText id="code" formControlName="code" class="w-full" />
              @if (productForm.get('code')?.invalid && productForm.get('code')?.touched) {
                <small class="text-red-500">Product code is required</small>
              }
            </div>

            <div class="field md:col-span-2">
              <label for="description" class="block text-sm font-medium mb-2">Description *</label>
              <textarea pInputTextarea id="description" formControlName="description" rows="3" class="w-full"></textarea>
              @if (productForm.get('description')?.invalid && productForm.get('description')?.touched) {
                <small class="text-red-500">Description is required</small>
              }
            </div>

            <div class="field">
              <label for="category" class="block text-sm font-medium mb-2">Category *</label>
              <p-select
                id="category"
                formControlName="category"
                [options]="categories"
                optionLabel="label"
                optionValue="value"
                placeholder="Select category"
                class="w-full"
                [style]="{'width': '100%'}">
              </p-select>
              @if (productForm.get('category')?.invalid && productForm.get('category')?.touched) {
                <small class="text-red-500">Category is required</small>
              }
            </div>

            <div class="field">
              <label for="unit" class="block text-sm font-medium mb-2">Unit *</label>
              <p-select
                id="unit"
                formControlName="unit"
                [options]="units"
                optionLabel="label"
                optionValue="value"
                placeholder="Select unit"
                class="w-full"
                [style]="{'width': '100%'}">
              </p-select>
              @if (productForm.get('unit')?.invalid && productForm.get('unit')?.touched) {
                <small class="text-red-500">Unit is required</small>
              }
            </div>

            <div class="field">
              <label for="costPrice" class="block text-sm font-medium mb-2">Cost Price *</label>
              <p-inputNumber inputId="costPrice" formControlName="costPrice" mode="currency" currency="USD" [minFractionDigits]="2" [min]="0" class="w-full"></p-inputNumber>
              @if (productForm.get('costPrice')?.invalid && productForm.get('costPrice')?.touched) {
                <small class="text-red-500">Cost price is required</small>
              }
            </div>

            <div class="field">
              <label for="sellingPrice" class="block text-sm font-medium mb-2">Selling Price *</label>
              <p-inputNumber inputId="sellingPrice" formControlName="sellingPrice" mode="currency" currency="USD" [minFractionDigits]="2" [min]="0" class="w-full"></p-inputNumber>
              @if (productForm.get('sellingPrice')?.invalid && productForm.get('sellingPrice')?.touched) {
                <small class="text-red-500">Selling price is required</small>
              }
              @if (productForm.get('sellingPrice')?.value < productForm.get('costPrice')?.value) {
                <small class="text-orange-500">Warning: Selling price is less than cost price</small>
              }
            </div>

            <div class="field">
              <label for="stock" class="block text-sm font-medium mb-2">Initial Stock *</label>
              <p-inputNumber inputId="stock" formControlName="stock" [min]="0" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (productForm.get('stock')?.invalid && productForm.get('stock')?.touched) {
                <small class="text-red-500">Stock is required</small>
              }
            </div>

            <div class="field">
              <label for="minStock" class="block text-sm font-medium mb-2">Min Stock Threshold *</label>
              <p-inputNumber inputId="minStock" formControlName="minStock" [min]="0" [showButtons]="true" class="w-full"></p-inputNumber>
              @if (productForm.get('minStock')?.invalid && productForm.get('minStock')?.touched) {
                <small class="text-red-500">Min stock is required</small>
              }
            </div>

            <div class="field md:col-span-2">
              <div class="flex items-center gap-2">
                <p-checkbox
                  inputId="isGlobal"
                  formControlName="isGlobal"
                  [binary]="true">
                </p-checkbox>
                <label for="isGlobal" class="text-sm font-medium">Global Product (shared across all branches)</label>
              </div>
            </div>

            @if (!productForm.get('isGlobal')?.value) {
              <div class="field md:col-span-2">
                <label for="branchId" class="block text-sm font-medium mb-2">Branch *</label>
                <p-select
                  id="branchId"
                  formControlName="branchId"
                  [options]="branches"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select branch"
                  class="w-full"
                  [style]="{'width': '100%'}">
                </p-select>
                @if (productForm.get('branchId')?.invalid && productForm.get('branchId')?.touched) {
                  <small class="text-red-500">Branch is required for branch-specific products</small>
                }
              </div>
            }
          </div>

          <div class="flex gap-3 mt-6">
            <p-button type="submit" label="{{ isEditMode() ? 'Update' : 'Create' }} Product" icon="pi pi-check" [disabled]="productForm.invalid || submitting()"></p-button>
            <p-button type="button" label="Cancel" icon="pi pi-times" severity="secondary" [outlined]="true" (onClick)="cancel()"></p-button>
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
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  productForm!: FormGroup;
  isEditMode = signal(false);
  productId = signal<string | null>(null);
  submitting = signal(false);
  branches: any[] = [];

  categories = [
    { value: ProductCategory.STATIONERY, label: 'Stationery' },
    { value: ProductCategory.BOOKS, label: 'Books' },
    { value: ProductCategory.ELECTRONICS, label: 'Electronics' },
    { value: ProductCategory.SUPPLIES, label: 'Supplies' },
    { value: ProductCategory.MERCHANDISE, label: 'Merchandise' },
    { value: ProductCategory.OTHER, label: 'Other' },
  ];

  units = [
    { value: 'piece', label: 'Piece' },
    { value: 'box', label: 'Box' },
    { value: 'pack', label: 'Pack' },
    { value: 'kg', label: 'Kilogram (kg)' },
    { value: 'liter', label: 'Liter' },
    { value: 'meter', label: 'Meter' },
    { value: 'set', label: 'Set' },
  ];

  ngOnInit() {
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
        alert('Failed to load product');
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

    const request = this.isEditMode()
      ? this.productService.updateProduct(this.productId()!, formValue)
      : this.productService.createProduct(formValue);

    request.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/products/list']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error saving product:', err);
        alert('Failed to save product: ' + (err.error?.message || 'Unknown error'));
      },
    });
  }

  cancel() {
    this.router.navigate(['/products/list']);
  }
}
