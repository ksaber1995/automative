import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { EmployeeService } from '../../employees/services/employee.service';
import { RoomService, Room } from '../../rooms/services/room.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course } from '@shared/interfaces/course.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { Employee } from '@shared/interfaces/employee.interface';

@Component({
  selector: 'app-course-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    TranslateModule
  ],
  templateUrl: './course-form.component.html'
})
export class CourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  courseForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  branches = signal<Branch[]>([]);
  employees = signal<any[]>([]);
  rooms = signal<Room[]>([]);
  private roomService = inject(RoomService);

  constructor() {
    this.courseForm = this.fb.group({
      branchId: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      price: [0, [Validators.required, Validators.min(0)]],
      duration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      maxStudents: [null],
      instructorId: [''],
      defaultRoomId: [null],
    });
  }

  ngOnInit() {
    this.loadBranches();
    this.loadEmployees();
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.isEditMode.set(true);
      this.loadCourse(this.courseId);
    }
    // Load rooms when branch changes
    this.courseForm.get('branchId')?.valueChanges.subscribe(branchId => {
      if (branchId) this.loadRooms(branchId);
    });
  }

  loadRooms(branchId: string) {
    this.roomService.listActive(branchId).subscribe({
      next: (r) => this.rooms.set(r),
      error: () => {},
    });
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadEmployees() {
    this.employeeService.getAllEmployees().subscribe({
      next: (employees: Employee[]) => {
        // Map employees to include full name for display
        const mappedEmployees = employees.map((emp: Employee) => ({
          ...emp,
          fullName: `${emp.firstName} ${emp.lastName}`
        }));
        this.employees.set(mappedEmployees);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadCourse(id: string) {
    this.loading.set(true);
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.courseForm.patchValue({
          branchId: course.branchId,
          name: course.name,
          code: course.code,
          description: course.description || '',
          price: course.price,
          duration: course.duration,
          maxStudents: course.maxStudents,
          instructorId: course.instructorId || '',
          defaultRoomId: (course as any).defaultRoomId || null,
        });
        // Load rooms for the selected branch
        if (course.branchId) this.loadRooms(course.branchId);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/courses']);
      }
    });
  }

  onSubmit() {
    if (this.courseForm.invalid) {
      this.courseForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.courseForm.value;

    // Clean the data
    const courseData = {
      ...formValue,
      description: formValue.description?.trim() || undefined,
      maxStudents: formValue.maxStudents || undefined,
      instructorId: formValue.instructorId || undefined,
    };

    if (this.isEditMode() && this.courseId) {
      this.courseService.updateCourse(this.courseId, courseData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('COURSES.FORM.UPDATE_SUCCESS'));
          this.router.navigate(['/courses']);
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Update error:', error);
        }
      });
    } else {
      this.courseService.createCourse(courseData).subscribe({
        next: () => {
          this.loading.set(false);
          this.notificationService.success(this.translate.instant('COURSES.FORM.CREATE_SUCCESS'));
          this.router.navigate(['/courses']);
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
    this.router.navigate(['/courses']);
  }

  get branchId() { return this.courseForm.get('branchId'); }
  get name() { return this.courseForm.get('name'); }
  get code() { return this.courseForm.get('code'); }
  get price() { return this.courseForm.get('price'); }
  get duration() { return this.courseForm.get('duration'); }
}
