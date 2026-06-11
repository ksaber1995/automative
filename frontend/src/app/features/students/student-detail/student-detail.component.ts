import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { RadioButtonModule } from 'primeng/radiobutton';
import { ProgressBarModule } from 'primeng/progressbar';
import { TabsModule, Tab, TabList, TabPanel, TabPanels } from 'primeng/tabs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { StudentQrDialogComponent } from '../student-qr/student-qr-dialog.component';
import { StudentService } from '../services/student.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { CourseService } from '../../courses/services/course.service';
import { ClassService } from '../../courses/services/class.service';
import { MasterEnrollmentService } from '../../master-courses/services/master-enrollment.service';
import { MasterCourseService } from '../../master-courses/services/master-course.service';
import { MasterClassEnrollmentService } from '../../master-courses/services/master-class-enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { AttendanceService, StudentAttendanceRecord } from '../../rooms/services/attendance.service';
import { Student } from '@shared/interfaces/student.interface';
import { Enrollment, EnrollmentPayment, Refund } from '@shared/interfaces/enrollment.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Class } from '@shared/interfaces/class.interface';
import { MasterEnrollmentProgress } from '@shared/interfaces/master-enrollment.interface';
import { MasterClassEnrollment } from '@shared/interfaces/master-class-enrollment.interface';
import { LinkedCourseSummary } from '@shared/interfaces/master-course.interface';

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
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    RadioButtonModule,
    ProgressBarModule,
    TabsModule,
    Tab,
    TabList,
    TabPanel,
    TabPanels,
    TranslateModule,
    AmountPipe,
    StudentQrDialogComponent,
  ],
  templateUrl: './student-detail.component.html',
  styleUrl: './student-detail.component.scss'
})
export class StudentDetailComponent implements OnInit {
  private studentService = inject(StudentService);
  private enrollmentService = inject(EnrollmentService);
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private masterEnrollmentService = inject(MasterEnrollmentService);
  private masterCourseService = inject(MasterCourseService);
  private masterClassEnrollmentService = inject(MasterClassEnrollmentService);
  private attendanceService = inject(AttendanceService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  private authService = inject(AuthService);

  /** TEACHER companies don't use master courses, so hide that whole section. */
  isTeacher = computed(() => this.authService.currentUser()?.companyType === 'TEACHER');

  student = signal<Student | null>(null);
  showQrDialog = signal(false);
  enrollments = signal<Enrollment[]>([]);
  masterEnrollments = signal<MasterEnrollmentProgress[]>([]);
  classDoneMap = signal<Map<string, boolean>>(new Map());

  private isEnrollmentFinished(e: Enrollment): boolean {
    return this.classDoneMap().get(e.classId) === true;
  }

  activeEnrollments = computed(() => this.enrollments().filter(e => !this.isEnrollmentFinished(e)));
  finishedEnrollments = computed(() => this.enrollments().filter(e => this.isEnrollmentFinished(e)));
  activeMasterEnrollments = computed(() => this.masterEnrollments().filter(m => m.status !== 'COMPLETED'));
  finishedMasterEnrollments = computed(() => this.masterEnrollments().filter(m => m.status === 'COMPLETED'));
  courses = new Map<string, Course>();
  loading = signal(true);
  studentId: string | null = null;

  // Expandable rows (course enrollments)
  expandedRows: { [key: string]: boolean } = {};
  paymentHistoryMap = signal<Map<string, EnrollmentPayment[]>>(new Map());
  refundHistoryMap = signal<Map<string, Refund[]>>(new Map());

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

  // Attendance
  attendanceRecords = signal<StudentAttendanceRecord[]>([]);
  loadingAttendance = signal(false);
  attendancePresentCount = computed(() => this.attendanceRecords().filter(r => r.isPresent).length);
  attendanceAbsentCount = computed(() => this.attendanceRecords().filter(r => !r.isPresent).length);
  attendanceRate = computed(() => {
    const total = this.attendanceRecords().length;
    if (!total) return 0;
    return Math.round((this.attendancePresentCount() / total) * 100);
  });

  async ngOnInit() {
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      await this.loadCourses();
      this.loadClassesForDoneMap();
      this.loadStudent(this.studentId);
      this.loadEnrollments(this.studentId);
      if (!this.isTeacher()) this.loadMasterEnrollments(this.studentId);
      this.loadAttendance(this.studentId);
    }
  }

  loadClassesForDoneMap() {
    this.classService.getAllClasses().subscribe({
      next: (classes) => {
        const map = new Map<string, boolean>();
        for (const c of classes) {
          map.set(c.id, c.status === 'DONE' || c.isFinished === true);
        }
        this.classDoneMap.set(map);
      },
    });
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
    if (!confirm(this.translate.instant('STUDENTS.MASTER_ENROLLMENT_CANCEL_CONFIRM'))) return;
    this.masterEnrollmentService.cancel(me.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.MASTER_ENROLLMENT_CANCELLED'));
        if (this.studentId) this.loadMasterEnrollments(this.studentId);
      },
      error: () => {
        // Interceptor toasted the translated error.
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

  loadEnrollments(id: string) {
    this.enrollmentService.getEnrollmentsByStudent(id).subscribe({
      next: (enrollments) => {
        this.enrollments.set(enrollments);
        // Auto-load payment & refund history for every enrollment
        enrollments.forEach(e => {
          this.loadPaymentHistory(e.id);
          if ((e.totalRefunded || 0) > 0) this.loadRefundHistory(e.id);
        });
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
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

  submitPayment() {
    const enrollment = this.enrollmentForAction();
    if (!enrollment || !this.dialogPaymentAmount || !this.dialogPaymentDate) return;

    this.actionLoading.set(true);
    const dateStr = this.dialogPaymentDate.toISOString().split('T')[0];

    this.enrollmentService.addPayment(enrollment.id, {
      amount: this.dialogPaymentAmount,
      paymentDate: dateStr,
      notes: this.dialogPaymentNotes || undefined,
    }).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('STUDENTS.PAYMENT_RECORDED'));
        this.showPaymentDialog = false;
        this.actionLoading.set(false);
        this.loadEnrollments(this.studentId!);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.actionLoading.set(false);
      }
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
    const dateStr = this.refundDate.toISOString().split('T')[0];

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
    const dateStr = this.masterRefundDate.toISOString().split('T')[0];

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
    const dateStr = this.masterDialogPaymentDate.toISOString().split('T')[0];
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

  getAge(dateOfBirth: string): number {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
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

  getCourseCode(courseId: string): string {
    return this.courses.get(courseId)?.code || 'N/A';
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getStatusSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
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
}
