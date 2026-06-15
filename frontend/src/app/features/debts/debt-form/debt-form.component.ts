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
import { BranchStateService } from '../../../core/services/branch-state.service';
import { DebtType, CompoundingFrequency, PaymentSchedule } from '@shared/interfaces/debt.interface';
import { NotificationService } from '../../../core/services/notification.service';

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
  templateUrl: './debt-form.component.html',
  styleUrl: './debt-form.component.scss'})
export class DebtFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private debtService = inject(DebtService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  protected branchState = inject(BranchStateService);

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
        if (branches.length === 1 && !this.isEditMode()) {
          const ctrl = this.debtForm.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(branches[0].id);
        }
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
        this.notificationService.error('Failed to load debt');
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
        this.notificationService.error(err.error?.message || 'Failed to save debt');
      }
    });
  }

  cancel() {
    this.router.navigate(['/debts']);
  }
}
