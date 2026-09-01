import { TablePageUxDirective } from '../../../core/directives/table-page-ux.directive';
import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { TranslateService } from '@ngx-translate/core';
import { AmountPipe } from '../../../shared/pipes/amount.pipe';
import { EnrollmentService } from '../services/enrollment.service';
import { StudentService } from '../../students/services/student.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Enrollment } from '@shared/interfaces/enrollment.interface';
import { Student } from '@shared/interfaces/student.interface';
import { Course } from '@shared/interfaces/course.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

interface EnrollmentDisplay extends Enrollment {
  studentName: string;
  courseName: string;
}

@Component({
  selector: 'app-enrollment-list',
  standalone: true,
  imports: [
    TablePageUxDirective,
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DeleteConfirmDialogComponent,
    AmountPipe,
  ],
  templateUrl: './enrollment-list.component.html'
})
export class EnrollmentListComponent implements OnInit {
  private enrollmentService = inject(EnrollmentService);
  private studentService = inject(StudentService);
  private courseService = inject(CourseService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);

  enrollments = signal<Enrollment[]>([]);
  enrollmentsDisplay = signal<EnrollmentDisplay[]>([]);
  loading = signal(true);
  showDeleteDialog = false;
  enrollmentToDelete = signal<Enrollment | null>(null);

  private students = new Map<string, Student>();
  private courses = new Map<string, Course>();

  ngOnInit() {
    this.loadData();
  }

  async loadData() {
    this.loading.set(true);

    try {
      // Load students and courses first
      const [students, courses] = await Promise.all([
        this.studentService.getAllStudents().toPromise(),
        this.courseService.getAllCourses().toPromise()
      ]);

      // Build lookup maps
      students?.forEach(s => this.students.set(s.id, s));
      courses?.forEach(c => this.courses.set(c.id, c));

      // Load enrollments
      this.loadEnrollments();
    } catch (error) {
      // Interceptor toasted the translated error.
      this.loading.set(false);
    }
  }

  loadEnrollments() {
    this.enrollmentService.getAllEnrollments().subscribe({
      next: (enrollments) => {
        this.enrollments.set(enrollments);

        // Map to display format
        const display = enrollments.map(e => {
          const student = this.students.get(e.studentId);
          const course = this.courses.get(e.courseId);

          return {
            ...e,
            studentName: student ? student.name : 'Unknown',
            courseName: course?.name || 'Unknown',
          };
        });

        this.enrollmentsDisplay.set(display);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getEnrollmentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'ACTIVE': return 'success';
      case 'COMPLETED': return 'info';
      case 'DROPPED': return 'danger';
      case 'PENDING': return 'warn';
      default: return 'info';
    }
  }

  getPaymentStatusSeverity(status: string): 'success' | 'warn' | 'danger' | 'info' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PARTIAL': return 'info';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      default: return 'warn';
    }
  }

  createEnrollment() {
    this.router.navigate(['/enrollments/create']);
  }

  editEnrollment(enrollment: Enrollment) {
    this.router.navigate(['/enrollments', enrollment.id, 'edit']);
  }

  confirmDelete(enrollment: Enrollment) {
    this.enrollmentToDelete.set(enrollment);
    this.showDeleteDialog = true;
  }

  deleteEnrollment() {
    const enrollment = this.enrollmentToDelete();
    if (!enrollment) return;

    this.enrollmentService.deleteEnrollment(enrollment.id).subscribe({
      next: () => {
        this.notificationService.success(this.translate.instant('ENROLLMENTS.DELETED'));
        this.loadEnrollments();
        this.showDeleteDialog = false;
        this.enrollmentToDelete.set(null);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.showDeleteDialog = false;
      }
    });
  }
}
