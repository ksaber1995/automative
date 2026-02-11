import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { EnrollmentService } from '../services/enrollment.service';
import { StudentService } from '../../students/services/student.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EnrollmentStatus, PaymentStatus } from '@shared/enums/enrollment-status.enum';
import { Student } from '@shared/interfaces/student.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Class } from '@shared/interfaces/class.interface';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-enrollment-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TextareaModule,
    RadioButtonModule
  ],
  template: `
    <div class="container-custom py-8">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            {{ isEditMode() ? 'Edit Enrollment' : 'Enroll Student in Course' }}
          </h1>
          <p class="text-gray-600 mt-2">
            {{ isEditMode() ? 'Update enrollment information' : 'Create a new course enrollment for a student' }}
          </p>
        </div>

        <p-card>
          <form [formGroup]="enrollmentForm" (ngSubmit)="onSubmit()">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- Student Selection -->
              <div class="col-span-2">
                <label for="studentId" class="block text-sm font-medium text-gray-700 mb-2">
                  Student <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="studentId"
                  formControlName="studentId"
                  [options]="students()"
                  optionLabel="fullName"
                  optionValue="id"
                  placeholder="Select a student"
                  [filter]="true"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="studentId?.invalid && studentId?.touched"
                ></p-select>
                @if (studentId?.invalid && studentId?.touched) {
                  <small class="text-red-500">Student is required</small>
                }
              </div>

              <!-- Branch Selection -->
              <div>
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
                  (onChange)="onBranchChange()"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="branchId?.invalid && branchId?.touched"
                ></p-select>
                @if (branchId?.invalid && branchId?.touched) {
                  <small class="text-red-500">Branch is required</small>
                }
              </div>

              <!-- Course Selection -->
              <div>
                <label for="courseId" class="block text-sm font-medium text-gray-700 mb-2">
                  Course <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="courseId"
                  formControlName="courseId"
                  [options]="filteredCourses()"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a course"
                  (onChange)="onCourseChange()"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="courseId?.invalid && courseId?.touched"
                  [disabled]="!branchId?.value"
                ></p-select>
                @if (!branchId?.value) {
                  <small class="text-gray-500">Please select a branch first</small>
                }
                @if (branchId?.value && filteredCourses().length === 0) {
                  <small class="text-orange-500">No active courses available for this branch</small>
                }
                @if (courseId?.invalid && courseId?.touched) {
                  <small class="text-red-500">Course is required</small>
                }
              </div>

              <!-- Class Selection -->
              <div>
                <label for="classId" class="block text-sm font-medium text-gray-700 mb-2">
                  Class <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="classId"
                  formControlName="classId"
                  [options]="filteredClasses()"
                  optionLabel="name"
                  optionValue="id"
                  placeholder="Select a class"
                  [style]="{ width: '100%' }"
                  [class.border-red-500]="classId?.invalid && classId?.touched"
                  [disabled]="!courseId?.value"
                ></p-select>
                @if (classId?.invalid && classId?.touched) {
                  <small class="text-red-500">Class is required</small>
                }
              </div>

              <!-- Enrollment Date -->
              <div>
                <label for="enrollmentDate" class="block text-sm font-medium text-gray-700 mb-2">
                  Enrollment Date <span class="text-red-500">*</span>
                </label>
                <p-datepicker
                  id="enrollmentDate"
                  formControlName="enrollmentDate"
                  [showIcon]="true"
                  dateFormat="yy-mm-dd"
                  placeholder="Select date"
                  [style]="{ width: '100%' }"
                ></p-datepicker>
                @if (enrollmentDate?.invalid && enrollmentDate?.touched) {
                  <small class="text-red-500">Enrollment date is required</small>
                }
              </div>

              <!-- Enrollment Status -->
              <div>
                <label for="status" class="block text-sm font-medium text-gray-700 mb-2">
                  Status <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="status"
                  formControlName="status"
                  [options]="enrollmentStatuses"
                  placeholder="Select status"
                  [style]="{ width: '100%' }"
                ></p-select>
              </div>

              <!-- Payment Status -->
              <div>
                <label for="paymentStatus" class="block text-sm font-medium text-gray-700 mb-2">
                  Payment Status <span class="text-red-500">*</span>
                </label>
                <p-select
                  id="paymentStatus"
                  formControlName="paymentStatus"
                  [options]="paymentStatuses"
                  placeholder="Select payment status"
                  [style]="{ width: '100%' }"
                ></p-select>
              </div>

              <!-- Pricing Information -->
              <div class="col-span-2 border-t pt-4 mt-4">
                <h3 class="text-lg font-semibold mb-4">Pricing & Discounts</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <!-- Original Price -->
                  <div>
                    <label for="originalPrice" class="block text-sm font-medium text-gray-700 mb-2">
                      Original Price <span class="text-red-500">*</span>
                    </label>
                    <p-inputnumber
                      id="originalPrice"
                      formControlName="originalPrice"
                      mode="currency"
                      currency="USD"
                      [min]="0"
                      (onInput)="calculateFinalPrice()"
                      [style]="{ width: '100%' }"
                    />
                    @if (selectedCourse()) {
                      <small class="text-gray-500">Course price: \${{ selectedCourse()!.price.toFixed(2) }}</small>
                    }
                  </div>

                  <!-- Discount Type -->
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      Discount Type
                    </label>
                    <div class="flex gap-4">
                      <div class="flex items-center">
                        <p-radiobutton
                          value="percentage"
                          formControlName="discountType"
                          (onClick)="calculateFinalPrice()"
                        />
                        <label class="ml-2">Percentage</label>
                      </div>
                      <div class="flex items-center">
                        <p-radiobutton
                          value="amount"
                          formControlName="discountType"
                          (onClick)="calculateFinalPrice()"
                        />
                        <label class="ml-2">Fixed Amount</label>
                      </div>
                    </div>
                  </div>

                  <!-- Discount Percentage -->
                  @if (enrollmentForm.get('discountType')?.value === 'percentage') {
                    <div>
                      <label for="discountPercent" class="block text-sm font-medium text-gray-700 mb-2">
                        Discount Percentage
                      </label>
                      <p-inputnumber
                        id="discountPercent"
                        formControlName="discountPercent"
                        suffix="%"
                        [min]="0"
                        [max]="100"
                        (onInput)="calculateFinalPrice()"
                        [style]="{ width: '100%' }"
                      />
                    </div>
                  }

                  <!-- Discount Amount -->
                  @if (enrollmentForm.get('discountType')?.value === 'amount') {
                    <div>
                      <label for="discountAmount" class="block text-sm font-medium text-gray-700 mb-2">
                        Discount Amount
                      </label>
                      <p-inputnumber
                        id="discountAmount"
                        formControlName="discountAmount"
                        mode="currency"
                        currency="USD"
                        [min]="0"
                        (onInput)="calculateFinalPrice()"
                        [style]="{ width: '100%' }"
                      />
                    </div>
                  }

                  <!-- Final Price (Read-only) -->
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      Final Price
                    </label>
                    <div class="text-2xl font-bold text-green-600">
                      \${{ finalPriceDisplay() }}
                    </div>
                    @if (savingsAmount() > 0) {
                      <small class="text-green-600">
                        You save: \${{ savingsAmount().toFixed(2) }}
                      </small>
                    }
                  </div>
                </div>
              </div>

              <!-- Notes -->
              <div class="col-span-2">
                <label for="notes" class="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  pTextarea
                  id="notes"
                  formControlName="notes"
                  rows="3"
                  placeholder="Additional notes..."
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
                [label]="isEditMode() ? 'Update Enrollment' : 'Create Enrollment'"
                type="submit"
                [loading]="loading()"
                [disabled]="enrollmentForm.invalid"
              ></p-button>
            </div>
          </form>
        </p-card>
      </div>
    </div>
  `
})
export class EnrollmentFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private enrollmentService = inject(EnrollmentService);
  private studentService = inject(StudentService);
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  enrollmentForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  enrollmentId: string | null = null;

  students = signal<(Student & { fullName: string })[]>([]);
  branches = signal<Branch[]>([]);
  courses = signal<Course[]>([]);
  classes = signal<Class[]>([]);

  selectedCourse = signal<Course | null>(null);

  filteredCourses = computed(() => {
    const branchId = this.enrollmentForm?.get('branchId')?.value;
    if (!branchId) return [];
    return this.courses().filter(c => c.branchId === branchId);
  });

  filteredClasses = computed(() => {
    const courseId = this.enrollmentForm?.get('courseId')?.value;
    if (!courseId) return [];
    return this.classes().filter(c => c.courseId === courseId);
  });

  enrollmentStatuses = [
    { label: 'Active', value: EnrollmentStatus.ACTIVE },
    { label: 'Pending', value: EnrollmentStatus.PENDING },
    { label: 'Completed', value: EnrollmentStatus.COMPLETED },
    { label: 'Dropped', value: EnrollmentStatus.DROPPED }
  ];

  paymentStatuses = [
    { label: 'Pending', value: PaymentStatus.PENDING },
    { label: 'Partial', value: PaymentStatus.PARTIAL },
    { label: 'Paid', value: PaymentStatus.PAID },
    { label: 'Overdue', value: PaymentStatus.OVERDUE }
  ];

  finalPriceDisplay = computed(() => {
    return (this.enrollmentForm?.get('finalPrice')?.value || 0).toFixed(2);
  });

  savingsAmount = computed(() => {
    const original = this.enrollmentForm?.get('originalPrice')?.value || 0;
    const final = this.enrollmentForm?.get('finalPrice')?.value || 0;
    return Math.max(0, original - final);
  });

  constructor() {
    const today = new Date();
    this.enrollmentForm = this.fb.group({
      studentId: ['', [Validators.required]],
      branchId: ['', [Validators.required]],
      courseId: ['', [Validators.required]],
      classId: ['', [Validators.required]],
      enrollmentDate: [today, [Validators.required]],
      status: [EnrollmentStatus.ACTIVE, [Validators.required]],
      paymentStatus: [PaymentStatus.PENDING, [Validators.required]],
      originalPrice: [0, [Validators.required, Validators.min(0)]],
      discountType: ['percentage'],
      discountPercent: [0],
      discountAmount: [0],
      finalPrice: [0],
      notes: ['']
    });
  }

  ngOnInit() {
    this.loadData();

    // Check for pre-selected student from query params
    const studentId = this.route.snapshot.queryParamMap.get('studentId');
    if (studentId) {
      this.enrollmentForm.patchValue({ studentId });
      // Auto-select student's branch to enable course dropdown
      this.autoSelectStudentBranch(studentId);
    }

    this.enrollmentId = this.route.snapshot.paramMap.get('id');
    if (this.enrollmentId) {
      this.isEditMode.set(true);
      this.loadEnrollment(this.enrollmentId);
    }
  }

  autoSelectStudentBranch(studentId: string) {
    // Wait for students to load, then find the student and set their branch
    this.studentService.getStudentById(studentId).subscribe({
      next: (student) => {
        console.log('Auto-selecting branch for student:', student);
        if (student.branchId) {
          this.enrollmentForm.patchValue({ branchId: student.branchId });
        }
      },
      error: (err) => {
        console.error('Error loading student for auto-select:', err);
      }
    });
  }

  loadData() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        console.log('Loaded branches:', branches);
        this.branches.set(branches);
      },
      error: (err) => {
        console.error('Error loading branches:', err);
        this.notificationService.error('Failed to load branches');
      }
    });

    this.courseService.getAllCourses().subscribe({
      next: (courses) => {
        console.log('Loaded courses:', courses);
        const activeCourses = courses.filter(c => c.isActive);
        console.log('Active courses:', activeCourses);
        this.courses.set(activeCourses);
      },
      error: (err) => {
        console.error('Error loading courses:', err);
        this.notificationService.error('Failed to load courses');
      }
    });

    this.classService.getAllClasses().subscribe({
      next: (classes) => {
        console.log('Loaded classes:', classes);
        this.classes.set(classes.filter(c => c.isActive));
      },
      error: (err) => {
        console.error('Error loading classes:', err);
        this.notificationService.error('Failed to load classes');
      }
    });

    this.studentService.getAllStudents().subscribe({
      next: (students) => {
        console.log('Loaded students:', students);
        const studentsWithFullName = students
          .filter(s => s.isActive)
          .map(s => ({
            ...s,
            fullName: `${s.firstName} ${s.lastName}`
          }));
        this.students.set(studentsWithFullName);
      },
      error: (err) => {
        console.error('Error loading students:', err);
        this.notificationService.error('Failed to load students');
      }
    });
  }

  loadEnrollment(id: string) {
    this.loading.set(true);
    this.enrollmentService.getEnrollmentById(id).subscribe({
      next: (enrollment) => {
        this.enrollmentForm.patchValue({
          studentId: enrollment.studentId,
          branchId: enrollment.branchId,
          courseId: enrollment.courseId,
          classId: enrollment.classId,
          enrollmentDate: new Date(enrollment.enrollmentDate),
          status: enrollment.status,
          paymentStatus: enrollment.paymentStatus,
          originalPrice: enrollment.originalPrice,
          discountPercent: enrollment.discountPercent,
          discountAmount: enrollment.discountAmount,
          finalPrice: enrollment.finalPrice,
          notes: enrollment.notes || ''
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load enrollment');
        this.loading.set(false);
        this.router.navigate(['/students']);
      }
    });
  }

  onBranchChange() {
    this.enrollmentForm.patchValue({
      courseId: '',
      classId: '',
      originalPrice: 0
    });
    this.selectedCourse.set(null);
  }

  onCourseChange() {
    const courseId = this.enrollmentForm.get('courseId')?.value;
    if (courseId) {
      const course = this.courses().find(c => c.id === courseId);
      if (course) {
        this.selectedCourse.set(course);
        this.enrollmentForm.patchValue({
          originalPrice: course.price,
          classId: ''
        });
        this.calculateFinalPrice();
      }
    }
  }

  calculateFinalPrice() {
    const originalPrice = this.enrollmentForm.get('originalPrice')?.value || 0;
    const discountType = this.enrollmentForm.get('discountType')?.value;
    let discountAmount = 0;
    let discountPercent = 0;

    if (discountType === 'percentage') {
      discountPercent = this.enrollmentForm.get('discountPercent')?.value || 0;
      discountAmount = (originalPrice * discountPercent) / 100;
      this.enrollmentForm.patchValue({ discountAmount }, { emitEvent: false });
    } else {
      discountAmount = this.enrollmentForm.get('discountAmount')?.value || 0;
      discountPercent = originalPrice > 0 ? (discountAmount / originalPrice) * 100 : 0;
      this.enrollmentForm.patchValue({ discountPercent }, { emitEvent: false });
    }

    const finalPrice = Math.max(0, originalPrice - discountAmount);
    this.enrollmentForm.patchValue({ finalPrice }, { emitEvent: false });
  }

  onSubmit() {
    if (this.enrollmentForm.invalid) {
      this.enrollmentForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.enrollmentForm.value;

    const enrollmentData = {
      studentId: formValue.studentId,
      classId: formValue.classId,
      courseId: formValue.courseId,
      branchId: formValue.branchId,
      enrollmentDate: this.formatDate(formValue.enrollmentDate),
      status: formValue.status,
      originalPrice: formValue.originalPrice,
      discountPercent: formValue.discountPercent || 0,
      discountAmount: formValue.discountAmount || 0,
      finalPrice: formValue.finalPrice,
      paymentStatus: formValue.paymentStatus,
      notes: formValue.notes || undefined
    };

    if (this.isEditMode() && this.enrollmentId) {
      const updateData = {
        status: enrollmentData.status,
        paymentStatus: enrollmentData.paymentStatus,
        notes: enrollmentData.notes
      };

      this.enrollmentService.updateEnrollment(this.enrollmentId, updateData).subscribe({
        next: () => {
          this.notificationService.success('Enrollment updated successfully');
          this.router.navigate(['/students']);
        },
        error: () => {
          this.loading.set(false);
          this.notificationService.error('Failed to update enrollment');
        }
      });
    } else {
      this.enrollmentService.createEnrollment(enrollmentData).subscribe({
        next: () => {
          this.notificationService.success('Student enrolled successfully');
          this.router.navigate(['/students']);
        },
        error: () => {
          this.loading.set(false);
          this.notificationService.error('Failed to create enrollment');
        }
      });
    }
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  cancel() {
    this.router.navigate(['/students']);
  }

  get studentId() { return this.enrollmentForm.get('studentId'); }
  get branchId() { return this.enrollmentForm.get('branchId'); }
  get courseId() { return this.enrollmentForm.get('courseId'); }
  get classId() { return this.enrollmentForm.get('classId'); }
  get enrollmentDate() { return this.enrollmentForm.get('enrollmentDate'); }
}
