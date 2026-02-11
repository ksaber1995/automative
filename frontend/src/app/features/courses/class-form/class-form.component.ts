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
    CheckboxModule
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
  courseName = signal<string>('');
  courseDefaultInstructor = signal<string | null>(null);

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
      name: ['', [Validators.required, Validators.minLength(2)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      branchId: ['', [Validators.required]],
      instructorId: [''],
      daysOfWeek: [[]],
      startTime: [''],
      endTime: [''],
      startDate: ['', [Validators.required]],
      endDate: ['', [Validators.required]],
      maxStudents: [null],
      notes: ['']
    });
  }

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('courseId');
    this.classId = this.route.snapshot.paramMap.get('id');

    if (!this.courseId) {
      this.notificationService.error('Course ID is required');
      this.router.navigate(['/courses']);
      return;
    }

    this.loadCourse(this.courseId);
    this.loadInstructors();
    this.loadBranches();

    if (this.classId) {
      this.isEditMode.set(true);
      this.loadClass(this.classId);
    }
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
        this.router.navigate(['/courses']);
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

        this.classForm.patchValue({
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

  onSubmit() {
    if (this.classForm.invalid) {
      this.classForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.classForm.value;

    // Convert dates to ISO strings
    const startDate = formValue.startDate instanceof Date
      ? formValue.startDate.toISOString().split('T')[0]
      : formValue.startDate;
    const endDate = formValue.endDate instanceof Date
      ? formValue.endDate.toISOString().split('T')[0]
      : formValue.endDate;

    // Convert daysOfWeek array to comma-separated string
    const daysOfWeek = formValue.daysOfWeek && formValue.daysOfWeek.length > 0
      ? formValue.daysOfWeek.join(',')
      : undefined;

    const classData: any = {
      courseId: this.courseId!,
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
          this.router.navigate(['/courses', this.courseId]);
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
          this.router.navigate(['/courses', this.courseId]);
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
    this.router.navigate(['/courses', this.courseId]);
  }
}
