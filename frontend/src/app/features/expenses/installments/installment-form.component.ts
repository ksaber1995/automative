import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { InstallmentService } from '../services/installment.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { ExpenseCategory } from '@shared/enums/expense-type.enum';

@Component({
  selector: 'app-installment-form',
  standalone: true,
  imports: [
    CommonModule, FormsModule, ReactiveFormsModule, CardModule, ButtonModule,
    InputTextModule, InputNumberModule, TextareaModule, SelectModule, DatePickerModule,
  ],
  template: `
    <div class="container-custom py-8 max-w-4xl mx-auto">
      <div class="flex items-center gap-4 mb-6">
        <p-button icon="pi pi-arrow-left" [text]="true" severity="secondary" (onClick)="cancel()"></p-button>
        <div class="flex-1">
          <h1 class="text-2xl font-bold text-gray-900">New Installment Plan</h1>
          <p class="text-gray-500 mt-1">Set up a financed purchase paid over multiple months</p>
        </div>
      </div>

      <p-card>
        <form [formGroup]="form" (ngSubmit)="submit()" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="md:col-span-2">
            <label class="block text-sm font-medium mb-1">Item / Asset Name *</label>
            <input pInputText type="text" formControlName="name" placeholder="e.g. MacBook Pro 16'"
              class="w-full" />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Branch</label>
            <p-select formControlName="branchId" [options]="branchOptions()" optionLabel="label" optionValue="value"
              placeholder="Global / All branches" [showClear]="true" styleClass="w-full">
            </p-select>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Category *</label>
            <p-select formControlName="category" [options]="categoryOptions" optionLabel="label" optionValue="value"
              placeholder="Select category" styleClass="w-full">
            </p-select>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Total Amount *</label>
            <p-inputnumber formControlName="totalAmount" [min]="0.01" [minFractionDigits]="2"
              [maxFractionDigits]="2" placeholder="2000.00" styleClass="w-full">
            </p-inputnumber>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Downpayment</label>
            <p-inputnumber formControlName="downpaymentAmount" [min]="0" [minFractionDigits]="2"
              [maxFractionDigits]="2" placeholder="0.00" styleClass="w-full">
            </p-inputnumber>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Number of Months *</label>
            <p-inputnumber formControlName="monthsCount" [min]="1" [max]="120" [showButtons]="true"
              styleClass="w-full">
            </p-inputnumber>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Start Date *</label>
            <p-datepicker formControlName="startDate" dateFormat="yy-mm-dd" [showIcon]="true" styleClass="w-full">
            </p-datepicker>
            <p class="text-xs text-gray-500 mt-1">Downpayment recorded here. First installment due 1 month after.</p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Vendor</label>
            <input pInputText type="text" formControlName="vendor" placeholder="Vendor / Store name" class="w-full" />
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">Invoice #</label>
            <input pInputText type="text" formControlName="invoiceNumber" placeholder="Invoice number" class="w-full" />
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-medium mb-1">Description</label>
            <textarea pTextarea formControlName="description" rows="2" placeholder="Optional description"
              class="w-full"></textarea>
          </div>

          <div class="md:col-span-2">
            <label class="block text-sm font-medium mb-1">Notes</label>
            <textarea pTextarea formControlName="notes" rows="2" placeholder="Optional notes" class="w-full"></textarea>
          </div>

          <!-- Live preview -->
          <div class="md:col-span-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 class="font-semibold text-blue-900 mb-3">Plan Preview</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p class="text-blue-700 text-xs uppercase">Total</p>
                <p class="font-bold text-blue-900">{{ totalPreview() | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-blue-700 text-xs uppercase">Downpayment</p>
                <p class="font-bold text-blue-900">{{ dpPreview() | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-blue-700 text-xs uppercase">Financed</p>
                <p class="font-bold text-blue-900">{{ financedPreview() | number:'1.2-2' }}</p>
              </div>
              <div>
                <p class="text-blue-700 text-xs uppercase">Per Month × {{ form.value.monthsCount || 0 }}</p>
                <p class="font-bold text-blue-900">{{ monthlyPreview() | number:'1.2-2' }}</p>
              </div>
            </div>
          </div>

          <div class="md:col-span-2 flex justify-end gap-2">
            <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="cancel()"></p-button>
            <p-button
              type="submit"
              label="Create Plan"
              icon="pi pi-check"
              [disabled]="!form.valid || submitting()"
              [loading]="submitting()">
            </p-button>
          </div>
        </form>
      </p-card>
    </div>
  `,
})
export class InstallmentFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private installmentService = inject(InstallmentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

  form: FormGroup;
  branches = signal<Branch[]>([]);
  branchOptions = computed(() => this.branches().map(b => ({ label: b.name, value: b.id })));
  submitting = signal(false);

  categoryOptions = Object.values(ExpenseCategory).map(c => ({ label: c, value: c }));

  totalPreview = signal(0);
  dpPreview = signal(0);
  financedPreview = computed(() => Math.max(0, this.totalPreview() - this.dpPreview()));
  monthlyPreview = signal(0);

  constructor() {
    this.form = this.fb.group({
      branchId: [null],
      name: ['', [Validators.required]],
      description: [''],
      category: ['EQUIPMENT', [Validators.required]],
      totalAmount: [0, [Validators.required, Validators.min(0.01)]],
      downpaymentAmount: [0, [Validators.min(0)]],
      monthsCount: [12, [Validators.required, Validators.min(1)]],
      startDate: [new Date(), [Validators.required]],
      vendor: [''],
      invoiceNumber: [''],
      notes: [''],
    });

    const recompute = () => {
      const v = this.form.value;
      const total = Number(v.totalAmount || 0);
      const dp = Number(v.downpaymentAmount || 0);
      const months = Number(v.monthsCount || 0);
      this.totalPreview.set(total);
      this.dpPreview.set(dp);
      const financed = Math.max(0, total - dp);
      this.monthlyPreview.set(months > 0 ? parseFloat((financed / months).toFixed(2)) : 0);
    };
    this.form.valueChanges.subscribe(() => recompute());
    recompute();
  }

  ngOnInit() {
    this.branchService.getActiveBranches().subscribe({ next: bs => this.branches.set(bs) });
  }

  cancel() { this.router.navigate(['/expenses/installments']); }

  submit() {
    if (!this.form.valid) {
      this.notificationService.error('Please fill all required fields');
      return;
    }
    const v = this.form.value;
    if (Number(v.downpaymentAmount || 0) >= Number(v.totalAmount)) {
      this.notificationService.error('Downpayment must be less than total amount');
      return;
    }
    const startStr = v.startDate instanceof Date ? v.startDate.toISOString().split('T')[0] : v.startDate;

    this.submitting.set(true);
    this.installmentService.create({
      branchId: v.branchId || null,
      name: v.name,
      description: v.description || undefined,
      category: v.category,
      totalAmount: Number(v.totalAmount),
      downpaymentAmount: Number(v.downpaymentAmount || 0),
      monthsCount: Number(v.monthsCount),
      startDate: startStr,
      vendor: v.vendor || undefined,
      invoiceNumber: v.invoiceNumber || undefined,
      notes: v.notes || undefined,
    }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.notificationService.success('Installment plan created');
        this.router.navigate(['/expenses/installments', res.plan.id]);
      },
      error: (err) => {
        this.submitting.set(false);
        this.notificationService.error(err.error?.message || 'Failed to create plan');
      },
    });
  }
}
