import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeService } from '../services/employee.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-employee-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    TranslateModule
  ],
  templateUrl: './employee-form.component.html',
  styleUrl: './employee-form.component.scss'
})
export class EmployeeFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  employeeForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  employeeId: string | null = null;
  branches = signal<Branch[]>([]);
  salaryTypeOptions = signal<{ label: string; value: string }[]>([]);

  constructor() {
    this.rebuildSalaryTypeOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildSalaryTypeOptions());

    const today = new Date().toISOString().split('T')[0];
    this.employeeForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required]],
      position: ['', [Validators.required]],
      department: ['', [Validators.required]],
      isGlobal: [false],
      branchId: [''],
      salaryType: ['MONTHLY', [Validators.required]],
      salary: [0, [Validators.required, Validators.min(0)]],
      sessionRate: [null],
      hireDate: [today, [Validators.required]],
      notes: ['']
    });

    // Toggle branch requirement based on isGlobal
    this.employeeForm.get('isGlobal')?.valueChanges.subscribe(isGlobal => {
      const branchControl = this.employeeForm.get('branchId');
      if (isGlobal) {
        branchControl?.clearValidators();
        branchControl?.setValue('');
      } else {
        branchControl?.setValidators([Validators.required]);
      }
      branchControl?.updateValueAndValidity();
    });

    // Monthly → require `salary`; session-based → require `sessionRate`.
    this.employeeForm.get('salaryType')?.valueChanges.subscribe((type: string) => {
      const salaryCtrl = this.employeeForm.get('salary');
      const rateCtrl = this.employeeForm.get('sessionRate');
      if (type === 'SESSION_BASED') {
        salaryCtrl?.clearValidators();
        rateCtrl?.setValidators([Validators.required, Validators.min(0)]);
      } else {
        salaryCtrl?.setValidators([Validators.required, Validators.min(0)]);
        rateCtrl?.clearValidators();
      }
      salaryCtrl?.updateValueAndValidity();
      rateCtrl?.updateValueAndValidity();
    });
  }

  private rebuildSalaryTypeOptions() {
    this.salaryTypeOptions.set([
      { label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_MONTHLY'), value: 'MONTHLY' },
      { label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_SESSION'), value: 'SESSION_BASED' },
    ]);
  }

  ngOnInit() {
    this.loadBranches();
    this.employeeId = this.route.snapshot.paramMap.get('id');
    if (this.employeeId) {
      this.isEditMode.set(true);
      this.loadEmployee(this.employeeId);
    }
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        if (branches.length === 1 && !this.isEditMode()) {
          const ctrl = this.employeeForm.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(branches[0].id);
        }
      }
    });
  }

  loadEmployee(id: string) {
    this.loading.set(true);
    this.employeeService.getEmployeeById(id).subscribe({
      next: (employee) => {
        this.employeeForm.patchValue({
          ...employee,
          hireDate: employee.hireDate ? employee.hireDate.split('T')[0] : null
        });
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/employees']);
      }
    });
  }

  onSubmit() {
    if (this.employeeForm.invalid) {
      this.employeeForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const employeeData = {
      ...this.employeeForm.value,
      branchId: this.employeeForm.value.isGlobal ? null : this.employeeForm.value.branchId
    };

    if (this.isEditMode() && this.employeeId) {
      this.employeeService.updateEmployee(this.employeeId, employeeData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('EMPLOYEES.UPDATED'));
          this.router.navigate(['/employees']);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    } else {
      this.employeeService.createEmployee(employeeData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('EMPLOYEES.CREATED'));
          this.router.navigate(['/employees']);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/employees']);
  }

  get firstName() { return this.employeeForm.get('firstName'); }
  get lastName() { return this.employeeForm.get('lastName'); }
  get email() { return this.employeeForm.get('email'); }
  get phone() { return this.employeeForm.get('phone'); }
  get position() { return this.employeeForm.get('position'); }
  get department() { return this.employeeForm.get('department'); }
  get salary() { return this.employeeForm.get('salary'); }
  get salaryType() { return this.employeeForm.get('salaryType'); }
  get sessionRate() { return this.employeeForm.get('sessionRate'); }
  get hireDate() { return this.employeeForm.get('hireDate'); }
  get branchId() { return this.employeeForm.get('branchId'); }
  get isGlobal() { return this.employeeForm.get('isGlobal'); }
}
