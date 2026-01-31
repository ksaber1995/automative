import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormArray } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ClassService } from '../services/class.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { CourseService } from '../services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DayOfWeek } from '@shared/interfaces/class.interface';

@Component({
  selector: 'app-class-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule
  ],
  templateUrl: './class-form.component.html',
  styleUrl: './class-form.component.scss'
})
export class ClassFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private classService = inject(ClassService);
  private employeeService = inject(EmployeeService);
  private courseService = inject(CourseService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  classForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  classId: string | null = null;
  teachers = signal<any[]>([]);
  courseName = signal<string>('');

  daysOfWeek = [
    { label: 'Sunday', value: DayOfWeek.SUNDAY },
    { label: 'Monday', value: DayOfWeek.MONDAY },
    { label: 'Tuesday', value: DayOfWeek.TUESDAY },
    { label: 'Wednesday', value: DayOfWeek.WEDNESDAY },
    { label: 'Thursday', value: DayOfWeek.THURSDAY },
    { label: 'Friday', value: DayOfWeek.FRIDAY },
    { label: 'Saturday', value: DayOfWeek.SATURDAY }
  ];

  constructor() {
    this.classForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      teacherId: ['', [Validators.required]],
      days: [[], [Validators.required, Validators.minLength(1)]],
      startTime: ['', [Validators.required]],
      endTime: ['', [Validators.required]],
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
    this.loadTeachers();

    if (this.classId) {
      this.isEditMode.set(true);
      this.loadClass(this.classId);
    }
  }

  loadCourse(id: string) {
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.courseName.set(course.name);
      },
      error: () => {
        this.notificationService.error('Failed to load course');
        this.router.navigate(['/courses']);
      }
    });
  }

  loadTeachers() {
    this.employeeService.getAllEmployees().subscribe({
      next: (employees) => {
        // Filter for active employees only
        const activeEmployees = employees.filter(emp => emp.isActive);
        this.teachers.set(activeEmployees.map(emp => ({
          label: `${emp.firstName} ${emp.lastName} - ${emp.position}`,
          value: emp.id
        })));
      },
      error: () => {
        this.notificationService.error('Failed to load teachers');
      }
    });
  }

  loadClass(id: string) {
    this.loading.set(true);
    this.classService.getClassById(id).subscribe({
      next: (classData) => {
        this.classForm.patchValue({
          name: classData.name,
          code: classData.code,
          teacherId: classData.teacherId,
          days: classData.schedule.days,
          startTime: classData.schedule.startTime,
          endTime: classData.schedule.endTime,
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

  onDayChange(event: Event, day: DayOfWeek) {
    const checkbox = event.target as HTMLInputElement;
    const days = this.classForm.get('days')?.value || [];

    if (checkbox.checked) {
      if (!days.includes(day)) {
        this.classForm.patchValue({ days: [...days, day] });
      }
    } else {
      this.classForm.patchValue({ days: days.filter((d: DayOfWeek) => d !== day) });
    }
  }

  isDaySelected(day: DayOfWeek): boolean {
    const days = this.classForm.get('days')?.value || [];
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
    const startDate = formValue.startDate;
    const endDate = formValue.endDate;

    const classData = {
      courseId: this.courseId!,
      name: formValue.name,
      code: formValue.code,
      teacherId: formValue.teacherId,
      schedule: {
        days: formValue.days,
        startTime: formValue.startTime,
        endTime: formValue.endTime
      },
      startDate,
      endDate,
      maxStudents: formValue.maxStudents,
      notes: formValue.notes
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
