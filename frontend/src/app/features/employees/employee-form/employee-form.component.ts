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
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { AuthService } from '../../../core/services/auth.service';

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
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);
  private authService = inject(AuthService);

  employeeForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  employeeId: string | null = null;
  branches = signal<LookupOption[]>([]);
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
      salary: [null, [Validators.required, Validators.min(1)]],
      sessionRate: [null],
      percentageRate: [null],
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

    // Require the field that matches the chosen salary type:
    //   MONTHLY → salary, SESSION_BASED → sessionRate, PERCENTAGE → percentageRate.
    this.employeeForm.get('salaryType')?.valueChanges.subscribe((type: string) => {
      const salaryCtrl = this.employeeForm.get('salary');
      const rateCtrl = this.employeeForm.get('sessionRate');
      const pctCtrl = this.employeeForm.get('percentageRate');
      salaryCtrl?.clearValidators();
      rateCtrl?.clearValidators();
      pctCtrl?.clearValidators();
      if (type === 'SESSION_BASED') {
        rateCtrl?.setValidators([Validators.required, Validators.min(1)]);
      } else if (type === 'PERCENTAGE') {
        // A percentage of paid revenue: 0 < rate <= 100.
        pctCtrl?.setValidators([Validators.required, Validators.min(0.01), Validators.max(100)]);
      } else {
        salaryCtrl?.setValidators([Validators.required, Validators.min(1)]);
      }
      salaryCtrl?.updateValueAndValidity();
      rateCtrl?.updateValueAndValidity();
      pctCtrl?.updateValueAndValidity();
    });
  }

  private rebuildSalaryTypeOptions() {
    const options = [
      { label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_MONTHLY'), value: 'MONTHLY' },
      { label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_SESSION'), value: 'SESSION_BASED' },
    ];
    // Percentage-of-revenue pay is an academy-only model (a teacher tenant is a
    // single person, so there's no separate teacher to revenue-share with).
    if (!this.authService.isTeacher()) {
      options.push({ label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_PERCENTAGE'), value: 'PERCENTAGE' });
    }
    this.salaryTypeOptions.set(options);
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
    this.lookupService.branches().subscribe({
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
  get percentageRate() { return this.employeeForm.get('percentageRate'); }
  get hireDate() { return this.employeeForm.get('hireDate'); }
  get branchId() { return this.employeeForm.get('branchId'); }
  get isGlobal() { return this.employeeForm.get('isGlobal'); }
}
