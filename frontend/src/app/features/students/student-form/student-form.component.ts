import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StudentService } from '../services/student.service';
import { BranchService } from '../../branches/services/branch.service';
import { NotificationService } from '../../../core/services/notification.service';
import { Branch } from '@shared/interfaces/branch.interface';
import { ACQUISITION_CHANNELS } from '@shared/interfaces/student.interface';

@Component({
  selector: 'app-student-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    SelectModule,
    DatePickerModule,
    TranslateModule
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
  private translate = inject(TranslateService);

  studentForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  studentId: string | null = null;
  branches = signal<Branch[]>([]);

  acquisitionChannelOptions = ACQUISITION_CHANNELS.map(value => ({
    value,
    label: `STUDENTS.FORM.CHANNEL_${value}`,
  }));

  constructor() {
    const today = new Date();
    this.studentForm = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      dateOfBirth: [null],
      email: ['', [Validators.email]],
      phone: [''],
      parentName: ['', [Validators.required]],
      parentPhone: ['', [Validators.required]],
      parentEmail: ['', [Validators.email]],
      address: [''],
      branchId: ['', [Validators.required]],
      enrollmentDate: [today, [Validators.required]],
      notes: [''],
      acquisitionChannel: [null]
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
        // Interceptor toasted the translated error.
      }
    });
  }

  loadStudent(id: string) {
    this.loading.set(true);
    this.studentService.getStudentById(id).subscribe({
      next: (student) => {
        this.studentForm.patchValue({
          ...student,
          dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth) : null,
          enrollmentDate: student.enrollmentDate ? new Date(student.enrollmentDate) : null
        });
        this.loading.set(false);
      },
      error: () => {
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
    const formValue = this.studentForm.value;
    const studentData = {
      ...formValue,
      dateOfBirth: formValue.dateOfBirth instanceof Date ? formValue.dateOfBirth.toISOString().split('T')[0] : formValue.dateOfBirth,
      enrollmentDate: formValue.enrollmentDate instanceof Date ? formValue.enrollmentDate.toISOString().split('T')[0] : formValue.enrollmentDate
    };

    if (this.isEditMode() && this.studentId) {
      this.studentService.updateStudent(this.studentId, studentData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('STUDENTS.UPDATED'));
          this.router.navigate(['/students']);
        },
        error: (error) => {
          this.loading.set(false);
          console.error('Update error:', error);
        }
      });
    } else {
      this.studentService.createStudent(studentData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('STUDENTS.CREATED'));
          this.router.navigate(['/students']);
        },
        error: (error) => {
          this.loading.set(false);
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
