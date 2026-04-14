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
import { ClassService } from '../services/class.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { TranslateModule } from '@ngx-translate/core';

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
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  classForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  classId: string | null = null;
  instructors = signal<any[]>([]);
  branches = signal<any[]>([]);
  courses = signal<any[]>([]);
  courseName = signal<string>('');
  courseDefaultInstructor = signal<string | null>(null);
  isGlobalCreate = signal(false);

  daysOfWeek = [
    { label: 'Sunday', value: 'SUNDAY' },
    { label: 'Monday', value: 'MONDAY' },
    { label: 'Tuesday', value: 'TUESDAY' },
    { label: 'Wednesday', value: 'WEDNESDAY' },
    { label: 'Thursday', value: 'THURSDAY' },
    { label: 'Friday', value: 'FRIDAY' },
    { label: 'Saturday', value: 'SATURDAY' }
  ];

  constructor() {
    this.classForm = this.fb.group({
      courseId: [''],
      name: ['', [Validators.required, Validators.minLength(2)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      branchId: ['', [Validators.required]],
      instructorId: [''],
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

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('courseId');
    this.classId = this.route.snapshot.paramMap.get('id');

    // Check if creating from global classes list (no courseId in route)
    if (!this.courseId && !this.classId) {
      this.isGlobalCreate.set(true);
      this.classForm.get('courseId')?.setValidators([Validators.required]);
      this.classForm.get('courseId')?.updateValueAndValidity();
      this.loadCourses();
    } else if (this.courseId) {
      this.loadCourse(this.courseId);
    }

    this.loadInstructors();
    this.loadBranches();

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
  }

  loadCourses() {
    this.courseService.getActiveCourses().subscribe({
      next: (courses) => {
        this.courses.set(courses.map(c => ({
          label: c.name,
          value: c.id
        })));
      },
      error: () => {
        this.notificationService.error('Failed to load courses');
      }
    });
  }

  loadCourse(id: string) {
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.courseName.set(course.name);
        this.courseDefaultInstructor.set(course.instructorId || null);

        // Auto-select course's branch and instructor if creating new class
        if (!this.isEditMode()) {
          this.classForm.patchValue({
            branchId: course.branchId,
            instructorId: course.instructorId
          });
        }
      },
      error: () => {
        this.notificationService.error('Failed to load course');
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
        this.notificationService.error('Failed to load instructors');
      }
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches.map(branch => ({
          label: branch.name,
          value: branch.id
        })));
      },
      error: () => {
        this.notificationService.error('Failed to load branches');
      }
    });
  }

  loadClass(id: string) {
    this.loading.set(true);
    this.classService.getClassById(id).subscribe({
      next: (classData) => {
        // Parse daysOfWeek string (e.g., "MONDAY,WEDNESDAY") to array
        const daysArray = classData.daysOfWeek ? classData.daysOfWeek.split(',') : [];

        // If editing, set the courseId for potential display
        if (!this.courseId) {
          this.courseId = classData.courseId;
          this.loadCourse(classData.courseId);
        }

        this.classForm.patchValue({
          courseId: classData.courseId,
          name: classData.name,
          code: classData.code,
          branchId: classData.branchId,
          instructorId: classData.instructorId,
          daysOfWeek: daysArray,
          startTime: classData.startTime,
          endTime: classData.endTime,
          startDate: new Date(classData.startDate),
          endDate: new Date(classData.endDate),
          maxStudents: classData.maxStudents,
          notes: classData.notes
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load class');
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
    } else {
      this.classForm.patchValue({ daysOfWeek: days.filter((d: string) => d !== day) });
    }
  }

  isDaySelected(day: string): boolean {
    const days = this.classForm.get('daysOfWeek')?.value || [];
    return days.includes(day);
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
      this.notificationService.error('Course is required');
      this.loading.set(false);
      return;
    }

    // Convert start date to ISO string
    const startDate = formValue.startDate instanceof Date
      ? formValue.startDate.toISOString().split('T')[0]
      : formValue.startDate;

    // Calculate end date if numberOfSessions is provided
    let endDate: string;
    if (formValue.numberOfSessions && formValue.numberOfSessions > 0 && formValue.daysOfWeek && formValue.daysOfWeek.length > 0) {
      const calculatedEndDate = this.calculateEndDate(
        formValue.startDate instanceof Date ? formValue.startDate : new Date(formValue.startDate),
        formValue.daysOfWeek,
        formValue.numberOfSessions
      );
      endDate = calculatedEndDate.toISOString().split('T')[0];
    } else if (formValue.endDate) {
      endDate = formValue.endDate instanceof Date
        ? formValue.endDate.toISOString().split('T')[0]
        : formValue.endDate;
    } else {
      this.notificationService.error('Please provide either an end date or number of sessions with days of week');
      this.loading.set(false);
      return;
    }

    // Convert daysOfWeek array to comma-separated string
    const daysOfWeek = formValue.daysOfWeek && formValue.daysOfWeek.length > 0
      ? formValue.daysOfWeek.join(',')
      : undefined;

    const classData: any = {
      courseId: targetCourseId,
      branchId: formValue.branchId,
      name: formValue.name,
      code: formValue.code,
      instructorId: formValue.instructorId || undefined,
      startDate,
      endDate,
      startTime: formValue.startTime || undefined,
      endTime: formValue.endTime || undefined,
      daysOfWeek,
      maxStudents: formValue.maxStudents || undefined,
      notes: formValue.notes || undefined
    };

    if (this.isEditMode() && this.classId) {
      this.classService.updateClass(this.classId, classData).subscribe({
        next: () => {
          this.notificationService.success('Class updated successfully');
          if (this.isGlobalCreate()) {
            this.router.navigate(['/classes']);
          } else {
            this.router.navigate(['/courses', targetCourseId]);
          }
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update class');
          console.error('Update error:', error);
        }
      });
    } else {
      this.classService.createClass(classData).subscribe({
        next: () => {
          this.notificationService.success('Class created successfully');
          if (this.isGlobalCreate()) {
            this.router.navigate(['/classes']);
          } else {
            this.router.navigate(['/courses', targetCourseId]);
          }
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create class');
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    if (this.isGlobalCreate() && !this.isEditMode()) {
      this.router.navigate(['/classes']);
    } else if (this.courseId) {
      this.router.navigate(['/courses', this.courseId]);
    } else {
      this.router.navigate(['/classes']);
    }
  }
}
