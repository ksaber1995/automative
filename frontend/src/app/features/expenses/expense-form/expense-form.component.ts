import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { switchMap } from 'rxjs';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { CheckboxModule } from 'primeng/checkbox';
import { TooltipModule } from 'primeng/tooltip';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { ExpenseType, ExpenseCategory, DistributionMethod } from '@shared/enums/expense-type.enum';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-expense-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    CheckboxModule,
    TooltipModule,
    TranslateModule
  ],
  templateUrl: './expense-form.component.html',
  styleUrl: './expense-form.component.scss'
})
export class ExpenseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private expenseService = inject(ExpenseService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  expenseForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  expenseId: string | null = null;
  branches = signal<Branch[]>([]);

  expenseTypes = Object.values(ExpenseType);
  expenseCategories = Object.values(ExpenseCategory);
  distributionMethods = Object.values(DistributionMethod);

  // Options arrays for PrimeNG selects — labels resolve through the i18n keys so the
  // dropdown reflects the active language. Rebuilt on language change.
  expenseTypeOptions: { label: string; value: string }[] = [];
  expenseCategoryOptions: { label: string; value: string }[] = [];
  distributionMethodOptions: { label: string; value: string }[] = [];
  branchOptions = signal<{ label: string, value: string }[]>([]);

  isCapital = signal(false);
  payImmediately = signal(false);
  paymentDate: Date = new Date();

  private rebuildLocalizedOptions() {
    this.expenseTypeOptions = Object.values(ExpenseType).map((type) => ({
      label: this.translate.instant('EXPENSES.LIST.' + type),
      value: type,
    }));
    this.expenseCategoryOptions = Object.values(ExpenseCategory).map((cat) => ({
      label: this.translate.instant('EXPENSES.CATEGORY_VALUES.' + cat),
      value: cat,
    }));
    this.distributionMethodOptions = Object.values(DistributionMethod).map((method) => ({
      label: this.translate.instant('EXPENSES.DIST.' + method),
      value: method,
    }));
  }

  constructor() {
    this.rebuildLocalizedOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildLocalizedOptions());

    const today = new Date();
    this.expenseForm = this.fb.group({
      branchId: [''],
      type: ['', [Validators.required]],
      category: ['', [Validators.required]],
      amount: [0, [Validators.required, Validators.min(0)]],
      description: ['', [Validators.required]],
      date: [today, [Validators.required]],
      isRecurring: [false],
      distributionMethod: ['PROPORTIONAL'],
      vendor: [''],
      invoiceNumber: [''],
      notes: [''],
      assetName: [''],
      amortizationMonths: [null]
    });

    // Watch for type changes to adjust branch requirement
    this.expenseForm.get('type')?.valueChanges.subscribe(type => {
      const branchControl = this.expenseForm.get('branchId');
      const distributionControl = this.expenseForm.get('distributionMethod');
      const amortizationControl = this.expenseForm.get('amortizationMonths');

      this.isCapital.set(type === 'CAPITAL');

      if (type === 'SHARED') {
        branchControl?.clearValidators();
        branchControl?.setValue('');
        distributionControl?.setValidators([Validators.required]);
        amortizationControl?.clearValidators();
      } else if (type === 'CAPITAL') {
        branchControl?.setValidators([Validators.required]);
        distributionControl?.clearValidators();
        distributionControl?.setValue('PROPORTIONAL');
        amortizationControl?.setValidators([Validators.required, Validators.min(1)]);
      } else {
        branchControl?.setValidators([Validators.required]);
        distributionControl?.clearValidators();
        distributionControl?.setValue('PROPORTIONAL');
        amortizationControl?.clearValidators();
      }
      branchControl?.updateValueAndValidity();
      distributionControl?.updateValueAndValidity();
      amortizationControl?.updateValueAndValidity();
    });

  
  }

  ngOnInit() {
    this.loadBranches();

    this.expenseId = this.route.snapshot.paramMap.get('id');
    if (this.expenseId) {
      this.isEditMode.set(true);
      this.loadExpense(this.expenseId);
    }
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        this.branchOptions.set(branches.map(branch => ({ label: branch.name, value: branch.id })));
      }
    });
  }

  loadExpense(id: string) {
    this.loading.set(true);
    this.expenseService.getExpenseById(id).subscribe({
      next: (expense) => {
        this.expenseForm.patchValue({
          ...expense,
          branchId: expense.branchId || '',
          date: new Date(expense.date),
        });
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/expenses']);
      }
    });
  }

  onSubmit() {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.expenseForm.value;
    const expenseData = {
      ...formValue,
      branchId: formValue.branchId || null,
      date: formValue.date instanceof Date ? formValue.date.toISOString().split('T')[0] : formValue.date,
      assetName: formValue.type === 'CAPITAL' ? (formValue.assetName || null) : null,
      amortizationMonths: formValue.type === 'CAPITAL' ? (formValue.amortizationMonths || null) : null,
    };

    if (this.isEditMode() && this.expenseId) {
      this.expenseService.updateExpense(this.expenseId, expenseData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('EXPENSES.UPDATED'));
          this.router.navigate(['/expenses']);
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Update error:', error);
        }
      });
    } else {
      const create$ = this.expenseService.createExpense(expenseData);

      if (this.payImmediately()) {
        const payDate = this.paymentDate instanceof Date
          ? this.paymentDate.toISOString().split('T')[0]
          : this.paymentDate;

        create$.pipe(
          switchMap(expense =>
            this.expenseService.recordPayment({
              expenseId: expense.id,
              type: expense.type,
              category: expense.category,
              amount: expense.amount,
              date: payDate,
              branchId: expense.branchId,
              vendor: expense.vendor || undefined,
              invoiceNumber: expense.invoiceNumber || undefined,
              notes: expense.notes || undefined,
            })
          )
        ).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('EXPENSES.CREATED_AND_PAID'));
            this.router.navigate(['/expenses']);
          },
          error: (error) => {
            // Interceptor toasted the translated error.
            this.loading.set(false);
            console.error('Payment error:', error);
          }
        });
      } else {
        create$.subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('EXPENSES.CREATED'));
            this.router.navigate(['/expenses']);
          },
          error: (error) => {
            // Interceptor toasted the translated error.
            this.loading.set(false);
            console.error('Create error:', error);
          }
        });
      }
    }
  }

  cancel() {
    this.router.navigate(['/expenses']);
  }

  get type() { return this.expenseForm.get('type'); }
  get category() { return this.expenseForm.get('category'); }
  get branchId() { return this.expenseForm.get('branchId'); }
  get amount() { return this.expenseForm.get('amount'); }
  get description() { return this.expenseForm.get('description'); }
  get date() { return this.expenseForm.get('date'); }
  get isRecurring() { return this.expenseForm.get('isRecurring'); }
  get distributionMethod() { return this.expenseForm.get('distributionMethod'); }
  get assetName() { return this.expenseForm.get('assetName'); }
  get amortizationMonths() { return this.expenseForm.get('amortizationMonths'); }
}
