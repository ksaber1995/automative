import { Component, OnInit, inject, signal, computed, DestroyRef, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { SelectModule } from 'primeng/select';
import { ProgressBarModule } from 'primeng/progressbar';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { StudentQrDialogComponent } from '../student-qr/student-qr-dialog.component';
import { openWhatsappChat } from '../../../core/utils/whatsapp.util';
import { GlobalScanService } from '../../../core/services/global-scan.service';
import { QrCard, QrCardService } from '../../qr-cards/qr-card.service';
import { serialLabel } from '../../qr-cards/qr-cards.component';
import { StudentService } from '../services/student.service';
import { CARD_SERIAL_BASE, formatStudentCode, normalizeStudentCode, shouldShowStudentCode } from '../../../core/utils/student-code.util';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { MasterEnrollmentService } from '../../master-courses/services/master-enrollment.service';
import { MasterCourseService } from '../../master-courses/services/master-course.service';
import { MasterClassEnrollmentService } from '../../master-courses/services/master-class-enrollment.service';
import { MonthlySubscriptionsService } from '../../monthly-subscriptions/monthly-subscriptions.service';
import { SessionPaymentsService } from '../../session-payments/session-payments.service';
import { SessionPayDialogComponent } from '../../session-payments/session-pay-dialog/session-pay-dialog.component';
import { NotificationService } from '../../../core/services/notification.service';
import { ReceiptService } from '../../../core/services/receipt.service';
import { ApiService } from '../../../core/services/api.service';
import { PaymentReceipt } from '../../public/receipt/receipt.component';
import { AuthService } from '../../../core/services/auth.service';
import { AttendanceService, StudentAttendanceRecord } from '../../rooms/services/attendance.service';
import { ProductSaleService } from '../../products/services/product-sale.service';
import { ExamService } from '../../exams/services/exam.service';
import { ratingLabelKey } from '../../exams/homework-rating.util';
import { Student } from '@shared/interfaces/student.interface';
import { StudentExamResult } from '@shared/interfaces/exam.interface';
import { Enrollment, EnrollmentPayment, Refund } from '@shared/interfaces/enrollment.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Class, ClassWithDetails } from '@shared/interfaces/class.interface';
import { MasterEnrollmentProgress } from '@shared/interfaces/master-enrollment.interface';
import { MasterClassEnrollment } from '@shared/interfaces/master-class-enrollment.interface';
import { LinkedCourseSummary } from '@shared/interfaces/master-course.interface';
import { MonthlyPaymentWithDetails } from '@shared/interfaces/monthly-subscription.interface';
import { SessionPaymentWithDetails, SessionPackageWithDetails } from '@shared/interfaces/session-payment.interface';
import { ProductSale } from '@shared/interfaces/product-sale.interface';

@Component({
  selector: 'app-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    TooltipModule,
    DialogModule,
    ConfirmDialogModule,
    InputNumberModule,
    // The link-card field is a plain pInputText (it takes a typed serial or a
    // scanned token) — without this import the directive is inert and it renders
    // as an unstyled browser input.
    InputTextModule,
    DatePickerModule,
    TextareaModule,
    RadioButtonModule,
    SelectModule,
    ProgressBarModule,
    TabsModule,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    TranslateModule,
    AmountPipe,
    StudentQrDialogComponent,
    SessionPayDialogComponent,
  ],
  templateUrl: './student-detail.component.html',
  styleUrl: './student-detail.component.scss',
  providers: [ConfirmationService],
})
export class StudentDetailComponent implements OnInit {
  @ViewChild(SessionPayDialogComponent) sessionPayDialog?: SessionPayDialogComponent;
  private studentService = inject(StudentService);
  private enrollmentService = inject(EnrollmentService);
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private masterEnrollmentService = inject(MasterEnrollmentService);
  private masterCourseService = inject(MasterCourseService);
  private masterClassEnrollmentService = inject(MasterClassEnrollmentService);
  private monthlyService = inject(MonthlySubscriptionsService);
  private sessionPaymentsService = inject(SessionPaymentsService);
  private attendanceService = inject(AttendanceService);
  private productSaleService = inject(ProductSaleService);
  private examService = inject(ExamService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private receiptService = inject(ReceiptService);
  private api = inject(ApiService);
  private translate = inject(TranslateService);
  private authService = inject(AuthService);
  private confirmationService = inject(ConfirmationService);
  private destroyRef = inject(DestroyRef);

  /** TEACHER companies don't use master courses, so hide that whole section. */
  isTeacher = computed(() => this.authService.currentUser()?.companyType === 'TEACHER');

  /** Show the student code only once the QR is active (see student-code.util). */
  showCode = (s: any) => shouldShowStudentCode(s);
  /** A card-derived code reads "A5", not 100005. */
  code = formatStudentCode;

  student = signal<Student | null>(null);
  showQrDialog = signal(false);

  /**
   * Click-to-chat the student's notes to their parent, from the staff member's own
   * WhatsApp. The notes are the whole point of the message, so the button is
   * disabled when there are none (or no parent number to send them to) rather than
   * sending an empty-bodied message.
   */
  // ── Send notes to the parent ────────────────────────────────────────────────
  // The note is written here, in the dialog — gating the button on the student
  // already HAVING notes made it useless exactly when you want it, since there was
  // no way to write one. The student's saved notes just seed the box.
  notesDialogOpen = signal(false);
  notesDraft = signal('');

  openNotesDialog(): void {
    const s = this.student();
    this.notesDraft.set(s?.notes?.trim() || '');
    this.notesDialogOpen.set(true);
  }

  /** Click-to-chat the typed note to the parent, from the staff member's own WhatsApp. */
  sendNotesToParent(): void {
    const s = this.student();
    const notes = this.notesDraft().trim();
    if (!s || !notes) return;

    const text = this.translate.instant('WHATSAPP.NOTES_PARENT_BODY', {
      academyName: this.authService.getCompanyName(),
      parentName: s.parentName || '',
      studentName: s.name,
      notes,
    });
    if (openWhatsappChat(s.parentPhone, text)) {
      this.notesDialogOpen.set(false);
    } else {
      this.notificationService.error(this.translate.instant('STUDENTS.DETAIL.SEND_NOTES_NO_PHONE'));
    }
  }
  enrollments = signal<Enrollment[]>([]);
  masterEnrollments = signal<MasterEnrollmentProgress[]>([]);
  classDoneMap = signal<Map<string, boolean>>(new Map());
  /** classId → class name, so an enrollment row can show which class the student is in. */
  classNameMap = signal<Map<string, string>>(new Map());

  private isEnrollmentFinished(e: Enrollment): boolean {
    return this.classDoneMap().get(e.classId) === true;
  }

  /**
   * Which enrollment tab is showing. Held here rather than left to PrimeNG
   * because Active and Withdrawn share one table — same columns, same row
   * actions — switched by `tabEnrollments()`.
   */
  enrollmentTab = signal<'active-courses' | 'withdrawn-courses' | 'finished-courses'>('active-courses');

  /**
   * The student left this course. Withdrawn wins over both other tabs, so a
   * dropped enrollment appears in exactly one place — its own — instead of
   * sitting among the courses the student is actually taking.
   */
  withdrawnEnrollments = computed(() => this.enrollments().filter(e => e.status === 'DROPPED'));
  activeEnrollments = computed(() => this.enrollments().filter(e => e.status !== 'DROPPED' && !this.isEnrollmentFinished(e)));
  finishedEnrollments = computed(() => this.enrollments().filter(e => e.status !== 'DROPPED' && this.isEnrollmentFinished(e)));
  /** Rows for the table shared by the Active and Withdrawn tabs. */
  tabEnrollments = computed(() =>
    this.enrollmentTab() === 'withdrawn-courses' ? this.withdrawnEnrollments() : this.activeEnrollments()
  );
  activeMasterEnrollments = computed(() => this.masterEnrollments().filter(m => m.status !== 'COMPLETED'));
  finishedMasterEnrollments = computed(() => this.masterEnrollments().filter(m => m.status === 'COMPLETED'));
  courses = new Map<string, Course>();
  loading = signal(true);
  studentId: string | null = null;

  // Expandable rows (course enrollments)
  expandedRows: { [key: string]: boolean } = {};
  paymentHistoryMap = signal<Map<string, EnrollmentPayment[]>>(new Map());
  refundHistoryMap = signal<Map<string, Refund[]>>(new Map());

  // Monthly-subscription bills, grouped by enrollmentId (newest month first).
  monthlyByEnrollment = signal<Map<string, MonthlyPaymentWithDetails[]>>(new Map());

  // Per-session charges + prepaid packages, grouped by enrollmentId.
  sessionPaymentsByEnrollment = signal<Map<string, SessionPaymentWithDetails[]>>(new Map());
  sessionPackagesByEnrollment = signal<Map<string, SessionPackageWithDetails[]>>(new Map());

  // Monthly-subscription payment dialog
  showMonthlyPayDialog = false;
  monthlyForAction = signal<MonthlyPaymentWithDetails | null>(null);
  monthlyDialogAmount: number | null = null;
  monthlyDialogDate: Date = new Date();
  monthlyDialogNotes = '';
  monthlyRemaining = computed(() => {
    const m = this.monthlyForAction();
    if (!m) return 0;
    return Math.max(0, m.amountDue - (m.amountPaid || 0));
  });

  // Expandable rows (master enrollments → linked courses + payment history)
  expandedMasterRows: { [key: string]: boolean } = {};
  linkedCoursesMap = signal<Map<string, LinkedCourseSummary[]>>(new Map());
  masterClassEnrollmentsMap = signal<Map<string, MasterClassEnrollment[]>>(new Map());
  masterPaymentHistoryMap = signal<Map<string, EnrollmentPayment[]>>(new Map());

  // Master payment dialog
  showMasterPaymentDialog = false;
  masterDialogPaymentAmount: number | null = null;
  masterDialogPaymentDate: Date = new Date();
  masterDialogPaymentNotes = '';

  masterPaymentRemaining = computed(() => {
    const me = this.masterEnrollmentForAction();
    if (!me) return 0;
    return Math.max(0, me.finalPrice - (me.amountPaid || 0));
  });

  // Action state
  enrollmentForAction = signal<Enrollment | null>(null);
  actionLoading = signal(false);

  remaining = computed(() => {
    const e = this.enrollmentForAction();
    if (!e) return 0;
    return Math.max(0, e.finalPrice - (e.amountPaid || 0));
  });

  // Payment dialog
  showPaymentDialog = false;
  dialogPaymentAmount: number | null = null;
  dialogPaymentDate: Date = new Date();
  dialogPaymentNotes = '';

  // Edit-price dialog — override the final price this student pays for a course.
  showEditPriceDialog = false;
  editPriceEnrollment = signal<Enrollment | null>(null);
  editPriceValue: number | null = null;

  // Refund dialog (regular enrollment)
  showRefundDialog = false;
  refundType: 'FULL' | 'PARTIAL' = 'FULL';
  refundAmount: number | null = null;
  refundDate: Date = new Date();
  refundReason = '';

  // Refund dialog (master enrollment / bundle)
  showMasterRefundDialog = false;
  masterEnrollmentForAction = signal<MasterEnrollmentProgress | null>(null);
  masterRefundType: 'FULL' | 'PARTIAL' = 'FULL';
  masterRefundAmount: number | null = null;
  masterRefundDate: Date = new Date();
  masterRefundReason = '';

  masterRefundable = computed(() => {
    const me = this.masterEnrollmentForAction();
    if (!me) return 0;
    return Math.max(0, (me.amountPaid || 0) - (me.totalRefunded || 0));
  });

  // Join bundle course dialog
  showJoinBundleCourseDialog = false;
  joinBundleCourseClasses = signal<Class[]>([]);
  joinBundleCourseLoading = signal(false);
  selectedJoinClass = signal<Class | null>(null);
  private joinBundleCourseId: string | null = null;
  private joinBundleMasterEnrollmentId: string | null = null;

  // ── Change-class dialog ─────────────────────────────────────────────────────
  showChangeClassDialog = false;
  changeClassEnrollment = signal<Enrollment | null>(null);
  changeClassCurrentName = signal<string>('');
  changeClassOptions = signal<ClassWithDetails[]>([]);
  changeClassLoading = signal(false);
  changeClassSubmitting = signal(false);
  selectedChangeClass = signal<ClassWithDetails | null>(null);

  /** Live student count for a class (live COUNT, falling back to the stored counter). */
  classCount(cls: ClassWithDetails): number {
    return cls.studentCount ?? cls.currentEnrollment ?? 0;
  }

  /** Is a class at or over its max capacity? (warn-but-allow) */
  isClassFull(cls: ClassWithDetails | null): boolean {
    return !!cls && cls.maxStudents != null && this.classCount(cls) >= cls.maxStudents;
  }

  // Books & Products purchases attributed to this student.
  bookPurchases = signal<ProductSale[]>([]);

  // Exam grades. Homework rides on the same table and arrives in this one feed,
  // so the two cards below split it — otherwise homework would silently pad the
  // exam results.
  examResults = signal<StudentExamResult[]>([]);
  loadingExams = signal(false);

  /** Class filter shared by the exam and homework cards (null = every class). */
  examClassFilter = signal<string | null>(null);

  /**
   * The words the teacher actually picked, for a mark recorded by rating. Returns
   * '' when the mark isn't one of the five, and the caller falls back to the
   * number — so a homework marked 7/10 before the academy switched to ratings
   * still reads as 7/10.
   */
  ratingLabel(grade: string | number | null | undefined): string {
    const key = ratingLabelKey(grade);
    return key ? this.translate.instant(key) : '';
  }

  /** Classes this student has results in. */
  examClassOptions = computed(() => {
    const seen = new Set<string>();
    for (const r of this.examResults()) {
      if (r.className) seen.add(r.className);
    }
    return [...seen].sort((a, b) => a.localeCompare(b)).map(name => ({ id: name, label: name }));
  });

  private filteredExamFeed = computed(() => {
    const cls = this.examClassFilter();
    if (!cls) return this.examResults();
    return this.examResults().filter(r => r.className === cls);
  });

  examOnlyResults = computed(() => this.filteredExamFeed().filter((r) => !r.isHomework));
  homeworkResults = computed(() => this.filteredExamFeed().filter((r) => r.isHomework));

  /**
   * Average score across the filtered exams, as a percentage of what was
   * available. Only results with a numeric grade AND a max grade can be scored,
   * so a letter grade or an exam with no maximum is left out rather than
   * silently counted as zero. Returns null when nothing is scoreable.
   */
  examAveragePercent = computed<number | null>(() => {
    const scored = this.examOnlyResults()
      .map(r => ({ got: Number(r.grade), max: r.maxGrade ?? 0 }))
      .filter(v => Number.isFinite(v.got) && v.max > 0);
    if (!scored.length) return null;
    const total = scored.reduce((sum, v) => sum + (v.got / v.max) * 100, 0);
    return Math.round(total / scored.length);
  });

  // Attendance
  attendanceRecords = signal<StudentAttendanceRecord[]>([]);
  loadingAttendance = signal(false);

  /** Class filter for the attendance history (null = every class). */
  attendanceClassFilter = signal<string | null>(null);
  /** Session-kind filter: everything, only free (trial) sessions, or only paid. */
  attendanceKindFilter = signal<'ALL' | 'FREE' | 'PAID'>('ALL');

  /**
   * The classes this student actually has history in, labelled with their
   * course. Built from the records themselves rather than from enrolments, so a
   * class they only ever tried for free still shows up here.
   */
  attendanceClassOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.attendanceRecords()) {
      if (!seen.has(r.classId)) {
        seen.set(r.classId, r.courseName ? `${r.className} · ${r.courseName}` : r.className);
      }
    }
    return [...seen.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  filteredAttendance = computed(() => {
    const cls = this.attendanceClassFilter();
    const kind = this.attendanceKindFilter();
    return this.attendanceRecords().filter(r => {
      if (cls && r.classId !== cls) return false;
      if (kind === 'FREE' && !r.isFree) return false;
      if (kind === 'PAID' && r.isFree) return false;
      return true;
    });
  });

  /**
   * The rate is over the filtered records, so picking a class answers "how
   * often do they turn up to THIS class" rather than blending every class into
   * one number.
   *
   * Trials are excluded from the calculation entirely: the student isn't
   * enrolled in that class, so there is no set of sessions they were expected
   * at, and counting an always-present row would inflate the rate. They are
   * still listed, and counted separately.
   */
  private ratedAttendance = computed(() => this.filteredAttendance().filter(r => r.status !== 'TRIAL'));
  /**
   * Three states that do not overlap: sat in their own class, sat the lesson with
   * a sibling class, or missed it. Present used to include the make-ups, which
   * were then listed again beside it — the same lesson counted twice in a row of
   * figures meant to add up.
   */
  attendancePresentCount = computed(() => this.ratedAttendance().filter(r => r.isPresent && r.status !== 'SUBSTITUTED').length);
  attendanceSubstitutedCount = computed(() => this.ratedAttendance().filter(r => r.status === 'SUBSTITUTED').length);
  attendanceAbsentCount = computed(() => this.ratedAttendance().filter(r => !r.isPresent).length);
  attendanceTrialCount = computed(() => this.filteredAttendance().filter(r => r.status === 'TRIAL').length);
  attendanceRate = computed(() => {
    const total = this.ratedAttendance().length;
    if (!total) return 0;
    // A lesson made up elsewhere was attended, so it still counts towards the rate.
    return Math.round(((this.attendancePresentCount() + this.attendanceSubstitutedCount()) / total) * 100);
  });

  /**
   * Reversing money is its own permission now: recording a payment is
   * `enrollments: write`, undoing one is `refunds: write`, so whoever collects
   * fees cannot quietly un-collect them. Hides the button the API would 403.
   */
  canRefund = (): boolean => this.authService.canWrite('refunds');

  ngOnInit() {
    // Subscribe to the route param (not snapshot) so that scanning another
    // student while already on a detail page — which navigates to the same
    // /students/:id route and reuses this component instance — reloads the
    // page for the new id instead of silently doing nothing.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = params.get('id');
      if (id && id !== this.studentId) {
        this.studentId = id;
        this.loadStudentData(id);
      }
    });
  }

  private async loadStudentData(id: string) {
    this.resetStudentState();
    await this.loadCourses();
    this.loadClassesForDoneMap();
    this.loadStudent(id);
    this.loadMonthlySubscriptions(id);
    this.loadSessionPayments(id);
    this.loadEnrollments(id);
    this.loadReceipts(id);
    if (!this.isTeacher()) this.loadMasterEnrollments(id);
    this.loadAttendance(id);
    this.loadBookPurchases(id);
    this.loadExamResults(id);
    this.loadLinkedCards(id);
  }

  /** Clear per-student state so data from a previously-viewed student
   *  doesn't linger when navigating to a new id on the same component. */
  private resetStudentState() {
    this.student.set(null);
    this.enrollments.set([]);
    this.masterEnrollments.set([]);
    this.monthlyByEnrollment.set(new Map());
    this.sessionPaymentsByEnrollment.set(new Map());
    this.sessionPackagesByEnrollment.set(new Map());
    this.paymentHistoryMap.set(new Map());
    this.refundHistoryMap.set(new Map());
    this.attendanceRecords.set([]);
    this.bookPurchases.set([]);
    this.examResults.set([]);
    this.expandedRows = {};
    this.expandedMasterRows = {};
  }

  loadExamResults(studentId: string) {
    this.loadingExams.set(true);
    this.examService.getByStudent(studentId).subscribe({
      next: (rows) => { this.examResults.set(rows); this.loadingExams.set(false); },
      error: () => this.loadingExams.set(false),
    });
  }

  loadBookPurchases(studentId: string) {
    this.productSaleService.getAllSales({ studentId }).subscribe({
      next: (sales) => this.bookPurchases.set(sales),
      error: () => {
        // Interceptor toasted the translated error.
      },
    });
  }

  loadClassesForDoneMap() {
    this.classService.getAllClasses().subscribe({
      next: (classes) => {
        const doneMap = new Map<string, boolean>();
        const nameMap = new Map<string, string>();
        for (const c of classes) {
          doneMap.set(c.id, c.status === 'DONE' || c.isFinished === true);
          nameMap.set(c.id, c.name);
        }
        this.classDoneMap.set(doneMap);
        this.classNameMap.set(nameMap);
      },
    });
  }

  /** The class this enrollment sits in (empty until the class list loads). */
  getClassName(classId: string): string {
    return this.classNameMap().get(classId) || '';
  }

  loadAttendance(studentId: string) {
    this.loadingAttendance.set(true);
    this.attendanceService.getByStudent(studentId).subscribe({
      next: (records) => { this.attendanceRecords.set(records); this.loadingAttendance.set(false); },
      error: () => this.loadingAttendance.set(false),
    });
  }

  loadMasterEnrollments(id: string) {
    this.masterEnrollmentService.getByStudent(id).subscribe({
      next: (rows) => this.masterEnrollments.set(rows),
    });
  }

  enrollInMaster() {
    if (!this.studentId) return;
    this.router.navigate(['/enrollments/create'], {
      queryParams: { studentId: this.studentId, type: 'MASTER' },
    });
  }

  cancelMasterEnrollment(me: MasterEnrollmentProgress) {
    this.confirmationService.confirm({
      header: this.translate.instant('STUDENTS.MASTER_ENROLLMENT_CANCEL_TITLE'),
      message: this.translate.instant('STUDENTS.MASTER_ENROLLMENT_CANCEL_CONFIRM'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.masterEnrollmentService.cancel(me.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.MASTER_ENROLLMENT_CANCELLED'));
            if (this.studentId) this.loadMasterEnrollments(this.studentId);
          },
          error: () => {
            // Interceptor toasted the translated error.
          },
        });
      },
    });
  }


  async loadCourses() {
    try {
      const courses = await this.courseService.getAllCourses().toPromise();
      courses?.forEach(c => this.courses.set(c.id, c));
    } catch (error) {
      console.error('Failed to load courses', error);
    }
  }

  loadStudent(id: string) {
    this.loading.set(true);
    this.studentService.getStudentById(id).subscribe({
      next: (student) => {
        this.student.set(student);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/students']);
      }
    });
  }

  // ── Receipts ────────────────────────────────────────────────────────────────
  // Every slip issued for this student, so one can be reprinted when it is lost
  // or when the payment was confirmed without printing (the common case).
  receipts = signal<PaymentReceipt[]>([]);

  loadReceipts(studentId: string) {
    this.api.get<PaymentReceipt[]>(`receipts/student/${studentId}`).subscribe({
      next: (rows) => this.receipts.set(rows),
      error: () => { /* interceptor toasted it; the page still works without them */ },
    });
  }

  /** Reprint: the SAME receipt — same number, same QR, never a new one. */
  printReceipt(r: PaymentReceipt) { this.receiptService.openPrint(r); }

  receiptStatusKey(r: PaymentReceipt): string {
    if (r.voidedAt) return 'RECEIPT.VOIDED';
    return r.isFullPayment ? 'RECEIPT.PAID_IN_FULL' : 'RECEIPT.PARTIAL';
  }

  receiptStatusSeverity(r: PaymentReceipt): 'success' | 'warn' | 'danger' {
    if (r.voidedAt) return 'danger';
    return r.isFullPayment ? 'success' : 'warn';
  }

  loadEnrollments(id: string) {
    this.enrollmentService.getEnrollmentsByStudent(id).subscribe({
      next: (enrollments) => {
        this.enrollments.set(enrollments);
        // Auto-load payment & refund history for every enrollment.
        // Monthly-subscription enrollments use the months table instead, and
        // are auto-expanded so the bills are visible without a click.
        enrollments.forEach(e => {
          if (this.isMonthly(e) || this.isPerSession(e)) {
            // Monthly & per-session enrollments show their own bills table; auto-expand.
            this.expandedRows[e.id] = true;
          } else {
            this.loadPaymentHistory(e.id);
            if ((e.totalRefunded || 0) > 0) this.loadRefundHistory(e.id);
          }
        });
        this.expandedRows = { ...this.expandedRows };
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  // ─── Monthly subscriptions ──────────────────────────────────────────────────

  /**
   * Bills for months the student has not reached yet exist in the table: the
   * dashboard materialises a whole company's months whenever someone filters
   * forward, and the generate action writes an explicit month. An UNPAID future
   * bill is not a debt — nobody owes November in July — so it is noise here.
   * One that carries money is a deliberate early payment and must stay visible,
   * or the student's money would vanish from their own page.
   *
   * This hides rows; it never deletes them. The row still exists for the
   * dashboard's collect-early flow, which is where a future month gets paid.
   */
  private isBillVisible(p: MonthlyPaymentWithDetails, currentKey: number): boolean {
    const billKey = p.billingYear * 12 + p.billingMonth;
    return billKey <= currentKey || Number(p.amountPaid) > 0;
  }

  loadMonthlySubscriptions(studentId: string) {
    this.monthlyService.listByStudent(studentId).subscribe({
      next: (rows) => {
        const now = new Date();
        const currentKey = now.getFullYear() * 12 + (now.getMonth() + 1);
        const map = new Map<string, MonthlyPaymentWithDetails[]>();
        for (const r of rows) {
          if (!this.isBillVisible(r, currentKey)) continue;
          const list = map.get(r.enrollmentId) || [];
          list.push(r);
          map.set(r.enrollmentId, list);
        }
        this.monthlyByEnrollment.set(map);
      },
      error: () => {
        // Interceptor toasted the translated error.
      },
    });
  }

  /** A course billed monthly (vs. a one-time / installment course). */
  isMonthly(enrollment: Enrollment): boolean {
    return this.courses.get(enrollment.courseId)?.paymentType === 'MONTHLY_SUBSCRIPTION';
  }

  getMonthlyPayments(enrollmentId: string): MonthlyPaymentWithDetails[] {
    return this.monthlyByEnrollment().get(enrollmentId) || [];
  }

  /** "March 2026" style label for a billing period. */
  monthlyPeriodLabel(p: { billingMonth: number; billingYear: number }): string {
    const month = this.translate.instant('MONTHLY_SUBSCRIPTIONS.MONTHS.' + p.billingMonth);
    return `${month} ${p.billingYear}`;
  }

  getMonthlyStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      case 'PARTIAL': return 'info';
      default: return 'secondary';
    }
  }

  monthlyStatusLabel(status: string): string {
    const key = `MONTHLY_SUBSCRIPTIONS.STATUS.${status}`;
    const translated = this.translate.instant(key);
    return translated === key ? status : translated;
  }

  openMonthlyPayDialog(payment: MonthlyPaymentWithDetails) {
    this.monthlyForAction.set(payment);
    this.monthlyDialogAmount = Math.max(0, payment.amountDue - (payment.amountPaid || 0));
    this.monthlyDialogDate = new Date();
    this.monthlyDialogNotes = '';
    this.showMonthlyPayDialog = true;
  }

  /** Printing is OPT-IN — see the two dialog buttons. */
  submitMonthlyPayment(print = false) {
    const payment = this.monthlyForAction();
    if (!payment || !this.monthlyDialogAmount || !this.monthlyDialogDate) return;
    this.actionLoading.set(true);
    const dateStr = this.ymdLocal(this.monthlyDialogDate);
    // Every bill on this page is a real one the server already materialised —
    // the only thing that produced a projected future row here was the
    // collect-next-month button, which is gone. Paying a month before it comes
    // due still lives on the monthly-subscriptions dashboard.
    const req$ = this.monthlyService.recordPayment(payment.id, {
      amount: this.monthlyDialogAmount,
      paymentDate: dateStr,
      notes: this.monthlyDialogNotes || undefined,
    });
    req$.subscribe({
      next: (res: any) => {
        this.notificationService.success(this.translate.instant('STUDENTS.PAYMENT_RECORDED'));
        this.showMonthlyPayDialog = false;
        this.actionLoading.set(false);
        if (this.studentId) this.loadMonthlySubscriptions(this.studentId);
        if (print) this.receiptService.openPrint(res?.receipt);
        if (this.studentId) this.loadReceipts(this.studentId);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  // ─── Per-session payments ───────────────────────────────────────────────────

  loadSessionPayments(studentId: string) {
    this.sessionPaymentsService.listByStudent(studentId).subscribe({
      next: (rows) => {
        const map = new Map<string, SessionPaymentWithDetails[]>();
        for (const r of rows) {
          const list = map.get(r.enrollmentId) || [];
          list.push(r);
          map.set(r.enrollmentId, list);
        }
        this.sessionPaymentsByEnrollment.set(map);
      },
      error: () => {},
    });
    this.sessionPaymentsService.listPackages({ studentId }).subscribe({
      next: (rows) => {
        const map = new Map<string, SessionPackageWithDetails[]>();
        for (const r of rows) {
          const list = map.get(r.enrollmentId) || [];
          list.push(r);
          map.set(r.enrollmentId, list);
        }
        this.sessionPackagesByEnrollment.set(map);
      },
      error: () => {},
    });
  }

  /** A course billed per attended session (vs. monthly / one-time). */
  isPerSession(enrollment: Enrollment): boolean {
    return this.courses.get(enrollment.courseId)?.paymentType === 'PER_SESSION';
  }

  getSessionPayments(enrollmentId: string): SessionPaymentWithDetails[] {
    return this.sessionPaymentsByEnrollment().get(enrollmentId) || [];
  }

  getSessionPackages(enrollmentId: string): SessionPackageWithDetails[] {
    return this.sessionPackagesByEnrollment().get(enrollmentId) || [];
  }

  getSessionStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status) {
      case 'PAID': return 'success';
      case 'COVERED': return 'info';
      case 'PENDING': return 'warn';
      case 'REFUNDED': return 'danger';
      default: return 'secondary';
    }
  }

  sessionStatusLabel(status: string): string {
    const key = `SESSION_PAYMENTS.STATUS_${status}`;
    const translated = this.translate.instant(key);
    return translated === key ? status : translated;
  }

  /** Open the shared pay popup for a pending session charge. */
  openSessionPay(payment: SessionPaymentWithDetails) {
    this.sessionPayDialog?.enqueue([payment]);
  }

  // ─── Subscription hold / resume / delete ───────────────────────────────────

  holdSubscription(enrollment: Enrollment) {
    this.confirmationService.confirm({
      header: this.translate.instant('STUDENTS.DETAIL.HOLD_SUBSCRIPTION'),
      message: this.translate.instant('STUDENTS.DETAIL.HOLD_CONFIRM'),
      icon: 'pi pi-pause',
      acceptButtonStyleClass: 'p-button-warning',
      accept: () => {
        this.actionLoading.set(true);
        this.enrollmentService.holdSubscription(enrollment.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.DETAIL.SUBSCRIPTION_HELD'));
            this.actionLoading.set(false);
            if (this.studentId) this.loadEnrollments(this.studentId);
          },
          error: () => {
            this.actionLoading.set(false);
          },
        });
      },
    });
  }

  resumeSubscription(enrollment: Enrollment) {
    this.confirmationService.confirm({
      header: this.translate.instant('STUDENTS.DETAIL.RESUME_SUBSCRIPTION'),
      message: this.translate.instant('STUDENTS.DETAIL.RESUME_CONFIRM'),
      icon: 'pi pi-refresh',
      accept: () => {
        this.actionLoading.set(true);
        this.enrollmentService.resumeSubscription(enrollment.id).subscribe({
          next: () => {
            this.notificationService.success(this.translate.instant('STUDENTS.DETAIL.SUBSCRIPTION_RESUMED'));
            this.actionLoading.set(false);
            if (this.studentId) this.loadEnrollments(this.studentId);
          },
          error: () => {
            this.actionLoading.set(false);
          },
        });
      },
    });
  }

  hasAnyMonthlyPayment(enrollmentId: string): boolean {
    const payments = this.monthlyByEnrollment().get(enrollmentId) || [];
    return payments.some(p => (p.amountPaid || 0) > 0);
  }

  /** Open the change-class dialog: load the OTHER active classes of this course. */
  openChangeClassDialog(enrollment: Enrollment) {
    this.changeClassEnrollment.set(enrollment);
    this.selectedChangeClass.set(null);
    this.changeClassCurrentName.set('');
    this.changeClassOptions.set([]);
    this.changeClassLoading.set(true);
    this.showChangeClassDialog = true;
    this.classService.getClassesByCourse(enrollment.courseId).subscribe({
      next: (classes) => {
        const all = classes as ClassWithDetails[];
        const current = all.find(c => c.id === enrollment.classId);
        this.changeClassCurrentName.set(current?.name ?? '');
        // Other classes only: active, not finished/done, and not the current one.
        this.changeClassOptions.set(
          all.filter(c => c.id !== enrollment.classId && c.isActive && c.status !== 'DONE' && c.isFinished !== true),
        );
        this.changeClassLoading.set(false);
      },
      error: () => this.changeClassLoading.set(false),
    });
  }

  submitChangeClass() {
    const enrollment = this.changeClassEnrollment();
    const target = this.selectedChangeClass();
    if (!enrollment || !target) return;
    this.changeClassSubmitting.set(true);
    this.enrollmentService.changeClass(enrollment.id, target.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.DETAIL.CLASS_CHANGED'));
        this.changeClassSubmitting.set(false);
        this.showChangeClassDialog = false;
        if (this.studentId) this.loadEnrollments(this.studentId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.changeClassSubmitting.set(false);
      },
    });
  }

  /**
   * End a course enrolment of any kind — monthly subscription, per-session or
   * one-time.
   *
   * The server decides which of the two things happens, and it is the only place
   * that can: an enrolment counts as having money behind it through eight
   * different routes (payments, refunds, session packages, revenue rows, a parent
   * bundle…). Paid ones are DROPPED so the history survives; ones nothing was
   * ever paid on are removed outright. Re-checking that rule in the client would
   * mean two definitions of "has money" that drift apart, so the dialog names
   * both outcomes and the result message reports whichever actually happened.
   */
  cancelEnrollment(enrollment: Enrollment) {
    this.confirmationService.confirm({
      header: this.translate.instant('STUDENTS.DETAIL.CANCEL_ENROLLMENT'),
      message: this.translate.instant('STUDENTS.DETAIL.CANCEL_ENROLLMENT_CONFIRM'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.actionLoading.set(true);
        this.enrollmentService.deleteEnrollment(enrollment.id).subscribe({
          next: (res: any) => {
            this.notificationService.success(this.translate.instant(
              res?.code === 'ENROLLMENTS.DELETED'
                ? 'STUDENTS.DETAIL.ENROLLMENT_DELETED'
                : 'STUDENTS.DETAIL.ENROLLMENT_CANCELLED',
            ));
            this.actionLoading.set(false);
            if (this.studentId) {
              this.loadEnrollments(this.studentId);
              this.loadMonthlySubscriptions(this.studentId);
              this.loadSessionPayments(this.studentId);
            }
          },
          error: () => {
            this.actionLoading.set(false);
          },
        });
      },
    });
  }

  // ─── Expandable rows ────────────────────────────────────────────────────────

  toggleRow(enrollment: Enrollment) {
    const id = enrollment.id;
    if (this.expandedRows[id]) {
      delete this.expandedRows[id];
    } else {
      this.expandedRows[id] = true;
      this.loadPaymentHistory(id);
      this.loadRefundHistory(id);
    }
    this.expandedRows = { ...this.expandedRows };
  }

  loadPaymentHistory(enrollmentId: string) {
    this.enrollmentService.getPayments(enrollmentId).subscribe({
      next: (payments) => {
        const map = new Map(this.paymentHistoryMap());
        map.set(enrollmentId, payments);
        this.paymentHistoryMap.set(map);
      },
      error: () => {}
    });
  }

  loadRefundHistory(enrollmentId: string) {
    this.enrollmentService.getRefunds(enrollmentId).subscribe({
      next: (refunds) => {
        const map = new Map(this.refundHistoryMap());
        map.set(enrollmentId, refunds);
        this.refundHistoryMap.set(map);
      },
      error: () => {}
    });
  }

  getPaymentHistory(enrollmentId: string): EnrollmentPayment[] {
    return this.paymentHistoryMap().get(enrollmentId) || [];
  }

  getRefundHistory(enrollmentId: string): Refund[] {
    return this.refundHistoryMap().get(enrollmentId) || [];
  }

  // ─── Payment dialog ──────────────────────────────────────────────────────────

  openPaymentDialog(enrollment: Enrollment) {
    this.enrollmentForAction.set(enrollment);
    this.dialogPaymentAmount = null;
    this.dialogPaymentDate = new Date();
    this.dialogPaymentNotes = '';
    this.showPaymentDialog = true;
  }

  /** Printing is OPT-IN — see the two dialog buttons. */
  submitPayment(print = false) {
    const enrollment = this.enrollmentForAction();
    if (!enrollment || !this.dialogPaymentAmount || !this.dialogPaymentDate) return;

    this.actionLoading.set(true);
    const dateStr = this.ymdLocal(this.dialogPaymentDate);

    this.enrollmentService.addPayment(enrollment.id, {
      amount: this.dialogPaymentAmount,
      paymentDate: dateStr,
      notes: this.dialogPaymentNotes || undefined,
    }).subscribe({
      next: (res: any) => {
        this.notificationService.success(this.translate.instant('STUDENTS.PAYMENT_RECORDED'));
        this.showPaymentDialog = false;
        this.actionLoading.set(false);
        this.loadEnrollments(this.studentId!);
        if (print) this.receiptService.openPrint(res?.receipt);
        if (this.studentId) this.loadReceipts(this.studentId);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.actionLoading.set(false);
      }
    });
  }

  // ─── Edit-price dialog ───────────────────────────────────────────────────────

  /**
   * The price on an enrollment means whatever its course charges for — a total, a
   * monthly fee, or a per-session fee — so every label around the pencil names the
   * right thing instead of the generic "price".
   */
  private editPriceKey(enrollment: Enrollment, suffix: string): string {
    if (this.isMonthly(enrollment)) return `STUDENTS.DETAIL.${suffix}_MONTHLY`;
    if (this.isPerSession(enrollment)) return `STUDENTS.DETAIL.${suffix}_SESSION`;
    return `STUDENTS.DETAIL.${suffix}`;
  }

  editPriceTooltip(enrollment: Enrollment): string {
    return this.editPriceKey(enrollment, 'EDIT_PRICE');
  }

  editPriceLabel(enrollment: Enrollment): string {
    return this.editPriceKey(enrollment, 'PRICE_LABEL');
  }

  editPriceHint(enrollment: Enrollment): string {
    return this.editPriceKey(enrollment, 'EDIT_PRICE_HINT');
  }

  editPriceTitle(): string {
    const enrollment = this.editPriceEnrollment();
    return enrollment ? this.editPriceKey(enrollment, 'EDIT_PRICE_TITLE') : 'STUDENTS.DETAIL.EDIT_PRICE_TITLE';
  }

  openEditPriceDialog(enrollment: Enrollment) {
    this.editPriceEnrollment.set(enrollment);
    this.editPriceValue = enrollment.finalPrice;
    this.showEditPriceDialog = true;
  }

  submitEditPrice() {
    const enrollment = this.editPriceEnrollment();
    if (!enrollment || this.editPriceValue == null || this.editPriceValue < 0) return;

    this.actionLoading.set(true);
    this.enrollmentService.updateEnrollment(enrollment.id, { finalPrice: this.editPriceValue }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.DETAIL.PRICE_UPDATED'));
        this.showEditPriceDialog = false;
        this.actionLoading.set(false);
        if (this.studentId) {
          this.loadEnrollments(this.studentId);
          // Monthly bills and session charges live in their own tables; reload them
          // so a repriced open month shows its new amount without a page refresh.
          if (this.isMonthly(enrollment)) this.loadMonthlySubscriptions(this.studentId);
          if (this.isPerSession(enrollment)) this.loadSessionPayments(this.studentId);
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.actionLoading.set(false);
      },
    });
  }

  // ─── Refund dialog ───────────────────────────────────────────────────────────

  openRefundDialog(enrollment: Enrollment) {
    this.enrollmentForAction.set(enrollment);
    this.refundType = 'FULL';
    this.refundAmount = enrollment.amountPaid || 0;
    this.refundDate = new Date();
    this.refundReason = '';
    this.showRefundDialog = true;
  }

  onRefundTypeChange() {
    const enrollment = this.enrollmentForAction();
    if (this.refundType === 'FULL' && enrollment) {
      this.refundAmount = enrollment.amountPaid || 0;
    } else {
      this.refundAmount = null;
    }
  }

  submitRefund() {
    const enrollment = this.enrollmentForAction();
    if (!enrollment || !this.refundAmount || !this.refundDate) return;

    this.actionLoading.set(true);
    const dateStr = this.ymdLocal(this.refundDate);

    this.enrollmentService.createRefund(enrollment.id, {
      type: this.refundType,
      amount: this.refundAmount,
      refundDate: dateStr,
      reason: this.refundReason || undefined,
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.REFUND_ISSUED'));
        this.showRefundDialog = false;
        this.actionLoading.set(false);
        this.loadEnrollments(this.studentId!);
        if (this.expandedRows[enrollment.id]) {
          this.loadRefundHistory(enrollment.id);
          this.loadPaymentHistory(enrollment.id);
        }
      },
      error: () => {
        this.actionLoading.set(false);
      }
    });
  }

  // ─── Master-enrollment refund dialog ────────────────────────────────────────

  openMasterRefundDialog(me: MasterEnrollmentProgress) {
    const refundable = Math.max(0, (me.amountPaid || 0) - (me.totalRefunded || 0));
    if (refundable <= 0) {
      this.notificationService.error(this.translate.instant('STUDENTS.NOTHING_TO_REFUND'));
      return;
    }
    this.masterEnrollmentForAction.set(me);
    this.masterRefundType = 'FULL';
    this.masterRefundAmount = refundable;
    this.masterRefundDate = new Date();
    this.masterRefundReason = '';
    this.showMasterRefundDialog = true;
  }

  onMasterRefundTypeChange() {
    if (this.masterRefundType === 'FULL') {
      this.masterRefundAmount = this.masterRefundable();
    } else {
      this.masterRefundAmount = null;
    }
  }

  submitMasterRefund() {
    const me = this.masterEnrollmentForAction();
    if (!me || !this.masterRefundAmount || !this.masterRefundDate) return;

    this.actionLoading.set(true);
    const dateStr = this.ymdLocal(this.masterRefundDate);

    this.masterEnrollmentService.createRefund(me.id, {
      type: this.masterRefundType,
      amount: this.masterRefundAmount,
      refundDate: dateStr,
      reason: this.masterRefundReason || undefined,
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.BUNDLE_REFUND_ISSUED'));
        this.showMasterRefundDialog = false;
        this.actionLoading.set(false);
        if (this.studentId) this.loadMasterEnrollments(this.studentId);
      },
      error: () => {
        this.actionLoading.set(false);
      }
    });
  }

  // ─── Bundle course expansion ──────────────────────────────────────────────────

  onMasterRowExpand(event: { data: MasterEnrollmentProgress }) {
    this.loadLinkedCoursesIfNeeded(event.data.masterCourseId);
    this.loadMasterPaymentHistory(event.data.id);
    this.loadMasterClassEnrollments(event.data.id);
  }

  loadMasterClassEnrollments(masterEnrollmentId: string) {
    this.masterClassEnrollmentService.listByMasterEnrollment(masterEnrollmentId).subscribe({
      next: (items) => {
        const map = new Map(this.masterClassEnrollmentsMap());
        map.set(masterEnrollmentId, items);
        this.masterClassEnrollmentsMap.set(map);
      },
    });
  }

  private loadLinkedCoursesIfNeeded(masterCourseId: string) {
    if (this.linkedCoursesMap().has(masterCourseId)) return;
    this.masterCourseService.getLinkedCourses(masterCourseId).subscribe({
      next: (courses) => {
        const map = new Map(this.linkedCoursesMap());
        map.set(masterCourseId, courses);
        this.linkedCoursesMap.set(map);
      },
    });
  }

  getLinkedCourses(masterCourseId: string): LinkedCourseSummary[] {
    return this.linkedCoursesMap().get(masterCourseId) || [];
  }

  getBundleCourseStatus(masterEnrollmentId: string, courseId: string): string | null {
    const items = this.masterClassEnrollmentsMap().get(masterEnrollmentId) || [];
    return items.find(e => e.courseId === courseId)?.status ?? null;
  }

  getBundleClassName(masterEnrollmentId: string, courseId: string): string | null {
    const items = this.masterClassEnrollmentsMap().get(masterEnrollmentId) || [];
    return items.find(e => e.courseId === courseId)?.className ?? null;
  }

  joinBundleCourse(courseId: string, masterEnrollmentId: string) {
    this.joinBundleCourseId = courseId;
    this.joinBundleMasterEnrollmentId = masterEnrollmentId;
    this.selectedJoinClass.set(null);
    this.joinBundleCourseClasses.set([]);
    this.joinBundleCourseLoading.set(true);
    this.showJoinBundleCourseDialog = true;
    this.classService.getClassesByCourse(courseId).subscribe({
      next: (classes) => {
        this.joinBundleCourseClasses.set(
          classes.filter(c => c.isActive && c.status !== 'DONE' && c.isFinished !== true)
        );
        this.joinBundleCourseLoading.set(false);
      },
      error: () => {
        this.joinBundleCourseLoading.set(false);
      },
    });
  }

  submitJoinBundleCourse() {
    const cls = this.selectedJoinClass();
    if (!cls || !this.joinBundleCourseId || !this.joinBundleMasterEnrollmentId) return;
    this.actionLoading.set(true);
    this.masterClassEnrollmentService.create({
      masterEnrollmentId: this.joinBundleMasterEnrollmentId,
      classId: cls.id,
      courseId: this.joinBundleCourseId,
      branchId: cls.branchId,
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.ENROLLED_IN_CLASS'));
        this.showJoinBundleCourseDialog = false;
        this.actionLoading.set(false);
        this.loadMasterClassEnrollments(this.joinBundleMasterEnrollmentId!);
        if (this.studentId) this.loadMasterEnrollments(this.studentId);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  loadMasterPaymentHistory(masterEnrollmentId: string) {
    this.masterEnrollmentService.getPayments(masterEnrollmentId).subscribe({
      next: (payments) => {
        const map = new Map(this.masterPaymentHistoryMap());
        map.set(masterEnrollmentId, payments);
        this.masterPaymentHistoryMap.set(map);
      },
    });
  }

  getMasterPaymentHistory(masterEnrollmentId: string): EnrollmentPayment[] {
    return this.masterPaymentHistoryMap().get(masterEnrollmentId) || [];
  }

  openMasterPaymentDialog(me: MasterEnrollmentProgress) {
    this.masterEnrollmentForAction.set(me);
    this.masterDialogPaymentAmount = null;
    this.masterDialogPaymentDate = new Date();
    this.masterDialogPaymentNotes = '';
    this.showMasterPaymentDialog = true;
  }

  submitMasterPayment() {
    const me = this.masterEnrollmentForAction();
    if (!me || !this.masterDialogPaymentAmount || !this.masterDialogPaymentDate) return;
    this.actionLoading.set(true);
    const dateStr = this.ymdLocal(this.masterDialogPaymentDate);
    this.masterEnrollmentService.addPayment(me.id, {
      amount: this.masterDialogPaymentAmount,
      paymentDate: dateStr,
      notes: this.masterDialogPaymentNotes || undefined,
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.PAYMENT_RECORDED'));
        this.showMasterPaymentDialog = false;
        this.actionLoading.set(false);
        if (this.studentId) this.loadMasterEnrollments(this.studentId);
        this.loadMasterPaymentHistory(me.id);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  // Date of birth is optional, and a missing one makes `new Date(null)` fall back
  // to the epoch — which reads as a plausible ~56 rather than an obvious error.
  // Very young ages usually mean a placeholder/typo'd date, so treat those as unset too.
  hasAge(dateOfBirth: string | null | undefined): boolean {
    if (!dateOfBirth) return false;
    const age = this.getAge(dateOfBirth);
    return !isNaN(age) && age >= 2;
  }

  getAge(dateOfBirth: string | null | undefined): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth ?? NaN);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  editStudent() {
    if (this.studentId) {
      this.router.navigate(['/students', this.studentId, 'edit']);
    }
  }

  backToList() {
    this.router.navigate(['/students']);
  }

  /** Update the local student copy after the QR dialog rotates the token. */
  onQrRegenerated(updated: Student) {
    this.student.set(updated);
  }

  enrollStudent() {
    this.router.navigate(['/enrollments/create'], {
      queryParams: { studentId: this.studentId }
    });
  }

  editEnrollment(enrollment: Enrollment) {
    this.router.navigate(['/enrollments', enrollment.id, 'edit']);
  }

  getCourseName(courseId: string): string {
    return this.courses.get(courseId)?.name || 'Unknown Course';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  /**
   * Local YYYY-MM-DD for a picked date. toISOString() would convert the picker's
   * local-midnight Date to UTC, landing a day early for any timezone east of UTC
   * (e.g. Egypt) — so a payment picked for the 30th would be stored as the 29th.
   */
  private ymdLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'ON_HOLD': return 'warn';
      default: return 'warn';
    }
  }

  getPaymentSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'REFUNDED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'warn';
    }
  }

  paymentLabel(status: string): string {
    const key = `STUDENTS.DETAIL.PAYMENT_${status}`;
    const translated = this.translate.instant(key);
    return translated === key ? status : translated;
  }

  statusLabel(status: string): string {
    const key = `STUDENTS.DETAIL.STATUS_${status}`;
    const translated = this.translate.instant(key);
    return translated === key ? status : translated;
  }

  hasRefund(enrollment: any): boolean {
    return (enrollment.totalRefunded || 0) > 0;
  }

  // ── Link a pre-printed QR card ─────────────────────────────────────────────
  // The academy prints a pool of blank cards; one is handed to this student and
  // scanned here. It does NOT replace their own QR — both resolve to them — so a
  // card printed the old way keeps working.
  private qrCardService = inject(QrCardService);
  private globalScan = inject(GlobalScanService);
  /** Takes over the app-wide scanner ONLY while the link dialog is open. */
  private readonly linkScanHandler = (token: string) => this.linkByToken(token);

  linkCardVisible = signal(false);
  linkedCards = signal<QrCard[]>([]);
  linkingCard = signal(false);
  /**
   * The one link field. It takes anything printed on the card: the serial number,
   * the raw QR token, OR a full scanned profile URL. It is for TYPING only — the
   * dialog opens with nothing focused ([focusOnShow]="false") on purpose. A focused
   * field swallows the scanner's keystrokes (see the layout's keydown guard) and
   * they arrive through the OS keyboard layout, so on an Arabic layout the scan
   * came out as Arabic letters. Unfocused, the burst goes to the global capture,
   * which reads the raw keys and hands us the token.
   */
  linkInput = '';
  cardLabel = serialLabel;
  /** The card being handed back, so only its own chip shows a spinner. */
  unlinkingCardId = signal<string | null>(null);

  openLinkCard(): void {
    this.linkInput = '';
    this.linkCardVisible.set(true);
    // While this is open a scan links the card, instead of falling through to the
    // global "find student / take attendance" behaviour.
    this.globalScan.register(this.linkScanHandler);
  }

  closeLinkCard(): void {
    this.globalScan.unregister(this.linkScanHandler);
    this.linkCardVisible.set(false);
  }

  private loadLinkedCards(studentId: string): void {
    this.qrCardService.byStudent(studentId).subscribe({
      next: (rows) => this.linkedCards.set(rows),
      error: () => this.linkedCards.set([]),
    });
  }

  /** A scan from the USB reader (or the camera) while the dialog is open. */
  private linkByToken(token: string): void {
    this.linkCard({ token });
  }

  /**
   * Link from whatever is in the field — typed or scanned. A scanned QR is the
   * profile URL, so reduce it to its token; a bare number is the printed serial;
   * anything else is treated as a raw token.
   */
  linkByInput(): void {
    const raw = (this.linkInput || '').trim();
    if (!raw || this.linkingCard()) return;

    // A scanned card QR is the profile URL — reduce it to its token.
    if (raw.includes('/p/s/')) {
      const token = this.globalScan.extractToken(raw);
      if (token) this.linkCard({ token });
      return;
    }
    // Otherwise it's the code printed on the card — "A5", "05", "051", or the full
    // serial. normalizeStudentCode turns any of those into the stored serial.
    const serial = Number(normalizeStudentCode(raw));
    if (Number.isInteger(serial) && serial > CARD_SERIAL_BASE) {
      this.linkCard({ serial });
      return;
    }
    /**
     * A bare number is still a card number.
     *
     * normalizeStudentCode only lifts a code into a reserved range when it can
     * see which one — an "A" prefix or a leading zero. A pool printed at a fixed
     * three digits reads "100" for card 100, which carries neither, so it fell
     * through to the token branch below and was looked up as a QR token: cards
     * 001-099 linked (their zero gave the range away) and 100 upwards reported
     * "not in this pool" unless the cashier typed "0100". Send the number as a
     * number — the API tries each reserved range and only one can match.
     */
    if (/^\d{1,6}$/.test(raw)) {
      this.linkCard({ serial: Number(raw) });
      return;
    }
    // Not a recognisable card number — treat the raw value as a token (a hand-typed
    // token from a damaged QR); the API will reject it if it isn't one.
    this.linkCard({ token: raw });
  }

  /**
   * Hand a card back to the pool. Confirmed first: unlinking is not cosmetic —
   * the printed card in the student's hand stops opening their profile, and
   * their student code changes back, so a card already given out is worth a
   * question before it is undone.
   */
  confirmUnlinkCard(card: QrCard): void {
    const s = this.student();
    if (!s) return;
    this.confirmationService.confirm({
      header: this.translate.instant('QR_CARDS.UNLINK_TITLE'),
      message: this.translate.instant('QR_CARDS.UNLINK_MSG', {
        serial: serialLabel(card.serial),
        name: s.name,
      }),
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: this.translate.instant('QR_CARDS.UNLINK'),
      rejectLabel: this.translate.instant('STUDENTS.DETAIL.CANCEL'),
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => this.unlinkCard(card),
    });
  }

  private unlinkCard(card: QrCard): void {
    const s = this.student();
    if (!s || this.unlinkingCardId()) return;

    this.unlinkingCardId.set(card.id);
    this.qrCardService.unlink(card.id).subscribe({
      next: () => {
        this.unlinkingCardId.set(null);
        this.notificationService.success(this.translate.instant('QR_CARDS.UNLINKED'));
        this.loadLinkedCards(s.id);
        // Unlinking gives the student a plain code back, server-side — the same
        // refresh the link path needs, for the same reason: the header reads the
        // code straight off this signal and would otherwise show the card's.
        this.studentService.getStudentById(s.id).subscribe({
          next: (updated) => this.student.set(updated),
        });
      },
      // Interceptor toasts the reason.
      error: () => this.unlinkingCardId.set(null),
    });
  }

  private linkCard(by: { token?: string; serial?: number }): void {
    const s = this.student();
    if (!s || this.linkingCard()) return;

    this.linkingCard.set(true);
    this.qrCardService.link(s.id, by).subscribe({
      next: (card) => {
        this.linkingCard.set(false);
        this.notificationService.success(this.translate.instant(
          card.alreadyLinked ? 'QR_CARDS.ALREADY_ON_STUDENT' : 'QR_CARDS.LINKED_OK',
          { serial: serialLabel(card.serial), name: s.name },
        ));
        this.closeLinkCard();
        this.loadLinkedCards(s.id);

        // Linking copies the card's serial into the student's code, server-side.
        // The header renders that code straight off the `student` signal, which
        // the line above does not touch — so it kept showing the old code until
        // the page was reloaded. Re-pull the student and patch the signal.
        //
        // Deliberately not loadStudent(): that flips `loading`, blanking the
        // page under the success toast, and on failure it navigates back to the
        // list — losing the page over a refresh that only cosmetics depend on.
        // Failing quietly here just leaves the stale code, which is where we
        // started, and the linked-cards list already reflects the truth.
        this.studentService.getStudentById(s.id).subscribe({
          next: (updated) => this.student.set(updated),
        });
      },
      // Interceptor toasts the reason — unknown card, or already on someone else.
      error: () => this.linkingCard.set(false),
    });
  }
}
