import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { CheckboxModule } from 'primeng/checkbox';
import { ClassService, TeacherAvailabilityConflict } from '../services/class.service';
import { debounceTime } from 'rxjs/operators';
import { EmployeeService } from '../../employees/services/employee.service';
import { CourseService } from '../services/course.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-class-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TextareaModule,
    CheckboxModule,
    TranslateModule
  ],
  templateUrl: './class-form.component.html',
  styleUrl: './class-form.component.scss'
})
export class ClassFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private classService = inject(ClassService);
  private employeeService = inject(EmployeeService);
  private courseService = inject(CourseService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  classForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  classId: string | null = null;
  // Where the user opened the edit page from ('class' | 'course'), so Cancel/Update return there.
  fromOrigin: string | null = null;
  instructors = signal<any[]>([]);
  branches = signal<LookupOption[]>([]);
  // All active courses fetched once; the dropdown shown to the user is `filteredCourses`,
  // which narrows them down to those belonging to the currently-selected branch.
  allCourses = signal<Array<{ id: string; name: string; branchId: string | null }>>([]);
  courses = signal<any[]>([]);
  courseName = signal<string>('');
  branchName = signal<string>('');
  courseDefaultInstructor = signal<string | null>(null);
  isGlobalCreate = signal(false);
  availabilityConflicts = signal<TeacherAvailabilityConflict[]>([]);
  checkingAvailability = signal(false);

  // Per-day times. When sameTime is true the two single time inputs apply to every
  // selected day; when false each selected day carries its own start/end in perDay.
  sameTime = signal(true);
  perDay: { [day: string]: { startTime: string; endTime: string } } = {};

  daysOfWeek = [
    { label: 'CLASSES.FORM.DAY_SUNDAY', value: 'SUNDAY' },
    { label: 'CLASSES.FORM.DAY_MONDAY', value: 'MONDAY' },
    { label: 'CLASSES.FORM.DAY_TUESDAY', value: 'TUESDAY' },
    { label: 'CLASSES.FORM.DAY_WEDNESDAY', value: 'WEDNESDAY' },
    { label: 'CLASSES.FORM.DAY_THURSDAY', value: 'THURSDAY' },
    { label: 'CLASSES.FORM.DAY_FRIDAY', value: 'FRIDAY' },
    { label: 'CLASSES.FORM.DAY_SATURDAY', value: 'SATURDAY' }
  ];

  get classTypes() {
    return [
      { label: this.translate.instant('CLASSES.FORM.TYPE_OFFLINE'), value: 'OFFLINE' },
      { label: this.translate.instant('CLASSES.FORM.TYPE_ONLINE'), value: 'ONLINE' }
    ];
  }

  constructor() {
    this.classForm = this.fb.group({
      courseId: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      // Branch is no longer stored on the class — it is derived from the course.
      // The form control acts purely as a UI filter for the course dropdown in global-create mode.
      branchId: [''],
      instructorId: [''],
      type: ['OFFLINE', [Validators.required]],
      daysOfWeek: [[]],
      startTime: [''],
      endTime: [''],
      startDate: ['', [Validators.required]],
      endDate: [''],
      numberOfSessions: [null],
      maxStudents: [null],
      notes: ['']
    });
  }

  /** Courses shown to the user in the dropdown — narrowed by the chosen branch. */
  filteredCourses() {
    const branchId = this.classForm?.get('branchId')?.value;
    const all = this.allCourses();
    if (!branchId) return [];
    return all
      .filter(c => c.branchId === branchId)
      .map(c => ({ label: c.name, value: c.id }));
  }

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('courseId');
    this.classId = this.route.snapshot.paramMap.get('id');
    this.fromOrigin = this.route.snapshot.queryParamMap.get('from');

    // Check if creating from global classes list (no courseId in route)
    if (!this.courseId && !this.classId) {
      this.isGlobalCreate.set(true);
      this.classForm.get('courseId')?.setValidators([Validators.required]);
      this.classForm.get('courseId')?.updateValueAndValidity();
      // Branch is the entry-point filter in global-create mode.
      this.classForm.get('branchId')?.setValidators([Validators.required]);
      this.classForm.get('branchId')?.updateValueAndValidity();
      this.loadCourses();
    } else if (this.courseId) {
      this.loadCourse(this.courseId);
    }

    this.loadInstructors();
    this.loadBranches();

    // When the branch changes in global-create mode, clear the picked course
    // (it may not belong to the new branch).
    this.classForm.get('branchId')?.valueChanges.subscribe(() => {
      if (this.isGlobalCreate() && !this.isEditMode()) {
        this.classForm.patchValue({ courseId: '' }, { emitEvent: false });
      }
    });

    if (this.classId) {
      this.isEditMode.set(true);
      this.loadClass(this.classId);
    }

    // Watch for changes to numberOfSessions to update endDate validation
    this.classForm.get('numberOfSessions')?.valueChanges.subscribe(sessions => {
      if (sessions && sessions > 0) {
        this.classForm.get('endDate')?.clearValidators();
      } else {
        this.classForm.get('endDate')?.setValidators([Validators.required]);
      }
      this.classForm.get('endDate')?.updateValueAndValidity();
    });

    // Watch for course selection changes when in global create mode
    if (this.isGlobalCreate()) {
      this.classForm.get('courseId')?.valueChanges.subscribe(courseId => {
        if (courseId) {
          this.loadCourse(courseId);
        }
      });
    }

    this.classForm.valueChanges
      .pipe(debounceTime(400))
      .subscribe(() => this.checkAvailability());
  }

  private checkAvailability() {
    const v = this.classForm.value;
    const instructorId = v.instructorId;
    const startTime = v.startTime;
    const endTime = v.endTime;
    const days: string[] = v.daysOfWeek || [];

    // Teacher companies have no instructor field — every class implicitly
    // belongs to the owner-teacher, so the overlap check runs without one.
    const isTeacherCompany = this.authService.isTeacher();
    if ((!instructorId && !isTeacherCompany) || !startTime || !endTime || days.length === 0 || !v.startDate) {
      this.availabilityConflicts.set([]);
      return;
    }

    const startDate = this.toLocalYmd(v.startDate);

    let endDate: string;
    if (v.numberOfSessions && v.numberOfSessions > 0) {
      const calc = this.calculateEndDate(
        v.startDate instanceof Date ? v.startDate : new Date(v.startDate),
        days,
        v.numberOfSessions
      );
      endDate = this.toLocalYmd(calc);
    } else if (v.endDate) {
      endDate = this.toLocalYmd(v.endDate);
    } else {
      this.availabilityConflicts.set([]);
      return;
    }

    this.checkingAvailability.set(true);
    this.classService.checkTeacherAvailability({
      instructorId: instructorId || undefined,
      startDate,
      endDate,
      startTime,
      endTime,
      daysOfWeek: days.join(','),
      excludeClassId: this.classId || undefined,
    }).subscribe({
      next: (result) => {
        this.availabilityConflicts.set(result.conflicts || []);
        this.checkingAvailability.set(false);
      },
      error: () => {
        this.checkingAvailability.set(false);
        this.availabilityConflicts.set([]);
      },
    });
  }

  instructorName(): string {
    const id = this.classForm.get('instructorId')?.value;
    const found = this.instructors().find(i => i.value === id);
    return found?.label || '';
  }

  loadCourses() {
    this.courseService.getActiveCourses().subscribe({
      next: (courses) => {
        this.allCourses.set(courses.map(c => ({
          id: c.id,
          name: c.name,
          branchId: c.branchId,
        })));
        // Legacy `courses` signal kept populated for any other code that reads it.
        this.courses.set(courses.map(c => ({ label: c.name, value: c.id })));
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadCourse(id: string) {
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.courseName.set(course.name);
        this.courseDefaultInstructor.set(course.instructorId || null);

        // Look up the branch name to show alongside the course in the header.
        if (course.branchId) {
          const found = this.branches().find(b => b.id === course.branchId);
          this.branchName.set(found?.label || '');
        }

        // Auto-select course's branch and instructor if creating new class.
        // emitEvent:false so the branchId valueChanges hook below doesn't fire
        // and clear the courseId we just selected (the dropdown is already
        // filtered to this branch, so the patch is essentially a no-op anyway).
        if (!this.isEditMode()) {
          this.classForm.patchValue({
            branchId: course.branchId,
            instructorId: course.instructorId
          }, { emitEvent: false });
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
        if (this.isGlobalCreate()) {
          this.router.navigate(['/classes']);
        } else {
          this.router.navigate(['/courses']);
        }
      }
    });
  }

  loadInstructors() {
    this.employeeService.getAllEmployees().subscribe({
      next: (employees) => {
        // Filter for active employees only
        const activeEmployees = employees.filter(emp => emp.isActive);
        this.instructors.set(activeEmployees.map(emp => ({
          label: `${emp.firstName} ${emp.lastName}${emp.position ? ' - ' + emp.position : ''}`,
          value: emp.id
        })));
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        if (branches.length === 1 && this.isGlobalCreate() && !this.isEditMode()) {
          const ctrl = this.classForm.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(branches[0].id);
        }
        // If a course was loaded before branches resolved, resolve the branch name now.
        const branchId = this.classForm.get('branchId')?.value;
        if (branchId && !this.branchName()) {
          const found = this.branches().find(b => b.id === branchId);
          if (found) this.branchName.set(found.label);
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadClass(id: string) {
    this.loading.set(true);
    this.classService.getClassById(id).subscribe({
      next: (classData) => {
        // Parse daysOfWeek string (e.g., "MONDAY,WEDNESDAY") to array
        const daysArray = classData.daysOfWeek ? classData.daysOfWeek.split(',') : [];

        // Per-day times: seed perDay and decide whether every day shares one time.
        const dts = classData.dayTimes || [];
        this.perDay = {};
        for (const dt of dts) {
          this.perDay[dt.day] = { startTime: (dt.startTime || '').slice(0, 5), endTime: (dt.endTime || '').slice(0, 5) };
        }
        const distinct = new Set(dts.map((d: any) => `${d.startTime}-${d.endTime}`));
        this.sameTime.set(dts.length === 0 || distinct.size <= 1);
        const shared = dts[0];
        const sharedStart = shared ? (shared.startTime || '').slice(0, 5) : (classData.startTime || '');
        const sharedEnd = shared ? (shared.endTime || '').slice(0, 5) : (classData.endTime || '');

        // If editing, set the courseId for potential display
        if (!this.courseId) {
          this.courseId = classData.courseId;
          this.loadCourse(classData.courseId);
        }

        this.classForm.patchValue({
          courseId: classData.courseId,
          name: classData.name,
          branchId: classData.branchId,
          instructorId: classData.instructorId,
          type: classData.type || 'OFFLINE',
          daysOfWeek: daysArray,
          startTime: sharedStart,
          endTime: sharedEnd,
          startDate: new Date(classData.startDate),
          endDate: new Date(classData.endDate),
          maxStudents: classData.maxStudents,
          notes: classData.notes
        });
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/courses', this.courseId]);
      }
    });
  }

  onDayChange(checked: boolean, day: string) {
    const days = this.classForm.get('daysOfWeek')?.value || [];

    if (checked) {
      if (!days.includes(day)) {
        this.classForm.patchValue({ daysOfWeek: [...days, day] });
      }
      // Seed a newly-checked day from the single time inputs so per-day mode
      // starts from the common time rather than blank.
      if (!this.perDay[day]) {
        this.perDay[day] = {
          startTime: this.classForm.get('startTime')?.value || '',
          endTime: this.classForm.get('endTime')?.value || '',
        };
      }
    } else {
      this.classForm.patchValue({ daysOfWeek: days.filter((d: string) => d !== day) });
    }
  }

  isDaySelected(day: string): boolean {
    const days = this.classForm.get('daysOfWeek')?.value || [];
    return days.includes(day);
  }

  /** Selected days in weekday order (not click order). */
  selectedDays(): string[] {
    const days = this.classForm.get('daysOfWeek')?.value || [];
    return this.daysOfWeek.map(d => d.value).filter(v => days.includes(v));
  }

  dayLabel(day: string): string {
    return this.daysOfWeek.find(d => d.value === day)?.label || day;
  }

  perDayStart(day: string): string { return this.perDay[day]?.startTime || ''; }
  perDayEnd(day: string): string { return this.perDay[day]?.endTime || ''; }
  setPerDayStart(day: string, v: string) {
    this.perDay[day] = { startTime: v, endTime: this.perDay[day]?.endTime || '' };
  }
  setPerDayEnd(day: string, v: string) {
    this.perDay[day] = { startTime: this.perDay[day]?.startTime || '', endTime: v };
  }

  /** The per-day times to send: single time expanded across days, or each day's own. */
  private buildDayTimes(): { day: string; startTime: string; endTime: string }[] {
    const days = this.selectedDays();
    if (this.sameTime()) {
      const st = this.classForm.get('startTime')?.value;
      const et = this.classForm.get('endTime')?.value;
      if (!st || !et) return [];
      return days.map(day => ({ day, startTime: st, endTime: et }));
    }
    return days
      .filter(day => this.perDay[day]?.startTime && this.perDay[day]?.endTime)
      .map(day => ({ day, startTime: this.perDay[day].startTime, endTime: this.perDay[day].endTime }));
  }

  /**
   * Local YYYY-MM-DD for a picked date. toISOString() would convert the picker's
   * local-midnight Date to UTC, which lands on the previous day for any timezone
   * east of UTC (Egypt) — pick the 25th, store the 24th.
   */
  private toLocalYmd(value: Date | string): string {
    if (!(value instanceof Date)) return value;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  calculateEndDate(startDate: Date, daysOfWeek: string[], numberOfSessions: number): Date {
    if (!startDate || !daysOfWeek || daysOfWeek.length === 0 || !numberOfSessions) {
      return startDate;
    }

    const dayMap: { [key: string]: number } = {
      'SUNDAY': 0,
      'MONDAY': 1,
      'TUESDAY': 2,
      'WEDNESDAY': 3,
      'THURSDAY': 4,
      'FRIDAY': 5,
      'SATURDAY': 6
    };

    const selectedDayNumbers = daysOfWeek.map(day => dayMap[day]).sort((a, b) => a - b);
    let currentDate = new Date(startDate);
    let sessionsFound = 0;

    // Move to the first valid day if start date is not on a selected day
    while (!selectedDayNumbers.includes(currentDate.getDay())) {
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Count this as the first session
    sessionsFound = 1;

    // Find the date of the last session
    while (sessionsFound < numberOfSessions) {
      currentDate.setDate(currentDate.getDate() + 1);
      if (selectedDayNumbers.includes(currentDate.getDay())) {
        sessionsFound++;
      }
    }

    return currentDate;
  }

  onSubmit() {
    if (this.classForm.invalid) {
      this.classForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.classForm.value;

    // Determine courseId (from route or from form)
    const targetCourseId = this.courseId || formValue.courseId;
    if (!targetCourseId) {
      this.notificationService.error(this.translate.instant('CLASSES.COURSE_REQUIRED'));
      this.loading.set(false);
      return;
    }

    const startDate = this.toLocalYmd(formValue.startDate);

    // Calculate end date if numberOfSessions is provided
    let endDate: string;
    if (formValue.numberOfSessions && formValue.numberOfSessions > 0 && formValue.daysOfWeek && formValue.daysOfWeek.length > 0) {
      const calculatedEndDate = this.calculateEndDate(
        formValue.startDate instanceof Date ? formValue.startDate : new Date(formValue.startDate),
        formValue.daysOfWeek,
        formValue.numberOfSessions
      );
      endDate = this.toLocalYmd(calculatedEndDate);
    } else if (formValue.endDate) {
      endDate = this.toLocalYmd(formValue.endDate);
    } else {
      this.notificationService.error(this.translate.instant('CLASSES.END_DATE_OR_SESSIONS_REQUIRED'));
      this.loading.set(false);
      return;
    }

    // Convert daysOfWeek array to comma-separated string
    const daysOfWeek = formValue.daysOfWeek && formValue.daysOfWeek.length > 0
      ? formValue.daysOfWeek.join(',')
      : undefined;

    // Per-day times. In per-day mode every selected day must carry a time.
    const dayTimes = this.buildDayTimes();
    if (!this.sameTime() && this.selectedDays().length > 0 && dayTimes.length !== this.selectedDays().length) {
      this.notificationService.error(this.translate.instant('CLASSES.FORM.DAY_TIMES_REQUIRED'));
      this.loading.set(false);
      return;
    }

    const classData: any = {
      courseId: targetCourseId,
      // branchId no longer sent — backend derives it from the course.
      name: formValue.name,
      instructorId: formValue.instructorId || undefined,
      type: formValue.type || 'OFFLINE',
      startDate,
      endDate,
      startTime: formValue.startTime || undefined,
      endTime: formValue.endTime || undefined,
      daysOfWeek,
      dayTimes: dayTimes.length ? dayTimes : undefined,
      maxStudents: formValue.maxStudents || undefined,
      notes: formValue.notes || undefined
    };

    if (this.isEditMode() && this.classId) {
      this.classService.updateClass(this.classId, classData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('CLASSES.UPDATED'));
          this.returnFromEdit();
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Update error:', error);
        }
      });
    } else {
      this.classService.createClass(classData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('CLASSES.CREATED'));
          if (this.isGlobalCreate()) {
            this.router.navigate(['/classes']);
          } else {
            this.router.navigate(['/courses', targetCourseId]);
          }
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    // When editing, go back to wherever the user came from (class or course).
    if (this.isEditMode()) {
      this.returnFromEdit();
      return;
    }
    if (this.isGlobalCreate() && !this.isEditMode()) {
      this.router.navigate(['/classes']);
    } else if (this.courseId) {
      this.router.navigate(['/courses', this.courseId]);
    } else {
      this.router.navigate(['/classes']);
    }
  }

  /**
   * After editing a class, return to the origin the user came from:
   * the class detail (from=class) or the course detail (from=course).
   * Falls back to the class detail when no origin hint is present.
   */
  private returnFromEdit() {
    if (this.fromOrigin === 'course' && this.courseId) {
      this.router.navigate(['/courses', this.courseId]);
    } else if (this.fromOrigin === 'class' && this.classId) {
      this.router.navigate(['/classes', this.classId]);
    } else if (this.classId) {
      this.router.navigate(['/classes', this.classId]);
    } else if (this.courseId) {
      this.router.navigate(['/courses', this.courseId]);
    } else {
      this.router.navigate(['/classes']);
    }
  }
}
