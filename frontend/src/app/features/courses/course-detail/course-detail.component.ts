import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { AccordionModule } from 'primeng/accordion';
import { PanelModule } from 'primeng/panel';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { DatePickerModule } from 'primeng/datepicker';
import { TextareaModule } from 'primeng/textarea';
import { ProgressBarModule } from 'primeng/progressbar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ConfirmationService } from 'primeng/api';
import { CourseService } from '../services/course.service';
import { ClassService } from '../services/class.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Course } from '@shared/interfaces/course.interface';
import { ClassWithDetails } from '@shared/interfaces/class.interface';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    AccordionModule,
    PanelModule,
    ConfirmDialogModule,
    TooltipModule,
    DialogModule,
    InputNumberModule,
    DatePickerModule,
    TextareaModule,
    ProgressBarModule,
    SelectButtonModule,
    TranslateModule
  ],
  providers: [ConfirmationService],
  templateUrl: './course-detail.component.html',
  styleUrl: './course-detail.component.scss'
})
export class CourseDetailComponent implements OnInit {
  private courseService = inject(CourseService);
  private classService = inject(ClassService);
  private enrollmentService = inject(EnrollmentService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  course = signal<Course | null>(null);
  classes = signal<ClassWithDetails[]>([]);
  enrollments = signal<any[]>([]);
  loading = signal(true);
  loadingEnrollments = signal(false);
  courseId: string | null = null;

  // Payment dialog
  showPaymentDialog = false;
  selectedEnrollment = signal<any | null>(null);
  paymentAmount: number | null = null;
  paymentDate: Date = new Date();
  paymentNotes = '';
  paymentLoading = signal(false);

  // Refund dialog
  showRefundDialog = false;
  refundAmount: number | null = null;
  refundDate: Date = new Date();
  refundType: 'FULL' | 'PARTIAL' = 'PARTIAL';
  refundReason = '';
  refundLoading = signal(false);

  refundTypeOptions = [
    { label: 'Partial', value: 'PARTIAL' },
    { label: 'Full', value: 'FULL' },
  ];

  ngOnInit() {
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.loadCourse(this.courseId);
      this.loadClasses(this.courseId);
      this.loadEnrollments(this.courseId);
    }
  }

  loadCourse(id: string) {
    this.loading.set(true);
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.course.set(course);
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load course');
        this.loading.set(false);
        this.router.navigate(['/courses']);
      }
    });
  }

  loadClasses(courseId: string) {
    this.classService.getClassesByCourse(courseId).subscribe({
      next: async (classes) => {
        const classesWithDetails = await Promise.all(
          classes.map(cls =>
            this.classService.getClassWithDetails(cls.id).toPromise()
          )
        );
        this.classes.set(classesWithDetails.filter(c => c !== undefined) as ClassWithDetails[]);
      },
      error: () => {
        this.notificationService.error('Failed to load classes');
      }
    });
  }

  loadEnrollments(courseId: string) {
    this.loadingEnrollments.set(true);
    this.courseService.getCourseEnrollments(courseId).subscribe({
      next: (data) => {
        this.enrollments.set(data);
        this.loadingEnrollments.set(false);
      },
      error: () => {
        this.loadingEnrollments.set(false);
      }
    });
  }

  // Payment dialog
  openPaymentDialog(enrollment: any) {
    this.selectedEnrollment.set(enrollment);
    this.paymentAmount = parseFloat((enrollment.finalPrice - enrollment.amountPaid).toFixed(2));
    this.paymentDate = new Date();
    this.paymentNotes = '';
    this.showPaymentDialog = true;
  }

  closePaymentDialog() {
    this.showPaymentDialog = false;
    this.selectedEnrollment.set(null);
  }

  submitPayment() {
    if (!this.paymentAmount || !this.paymentDate) return;
    const enrollmentId = this.selectedEnrollment()?.enrollmentId;
    if (!enrollmentId) return;

    this.paymentLoading.set(true);
    this.enrollmentService.addPayment(enrollmentId, {
      amount: this.paymentAmount,
      paymentDate: this.paymentDate.toISOString().split('T')[0],
      notes: this.paymentNotes || undefined
    }).subscribe({
      next: () => {
        this.notificationService.success('Payment recorded successfully');
        this.paymentLoading.set(false);
        this.closePaymentDialog();
        if (this.courseId) this.loadEnrollments(this.courseId);
      },
      error: () => {
        this.notificationService.error('Failed to record payment');
        this.paymentLoading.set(false);
      }
    });
  }

  // Refund dialog
  openRefundDialog(enrollment: any) {
    this.selectedEnrollment.set(enrollment);
    const refundable = enrollment.amountPaid - (enrollment.totalRefunded || 0);
    this.refundAmount = parseFloat(refundable.toFixed(2));
    this.refundDate = new Date();
    this.refundType = 'PARTIAL';
    this.refundReason = '';
    this.showRefundDialog = true;
  }

  closeRefundDialog() {
    this.showRefundDialog = false;
    this.selectedEnrollment.set(null);
  }

  submitRefund() {
    if (!this.refundAmount || !this.refundDate) return;
    const enrollmentId = this.selectedEnrollment()?.enrollmentId;
    if (!enrollmentId) return;

    this.refundLoading.set(true);
    this.enrollmentService.createRefund(enrollmentId, {
      amount: this.refundAmount,
      refundDate: this.refundDate.toISOString().split('T')[0],
      type: this.refundType,
      reason: this.refundReason || undefined
    }).subscribe({
      next: () => {
        this.notificationService.success('Refund processed successfully');
        this.refundLoading.set(false);
        this.closeRefundDialog();
        if (this.courseId) this.loadEnrollments(this.courseId);
      },
      error: (err) => {
        this.notificationService.error(err?.error?.message || 'Failed to process refund');
        this.refundLoading.set(false);
      }
    });
  }

  refundableAmount(enrollment: any): number {
    return Math.max(0, (enrollment.amountPaid || 0) - (enrollment.totalRefunded || 0));
  }

  editCourse() {
    this.router.navigate(['/courses', this.courseId, 'edit']);
  }

  backToList() {
    this.router.navigate(['/courses']);
  }

  createClass() {
    this.router.navigate(['/courses', this.courseId, 'classes', 'create']);
  }

  editClass(classId: string) {
    this.router.navigate(['/courses', this.courseId, 'classes', classId, 'edit']);
  }

  viewStudent(studentId: string) {
    this.router.navigate(['/students', studentId]);
  }

  deleteClass(classId: string) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to deactivate this class?',
      header: 'Confirm Deactivation',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.classService.deleteClass(classId).subscribe({
          next: () => {
            this.notificationService.success('Class deactivated successfully');
            if (this.courseId) {
              this.loadClasses(this.courseId);
            }
          },
          error: () => {
            this.notificationService.error('Failed to deactivate class');
          }
        });
      }
    });
  }

  paymentLabel(status: string): string {
    switch (status?.toUpperCase()) {
      case 'PAID': return 'Complete';
      case 'PARTIAL': return 'Partial';
      case 'PENDING': return 'Pending';
      case 'REFUNDED': return 'Refunded';
      default: return status || 'Unknown';
    }
  }

  getPaymentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      case 'REFUNDED': return 'secondary';
      default: return 'secondary';
    }
  }

  getEnrollmentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    switch (status?.toUpperCase()) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'secondary';
    }
  }

  formatSchedule(schedule: any): string {
    if (!schedule) return 'N/A';
    const days = schedule.days.join(', ');
    return `${days} ${schedule.startTime} - ${schedule.endTime}`;
  }

  formatDate(date: string): string {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}
