import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeService } from '../services/employee.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { todayYmd } from '../../../core/utils/date.util';

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
    MultiSelectModule,
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
  protected authService = inject(AuthService);

  employeeForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  employeeId: string | null = null;
  branches = signal<LookupOption[]>([]);
  salaryTypeOptions = signal<{ label: string; value: string }[]>([]);
  // Teacher mode: set from ?teacher=1 on create, from the record on edit. Drives
  // the title and whether the subject/level pickers show.
  isTeacher = signal(false);
  subjects = signal<LookupOption[]>([]);
  levels = signal<LookupOption[]>([]);
  // Subjects are academy-only across the app (/subjects has a notTeacherGuard,
  // and course-form hides them the same way).
  showSubjects = computed(() => this.isTeacher() && !this.authService.isTeacher());

  constructor() {
    this.rebuildSalaryTypeOptions();
    this.translate.onLangChange.subscribe(() => this.rebuildSalaryTypeOptions());

    const today = todayYmd();
    this.employeeForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.email]],
      phone: ['', [Validators.required]],
      // Required for staff, optional for teachers — see the effect below.
      position: ['', [Validators.required]],
      department: ['', [Validators.required]],
      isGlobal: [false],
      branchId: [''],
      salaryType: ['MONTHLY', [Validators.required]],
      salary: [null, [Validators.required, Validators.min(1)]],
      sessionRate: [null],
      percentageRate: [null],
      hireDate: [today, [Validators.required]],
      // Both optional, teachers only.
      subjectIds: [[] as string[]],
      levelIds: [[] as string[]],
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

    // A teacher's role is already described by the teacher flag plus their
    // subjects and levels, so position/department are optional for them. For
    // non-teaching staff those two fields are the only thing recording what the
    // person actually does, so they stay required.
    //
    // Runs as an effect because isTeacher isn't known at construction: on create
    // it comes from ?teacher=1 in ngOnInit, on edit from the loaded record.
    effect(() => {
      const teacher = this.isTeacher();
      for (const field of ['position', 'department']) {
        const ctrl = this.employeeForm.get(field);
        if (!ctrl) continue;
        if (teacher) ctrl.clearValidators();
        else ctrl.setValidators([Validators.required]);
        // emitEvent: false — this is a validity change, not a value change, and
        // shouldn't look like the user edited the field.
        ctrl.updateValueAndValidity({ emitEvent: false });
      }
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
    } else {
      // Create mode — the Add Teacher button is the only thing that sets this.
      this.isTeacher.set(this.route.snapshot.queryParamMap.get('teacher') === '1');
    }
    this.loadTeacherLookups();
  }

  private loadTeacherLookups() {
    this.lookupService.levels().subscribe({ next: (l) => this.levels.set(l) });
    // Skipped for teacher tenants, which have no subjects feature at all.
    if (!this.authService.isTeacher()) {
      this.lookupService.subjects().subscribe({ next: (s) => this.subjects.set(s) });
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
        this.isTeacher.set(employee.isTeacher === true);
        this.employeeForm.patchValue({
          ...employee,
          hireDate: employee.hireDate ? employee.hireDate.split('T')[0] : null,
          subjectIds: employee.subjectIds ?? [],
          levelIds: employee.levelIds ?? [],
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
    const teacher = this.isTeacher();
    const employeeData = {
      ...this.employeeForm.value,
      branchId: this.employeeForm.value.isGlobal ? null : this.employeeForm.value.branchId,
      isTeacher: teacher,
      // Don't send links a plain employee can't have, and drop subjects for
      // teacher tenants where the picker was never shown.
      subjectIds: this.showSubjects() ? (this.employeeForm.value.subjectIds ?? []) : [],
      levelIds: teacher ? (this.employeeForm.value.levelIds ?? []) : [],
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
