import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, FormArray, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { WithdrawalService, CreateWithdrawalDto } from '../../../core/services/withdrawal.service';
import { WithdrawalCategory, PaymentMethod, WithdrawalStakeholder } from '@shared/interfaces/withdrawal.interface';

@Component({
  selector: 'app-withdrawal-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    InputNumberModule,
    ButtonModule
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">{{ isEditMode() ? 'Edit' : 'Create' }} Withdrawal</h2>
            <p class="text-sm text-gray-600 mt-1">Withdrawal from company cash - not allocated to branches</p>
          </div>
        </ng-template>

        <form [formGroup]="withdrawalForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div class="field">
              <label for="amount" class="block text-sm font-medium mb-2">
                Total Amount *
              </label>
              <p-inputNumber
                inputId="amount"
                formControlName="amount"
                mode="currency"
                currency="USD"
                [minFractionDigits]="2"
                [min]="0.01"
                class="w-full">
              </p-inputNumber>
              @if (withdrawalForm.get('amount')?.invalid && withdrawalForm.get('amount')?.touched) {
                <small class="text-red-500">Amount must be greater than 0</small>
              }
            </div>

            <div class="field">
              <label for="withdrawalDate" class="block text-sm font-medium mb-2">
                Withdrawal Date *
              </label>
              <input
                type="date"
                id="withdrawalDate"
                formControlName="withdrawalDate"
                class="w-full p-2 border rounded" />
              @if (withdrawalForm.get('withdrawalDate')?.invalid && withdrawalForm.get('withdrawalDate')?.touched) {
                <small class="text-red-500">Withdrawal date is required</small>
              }
            </div>

            <div class="field">
              <label for="category" class="block text-sm font-medium mb-2">
                Category *
              </label>
              <select
                id="category"
                formControlName="category"
                class="w-full p-2 border rounded">
                <option value="">Select category</option>
                @for (opt of categoryOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
              @if (withdrawalForm.get('category')?.invalid && withdrawalForm.get('category')?.touched) {
                <small class="text-red-500">Category is required</small>
              }
            </div>

            <div class="field">
              <label for="paymentMethod" class="block text-sm font-medium mb-2">
                Payment Method *
              </label>
              <select
                id="paymentMethod"
                formControlName="paymentMethod"
                class="w-full p-2 border rounded">
                <option value="">Select payment method</option>
                @for (opt of paymentMethodOptions; track opt.value) {
                  <option [value]="opt.value">{{ opt.label }}</option>
                }
              </select>
              @if (withdrawalForm.get('paymentMethod')?.invalid && withdrawalForm.get('paymentMethod')?.touched) {
                <small class="text-red-500">Payment method is required</small>
              }
            </div>

            <div class="field md:col-span-2">
              <label for="reason" class="block text-sm font-medium mb-2">
                Reason *
              </label>
              <input
                pInputText
                id="reason"
                formControlName="reason"
                class="w-full"
                placeholder="Enter reason for withdrawal" />
              @if (withdrawalForm.get('reason')?.invalid && withdrawalForm.get('reason')?.touched) {
                <small class="text-red-500">Reason is required</small>
              }
            </div>

            <div class="field md:col-span-2">
              <label for="notes" class="block text-sm font-medium mb-2">
                Notes
              </label>
              <textarea
                id="notes"
                formControlName="notes"
                rows="3"
                class="w-full p-2 border rounded"
                placeholder="Additional notes...">
              </textarea>
            </div>
          </div>

          <!-- Stakeholders Section -->
          <div class="mt-6 p-4 border rounded-lg bg-gray-50">
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-lg font-semibold">Stakeholders</h3>
              <p-button
                type="button"
                label="Add Stakeholder"
                icon="pi pi-plus"
                size="small"
                (onClick)="addStakeholder()">
              </p-button>
            </div>

            <div formArrayName="stakeholders">
              @for (stakeholder of stakeholders.controls; track $index; let i = $index) {
                <div [formGroupName]="i" class="grid grid-cols-1 md:grid-cols-12 gap-3 mb-3 p-3 bg-white border rounded">
                  <div class="md:col-span-4">
                    <label class="block text-xs font-medium mb-1">Name *</label>
                    <input
                      pInputText
                      formControlName="stakeholderName"
                      class="w-full"
                      placeholder="Stakeholder name" />
                    @if (stakeholder.get('stakeholderName')?.invalid && stakeholder.get('stakeholderName')?.touched) {
                      <small class="text-red-500">Required</small>
                    }
                  </div>

                  <div class="md:col-span-4">
                    <label class="block text-xs font-medium mb-1">Email (Optional)</label>
                    <input
                      pInputText
                      formControlName="stakeholderEmail"
                      type="email"
                      class="w-full"
                      placeholder="email@example.com" />
                    @if (stakeholder.get('stakeholderEmail')?.invalid && stakeholder.get('stakeholderEmail')?.touched) {
                      <small class="text-red-500">Invalid email</small>
                    }
                  </div>

                  <div class="md:col-span-3">
                    <label class="block text-xs font-medium mb-1">Amount *</label>
                    <p-inputNumber
                      formControlName="amount"
                      mode="currency"
                      currency="USD"
                      [minFractionDigits]="2"
                      [min]="0.01"
                      class="w-full">
                    </p-inputNumber>
                    @if (stakeholder.get('amount')?.invalid && stakeholder.get('amount')?.touched) {
                      <small class="text-red-500">Required</small>
                    }
                  </div>

                  <div class="md:col-span-1 flex items-end">
                    @if (stakeholders.length > 1) {
                      <p-button
                        type="button"
                        icon="pi pi-trash"
                        severity="danger"
                        [text]="true"
                        [rounded]="true"
                        (onClick)="removeStakeholder(i)">
                      </p-button>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Validation Summary -->
            <div class="mt-4 p-3 rounded"
              [class.bg-green-50]="isStakeholderTotalValid()"
              [class.bg-red-50]="!isStakeholderTotalValid()">
              <div class="flex justify-between items-center text-sm">
                <span class="font-medium">Stakeholders Total:</span>
                <span class="font-bold"
                  [class.text-green-600]="isStakeholderTotalValid()"
                  [class.text-red-600]="!isStakeholderTotalValid()">
                  {{ getStakeholdersTotal() | currency }}
                </span>
              </div>
              <div class="flex justify-between items-center text-sm mt-1">
                <span class="font-medium">Withdrawal Amount:</span>
                <span class="font-bold">{{ withdrawalForm.get('amount')?.value || 0 | currency }}</span>
              </div>
              @if (!isStakeholderTotalValid() && withdrawalForm.get('amount')?.value > 0) {
                <div class="mt-2 text-xs text-red-600">
                  ⚠️ Stakeholders total must equal withdrawal amount
                </div>
              }
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <p-button
              type="submit"
              label="{{ isEditMode() ? 'Update' : 'Create' }} Withdrawal"
              icon="pi pi-check"
              [disabled]="withdrawalForm.invalid || !isStakeholderTotalValid() || submitting()">
            </p-button>
            <p-button
              type="button"
              label="Cancel"
              icon="pi pi-times"
              severity="secondary"
              [outlined]="true"
              (onClick)="cancel()">
            </p-button>
          </div>
        </form>
      </p-card>
    </div>
  `,
  styles: [`
    :host ::ng-deep {
      .p-inputnumber {
        width: 100%;
      }
    }
  `]
})
export class WithdrawalFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private withdrawalService = inject(WithdrawalService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  withdrawalForm!: FormGroup;
  isEditMode = signal(false);
  withdrawalId = signal<string | null>(null);
  submitting = signal(false);

  categoryOptions = [
    { label: 'Owner Draw', value: 'OWNER_DRAW' },
    { label: 'Profit Distribution', value: 'PROFIT_DISTRIBUTION' },
    { label: 'Dividend', value: 'DIVIDEND' },
    { label: 'Other', value: 'OTHER' }
  ];

  paymentMethodOptions = [
    { label: 'Cash', value: 'CASH' },
    { label: 'Check', value: 'CHECK' },
    { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
    { label: 'Other', value: 'OTHER' }
  ];

  get stakeholders(): FormArray {
    return this.withdrawalForm.get('stakeholders') as FormArray;
  }

  ngOnInit() {
    this.initForm();

    const id = this.route.snapshot.params['id'];
    if (id) {
      this.isEditMode.set(true);
      this.withdrawalId.set(id);
      this.loadWithdrawal(id);
    }
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    this.withdrawalForm = this.fb.group({
      amount: [null, [Validators.required, Validators.min(0.01)]],
      withdrawalDate: [today, Validators.required],
      reason: ['', Validators.required],
      category: ['', Validators.required],
      paymentMethod: ['', Validators.required],
      notes: [''],
      stakeholders: this.fb.array([this.createStakeholderGroup()])
    });
  }

  createStakeholderGroup(stakeholder?: WithdrawalStakeholder): FormGroup {
    return this.fb.group({
      stakeholderName: [stakeholder?.stakeholderName || '', Validators.required],
      stakeholderEmail: [stakeholder?.stakeholderEmail || '', Validators.email],
      amount: [stakeholder?.amount || null, [Validators.required, Validators.min(0.01)]]
    });
  }

  addStakeholder() {
    this.stakeholders.push(this.createStakeholderGroup());
  }

  removeStakeholder(index: number) {
    if (this.stakeholders.length > 1) {
      this.stakeholders.removeAt(index);
    }
  }

  getStakeholdersTotal(): number {
    return this.stakeholders.controls.reduce((sum, control) => {
      return sum + (control.get('amount')?.value || 0);
    }, 0);
  }

  isStakeholderTotalValid(): boolean {
    const total = this.getStakeholdersTotal();
    const withdrawalAmount = this.withdrawalForm.get('amount')?.value || 0;
    return Math.abs(total - withdrawalAmount) < 0.01;
  }

  loadWithdrawal(id: string) {
    this.withdrawalService.findOne(id).subscribe({
      next: (withdrawal) => {
        this.withdrawalForm.patchValue({
          amount: withdrawal.amount,
          withdrawalDate: withdrawal.withdrawalDate.split('T')[0],
          reason: withdrawal.reason,
          category: withdrawal.category,
          paymentMethod: withdrawal.paymentMethod,
          notes: withdrawal.notes
        });

        // Clear existing stakeholders and add loaded ones
        this.stakeholders.clear();
        withdrawal.stakeholders.forEach(s => {
          this.stakeholders.push(this.createStakeholderGroup(s));
        });
      },
      error: (err) => {
        console.error('Error loading withdrawal:', err);
        alert('Failed to load withdrawal');
        this.cancel();
      }
    });
  }

  onSubmit() {
    if (this.withdrawalForm.invalid || !this.isStakeholderTotalValid()) {
      Object.keys(this.withdrawalForm.controls).forEach(key => {
        this.withdrawalForm.get(key)?.markAsTouched();
      });
      this.stakeholders.controls.forEach(control => {
        Object.keys((control as FormGroup).controls).forEach(key => {
          control.get(key)?.markAsTouched();
        });
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.withdrawalForm.value;

    const withdrawalDto: CreateWithdrawalDto = {
      amount: formValue.amount,
      stakeholders: formValue.stakeholders,
      withdrawalDate: formValue.withdrawalDate,
      reason: formValue.reason,
      category: formValue.category as WithdrawalCategory,
      paymentMethod: formValue.paymentMethod as PaymentMethod,
      notes: formValue.notes || undefined
    };

    const request = this.isEditMode()
      ? this.withdrawalService.update(this.withdrawalId()!, withdrawalDto)
      : this.withdrawalService.createWithdrawal(withdrawalDto);

    request.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/withdrawals']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error saving withdrawal:', err);
        alert('Failed to save withdrawal: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  cancel() {
    this.router.navigate(['/withdrawals']);
  }
}
