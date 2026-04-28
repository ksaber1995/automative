import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { DividerModule } from 'primeng/divider';
import { EnrollmentService } from '../services/enrollment.service';
import { StudentService } from '../../students/services/student.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { MasterCourseService } from '../../master-courses/services/master-course.service';
import { MasterEnrollmentService, CoverageInfo } from '../../master-courses/services/master-enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { EnrollmentStatus, PaymentMode } from '@shared/enums/enrollment-status.enum';
import { Student } from '@shared/interfaces/student.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Class } from '@shared/interfaces/class.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { MasterCourse } from '@shared/interfaces/master-course.interface';

type EnrollmentType = 'COURSE' | 'MASTER';

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
    RadioButtonModule,
    DividerModule,
  ],
  template: `
    <div class="container-custom py-8">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <h1 class="text-3xl font-bold text-gray-900">
            {{ isEditMode() ? 'Edit Enrollment' : 'Enroll Student in Course' }}
          </h1>
        </div>

        <p-card>
          <form [formGroup]="enrollmentForm" (ngSubmit)="onSubmit()">
            <!-- Enrollment type toggle -->
            @if (!isEditMode()) {
              <div class="mb-6">
                <div class="text-sm font-medium text-gray-700 mb-2">Enrollment Type</div>
                <div class="flex gap-3">
                  <button type="button"
                    class="relative flex-1 p-4 pr-10 border-2 rounded-lg text-left transition-all focus:outline-none"
                    [class]="enrollmentType() === 'COURSE'
                      ? 'border-blue-600 bg-blue-600 text-white shadow-lg shadow-blue-600/30 ring-2 ring-blue-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-gray-50'"
                    (click)="setEnrollmentType('COURSE')">
                    @if (enrollmentType() === 'COURSE') {
                      <span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-blue-600 flex items-center justify-center text-sm font-bold shadow">✓</span>
                    }
                    <div class="font-semibold text-base flex items-center gap-2">
                      <span class="text-xl">🎓</span> Single Course
                    </div>
                    <div class="text-xs mt-1" [class]="enrollmentType() === 'COURSE' ? 'text-blue-100' : 'text-gray-500'">
                      Enroll the student in one class of one course.
                    </div>
                  </button>
                  <button type="button"
                    class="relative flex-1 p-4 pr-10 border-2 rounded-lg text-left transition-all focus:outline-none"
                    [class]="enrollmentType() === 'MASTER'
                      ? 'border-purple-600 bg-purple-600 text-white shadow-lg shadow-purple-600/30 ring-2 ring-purple-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-purple-300 hover:bg-gray-50'"
                    (click)="setEnrollmentType('MASTER')">
                    @if (enrollmentType() === 'MASTER') {
                      <span class="absolute top-2 right-2 w-6 h-6 rounded-full bg-white text-purple-600 flex items-center justify-center text-sm font-bold shadow">✓</span>
                    }
                    <div class="font-semibold text-base flex items-center gap-2">
                      <span class="text-xl">🎁</span> Master Course Bundle
                    </div>
                    <div class="text-xs mt-1" [class]="enrollmentType() === 'MASTER' ? 'text-purple-100' : 'text-gray-500'">
                      One payment gives access to every course in the bundle.
                    </div>
                  </button>
                </div>
              </div>
            }

            @if (studentLocked() && studentBranchName()) {
              <div class="mb-4 px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-sm">
                <span class="text-gray-500">Branch:</span>
                <span class="ml-2 font-semibold text-gray-900">{{ studentBranchName() }}</span>
                <span class="ml-2 text-xs text-gray-400">(locked to the student's branch)</span>
              </div>
            }

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

              <!-- Branch (only shown when not locked to a student) -->
              @if (!studentLocked()) {
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-2">Branch <span class="text-red-500">*</span></label>
                  <p-select formControlName="branchId" [options]="branches()" optionLabel="name" optionValue="id"
                    placeholder="Select a branch" (onChange)="onBranchChange()" [style]="{ width: '100%' }"></p-select>
                  @if (f['branchId'].invalid && f['branchId'].touched) {
                    <small class="text-red-500">Branch is required</small>
                  }
                </div>
              }

              <!-- Student (only shown when not locked to a single student) -->
              @if (!studentLocked()) {
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-2">Student <span class="text-red-500">*</span></label>
                  <p-select formControlName="studentId" [options]="filteredStudents()" optionLabel="fullName" optionValue="id"
                    placeholder="Select a student" [filter]="true" (onChange)="onStudentChange()" [style]="{ width: '100%' }"
                    [disabled]="!f['branchId'].value"></p-select>
                  @if (!f['branchId'].value) { <small class="text-gray-500">Select a branch first</small> }
                  @if (f['branchId'].value && filteredStudents().length === 0) {
                    <small class="text-orange-500">No active students for this branch</small>
                  }
                  @if (f['studentId'].invalid && f['studentId'].touched) {
                    <small class="text-red-500">Student is required</small>
                  }
                </div>
              }

              <!-- Master Course (MASTER mode) -->
              @if (enrollmentType() === 'MASTER') {
                <div class="col-span-2">
                  <label class="block text-sm font-medium text-gray-700 mb-2">Master Course <span class="text-red-500">*</span></label>
                  <p-select formControlName="masterCourseId" [options]="filteredMasters()" optionLabel="name" optionValue="id"
                    placeholder="Select a master course" (onChange)="onMasterCourseChange()" [style]="{ width: '100%' }"
                    [disabled]="!f['branchId'].value">
                    <ng-template let-m pTemplate="item">
                      <div class="flex justify-between items-center gap-3">
                        <span>{{ m.name }} <span class="text-xs text-gray-500 font-mono ml-2">{{ m.code }}</span></span>
                        <span class="text-sm text-gray-600">{{ m.defaultPrice.toFixed(2) }}</span>
                      </div>
                    </ng-template>
                  </p-select>
                  @if (!f['branchId'].value) { <small class="text-gray-500">Select a branch first</small> }
                  @if (f['branchId'].value && filteredMasters().length === 0) {
                    <small class="text-orange-500">No active master courses for this branch</small>
                  }
                  @if (f['masterCourseId'].invalid && f['masterCourseId'].touched) {
                    <small class="text-red-500">Master course is required</small>
                  }
                </div>
              }

              <!-- Course (COURSE mode) -->
              @if (enrollmentType() === 'COURSE') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Course <span class="text-red-500">*</span></label>
                  <p-select formControlName="courseId" [options]="filteredCourses()" optionLabel="name" optionValue="id"
                    optionDisabled="disabled" placeholder="Select a course" (onChange)="onCourseChange()"
                    [style]="{ width: '100%' }" [disabled]="!f['branchId'].value">
                    <ng-template let-c pTemplate="item">
                      <div class="flex justify-between items-center gap-3 w-full" [class.opacity-50]="c.disabled">
                        <span>{{ c.name }}</span>
                        @if (c.disabled) {
                          <span class="text-xs text-gray-500 italic">already enrolled</span>
                        }
                      </div>
                    </ng-template>
                  </p-select>
                  @if (!f['branchId'].value) { <small class="text-gray-500">Select a branch first</small> }
                  @if (f['branchId'].value && filteredCourses().length === 0) {
                    <small class="text-orange-500">No active courses for this branch</small>
                  }
                </div>

                <!-- Class -->
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Class <span class="text-red-500">*</span></label>
                  <p-select formControlName="classId" [options]="filteredClasses()" optionLabel="name" optionValue="id"
                    placeholder="Select a class" [style]="{ width: '100%' }" [disabled]="!f['courseId'].value"></p-select>
                  @if (f['classId'].invalid && f['classId'].touched) {
                    <small class="text-red-500">Class is required</small>
                  }
                </div>
              }

              <!-- Enrollment Date -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Enrollment Date <span class="text-red-500">*</span></label>
                <p-datepicker formControlName="enrollmentDate" [showIcon]="true" dateFormat="yy-mm-dd"
                  placeholder="Select date" [style]="{ width: '100%' }"></p-datepicker>
              </div>

              <!-- Status -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Status <span class="text-red-500">*</span></label>
                <p-select formControlName="status" [options]="enrollmentStatuses" placeholder="Select status"
                  [style]="{ width: '100%' }"></p-select>
              </div>
            </div>

            @if (enrollmentType() === 'COURSE' && coverage()?.covered) {
              <div class="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                <div class="flex items-start gap-3">
                  <i class="pi pi-check-circle text-green-600 text-2xl mt-1"></i>
                  <div>
                    <p class="font-semibold text-green-800">Covered by master course</p>
                    <p class="text-sm text-green-700 mt-1">
                      This student is enrolled in <strong>{{ coverage()?.masterCourseName }}</strong>.
                      This course is included — no payment required.
                    </p>
                  </div>
                </div>
              </div>
            }

            @if (enrollmentType() === 'MASTER' && selectedMaster(); as m) {
              <p-divider></p-divider>
              <div class="p-4 rounded-lg bg-purple-50 border border-purple-200 mb-4">
                <div class="font-semibold text-purple-900">🎁 {{ m.name }}</div>
                <div class="text-sm text-purple-700 mt-1">
                  This bundle includes {{ linkedCourseCount() }} course(s). The student can enroll in any class inside those courses for free.
                </div>
              </div>
              @if (duplicateMaster()) {
                <div class="p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                  This student already has an active enrollment in this master course.
                </div>
              }
            }

            @if (showPricingBlock()) {
            <p-divider></p-divider>
            <h3 class="text-lg font-semibold text-gray-800 mb-4">Pricing</h3>

            <!-- Pricing summary card -->
            <div class="grid grid-cols-3 gap-4 mb-6">
              <div class="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center">
                <p class="text-xs text-gray-500 uppercase tracking-wider mb-1">Original Price</p>
                <p class="text-2xl font-bold text-gray-800">{{ originalPriceSig().toFixed(2) }}</p>
              </div>
              <div class="bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
                <p class="text-xs text-orange-600 uppercase tracking-wider mb-1">Discount</p>
                <p class="text-2xl font-bold text-orange-700">
                  {{ discountAmountSig().toFixed(2) }}
                  @if (discountPercentSig() > 0) {
                    <span class="text-sm font-normal ml-1">({{ discountPercentSig().toFixed(1) }}%)</span>
                  }
                </p>
              </div>
              <div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p class="text-xs text-green-600 uppercase tracking-wider mb-1">Final Price</p>
                <p class="text-2xl font-bold text-green-700">{{ finalPriceSig().toFixed(2) }}</p>
              </div>
            </div>

            <!-- Discount controls -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">Discount Type</label>
                <div class="flex flex-wrap gap-6">
                  <div class="flex items-center gap-2">
                    <p-radiobutton name="discountType" value="none" formControlName="discountType" (onClick)="setDiscountType('none')"></p-radiobutton>
                    <label>No Discount</label>
                  </div>
                  <div class="flex items-center gap-2">
                    <p-radiobutton name="discountType" value="percentage" formControlName="discountType" (onClick)="setDiscountType('percentage')"></p-radiobutton>
                    <label>By Percentage</label>
                  </div>
                  <div class="flex items-center gap-2">
                    <p-radiobutton name="discountType" value="amount" formControlName="discountType" (onClick)="setDiscountType('amount')"></p-radiobutton>
                    <label>By Fixed Amount</label>
                  </div>
                  <div class="flex items-center gap-2">
                    <p-radiobutton name="discountType" value="direct" formControlName="discountType" (onClick)="setDiscountType('direct')"></p-radiobutton>
                    <label>Set Final Price Directly</label>
                  </div>
                </div>
              </div>

              <!-- Percentage input -->
              @if (discountTypeSig() === 'percentage') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Discount %</label>
                  <p-inputnumber formControlName="discountPercent" suffix="%" [min]="0" [max]="100"
                    (onInput)="recalculate()" [style]="{ width: '100%' }" />
                </div>
              }

              <!-- Fixed amount input -->
              @if (discountTypeSig() === 'amount') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Discount Amount</label>
                  <p-inputnumber formControlName="discountAmount" [min]="0"
                    (onInput)="recalculate()" [style]="{ width: '100%' }" />
                </div>
              }

              <!-- Direct final price input -->
              @if (discountTypeSig() === 'direct') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Final Price</label>
                  <p-inputnumber formControlName="finalPrice" [min]="0"
                    (onInput)="onFinalPriceInput()" [style]="{ width: '100%' }" />
                </div>
              }
            </div>

            <p-divider></p-divider>
            <h3 class="text-lg font-semibold text-gray-800 mb-4">Payment</h3>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="col-span-2">
                <label class="block text-sm font-medium text-gray-700 mb-2">Payment Method <span class="text-red-500">*</span></label>
                <div class="flex gap-8">
                  <div class="flex items-center gap-3 p-4 border rounded-lg cursor-pointer flex-1"
                    [class.border-green-500]="paymentModeSig() === 'FULL'"
                    [class.bg-green-50]="paymentModeSig() === 'FULL'">
                    <p-radiobutton name="paymentMode" value="FULL" formControlName="paymentMode" (onClick)="paymentModeSig.set('FULL')"></p-radiobutton>
                    <div>
                      <p class="font-medium">Pay in Full</p>
                      <p class="text-sm text-gray-500">Full payment: {{ finalPriceSig().toFixed(2) }}</p>
                    </div>
                  </div>
                  <div class="flex items-center gap-3 p-4 border rounded-lg cursor-pointer flex-1"
                    [class.border-blue-500]="paymentModeSig() === 'INSTALLMENTS'"
                    [class.bg-blue-50]="paymentModeSig() === 'INSTALLMENTS'">
                    <p-radiobutton name="paymentMode" value="INSTALLMENTS" formControlName="paymentMode" (onClick)="paymentModeSig.set('INSTALLMENTS')"></p-radiobutton>
                    <div>
                      <p class="font-medium">Installments</p>
                      <p class="text-sm text-gray-500">Pay a down payment now, rest later</p>
                    </div>
                  </div>
                </div>
              </div>

              @if (paymentModeSig() === 'INSTALLMENTS') {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Down Payment <span class="text-red-500">*</span></label>
                  <p-inputnumber formControlName="downPayment" [min]="0" [max]="finalPriceSig()"
                    placeholder="First payment amount" (onInput)="downPaymentSig.set($event.value || 0)"
                    [style]="{ width: '100%' }" />
                  <small class="text-gray-500">
                    Remaining: <strong>{{ (finalPriceSig() - downPaymentSig()).toFixed(2) }}</strong>
                  </small>
                </div>
                <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <i class="pi pi-info-circle text-amber-500 mt-0.5"></i>
                  <p class="text-sm text-amber-700">Payment status will be <strong>Partial</strong> until the full amount of <strong>{{ finalPriceSig().toFixed(2) }}</strong> is paid.</p>
                </div>
              }
            </div>

            }

            <p-divider></p-divider>

            <!-- Notes -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea pTextarea formControlName="notes" rows="3" placeholder="Additional notes..." class="w-full"></textarea>
            </div>

            <div class="flex justify-end gap-3 mt-6 pt-4 border-t">
              <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="cancel()" type="button"></p-button>
              <p-button [label]="isEditMode() ? 'Update Enrollment' : 'Create Enrollment'" type="submit"
                [loading]="loading()" [disabled]="enrollmentForm.invalid"></p-button>
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
  private masterCourseService = inject(MasterCourseService);
  private masterEnrollmentService = inject(MasterEnrollmentService);

  enrollmentForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  enrollmentId: string | null = null;

  students = signal<(Student & { fullName: string })[]>([]);
  branches = signal<Branch[]>([]);
  courses = signal<Course[]>([]);
  classes = signal<Class[]>([]);
  masters = signal<MasterCourse[]>([]);
  selectedCourse = signal<Course | null>(null);
  selectedMaster = signal<MasterCourse | null>(null);
  selectedBranchId = signal<string | null>(null);
  selectedCourseId = signal<string | null>(null);
  enrollmentType = signal<EnrollmentType>('COURSE');
  linkedCourseCount = signal(0);
  duplicateMaster = signal(false);
  studentLocked = signal(false);
  studentBranchName = signal<string>('');
  enrolledCourseIds = signal<Set<string>>(new Set());

  // Signals for reactive display — avoids reading form.value in template
  originalPriceSig = signal(0);
  finalPriceSig = signal(0);
  discountAmountSig = signal(0);
  discountPercentSig = signal(0);
  discountTypeSig = signal<'none' | 'percentage' | 'amount' | 'direct'>('none');
  paymentModeSig = signal<'FULL' | 'INSTALLMENTS'>('FULL');
  downPaymentSig = signal(0);
  coverage = signal<CoverageInfo | null>(null);

  filteredStudents = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return [];
    return this.students().filter(s => String(s.branchId) === String(branchId));
  });

  filteredCourses = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return [];
    const enrolled = this.enrolledCourseIds();
    return this.courses()
      .filter(c => {
        const courseBranchId = c.branchId ? String(c.branchId) : null;
        return courseBranchId === String(branchId) || courseBranchId === null;
      })
      .map(c => ({ ...c, disabled: enrolled.has(c.id) }));
  });

  filteredClasses = computed(() => {
    const courseId = this.selectedCourseId();
    if (!courseId) return [];
    return this.classes().filter(c => c.courseId === courseId);
  });

  filteredMasters = computed(() => {
    const branchId = this.selectedBranchId();
    if (!branchId) return [];
    return this.masters().filter(m => m.isActive && m.branchId === branchId);
  });

  showPricingBlock = computed(() => {
    if (this.enrollmentType() === 'MASTER') return !!this.selectedMaster();
    return !!this.selectedCourse() && !this.coverage()?.covered;
  });

  enrollmentStatuses = [
    { label: 'Active', value: EnrollmentStatus.ACTIVE },
    { label: 'Pending', value: EnrollmentStatus.PENDING },
    { label: 'Completed', value: EnrollmentStatus.COMPLETED },
    { label: 'Dropped', value: EnrollmentStatus.DROPPED }
  ];

  constructor() {
    this.enrollmentForm = this.fb.group({
      studentId: ['', [Validators.required]],
      branchId: ['', [Validators.required]],
      courseId: ['', [Validators.required]],
      classId: ['', [Validators.required]],
      masterCourseId: [''],
      enrollmentDate: [new Date(), [Validators.required]],
      status: [EnrollmentStatus.ACTIVE, [Validators.required]],
      discountType: ['none'],
      discountPercent: [0],
      discountAmount: [0],
      finalPrice: [0],
      paymentMode: [PaymentMode.FULL, [Validators.required]],
      downPayment: [0],
      notes: ['']
    });
  }

  ngOnInit() {
    const studentId = this.route.snapshot.queryParamMap.get('studentId');
    const classId = this.route.snapshot.queryParamMap.get('classId');
    const courseId = this.route.snapshot.queryParamMap.get('courseId');
    const branchId = this.route.snapshot.queryParamMap.get('branchId');
    const typeParam = (this.route.snapshot.queryParamMap.get('type') || '').toUpperCase();
    if (typeParam === 'MASTER') this.setEnrollmentType('MASTER');

    this.loadData().then(() => {
      if (branchId) {
        this.enrollmentForm.patchValue({ branchId });
        this.selectedBranchId.set(branchId);
      }
      if (courseId) {
        this.enrollmentForm.patchValue({ courseId });
        this.selectedCourseId.set(courseId);
        const course = this.courses().find(c => c.id === courseId);
        if (course) {
          this.selectedCourse.set(course);
          this.setPrices(course.price, 0, 0, course.price);
        }
      }
      if (classId) {
        this.enrollmentForm.patchValue({ classId });
      }
      if (studentId) {
        this.enrollmentForm.patchValue({ studentId });
        // When opened from a student page, lock the branch to that student's branch.
        // The student can only enroll in courses/masters at their own branch.
        this.studentLocked.set(true);
        this.enrollmentForm.get('studentId')?.disable({ emitEvent: false });
        this.autoSelectStudentBranch(studentId, true);
        this.loadEnrolledCourseIds(studentId);
      }
    });

    this.enrollmentId = this.route.snapshot.paramMap.get('id');
    if (this.enrollmentId) {
      this.isEditMode.set(true);
      this.loadEnrollment(this.enrollmentId);
    }
  }

  /** Single source of truth for all price signals + form values */
  setPrices(originalPrice: number, discountAmount: number, discountPercent: number, finalPrice: number) {
    this.originalPriceSig.set(originalPrice);
    this.discountAmountSig.set(discountAmount);
    this.discountPercentSig.set(discountPercent);
    this.finalPriceSig.set(finalPrice);
    this.enrollmentForm.patchValue(
      { discountPercent, discountAmount, finalPrice },
      { emitEvent: false }
    );
  }

  autoSelectStudentBranch(studentId: string, lock = false) {
    this.studentService.getStudentById(studentId).subscribe({
      next: (student) => {
        if (student.branchId) {
          this.enrollmentForm.patchValue({ branchId: student.branchId });
          this.selectedBranchId.set(student.branchId);
          if (lock) {
            this.studentBranchName.set(this.branches().find(b => b.id === student.branchId)?.name || '');
            this.enrollmentForm.get('branchId')?.disable({ emitEvent: false });
          }
        }
      }
    });
  }

  loadData(): Promise<void> {
    return new Promise((resolve) => {
      let loaded = 0;
      const check = () => { if (++loaded === 5) resolve(); };
      this.branchService.getActiveBranches().subscribe({ next: (b) => { this.branches.set(b); check(); }, error: () => check() });
      this.courseService.getAllCourses().subscribe({ next: (c) => { this.courses.set(c.filter(x => x.isActive)); check(); }, error: () => check() });
      this.classService.getAllClasses().subscribe({ next: (c) => { this.classes.set(c.filter(x => x.isActive)); check(); }, error: () => check() });
      this.masterCourseService.getAll().subscribe({ next: (m) => { this.masters.set(m); check(); }, error: () => check() });
      this.studentService.getAllStudents().subscribe({
        next: (s) => { this.students.set(s.filter(x => x.isActive).map(x => ({ ...x, fullName: `${x.firstName} ${x.lastName}` }))); check(); },
        error: () => check()
      });
    });
  }

  loadEnrollment(id: string) {
    this.loading.set(true);
    this.enrollmentService.getEnrollmentById(id).subscribe({
      next: (enrollment) => {
        this.selectedBranchId.set(enrollment.branchId);
        this.selectedCourseId.set(enrollment.courseId);
        const course = this.courses().find(c => c.id === enrollment.courseId);
        if (course) this.selectedCourse.set(course);

        const dtype = enrollment.discountPercent > 0 ? 'percentage' : enrollment.discountAmount > 0 ? 'amount' : 'none';
        this.discountTypeSig.set(dtype as any);
        this.paymentModeSig.set((enrollment.paymentMode || 'FULL') as any);
        this.downPaymentSig.set(enrollment.downPayment || 0);

        this.enrollmentForm.patchValue({
          studentId: enrollment.studentId,
          branchId: enrollment.branchId,
          courseId: enrollment.courseId,
          classId: enrollment.classId,
          enrollmentDate: new Date(enrollment.enrollmentDate),
          status: enrollment.status,
          discountType: dtype,
          paymentMode: enrollment.paymentMode || PaymentMode.FULL,
          downPayment: enrollment.downPayment || 0,
          notes: enrollment.notes || ''
        });
        this.setPrices(
          enrollment.originalPrice,
          enrollment.discountAmount,
          enrollment.discountPercent,
          enrollment.finalPrice
        );
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
    this.selectedBranchId.set(this.enrollmentForm.get('branchId')?.value || null);
    if (!this.studentLocked()) {
      this.enrollmentForm.patchValue({ studentId: '' });
      this.coverage.set(null);
      this.enrolledCourseIds.set(new Set());
    }
    this.enrollmentForm.patchValue({ courseId: '', classId: '', masterCourseId: '' });
    this.selectedCourseId.set(null);
    this.selectedCourse.set(null);
    this.selectedMaster.set(null);
    this.linkedCourseCount.set(0);
    this.duplicateMaster.set(false);
    this.setPrices(0, 0, 0, 0);
    this.discountTypeSig.set('none');
    this.enrollmentForm.patchValue({ discountType: 'none' });
  }

  setEnrollmentType(t: EnrollmentType) {
    if (this.isEditMode()) return;
    this.enrollmentType.set(t);
    // Re-wire validators based on the chosen path.
    const courseCtl = this.enrollmentForm.get('courseId');
    const classCtl = this.enrollmentForm.get('classId');
    const masterCtl = this.enrollmentForm.get('masterCourseId');
    if (t === 'MASTER') {
      courseCtl?.clearValidators();
      classCtl?.clearValidators();
      masterCtl?.setValidators([Validators.required]);
      // Reset course fields and coverage state.
      this.enrollmentForm.patchValue({ courseId: '', classId: '' });
      this.selectedCourseId.set(null);
      this.selectedCourse.set(null);
      this.setPrices(0, 0, 0, 0);
      this.coverage.set(null);
    } else {
      masterCtl?.clearValidators();
      this.enrollmentForm.patchValue({ masterCourseId: '' });
      this.selectedMaster.set(null);
      this.linkedCourseCount.set(0);
      this.duplicateMaster.set(false);
      courseCtl?.setValidators([Validators.required]);
      classCtl?.setValidators([Validators.required]);
    }
    courseCtl?.updateValueAndValidity({ emitEvent: false });
    classCtl?.updateValueAndValidity({ emitEvent: false });
    masterCtl?.updateValueAndValidity({ emitEvent: false });
  }

  onMasterCourseChange() {
    const id: string | null = this.enrollmentForm.get('masterCourseId')?.value || null;
    if (!id) {
      this.selectedMaster.set(null);
      this.linkedCourseCount.set(0);
      this.duplicateMaster.set(false);
      this.setPrices(0, 0, 0, 0);
      this.discountTypeSig.set('none');
      this.enrollmentForm.patchValue({ discountType: 'none' });
      return;
    }
    const m = this.masters().find((x) => x.id === id) || null;
    this.selectedMaster.set(m);
    if (m) {
      this.setPrices(m.defaultPrice, 0, 0, m.defaultPrice);
      this.discountTypeSig.set('none');
      this.enrollmentForm.patchValue({ discountType: 'none' });
    }

    // Fetch linked courses count for the bundle info banner.
    this.masterCourseService.getLinkedCourses(id).subscribe({
      next: (rows) => this.linkedCourseCount.set(rows.length),
      error: () => this.linkedCourseCount.set(0),
    });

    // Check if this student already has an active master enrollment for this master.
    const studentId = this.enrollmentForm.get('studentId')?.value;
    this.duplicateMaster.set(false);
    if (studentId) {
      this.masterEnrollmentService.getByStudent(studentId).subscribe({
        next: (list) => {
          const dup = list.some((e) => e.masterCourseId === id && e.status === 'ACTIVE');
          this.duplicateMaster.set(dup);
        },
      });
    }
  }

  onCourseChange() {
    const courseId = this.enrollmentForm.get('courseId')?.value;
    this.selectedCourseId.set(courseId || null);
    if (courseId) {
      const course = this.courses().find(c => c.id === courseId);
      if (course) {
        this.selectedCourse.set(course);
        this.enrollmentForm.patchValue({ classId: '', discountType: 'none' });
        this.discountTypeSig.set('none');
        this.setPrices(course.price, 0, 0, course.price);
      }
    }
    this.checkCoverage();
  }

  onStudentChange() {
    const studentId = this.enrollmentForm.get('studentId')?.value;
    this.loadEnrolledCourseIds(studentId);
    this.checkCoverage();
  }

  loadEnrolledCourseIds(studentId: string | null | undefined) {
    if (!studentId) {
      this.enrolledCourseIds.set(new Set());
      return;
    }
    forkJoin({
      direct: this.enrollmentService.getEnrollmentsByStudent(studentId),
      masters: this.masterEnrollmentService.getByStudent(studentId),
    }).pipe(
      switchMap(({ direct, masters }) => {
        const directIds = direct
          .filter(e => e.status === EnrollmentStatus.ACTIVE)
          .map(e => e.courseId);
        const activeMasters = masters.filter(m => m.status === 'ACTIVE');
        if (activeMasters.length === 0) {
          return of(new Set<string>(directIds));
        }
        return forkJoin(
          activeMasters.map(m => this.masterCourseService.getLinkedCourses(m.masterCourseId))
        ).pipe(
          map(linkedLists => {
            const all = new Set<string>(directIds);
            linkedLists.forEach(list => list.forEach(c => all.add(c.id)));
            return all;
          })
        );
      })
    ).subscribe({
      next: (ids) => this.enrolledCourseIds.set(ids),
      error: () => this.enrolledCourseIds.set(new Set()),
    });
  }

  checkCoverage() {
    const studentId = this.enrollmentForm.get('studentId')?.value;
    const courseId = this.enrollmentForm.get('courseId')?.value;
    this.coverage.set(null);
    if (!studentId || !courseId || this.isEditMode()) return;
    this.masterEnrollmentService.checkCoverage(studentId, courseId).subscribe({
      next: (info) => this.coverage.set(info),
    });
  }

  setDiscountType(type: 'none' | 'percentage' | 'amount' | 'direct') {
    this.discountTypeSig.set(type);
    this.enrollmentForm.patchValue({ discountType: type });
    this.recalculate(type);
  }

  recalculate(typeOverride?: string) {
    const original = this.originalPriceSig();
    const type = typeOverride ?? this.discountTypeSig();

    if (type === 'none') {
      this.setPrices(original, 0, 0, original);
    } else if (type === 'percentage') {
      const pct = this.enrollmentForm.get('discountPercent')?.value || 0;
      const amt = (original * pct) / 100;
      this.setPrices(original, amt, pct, Math.max(0, original - amt));
    } else if (type === 'amount') {
      const amt = this.enrollmentForm.get('discountAmount')?.value || 0;
      const pct = original > 0 ? (amt / original) * 100 : 0;
      this.setPrices(original, amt, pct, Math.max(0, original - amt));
    }
  }

  onFinalPriceInput() {
    const original = this.originalPriceSig();
    const finalPrice = this.enrollmentForm.get('finalPrice')?.value || 0;
    const discountAmt = Math.max(0, original - finalPrice);
    const discountPct = original > 0 ? (discountAmt / original) * 100 : 0;
    this.finalPriceSig.set(finalPrice);
    this.discountAmountSig.set(discountAmt);
    this.discountPercentSig.set(discountPct);
    this.enrollmentForm.patchValue({ discountAmount: discountAmt, discountPercent: discountPct }, { emitEvent: false });
  }

  onSubmit() {
    if (this.enrollmentForm.invalid) {
      this.enrollmentForm.markAllAsTouched();
      return;
    }
    const v = this.enrollmentForm.getRawValue();

    if (!this.isEditMode() && this.enrollmentType() === 'MASTER') {
      if (this.duplicateMaster()) {
        this.notificationService.error('Student already has an active enrollment in this master course');
        return;
      }
      this.loading.set(true);
      const finalPrice = this.finalPriceSig();
      const paymentMode: 'FULL' | 'INSTALLMENTS' = v.paymentMode === 'INSTALLMENTS' ? 'INSTALLMENTS' : 'FULL';
      const downPayment = paymentMode === 'INSTALLMENTS' ? (v.downPayment || 0) : 0;
      const amountPaid = paymentMode === 'FULL' ? finalPrice : downPayment;
      this.masterEnrollmentService.create({
        studentId: v.studentId,
        masterCourseId: v.masterCourseId,
        enrollmentDate: this.formatDate(v.enrollmentDate),
        originalPrice: this.originalPriceSig(),
        discountPercent: this.discountPercentSig(),
        discountAmount: this.discountAmountSig(),
        finalPrice,
        paymentMode,
        downPayment,
        amountPaid,
        notes: v.notes || undefined,
      }).subscribe({
        next: () => {
          this.notificationService.success('Student enrolled in master course bundle');
          this.router.navigate(['/students', v.studentId]);
        },
        error: (err) => {
          this.loading.set(false);
          this.notificationService.error(err?.error?.message || 'Failed to enroll in master course');
        },
      });
      return;
    }

    this.loading.set(true);
    const enrollmentData = {
      studentId: v.studentId,
      classId: v.classId,
      courseId: v.courseId,
      branchId: v.branchId,
      enrollmentDate: this.formatDate(v.enrollmentDate),
      status: v.status,
      originalPrice: this.originalPriceSig(),
      discountPercent: this.discountPercentSig(),
      discountAmount: this.discountAmountSig(),
      finalPrice: this.finalPriceSig(),
      paymentMode: v.paymentMode,
      downPayment: v.paymentMode === 'INSTALLMENTS' ? (v.downPayment || 0) : 0,
      notes: v.notes || undefined
    };

    if (this.isEditMode() && this.enrollmentId) {
      this.enrollmentService.updateEnrollment(this.enrollmentId, { status: enrollmentData.status, notes: enrollmentData.notes }).subscribe({
        next: () => { this.notificationService.success('Enrollment updated'); this.router.navigate(['/students']); },
        error: () => { this.loading.set(false); this.notificationService.error('Failed to update enrollment'); }
      });
    } else {
      this.enrollmentService.createEnrollment(enrollmentData).subscribe({
        next: () => { this.notificationService.success('Student enrolled successfully'); this.router.navigate(['/students']); },
        error: () => { this.loading.set(false); this.notificationService.error('Failed to create enrollment'); }
      });
    }
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  cancel() { this.router.navigate(['/students']); }

  get f() { return this.enrollmentForm.controls; }
}
