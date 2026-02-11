import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { StudentService } from '../services/student.service';
import { EnrollmentService } from '../../enrollments/services/enrollment.service';
import { CourseService } from '../../courses/services/course.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Student } from '@shared/interfaces/student.interface';
import { Enrollment } from '@shared/interfaces/enrollment.interface';
import { Course } from '@shared/interfaces/course.interface';
import { DeleteConfirmDialogComponent } from '../../../shared/components/delete-confirm-dialog/delete-confirm-dialog.component';

@Component({
  selector: 'app-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    TooltipModule,
    DeleteConfirmDialogComponent
  ],
  templateUrl: './student-detail.component.html',
  styleUrl: './student-detail.component.scss'
})
export class StudentDetailComponent implements OnInit {
  private studentService = inject(StudentService);
  private enrollmentService = inject(EnrollmentService);
  private courseService = inject(CourseService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  student = signal<Student | null>(null);
  enrollments = signal<Enrollment[]>([]);
  courses = new Map<string, Course>();
  loading = signal(true);
  showDeleteDialog = false;
  enrollmentToDelete = signal<Enrollment | null>(null);
  studentId: string | null = null;

  async ngOnInit() {
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      // Load courses first for lookup
      await this.loadCourses();
      this.loadStudent(this.studentId);
      this.loadEnrollments(this.studentId);
    }
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
        this.notificationService.error('Failed to load student');
        this.loading.set(false);
        this.router.navigate(['/students']);
      }
    });
  }

  loadEnrollments(id: string) {
    this.enrollmentService.getEnrollmentsByStudent(id).subscribe({
      next: (enrollments) => {
        this.enrollments.set(enrollments);
      },
      error: () => {
        this.notificationService.error('Failed to load enrollments');
      }
    });
  }

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

  enrollStudent() {
    this.router.navigate(['/enrollments/create'], {
      queryParams: { studentId: this.studentId }
    });
  }

  editEnrollment(enrollment: Enrollment) {
    this.router.navigate(['/enrollments', enrollment.id, 'edit']);
  }

  confirmDeleteEnrollment(enrollment: Enrollment) {
    this.enrollmentToDelete.set(enrollment);
    this.showDeleteDialog = true;
  }

  deleteEnrollment() {
    const enrollment = this.enrollmentToDelete();
    if (!enrollment || !this.studentId) return;

    this.enrollmentService.deleteEnrollment(enrollment.id).subscribe({
      next: () => {
        this.notificationService.success('Enrollment deleted successfully');
        this.loadEnrollments(this.studentId!);
        this.showDeleteDialog = false;
        this.enrollmentToDelete.set(null);
      },
      error: () => {
        this.notificationService.error('Failed to delete enrollment');
        this.showDeleteDialog = false;
      }
    });
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

  getPaymentSeverity(status: string): 'success' | 'warn' | 'danger' {
    switch (status) {
      case 'PAID': return 'success';
      case 'PENDING': return 'warn';
      case 'OVERDUE': return 'danger';
      default: return 'warn';
    }
  }
}
