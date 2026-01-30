import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { StudentService, Enrollment } from '../services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Student } from '@shared/interfaces/student.interface';

@Component({
  selector: 'app-student-detail',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    DialogModule,
    ConfirmDialogModule
  ],
  providers: [ConfirmationService],
  templateUrl: './student-detail.component.html',
  styleUrl: './student-detail.component.scss'
})
export class StudentDetailComponent implements OnInit {
  private studentService = inject(StudentService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private notificationService = inject(NotificationService);
  private confirmationService = inject(ConfirmationService);

  student = signal<Student | null>(null);
  enrollments = signal<Enrollment[]>([]);
  loading = signal(true);
  showEnrollDialog = signal(false);
  enrollForm: FormGroup;
  courses = signal<any[]>([]);
  studentId: string | null = null;

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.enrollForm = this.fb.group({
      courseId: ['', Validators.required],
      enrollmentDate: [today, Validators.required],
      discountPercent: [0],
      discountAmount: [0],
      notes: ['']
    });
  }

  ngOnInit() {
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      this.loadStudent(this.studentId);
      this.loadEnrollments(this.studentId);
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
    this.studentService.getEnrollments(id).subscribe({
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

  openEnrollDialog() {
    this.showEnrollDialog.set(true);
    // In a real app, load available courses here
  }

  closeEnrollDialog() {
    this.showEnrollDialog.set(false);
    this.enrollForm.reset({
      enrollmentDate: new Date().toISOString().split('T')[0],
      discountPercent: 0,
      discountAmount: 0
    });
  }

  enrollStudent() {
    if (this.enrollForm.invalid || !this.studentId) {
      this.enrollForm.markAllAsTouched();
      return;
    }

    this.studentService.enrollStudent(this.studentId, this.enrollForm.value).subscribe({
      next: () => {
        this.notificationService.success('Student enrolled successfully');
        this.loadEnrollments(this.studentId!);
        this.closeEnrollDialog();
      },
      error: () => {
        this.notificationService.error('Failed to enroll student');
      }
    });
  }

  dropEnrollment(enrollment: Enrollment) {
    this.confirmationService.confirm({
      message: 'Are you sure you want to drop this enrollment?',
      header: 'Confirm Drop',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        if (this.studentId) {
          this.studentService.deleteEnrollment(this.studentId, enrollment.id).subscribe({
            next: () => {
              this.notificationService.success('Enrollment dropped');
              this.loadEnrollments(this.studentId!);
            },
            error: () => {
              this.notificationService.error('Failed to drop enrollment');
            }
          });
        }
      }
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
