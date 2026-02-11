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
import { CourseService } from '../services/course.service';
import { BranchService } from '../../branches/services/branch.service';
import { EmployeeService } from '../../employees/services/employee.service';
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
    SelectModule
  ],
  template: `
    <div class="container-custom py-8">
      <div class="max-w-3xl mx-auto">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            {{ isEditMode() ? 'Edit Course' : 'Add New Course' }}
          </h1>
          <p class="text-gray-600 mt-2">
            {{ isEditMode() ? 'Update course information' : 'Create a new course for your academy' }}
          </p>
        </div>

        <p-card>
          <form [formGroup]="courseForm" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Branch -->
              <div class="col-span-2">
                <label for="branchId" class="block text-sm font-medium text-gray-700 mb-2">
                  Branch <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="branchId"
                  formControlName="branchId"
                  [options]="branches()"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a branch"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="branchId?.invalid && branchId?.touched"
                ></p-select>
                @if (branchId?.invalid && branchId?.touched) {
                  <small class="text-red-500">Branch is required</small>
                }
              </div>

              <!-- Course Name -->
              <div class="col-span-2">
                <label for="name" class="block text-sm font-medium text-gray-700 mb-2">
                  Course Name <span class="text-red-500">*</span>
                </label>
                <input
                  pInputText
                  id="name"
                  formControlName="name"
                  placeholder="e.g., Introduction to Robotics"
                  class="w-full"
                  [class.border-red-500]="name?.invalid && name?.touched"
                />
                @if (name?.invalid && name?.touched) {
                  <small class="text-red-500">Course name is required (min 3 characters)</small>
                }
              </div>

              <!-- Course Code -->
              <div>
                <label for="code" class="block text-sm font-medium text-gray-700 mb-2">
                  Course Code <span class="text-red-500">*</span>
                </label>
                <input
                  pInputText
                  id="code"
                  formControlName="code"
                  placeholder="e.g., ROB101"
                  class="w-full"
                  [class.border-red-500]="code?.invalid && code?.touched"
                />
                @if (code?.invalid && code?.touched) {
                  <small class="text-red-500">Course code is required (min 2 characters)</small>
                }
              </div>

              <!-- Price -->
              <div>
                <label for="price" class="block text-sm font-medium text-gray-700 mb-2">
                  Price <span class="text-red-500">*</span>
                </label>
                <p-inputnumber
                  id="price"
                  formControlName="price"
                  mode="currency"
                  currency="USD"
                  [min]="0"
                  placeholder="0.00"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="price?.invalid && price?.touched"
                />
                @if (price?.invalid && price?.touched) {
                  <small class="text-red-500">Price is required and must be positive</small>
                }
              </div>

              <!-- Duration (in weeks) -->
              <div>
                <label for="duration" class="block text-sm font-medium text-gray-700 mb-2">
                  Duration (weeks) <span class="text-red-500">*</span>
                </label>
                <p-inputnumber
                  id="duration"
                  formControlName="duration"
                  [min]="1"
                  [max]="52"
                  placeholder="8"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="duration?.invalid && duration?.touched"
                />
                @if (duration?.invalid && duration?.touched) {
                  <small class="text-red-500">Duration is required (1-52 weeks)</small>
                }
              </div>

              <!-- Max Students -->
              <div>
                <label for="maxStudents" class="block text-sm font-medium text-gray-700 mb-2">
                  Max Students (Optional)
                </label>
                <p-inputnumber
                  id="maxStudents"
                  formControlName="maxStudents"
                  [min]="1"
                  placeholder="20"
                  [style]="{ width: '100%' }"
                />
              </div>

              <!-- Instructor -->
              <div class="col-span-2">
                <label for="instructorId" class="block text-sm font-medium text-gray-700 mb-2">
                  Instructor (Optional)
                </label>
                <p-select
                  id="instructorId"
                  formControlName="instructorId"
                  [options]="employees()"
                  optionLabel="fullName"
                  optionValue="id"
                  placeholder="Select an instructor"
                  [style]="{ width: '100%' }"
                  [showClear]="true"
                ></p-select>
              </div>

              <!-- Description -->
              <div class="col-span-2">
                <label for="description" class="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  pTextarea
                  id="description"
                  formControlName="description"
                  rows="4"
                  placeholder="Course description..."
                  class="w-full"
                ></textarea>
              </div>
            </div>

            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <p-button
                label="Cancel"
                severity="secondary"
                [outlined]="true"
                (onClick)="cancel()"
                type="button"
              ></p-button>
              <p-button
                [label]="isEditMode() ? 'Update Course' : 'Create Course'"
                type="submit"
                [loading]="loading()"
                [disabled]="courseForm.invalid"
              ></p-button>
            </div>
          </form>
        </p-card>
      </div>
    </div>
  `
})
export class CourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private courseService = inject(CourseService);
  private branchService = inject(BranchService);
  private employeeService = inject(EmployeeService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  courseForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  branches = signal<Branch[]>([]);
  employees = signal<any[]>([]);

  constructor() {
    this.courseForm = this.fb.group({
      branchId: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(3)]],
      code: ['', [Validators.required, Validators.minLength(2)]],
      description: [''],
      price: [0, [Validators.required, Validators.min(0)]],
      duration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      maxStudents: [null],
      instructorId: ['']
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
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      },
      error: () => {
        this.notificationService.error('Failed to load branches');
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
        this.notificationService.error('Failed to load employees');
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
          instructorId: course.instructorId || ''
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load course');
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
          this.notificationService.success('Course updated successfully');
          this.router.navigate(['/courses']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update course');
          console.error('Update error:', error);
        }
      });
    } else {
      this.courseService.createCourse(courseData).subscribe({
        next: () => {
          this.notificationService.success('Course created successfully');
          this.router.navigate(['/courses']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create course');
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
