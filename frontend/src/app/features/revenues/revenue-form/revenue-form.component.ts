import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { RevenueService } from '../services/revenue.service';
import { BranchService } from '../../branches/services/branch.service';
import { CourseService } from '../../courses/services/course.service';
import { StudentService } from '../../students/services/student.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Revenue } from '@shared/interfaces/revenue.interface';
import { Branch } from '@shared/interfaces/branch.interface';
import { Course } from '@shared/interfaces/course.interface';
import { Student } from '@shared/interfaces/student.interface';
import { PaymentMethod } from '@shared/enums/enrollment-status.enum';

@Component({
  selector: 'app-revenue-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    SelectModule,
    DatePickerModule
  ],
  templateUrl: './revenue-form.component.html',
  styleUrl: './revenue-form.component.scss'
})
export class RevenueFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private revenueService = inject(RevenueService);
  private branchService = inject(BranchService);
  private courseService = inject(CourseService);
  private studentService = inject(StudentService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  revenueForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  revenueId: string | null = null;
  branches = signal<Branch[]>([]);
  courses = signal<Course[]>([]);
  students = signal<Student[]>([]);
  paymentMethods = Object.values(PaymentMethod);

  constructor() {
    const today = new Date();
    this.revenueForm = this.fb.group({
      branchId: ['', [Validators.required]],
      courseId: [''],
      studentId: [''],
      amount: [0, [Validators.required, Validators.min(0)]],
      description: ['', [Validators.required]],
      date: [today, [Validators.required]],
      paymentMethod: ['', [Validators.required]],
      receiptNumber: [''],
      notes: ['']
    });
  }

  ngOnInit() {
    this.loadBranches();
    this.loadCourses();
    this.loadStudents();

    this.revenueId = this.route.snapshot.paramMap.get('id');
    if (this.revenueId) {
      this.isEditMode.set(true);
      this.loadRevenue(this.revenueId);
    }
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => this.branches.set(branches)
    });
  }

  loadCourses() {
    this.courseService.getActiveCourses().subscribe({
      next: (courses) => this.courses.set(courses)
    });
  }

  loadStudents() {
    this.studentService.getAllStudents().subscribe({
      next: (students) => this.students.set(students)
    });
  }

  loadRevenue(id: string) {
    this.loading.set(true);
    this.revenueService.getRevenueById(id).subscribe({
      next: (revenue) => {
        this.revenueForm.patchValue({
          ...revenue,
          date: new Date(revenue.date)
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load revenue');
        this.loading.set(false);
        this.router.navigate(['/revenues']);
      }
    });
  }

  onSubmit() {
    if (this.revenueForm.invalid) {
      this.revenueForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const formValue = this.revenueForm.value;
    const revenueData = {
      ...formValue,
      date: formValue.date instanceof Date ? formValue.date.toISOString().split('T')[0] : formValue.date,
      courseId: formValue.courseId || null,
      studentId: formValue.studentId || null
    };

    if (this.isEditMode() && this.revenueId) {
      this.revenueService.updateRevenue(this.revenueId, revenueData).subscribe({
        next: () => {
          this.notificationService.success('Revenue updated successfully');
          this.router.navigate(['/revenues']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update revenue');
          console.error('Update error:', error);
        }
      });
    } else {
      this.revenueService.createRevenue(revenueData).subscribe({
        next: () => {
          this.notificationService.success('Revenue created successfully');
          this.router.navigate(['/revenues']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create revenue');
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/revenues']);
  }

  get branchId() { return this.revenueForm.get('branchId'); }
  get amount() { return this.revenueForm.get('amount'); }
  get description() { return this.revenueForm.get('description'); }
  get date() { return this.revenueForm.get('date'); }
  get paymentMethod() { return this.revenueForm.get('paymentMethod'); }
}
