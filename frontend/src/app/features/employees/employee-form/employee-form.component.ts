import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
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
import { CourseService } from '../../courses/services/course.service';
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
    FormsModule,
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
  private courseService = inject(CourseService);

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
      } else if (type === 'UNPAID') {
        // Nothing to require and nothing to keep: an amount left behind from a
        // previous choice would sit in the record looking like pay that is owed.
        salaryCtrl?.setValue(null, { emitEvent: false });
        rateCtrl?.setValue(null, { emitEvent: false });
        pctCtrl?.setValue(null, { emitEvent: false });
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
      // Unpaid teaching only makes sense where the academy is not the teacher:
      // a founder or co-founder who takes classes but draws nothing for them.
      options.push({ label: this.translate.instant('EMPLOYEES.FORM.SALARY_TYPE_UNPAID'), value: 'UNPAID' });
    }
    this.salaryTypeOptions.set(options);
  }

  ngOnInit() {
    this.loadBranches();
    this.employeeId = this.route.snapshot.paramMap.get('id');
    if (this.employeeId) {
      this.isEditMode.set(true);
      this.loadEmployee(this.employeeId);
      this.loadCourseRates(this.employeeId);
    } else {
      // Create mode — the Add Teacher button is the only thing that sets this.
      this.isTeacher.set(this.route.snapshot.queryParamMap.get('teacher') === '1');
    }
    this.loadTeacherLookups();
    this.loadCourseOptions();
  }

  /** Courses a rate can be set against — the whole active catalogue, since a
   *  teacher may be given a course before they are assigned a class on it. */
  private loadCourseOptions(): void {
    this.courseService.getAllCourses().subscribe({
      next: (courses) => this.courseOptions.set(
        courses.filter((c: any) => c.isActive !== false).map((c: any) => ({ id: c.id, name: c.name })),
      ),
      error: () => this.courseOptions.set([]),
    });
  }

  private loadCourseRates(employeeId: string): void {
    this.employeeService.getCoursePercentages(employeeId).subscribe({
      next: (rows) => this.courseRates.set(
        rows.map((r) => ({
          courseId: r.courseId,
          payType: r.payType ?? 'PERCENTAGE',
          percentageRate: r.percentageRate ?? null,
          sessionRate: r.sessionRate ?? null,
        })),
      ),
      error: () => this.courseRates.set([]),
    });
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

  // ── Per-course percentage rates ──────────────────────────────────────────
  // Edited as a table of {course, rate} rows and saved as one set, because that
  // is what the endpoint takes and what the arrangement is: a list of exceptions
  // to the global rate.
  courseRates = signal<Array<{
    courseId: string | null;
    payType: 'PERCENTAGE' | 'SESSION_BASED';
    percentageRate: number | null;
    sessionRate: number | null;
  }>>([]);

  /** How a course can be paid. Recomputed so the labels follow the language. */
  payTypeOptions = computed(() => {
    this.translate.currentLang;
    return [
      { label: this.translate.instant('EMPLOYEES.FORM.COURSE_RATE_PERCENTAGE'), value: 'PERCENTAGE' as const },
      { label: this.translate.instant('EMPLOYEES.FORM.COURSE_RATE_SESSION'), value: 'SESSION_BASED' as const },
    ];
  });
  courseOptions = signal<Array<{ id: string; name: string }>>([]);

  /** Two rows naming the same course would make the payslip a coin toss. */
  duplicateCourseRate = computed(() => {
    const ids = this.courseRates().map((r) => r.courseId).filter(Boolean);
    return new Set(ids).size !== ids.length;
  });

  addCourseRate(): void {
    this.courseRates.update((rows) => [
      ...rows,
      { courseId: null, payType: 'PERCENTAGE', percentageRate: null, sessionRate: null },
    ]);
  }

  /** Switching method clears the other method's number, so a row never carries both. */
  setCourseRateType(index: number, payType: 'PERCENTAGE' | 'SESSION_BASED'): void {
    this.courseRates.update((rows) => rows.map((r, i) =>
      i === index ? { ...r, payType, percentageRate: null, sessionRate: null } : r));
  }

  setCourseSessionRate(index: number, sessionRate: number): void {
    this.courseRates.update((rows) => rows.map((r, i) => (i === index ? { ...r, sessionRate } : r)));
  }

  removeCourseRate(index: number): void {
    this.courseRates.update((rows) => rows.filter((_, i) => i !== index));
  }

  setCourseRateCourse(index: number, courseId: string): void {
    this.courseRates.update((rows) => rows.map((r, i) => (i === index ? { ...r, courseId } : r)));
  }

  setCourseRateValue(index: number, percentageRate: number): void {
    this.courseRates.update((rows) => rows.map((r, i) => (i === index ? { ...r, percentageRate } : r)));
  }

  /** Only complete rows are worth sending; a half-filled one is not an arrangement yet. */
  private completeCourseRates(): Array<{
    courseId: string; payType: 'PERCENTAGE' | 'SESSION_BASED';
    percentageRate?: number | null; sessionRate?: number | null;
  }> {
    return this.courseRates()
      .filter((r) => !!r.courseId && (
        r.payType === 'PERCENTAGE'
          ? r.percentageRate !== null && r.percentageRate >= 0
          : r.sessionRate !== null && r.sessionRate > 0))
      .map((r) => ({
        courseId: r.courseId as string,
        payType: r.payType,
        percentageRate: r.payType === 'PERCENTAGE' ? r.percentageRate : null,
        sessionRate: r.payType === 'SESSION_BASED' ? r.sessionRate : null,
      }));
  }

  private saveCourseRates(employeeId: string, done: () => void): void {
    // Only a percentage teacher has rates; switching away from PERCENTAGE clears
    // them, so a stale 90% cannot come back if they are switched to it again.
    const rates = this.completeCourseRates();
    this.employeeService.setCoursePercentages(employeeId, rates).subscribe({
      next: () => done(),
      // The employee itself saved — say so, and let them retry the rates rather
      // than losing the whole edit.
      error: () => done(),
    });
  }

  onSubmit() {
    if (this.employeeForm.invalid) {
      this.employeeForm.markAllAsTouched();
      return;
    }
    if (this.duplicateCourseRate()) return;

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
          this.saveCourseRates(this.employeeId!, () => {
            this.notificationService.success(this.translate.instant('EMPLOYEES.UPDATED'));
            this.router.navigate(['/employees']);
          });
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    } else {
      this.employeeService.createEmployee(employeeData).subscribe({
        next: (created) => {
          this.saveCourseRates(created.id, () => {
            this.notificationService.success(this.translate.instant('EMPLOYEES.CREATED'));
            this.router.navigate(['/employees']);
          });
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
