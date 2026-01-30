import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ExpenseService } from '../services/expense.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Expense } from '@shared/interfaces/expense.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { ExpenseType, ExpenseCategory, DistributionMethod } from '@shared/enums/expense-type.enum';

@Component({
  selector: 'app-expense-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule
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

  expenseForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  expenseId: string | null = null;
  branches = signal<Branch[]>([]);

  expenseTypes = Object.values(ExpenseType);
  expenseCategories = Object.values(ExpenseCategory);
  distributionMethods = Object.values(DistributionMethod);

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.expenseForm = this.fb.group({
      branchId: [''],
      type: ['', [Validators.required]],
      category: ['', [Validators.required]],
      amount: [0, [Validators.required, Validators.min(0)]],
      description: ['', [Validators.required]],
      date: [today, [Validators.required]],
      isRecurring: [false],
      recurringDay: [1],
      distributionMethod: ['EQUAL'],
      vendor: [''],
      invoiceNumber: [''],
      notes: ['']
    });

    // Watch for type changes to adjust branch requirement
    this.expenseForm.get('type')?.valueChanges.subscribe(type => {
      const branchControl = this.expenseForm.get('branchId');
      const distributionControl = this.expenseForm.get('distributionMethod');

      if (type === 'SHARED') {
        // Shared expenses don't need a branch
        branchControl?.clearValidators();
        branchControl?.setValue('');
        distributionControl?.setValidators([Validators.required]);
      } else {
        // Fixed and Variable expenses need a branch
        branchControl?.setValidators([Validators.required]);
        distributionControl?.clearValidators();
        distributionControl?.setValue('EQUAL');
      }
      branchControl?.updateValueAndValidity();
      distributionControl?.updateValueAndValidity();
    });

    // Watch for isRecurring changes
    this.expenseForm.get('isRecurring')?.valueChanges.subscribe(isRecurring => {
      const recurringDayControl = this.expenseForm.get('recurringDay');
      if (isRecurring) {
        recurringDayControl?.setValidators([Validators.required, Validators.min(1), Validators.max(31)]);
      } else {
        recurringDayControl?.clearValidators();
      }
      recurringDayControl?.updateValueAndValidity();
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
      next: (branches) => this.branches.set(branches)
    });
  }

  loadExpense(id: string) {
    this.loading.set(true);
    this.expenseService.getExpenseById(id).subscribe({
      next: (expense) => {
        this.expenseForm.patchValue({
          ...expense,
          branchId: expense.branchId || '',
          date: expense.date.split('T')[0]
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load expense');
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
    const expenseData = {
      ...this.expenseForm.value,
      branchId: this.expenseForm.value.branchId || null
    };

    if (this.isEditMode() && this.expenseId) {
      this.expenseService.updateExpense(this.expenseId, expenseData).subscribe({
        next: () => {
          this.notificationService.success('Expense updated successfully');
          this.router.navigate(['/expenses']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update expense');
          console.error('Update error:', error);
        }
      });
    } else {
      this.expenseService.createExpense(expenseData).subscribe({
        next: () => {
          this.notificationService.success('Expense created successfully');
          this.router.navigate(['/expenses']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create expense');
          console.error('Create error:', error);
        }
      });
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
  get recurringDay() { return this.expenseForm.get('recurringDay'); }
  get distributionMethod() { return this.expenseForm.get('distributionMethod'); }
}
