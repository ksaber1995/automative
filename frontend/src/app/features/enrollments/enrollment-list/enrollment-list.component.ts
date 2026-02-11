import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
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
  courseCode: string;
}

@Component({
  selector: 'app-enrollment-list',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DeleteConfirmDialogComponent
  ],
  template: `
    <div class="container-custom py-8">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-900">Enrollments</h1>
        <p-button
          label="New Enrollment"
          icon="pi pi-plus"
          (onClick)="createEnrollment()"
        ></p-button>
      </div>

      <p-card>
        <p-table
          [value]="enrollmentsDisplay()"
          [loading]="loading()"
          [paginator]="true"
          [rows]="10"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} enrollments"
          [rowsPerPageOptions]="[10, 25, 50]"
          responsiveLayout="scroll"
        >
          <ng-template pTemplate="header">
            <tr>
              <th pSortableColumn="studentName">Student <p-sortIcon field="studentName"></p-sortIcon></th>
              <th pSortableColumn="courseName">Course <p-sortIcon field="courseName"></p-sortIcon></th>
              <th pSortableColumn="enrollmentDate">Enrollment Date <p-sortIcon field="enrollmentDate"></p-sortIcon></th>
              <th>Price</th>
              <th>Discount</th>
              <th>Final Price</th>
              <th pSortableColumn="status">Status <p-sortIcon field="status"></p-sortIcon></th>
              <th pSortableColumn="paymentStatus">Payment <p-sortIcon field="paymentStatus"></p-sortIcon></th>
              <th>Actions</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-enrollment>
            <tr>
              <td>{{ enrollment.studentName }}</td>
              <td>
                <div class="font-medium">{{ enrollment.courseName }}</div>
                <div class="text-sm text-gray-600">{{ enrollment.courseCode }}</div>
              </td>
              <td>{{ formatDate(enrollment.enrollmentDate) }}</td>
              <td>\${{ enrollment.originalPrice.toFixed(2) }}</td>
              <td>
                @if (enrollment.discountAmount > 0) {
                  <span class="text-green-600">
                    -\${{ enrollment.discountAmount.toFixed(2) }}
                    @if (enrollment.discountPercent > 0) {
                      <span class="text-xs">({{ enrollment.discountPercent.toFixed(0) }}%)</span>
                    }
                  </span>
                } @else {
                  <span class="text-gray-400">None</span>
                }
              </td>
              <td class="font-semibold">\${{ enrollment.finalPrice.toFixed(2) }}</td>
              <td>
                <p-tag
                  [value]="enrollment.status"
                  [severity]="getEnrollmentStatusSeverity(enrollment.status)"
                ></p-tag>
              </td>
              <td>
                <p-tag
                  [value]="enrollment.paymentStatus"
                  [severity]="getPaymentStatusSeverity(enrollment.paymentStatus)"
                ></p-tag>
              </td>
              <td>
                <div class="flex gap-2">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    severity="warn"
                    (onClick)="editEnrollment(enrollment)"
                    pTooltip="Edit"
                  ></p-button>
                  @if (enrollment.status !== 'DROPPED') {
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="confirmDelete(enrollment)"
                      pTooltip="Delete"
                    ></p-button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9" class="text-center py-8">
                <div class="text-gray-500">
                  <i class="pi pi-inbox text-4xl mb-3"></i>
                  <p>No enrollments found</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <app-delete-confirm-dialog
        [(visible)]="showDeleteDialog"
        [header]="'Delete Enrollment'"
        [message]="'Are you sure you want to delete this enrollment? The student will be removed from the course.'"
        (confirm)="deleteEnrollment()"
      ></app-delete-confirm-dialog>
    </div>
  `
})
export class EnrollmentListComponent implements OnInit {
  private enrollmentService = inject(EnrollmentService);
  private studentService = inject(StudentService);
  private courseService = inject(CourseService);
  private router = inject(Router);
  private notificationService = inject(NotificationService);

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
      this.loading.set(false);
      this.notificationService.error('Failed to load data');
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
            studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
            courseName: course?.name || 'Unknown',
            courseCode: course?.code || 'N/A'
          };
        });

        this.enrollmentsDisplay.set(display);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notificationService.error('Failed to load enrollments');
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
        this.notificationService.success('Enrollment deleted successfully');
        this.loadEnrollments();
        this.showDeleteDialog = false;
        this.enrollmentToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete enrollment');
        this.showDeleteDialog = false;
      }
    });
  }
}
