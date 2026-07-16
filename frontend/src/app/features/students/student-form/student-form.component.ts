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
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { ACQUISITION_CHANNELS } from '@shared/interfaces/student.interface';
import { toLocalYmd } from '../../../core/utils/date.util';

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
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  protected branchState = inject(BranchStateService);

  studentForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  studentId: string | null = null;
  branches = signal<LookupOption[]>([]);

  acquisitionChannelOptions = ACQUISITION_CHANNELS.map(value => ({
    value,
    label: `STUDENTS.FORM.CHANNEL_${value}`,
  }));

  genderOptions = [
    { value: 'MALE', label: 'STUDENTS.FORM.GENDER_MALE' },
    { value: 'FEMALE', label: 'STUDENTS.FORM.GENDER_FEMALE' },
  ];

  constructor() {
    this.studentForm = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      dateOfBirth: [null],
      gender: [null, [Validators.required]],
      email: ['', [Validators.email]],
      phone: [''],
      parentName: ['', [Validators.required]],
      parentPhone: ['', [Validators.required]],
      address: [''],
      branchId: ['', [Validators.required]],
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
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        if (branches.length === 1 && !this.isEditMode()) {
          const ctrl = this.studentForm.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(branches[0].id);
        }
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
          dateOfBirth: student.dateOfBirth ? new Date(student.dateOfBirth) : null
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
      dateOfBirth: toLocalYmd(formValue.dateOfBirth)
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
        next: (student) => {
          this.notificationService.success(this.translate.instant('STUDENTS.CREATED'));
          // Land on the new student, so the next step (enrol, print the card) is
          // one click away instead of a hunt through the list.
          this.router.navigate(student?.id ? ['/students', student.id] : ['/students']);
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
  get gender() { return this.studentForm.get('gender'); }
  get email() { return this.studentForm.get('email'); }
  get parentName() { return this.studentForm.get('parentName'); }
  get parentPhone() { return this.studentForm.get('parentPhone'); }
  get branchId() { return this.studentForm.get('branchId'); }
}
