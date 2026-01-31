import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DebtService, CreatePaymentDto } from '../../../core/services/debt.service';
import { Debt } from '@shared/interfaces/debt.interface';
import { PaymentMethod } from '@shared/interfaces/withdrawal.interface';

@Component({
  selector: 'app-debt-payment',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputNumberModule,
    InputTextModule,
    ButtonModule
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      @if (debt()) {
        <p-card>
          <ng-template pTemplate="header">
            <div class="p-4">
              <h2 class="text-2xl font-bold">Make Payment - {{ debt()!.creditorName }}</h2>
              <div class="mt-2 text-sm text-gray-600">
                <div>Current Balance: <span class="font-bold text-red-600">\${{ debt()!.currentBalance.toLocaleString() }}</span></div>
                <div>Interest Rate: {{ debt()!.interestRate }}%</div>
              </div>
            </div>
          </ng-template>

          <form [formGroup]="paymentForm" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

              <div class="field">
                <label for="paymentDate" class="block text-sm font-medium mb-2">
                  Payment Date *
                </label>
                <input
                  type="date"
                  id="paymentDate"
                  formControlName="paymentDate"
                  class="w-full p-2 border rounded" />
              </div>

              <div class="field">
                <label for="totalAmount" class="block text-sm font-medium mb-2">
                  Payment Amount *
                </label>
                <p-inputNumber
                  inputId="totalAmount"
                  formControlName="totalAmount"
                  mode="currency"
                  currency="USD"
                  [minFractionDigits]="2"
                  [min]="0.01"
                  class="w-full">
                </p-inputNumber>
                <small class="text-gray-500">Maximum: \${{ debt()!.currentBalance.toLocaleString() }}</small>
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
              </div>

              <div class="field">
                <label for="referenceNumber" class="block text-sm font-medium mb-2">
                  Reference Number
                </label>
                <input
                  pInputText
                  id="referenceNumber"
                  formControlName="referenceNumber"
                  class="w-full"
                  placeholder="Transaction reference" />
              </div>

              <div class="field">
                <label for="lateFee" class="block text-sm font-medium mb-2">
                  Late Fee
                </label>
                <p-inputNumber
                  inputId="lateFee"
                  formControlName="lateFee"
                  mode="currency"
                  currency="USD"
                  [minFractionDigits]="2"
                  [min]="0"
                  class="w-full">
                </p-inputNumber>
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
                  placeholder="Payment notes...">
                </textarea>
              </div>
            </div>

            <div class="bg-blue-50 p-4 rounded-lg mt-4">
              <h3 class="font-semibold mb-2">Payment Breakdown (Estimated)</h3>
              <div class="text-sm space-y-1">
                <div class="flex justify-between">
                  <span>Total Payment:</span>
                  <span class="font-semibold">\${{ paymentForm.get('totalAmount')?.value || 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span>Late Fee:</span>
                  <span>\${{ paymentForm.get('lateFee')?.value || 0 }}</span>
                </div>
                <div class="text-xs text-gray-600 mt-2">
                  * Interest and principal amounts will be calculated automatically based on the payment date
                </div>
              </div>
            </div>

            <div class="flex gap-3 mt-6">
              <p-button
                type="submit"
                label="Submit Payment"
                icon="pi pi-check"
                [disabled]="paymentForm.invalid || submitting()">
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
      }
    </div>
  `,
  styles: [`
    :host ::ng-deep {
      .p-inputnumber,
      .p-calendar,
      .p-dropdown {
        width: 100%;
      }
    }
  `]
})
export class DebtPaymentComponent implements OnInit {
  private fb = inject(FormBuilder);
  private debtService = inject(DebtService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  paymentForm!: FormGroup;
  debt = signal<Debt | null>(null);
  submitting = signal(false);

  paymentMethodOptions = [
    { label: 'Cash', value: 'CASH' },
    { label: 'Check', value: 'CHECK' },
    { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
    { label: 'Auto Debit', value: 'AUTO_DEBIT' },
    { label: 'Other', value: 'OTHER' }
  ];

  ngOnInit() {
    this.initForm();

    const debtId = this.route.snapshot.params['id'];
    if (debtId) {
      this.loadDebt(debtId);
    }
  }

  initForm() {
    const today = new Date().toISOString().split('T')[0];
    this.paymentForm = this.fb.group({
      paymentDate: [today, Validators.required],
      totalAmount: [null, [Validators.required, Validators.min(0.01)]],
      paymentMethod: ['', Validators.required],
      referenceNumber: [''],
      lateFee: [0, Validators.min(0)],
      notes: ['']
    });
  }

  loadDebt(id: string) {
    this.debtService.findOne(id, true).subscribe({
      next: (debt) => {
        this.debt.set(debt);
      },
      error: (err) => {
        console.error('Error loading debt:', err);
        alert('Failed to load debt');
        this.cancel();
      }
    });
  }

  onSubmit() {
    if (this.paymentForm.invalid || !this.debt()) {
      Object.keys(this.paymentForm.controls).forEach(key => {
        this.paymentForm.get(key)?.markAsTouched();
      });
      return;
    }

    const formValue = this.paymentForm.value;

    // Validate payment amount doesn't exceed balance
    if (formValue.totalAmount > this.debt()!.currentBalance) {
      alert('Payment amount cannot exceed current balance');
      return;
    }

    this.submitting.set(true);

    const paymentDto: CreatePaymentDto = {
      paymentDate: formValue.paymentDate,
      totalAmount: formValue.totalAmount,
      paymentMethod: formValue.paymentMethod as PaymentMethod,
      referenceNumber: formValue.referenceNumber || undefined,
      lateFee: formValue.lateFee || undefined,
      notes: formValue.notes || undefined
    };

    this.debtService.createPayment(this.debt()!.id, paymentDto).subscribe({
      next: () => {
        this.submitting.set(false);
        alert('Payment submitted successfully');
        this.router.navigate(['/debts', this.debt()!.id]);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error submitting payment:', err);
        alert('Failed to submit payment: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  cancel() {
    if (this.debt()) {
      this.router.navigate(['/debts', this.debt()!.id]);
    } else {
      this.router.navigate(['/debts']);
    }
  }
}
