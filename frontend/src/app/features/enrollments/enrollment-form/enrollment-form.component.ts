import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { DividerModule } from 'primeng/divider';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { EnrollmentService } from '../services/enrollment.service';
import { StudentService } from '../../students/services/student.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { BranchService } from '../../branches/services/branch.service';
import { MasterCourseService } from '../../master-courses/services/master-course.service';
import { MasterEnrollmentService, CoverageInfo } from '../../master-courses/services/master-enrollment.service';
import { MonthlySubscriptionsService } from '../../monthly-subscriptions/monthly-subscriptions.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { EnrollmentStatus, PaymentMode } from '@shared/enums/enrollment-status.enum';
import { Student } from '@shared/interfaces/student.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Class } from '@shared/interfaces/class.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { MasterCourse } from '@shared/interfaces/master-course.interface';
import { CourseProductService } from '../../educational-books/services/course-product.service';
import { CourseProduct } from '@shared/interfaces/course-product.interface';
import { DiscountType } from '@shared/enums/product.enum';

type EnrollmentType = 'COURSE' | 'MASTER';

@Component({
  selector: 'app-enrollment-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    TranslateModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    SelectModule,
    DatePickerModule,
    TextareaModule,
    RadioButtonModule,
    DividerModule,
    CheckboxModule,
    TagModule,
    AmountPipe,
  ],
  templateUrl: './enrollment-form.component.html'
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
  private translate = inject(TranslateService);
  private authService = inject(AuthService);
  private courseProductService = inject(CourseProductService);
  protected branchState = inject(BranchStateService);
  private monthlySubService = inject(MonthlySubscriptionsService);

  /** TEACHER companies don't use master courses, so hide the bundle toggle. */
  isTeacher = computed(() => this.authService.currentUser()?.companyType === 'TEACHER');

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
  // Monthly-subscription enrollment: pay the start month now or defer it.
  monthlyPayOptionSig = signal<'PAY_NOW' | 'PAY_LATER'>('PAY_LATER');
  // Monthly price override info for display hint
  monthlyOverridePrice = signal<number | null>(null);
  monthlyOverrideMonth = signal<string>(''); // e.g. "June 2026"

  // True when the selected single course is billed as a monthly subscription.
  isMonthly = computed(() =>
    this.enrollmentType() === 'COURSE' &&
    this.selectedCourse()?.paymentType === 'MONTHLY_SUBSCRIPTION'
  );

  // ─── Educational Books: products linked to the selected course ──────────────
  // Linked products for the selected course (COURSE mode only).
  courseBooks = signal<CourseProduct[]>([]);
  // Set of selected (to-be-bought) courseProduct ids.
  selectedBookIds = signal<Set<string>>(new Set());
  // Per-book discount overrides (bookId → { discountType, discountValue }).
  bookOverrides = signal<Map<string, { discountType: DiscountType; discountValue: number }>>(new Map());
  discountTypeOptions = [
    { label: 'ENROLLMENT_FORM.BOOK_DISCOUNT_NONE', value: DiscountType.NONE },
    { label: 'ENROLLMENT_FORM.BOOK_DISCOUNT_PERCENTAGE', value: DiscountType.PERCENTAGE },
    { label: 'ENROLLMENT_FORM.BOOK_DISCOUNT_FIXED', value: DiscountType.FIXED_AMOUNT },
  ];

  // Books are hidden for monthly-subscription courses (backend ignores products there).
  showBooksSection = computed(() =>
    this.enrollmentType() === 'COURSE' &&
    !this.isMonthly() &&
    this.courseBooks().length > 0
  );

  // Net total of the currently selected books (selling price minus discount).
  booksNetTotal = computed(() => {
    const selected = this.selectedBookIds();
    const overrides = this.bookOverrides();
    return this.courseBooks()
      .filter(b => selected.has(b.id))
      .reduce((sum, b) => sum + this.bookNetPrice(b, overrides.get(b.id)), 0);
  });

  selectedBooksCount = computed(() => {
    const selected = this.selectedBookIds();
    return this.courseBooks().filter(b => selected.has(b.id)).length;
  });

  // Enrollment final price + selected books net total.
  grandTotal = computed(() => this.finalPriceSig() + this.booksNetTotal());

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

  get enrollmentStatuses() {
    return [
      { label: this.translate.instant('ENROLLMENT_FORM.STATUS_ACTIVE'), value: EnrollmentStatus.ACTIVE },
      { label: this.translate.instant('ENROLLMENT_FORM.STATUS_PENDING'), value: EnrollmentStatus.PENDING },
      { label: this.translate.instant('ENROLLMENT_FORM.STATUS_COMPLETED'), value: EnrollmentStatus.COMPLETED },
      { label: this.translate.instant('ENROLLMENT_FORM.STATUS_DROPPED'), value: EnrollmentStatus.DROPPED }
    ];
  }

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
      monthlyPayOption: ['PAY_LATER'],
      notes: ['']
    });
  }

  ngOnInit() {
    const studentId = this.route.snapshot.queryParamMap.get('studentId');
    const classId = this.route.snapshot.queryParamMap.get('classId');
    const courseId = this.route.snapshot.queryParamMap.get('courseId');
    const branchId = this.route.snapshot.queryParamMap.get('branchId');
    const typeParam = (this.route.snapshot.queryParamMap.get('type') || '').toUpperCase();
    if (typeParam === 'MASTER' && !this.isTeacher()) this.setEnrollmentType('MASTER');

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
        // Load linked books for the pre-selected course (COURSE mode only).
        this.loadCourseBooks(courseId);
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
      this.branchService.getActiveBranches().subscribe({ next: (b) => { this.branches.set(b);
        if (b.length === 1 && !this.isEditMode()) {
          const ctrl = this.enrollmentForm.get('branchId');
          if (ctrl && !ctrl.value) { ctrl.setValue(b[0].id); this.onBranchChange(); }
        }
        check(); }, error: () => check() });
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
        // Interceptor toasted the translated error.
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
    // Course was cleared — drop any linked books.
    this.courseBooks.set([]);
    this.selectedBookIds.set(new Set());
    this.bookOverrides.set(new Map());
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
      // MASTER mode has no per-course books.
      this.courseBooks.set([]);
      this.selectedBookIds.set(new Set());
      this.bookOverrides.set(new Map());
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
    this.monthlyOverridePrice.set(null);
    this.monthlyOverrideMonth.set('');
    if (courseId) {
      const course = this.courses().find(c => c.id === courseId);
      if (course) {
        this.selectedCourse.set(course);
        this.enrollmentForm.patchValue({ classId: '', discountType: 'none' });
        this.discountTypeSig.set('none');
        this.setPrices(course.price, 0, 0, course.price);
      }
    }
    // Refresh the linked-books list for the newly selected course.
    this.loadCourseBooks(courseId || null);
    this.checkCoverage();
  }

  onClassChange() {
    const classId = this.enrollmentForm.get('classId')?.value;
    if (!classId) return;
    const cls = this.classes().find(c => c.id === classId);
    if (!cls) return;
    const classStart = new Date(cls.startDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    classStart.setHours(0, 0, 0, 0);
    const enrollDate = classStart > today ? classStart : today;
    this.enrollmentForm.patchValue({ enrollmentDate: enrollDate });
    this.checkMonthlyPriceOverride(enrollDate);
  }

  /** When enrollment date changes manually via the date picker. */
  onEnrollmentDateChange() {
    const d = this.enrollmentForm.get('enrollmentDate')?.value;
    if (d instanceof Date) {
      this.checkMonthlyPriceOverride(d);
    }
  }

  /**
   * For monthly-subscription courses, check if the enrollment start month has a
   * price override. If so, update the displayed price and show a hint.
   */
  private checkMonthlyPriceOverride(enrollDate: Date) {
    const course = this.selectedCourse();
    if (!course || course.paymentType !== 'MONTHLY_SUBSCRIPTION') {
      this.monthlyOverridePrice.set(null);
      this.monthlyOverrideMonth.set('');
      return;
    }
    const year = enrollDate.getFullYear();
    const month = enrollDate.getMonth() + 1;
    this.monthlySubService.getPriceOverride(course.id, year, month).subscribe({
      next: (ov) => {
        if (ov && ov.overridePrice !== course.price) {
          this.monthlyOverridePrice.set(ov.overridePrice);
          const monthName = enrollDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          this.monthlyOverrideMonth.set(monthName);
          // Update the price to the override
          this.setPrices(ov.overridePrice, 0, 0, ov.overridePrice);
          this.discountTypeSig.set('none');
          this.enrollmentForm.patchValue({ discountType: 'none' });
        } else {
          this.monthlyOverridePrice.set(null);
          this.monthlyOverrideMonth.set('');
          // Reset to base course price
          this.setPrices(course.price, 0, 0, course.price);
          this.discountTypeSig.set('none');
          this.enrollmentForm.patchValue({ discountType: 'none' });
        }
      },
      error: () => {
        this.monthlyOverridePrice.set(null);
        this.monthlyOverrideMonth.set('');
      },
    });
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
        this.notificationService.error(this.translate.instant('ENROLLMENT_FORM.ERR_DUPLICATE_MASTER'));
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
          this.notificationService.success(this.translate.instant('ENROLLMENT_FORM.MSG_MASTER_ENROLLED'));
          this.router.navigate(['/students', v.studentId]);
        },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        },
      });
      return;
    }

    this.loading.set(true);
    const monthly = this.isMonthly();
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
      // Monthly courses are billed per month — no installments; finalPrice is the
      // discounted monthly fee and payFirstMonth records the start month up-front.
      paymentMode: monthly ? PaymentMode.FULL : v.paymentMode,
      downPayment: (!monthly && v.paymentMode === 'INSTALLMENTS') ? (v.downPayment || 0) : 0,
      paymentType: monthly ? 'MONTHLY_SUBSCRIPTION' as const : 'ONE_TIME' as const,
      payFirstMonth: monthly ? this.monthlyPayOptionSig() === 'PAY_NOW' : undefined,
      notes: v.notes || undefined
    };

    if (this.isEditMode() && this.enrollmentId) {
      this.enrollmentService.updateEnrollment(this.enrollmentId, { status: enrollmentData.status, notes: enrollmentData.notes }).subscribe({
        next: () => { this.notificationService.success(this.translate.instant('ENROLLMENT_FORM.MSG_ENROLLMENT_UPDATED')); this.router.navigate(['/students']); },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    } else {
      // Educational Books: attach selected linked products (COURSE mode, non-monthly only).
      const createData: typeof enrollmentData & {
        products?: Array<{ productId: string; quantity: number; discountType: DiscountType; discountValue: number }>;
      } = { ...enrollmentData };
      if (this.enrollmentType() === 'COURSE' && !monthly) {
        const selected = this.selectedBookIds();
        const overrides = this.bookOverrides();
        const products = this.courseBooks()
          .filter(b => selected.has(b.id))
          .map(b => {
            const o = overrides.get(b.id);
            return {
              productId: b.productId,
              quantity: 1,
              discountType: o?.discountType ?? b.defaultDiscountType,
              discountValue: o?.discountValue ?? b.defaultDiscountValue,
            };
          });
        if (products.length > 0) createData.products = products;
      }
      this.enrollmentService.createEnrollment(createData).subscribe({
        next: () => { this.notificationService.success(this.translate.instant('ENROLLMENT_FORM.MSG_ENROLLMENT_CREATED')); this.router.navigate(['/students']); },
        error: () => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
        }
      });
    }
  }

  // ─── Educational Books helpers ──────────────────────────────────────────────

  /** Fetch the products linked to the given course (COURSE mode only). */
  loadCourseBooks(courseId: string | null | undefined) {
    this.courseBooks.set([]);
    this.selectedBookIds.set(new Set());
    this.bookOverrides.set(new Map());
    if (!courseId || this.enrollmentType() !== 'COURSE') return;
    this.courseProductService.list(courseId).subscribe({
      next: (books) => {
        this.courseBooks.set(books);
        // Pre-check required items by default (still toggleable).
        const preChecked = new Set(books.filter(b => b.isRequired).map(b => b.id));
        this.selectedBookIds.set(preChecked);
        // Initialize overrides from default discounts.
        const overrides = new Map<string, { discountType: DiscountType; discountValue: number }>();
        for (const b of books) {
          overrides.set(b.id, {
            discountType: b.defaultDiscountType || DiscountType.NONE,
            discountValue: b.defaultDiscountValue || 0,
          });
        }
        this.bookOverrides.set(overrides);
      },
      error: () => {
        this.courseBooks.set([]);
        this.selectedBookIds.set(new Set());
        this.bookOverrides.set(new Map());
      },
    });
  }

  /** Toggle a book in/out of the selection. */
  toggleBook(book: CourseProduct, checked: boolean) {
    const next = new Set(this.selectedBookIds());
    if (checked) next.add(book.id); else next.delete(book.id);
    this.selectedBookIds.set(next);
  }

  isBookSelected(book: CourseProduct): boolean {
    return this.selectedBookIds().has(book.id);
  }

  /** Net unit price after applying the discount (override or default). */
  bookNetPrice(book: CourseProduct, override?: { discountType: DiscountType; discountValue: number }): number {
    const price = book.sellingPrice || 0;
    const o = override || this.bookOverrides().get(book.id);
    const type = o?.discountType ?? book.defaultDiscountType;
    const value = o?.discountValue ?? book.defaultDiscountValue ?? 0;
    if (type === DiscountType.PERCENTAGE) {
      return Math.max(0, price - (price * value) / 100);
    }
    if (type === DiscountType.FIXED_AMOUNT) {
      return Math.max(0, price - value);
    }
    return price;
  }

  /** Update discount override for a book. */
  setBookDiscountType(bookId: string, type: DiscountType) {
    const next = new Map(this.bookOverrides());
    const existing = next.get(bookId) || { discountType: DiscountType.NONE, discountValue: 0 };
    next.set(bookId, { ...existing, discountType: type, discountValue: type === DiscountType.NONE ? 0 : existing.discountValue });
    this.bookOverrides.set(next);
  }

  setBookDiscountValue(bookId: string, value: number) {
    const next = new Map(this.bookOverrides());
    const existing = next.get(bookId) || { discountType: DiscountType.NONE, discountValue: 0 };
    next.set(bookId, { ...existing, discountValue: value || 0 });
    this.bookOverrides.set(next);
  }

  getBookOverride(bookId: string): { discountType: DiscountType; discountValue: number } {
    return this.bookOverrides().get(bookId) || { discountType: DiscountType.NONE, discountValue: 0 };
  }

  formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  cancel() { this.router.navigate(['/students']); }

  get f() { return this.enrollmentForm.controls; }
}
