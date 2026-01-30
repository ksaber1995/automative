import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { StudentService } from '../services/student.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';

@Component({
  selector: 'app-student-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule
  ],
  templateUrl: './student-form.component.html',
  styleUrl: './student-form.component.scss'
})
export class StudentFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private studentService = inject(StudentService);
  private branchService = inject(BranchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);

  studentForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  studentId: string | null = null;
  branches = signal<Branch[]>([]);

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.studentForm = this.fb.group({
      firstName: ['', [Validators.required, Validators.minLength(2)]],
      lastName: ['', [Validators.required, Validators.minLength(2)]],
      dateOfBirth: ['', [Validators.required]],
      email: ['', [Validators.email]],
      phone: [''],
      parentName: ['', [Validators.required, Validators.minLength(3)]],
      parentPhone: ['', [Validators.required]],
      parentEmail: ['', [Validators.email]],
      address: [''],
      branchId: ['', [Validators.required]],
      enrollmentDate: [today, [Validators.required]],
      notes: ['']
    });
  }

  ngOnInit() {
    this.loadBranches();
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      this.isEditMode.set(true);
      this.loadStudent(this.studentId);
    }
  }

  loadBranches() {
    this.branchService.getActiveBranches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
      },
      error: () => {
        this.notificationService.error('Failed to load branches');
      }
    });
  }

  loadStudent(id: string) {
    this.loading.set(true);
    this.studentService.getStudentById(id).subscribe({
      next: (student) => {
        this.studentForm.patchValue({
          ...student,
          dateOfBirth: student.dateOfBirth.split('T')[0],
          enrollmentDate: student.enrollmentDate.split('T')[0]
        });
        this.loading.set(false);
      },
      error: () => {
        this.notificationService.error('Failed to load student');
        this.loading.set(false);
        this.router.navigate(['/students']);
      }
    });
  }

  onSubmit() {
    if (this.studentForm.invalid) {
      this.studentForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    const studentData = this.studentForm.value;

    if (this.isEditMode() && this.studentId) {
      this.studentService.updateStudent(this.studentId, studentData).subscribe({
        next: () => {
          this.notificationService.success('Student updated successfully');
          this.router.navigate(['/students']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to update student');
          console.error('Update error:', error);
        }
      });
    } else {
      this.studentService.createStudent(studentData).subscribe({
        next: () => {
          this.notificationService.success('Student created successfully');
          this.router.navigate(['/students']);
        },
        error: (error) => {
          this.loading.set(false);
          this.notificationService.error('Failed to create student');
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/students']);
  }

  get firstName() { return this.studentForm.get('firstName'); }
  get lastName() { return this.studentForm.get('lastName'); }
  get dateOfBirth() { return this.studentForm.get('dateOfBirth'); }
  get email() { return this.studentForm.get('email'); }
  get parentName() { return this.studentForm.get('parentName'); }
  get parentPhone() { return this.studentForm.get('parentPhone'); }
  get parentEmail() { return this.studentForm.get('parentEmail'); }
  get branchId() { return this.studentForm.get('branchId'); }
  get enrollmentDate() { return this.studentForm.get('enrollmentDate'); }
}
