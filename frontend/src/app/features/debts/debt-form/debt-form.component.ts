import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { DebtService, CreateDebtDto } from '../../../core/services/debt.service';
import { BranchService } from '../../branches/services/branch.service';
import { DebtType, CompoundingFrequency, PaymentSchedule } from '@shared/interfaces/debt.interface';

@Component({
  selector: 'app-debt-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    InputTextModule,
    InputNumberModule,
    ButtonModule,
    SelectModule,
    DatePickerModule,
    TextareaModule
  ],
  template: `
    <div class="container mx-auto p-4 max-w-4xl">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-4">
            <h2 class="text-2xl font-bold">{{ isEditMode() ? 'Edit' : 'Create' }} Debt/Loan</h2>
          </div>
        </ng-template>

        <form [formGroup]="debtForm" (ngSubmit)="onSubmit()">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div class="field md:col-span-2">
              <label for="debtType" class="block text-sm font-medium mb-2">
                Debt Type *
              </label>
              <p-select
                id="debtType"
                formControlName="debtType"
                [options]="debtTypeOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Select debt type"
                [style]="{ width: '100%' }">
              </p-select>
            </div>

            <div class="field">
              <label for="creditorName" class="block text-sm font-medium mb-2">
                Creditor Name *
              </label>
              <input
                pInputText
                id="creditorName"
                formControlName="creditorName"
                class="w-full"
                placeholder="Enter creditor name" />
            </div>

            <div class="field">
              <label for="creditorEmail" class="block text-sm font-medium mb-2">
                Creditor Email
              </label>
              <input
                pInputText
                id="creditorEmail"
                formControlName="creditorEmail"
                type="email"
                class="w-full"
                placeholder="email@example.com" />
            </div>

            <div class="field">
              <label for="creditorPhone" class="block text-sm font-medium mb-2">
                Creditor Phone
              </label>
              <input
                pInputText
                id="creditorPhone"
                formControlName="creditorPhone"
                class="w-full"
                placeholder="+1 (555) 000-0000" />
            </div>

            <div class="field">
              <label for="principalAmount" class="block text-sm font-medium mb-2">
                Principal Amount *
              </label>
              <p-inputNumber
                inputId="principalAmount"
                formControlName="principalAmount"
                mode="currency"
                currency="USD"
                [minFractionDigits]="2"
                [min]="0.01"
                class="w-full">
              </p-inputNumber>
            </div>

            <div class="field">
              <label for="interestRate" class="block text-sm font-medium mb-2">
                Interest Rate (%) *
              </label>
              <p-inputNumber
                inputId="interestRate"
                formControlName="interestRate"
                [min]="0"
                [max]="100"
                [minFractionDigits]="2"
                suffix="%"
                class="w-full">
              </p-inputNumber>
            </div>

            <div class="field">
              <label for="compoundingFrequency" class="block text-sm font-medium mb-2">
                Compounding Frequency *
              </label>
              <p-select
                id="compoundingFrequency"
                formControlName="compoundingFrequency"
                [options]="compoundingOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Select frequency"
                [style]="{ width: '100%' }">
              </p-select>
            </div>

            <div class="field">
              <label for="takenDate" class="block text-sm font-medium mb-2">
                Taken Date *
              </label>
              <p-datepicker
                id="takenDate"
                formControlName="takenDate"
                [showIcon]="true"
                dateFormat="yy-mm-dd"
                placeholder="Select date"
                [style]="{ width: '100%' }">
              </p-datepicker>
            </div>

            <div class="field">
              <label for="dueDate" class="block text-sm font-medium mb-2">
                Due Date *
              </label>
              <p-datepicker
                id="dueDate"
                formControlName="dueDate"
                [showIcon]="true"
                dateFormat="yy-mm-dd"
                placeholder="Select date"
                [style]="{ width: '100%' }">
              </p-datepicker>
            </div>

            <div class="field">
              <label for="paymentSchedule" class="block text-sm font-medium mb-2">
                Payment Schedule *
              </label>
              <p-select
                id="paymentSchedule"
                formControlName="paymentSchedule"
                [options]="paymentScheduleOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Select schedule"
                [style]="{ width: '100%' }">
              </p-select>
            </div>

            <div class="field">
              <label for="branchId" class="block text-sm font-medium mb-2">
                Branch (Optional)
              </label>
              <p-select
                id="branchId"
                formControlName="branchId"
                [options]="branches()"
                optionLabel="label"
                optionValue="value"
                placeholder="Select branch"
                [style]="{ width: '100%' }">
              </p-select>
            </div>

            <div class="field md:col-span-2">
              <label for="purpose" class="block text-sm font-medium mb-2">
                Purpose
              </label>
              <input
                pInputText
                id="purpose"
                formControlName="purpose"
                class="w-full"
                placeholder="Purpose of the loan" />
            </div>

            <div class="field md:col-span-2">
              <label for="collateral" class="block text-sm font-medium mb-2">
                Collateral
              </label>
              <input
                pInputText
                id="collateral"
                formControlName="collateral"
                class="w-full"
                placeholder="Collateral provided" />
            </div>

            <div class="field md:col-span-2">
              <label for="notes" class="block text-sm font-medium mb-2">
                Notes
              </label>
              <textarea
                pTextarea
                id="notes"
                formControlName="notes"
                rows="3"
                class="w-full"
                placeholder="Additional notes...">
              </textarea>
            </div>
          </div>

          <div class="flex gap-3 mt-6">
            <p-button
              type="submit"
              label="{{ isEditMode() ? 'Update' : 'Create' }} Debt"
              icon="pi pi-check"
              [disabled]="debtForm.invalid || submitting()">
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
      .p-inputnumber,
      .p-datepicker,
      .p-select {
        width: 100%;
      }
    }
  `]
})
export class DebtFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private debtService = inject(DebtService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  debtForm!: FormGroup;
  isEditMode = signal(false);
  debtId = signal<string | null>(null);
  submitting = signal(false);
  branches = signal<{ label: string; value: string }[]>([]);

  debtTypeOptions = [
    { label: 'Bank Loan', value: 'BANK_LOAN' },
    { label: 'Line of Credit', value: 'LINE_OF_CREDIT' },
    { label: 'Investor Loan', value: 'INVESTOR_LOAN' },
    { label: 'Vendor Credit', value: 'VENDOR_CREDIT' },
    { label: 'Other', value: 'OTHER' }
  ];

  compoundingOptions = [
    { label: 'Daily', value: 'DAILY' },
    { label: 'Monthly', value: 'MONTHLY' },
    { label: 'Quarterly', value: 'QUARTERLY' },
    { label: 'Annually', value: 'ANNUALLY' }
  ];

  paymentScheduleOptions = [
    { label: 'Weekly', value: 'WEEKLY' },
    { label: 'Bi-Weekly', value: 'BIWEEKLY' },
    { label: 'Monthly', value: 'MONTHLY' },
    { label: 'Quarterly', value: 'QUARTERLY' },
    { label: 'Annually', value: 'ANNUALLY' },
    { label: 'Lump Sum', value: 'LUMP_SUM' }
  ];

  ngOnInit() {
    this.initForm();
    this.loadBranches();

    const id = this.route.snapshot.params['id'];
    if (id) {
      this.isEditMode.set(true);
      this.debtId.set(id);
      this.loadDebt(id);
    }
  }

  initForm() {
    const today = new Date();
    this.debtForm = this.fb.group({
      debtType: ['', Validators.required],
      creditorName: ['', Validators.required],
      creditorEmail: ['', Validators.email],
      creditorPhone: [''],
      principalAmount: [null, [Validators.required, Validators.min(0.01)]],
      interestRate: [null, [Validators.required, Validators.min(0)]],
      compoundingFrequency: ['MONTHLY', Validators.required],
      takenDate: [today, Validators.required],
      dueDate: [null, Validators.required],
      paymentSchedule: ['', Validators.required],
      branchId: [''],
      purpose: [''],
      collateral: [''],
      notes: ['']
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches.map(b => ({
          label: `${b.name} (${b.code})`,
          value: b.id
        })));
      },
      error: (err) => console.error('Error loading branches:', err)
    });
  }

  loadDebt(id: string) {
    this.debtService.findOne(id).subscribe({
      next: (debt) => {
        this.debtForm.patchValue({
          debtType: debt.debtType,
          creditorName: debt.creditorName,
          creditorEmail: debt.creditorContact || '',
          creditorPhone: '',
          principalAmount: debt.principalAmount,
          interestRate: debt.interestRate,
          compoundingFrequency: debt.compoundingFrequency,
          takenDate: new Date(debt.takenDate),
          dueDate: new Date(debt.dueDate),
          paymentSchedule: debt.paymentSchedule,
          branchId: debt.branchId || '',
          purpose: '',
          collateral: debt.collateral || '',
          notes: debt.notes || ''
        });
        // Disable principal amount in edit mode
        if (this.isEditMode()) {
          this.debtForm.get('principalAmount')?.disable();
        }
      },
      error: (err) => {
        console.error('Error loading debt:', err);
        alert('Failed to load debt');
        this.cancel();
      }
    });
  }

  onSubmit() {
    if (this.debtForm.invalid) {
      Object.keys(this.debtForm.controls).forEach(key => {
        this.debtForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.debtForm.getRawValue();

    const debtDto: any = {
      debtType: formValue.debtType as DebtType,
      creditorName: formValue.creditorName,
      creditorContact: formValue.creditorEmail || undefined,
      principalAmount: formValue.principalAmount,
      interestRate: formValue.interestRate,
      compoundingFrequency: formValue.compoundingFrequency as CompoundingFrequency,
      takenDate: formValue.takenDate instanceof Date ? formValue.takenDate.toISOString().split('T')[0] : formValue.takenDate,
      dueDate: formValue.dueDate instanceof Date ? formValue.dueDate.toISOString().split('T')[0] : formValue.dueDate,
      paymentSchedule: formValue.paymentSchedule as PaymentSchedule,
      branchId: formValue.branchId || undefined,
      collateral: formValue.collateral || undefined,
      notes: formValue.notes || undefined
    };

    const request = this.isEditMode()
      ? this.debtService.update(this.debtId()!, debtDto)
      : this.debtService.create(debtDto);

    request.subscribe({
      next: () => {
        this.submitting.set(false);
        this.router.navigate(['/debts']);
      },
      error: (err) => {
        this.submitting.set(false);
        console.error('Error saving debt:', err);
        alert('Failed to save debt: ' + (err.error?.message || 'Unknown error'));
      }
    });
  }

  cancel() {
    this.router.navigate(['/debts']);
  }
}
