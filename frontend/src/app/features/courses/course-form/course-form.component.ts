import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CourseService } from '../services/course.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Course } from '@shared/interfaces/course.interface';

@Component({
  selector: 'app-course-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    TranslateModule
  ],
  templateUrl: './course-form.component.html'
})
export class CourseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private courseService = inject(CourseService);
  private lookupService = inject(LookupService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notificationService = inject(NotificationService);
  private translate = inject(TranslateService);
  authService = inject(AuthService);
  protected branchState = inject(BranchStateService);

  courseForm: FormGroup;
  loading = signal(false);
  isEditMode = signal(false);
  courseId: string | null = null;
  branches = signal<LookupOption[]>([]);
  employees = signal<LookupOption[]>([]);
  rooms = signal<LookupOption[]>([]);
  levels = signal<LookupOption[]>([]);

  constructor() {
    this.courseForm = this.fb.group({
      branchId: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      paymentType: ['ONE_TIME', Validators.required],
      price: [0, [Validators.required, Validators.min(0)]],
      duration: [8, [Validators.required, Validators.min(1), Validators.max(52)]],
      maxStudents: [null],
      instructorId: [''],
      defaultRoomId: [null],
      levelId: [null],
      // PER_SESSION settings:
      chargeAbsentSessions: [false],
      sessionPackageSize: [null],
      sessionPackagePrice: [null],
    });
  }

  ngOnInit() {
    this.loadBranches();
    this.loadEmployees();
    this.loadLevels();
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.isEditMode.set(true);
      this.loadCourse(this.courseId);
    }
    // Load rooms when branch changes
    this.courseForm.get('branchId')?.valueChanges.subscribe(branchId => {
      if (branchId) this.loadRooms(branchId);
    });
  }

  loadRooms(branchId: string) {
    this.lookupService.rooms(branchId).subscribe({
      next: (r) => this.rooms.set(r),
      error: () => {},
    });
  }

  loadLevels() {
    this.lookupService.levels().subscribe({
      next: (l) => this.levels.set(l),
      error: () => {},
    });
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        if (branches.length === 1 && !this.isEditMode()) {
          const ctrl = this.courseForm.get('branchId');
          if (ctrl && !ctrl.value) ctrl.setValue(branches[0].id);
        }
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadEmployees() {
    this.lookupService.employees().subscribe({
      next: (employees) => {
        this.employees.set(employees);
      },
      error: () => {
        // Interceptor toasted the translated error.
      }
    });
  }

  loadCourse(id: string) {
    this.loading.set(true);
    this.courseService.getCourseById(id).subscribe({
      next: (course) => {
        this.courseForm.patchValue({
          branchId: course.branchId,
          name: course.name,
          description: course.description || '',
          paymentType: (course as any).paymentType || 'ONE_TIME',
          price: course.price,
          duration: course.duration,
          maxStudents: course.maxStudents,
          instructorId: course.instructorId || '',
          defaultRoomId: (course as any).defaultRoomId || null,
          levelId: course.levelId || null,
          chargeAbsentSessions: (course as any).chargeAbsentSessions ?? false,
          sessionPackageSize: (course as any).sessionPackageSize ?? null,
          sessionPackagePrice: (course as any).sessionPackagePrice ?? null,
        });
        // Payment type is fixed once a course is created — lock it in edit mode.
        this.courseForm.get('paymentType')?.disable();
        // Load rooms for the selected branch
        if (course.branchId) this.loadRooms(course.branchId);
        this.loading.set(false);
      },
      error: () => {
        // Interceptor toasted the translated error.
        this.loading.set(false);
        this.router.navigate(['/courses']);
      }
    });
  }

  onSubmit() {
    if (this.courseForm.invalid) {
      this.courseForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    // getRawValue() so the disabled paymentType control is still included on edit.
    const formValue = this.courseForm.getRawValue();

    // Clean the data
    const courseData = {
      ...formValue,
      description: formValue.description?.trim() || undefined,
      maxStudents: formValue.maxStudents || undefined,
      instructorId: formValue.instructorId || undefined,
    };

    if (this.isEditMode() && this.courseId) {
      this.courseService.updateCourse(this.courseId, courseData).subscribe({
        next: () => {
          this.notificationService.success(this.translate.instant('COURSES.FORM.UPDATE_SUCCESS'));
          this.router.navigate(['/courses']);
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Update error:', error);
        }
      });
    } else {
      this.courseService.createCourse(courseData).subscribe({
        next: () => {
          this.loading.set(false);
          this.notificationService.success(this.translate.instant('COURSES.FORM.CREATE_SUCCESS'));
          this.router.navigate(['/courses']);
        },
        error: (error) => {
          // Interceptor toasted the translated error.
          this.loading.set(false);
          console.error('Create error:', error);
        }
      });
    }
  }

  cancel() {
    this.router.navigate(['/courses']);
  }

  get branchId() { return this.courseForm.get('branchId'); }
  get name() { return this.courseForm.get('name'); }
  get price() { return this.courseForm.get('price'); }
  get duration() { return this.courseForm.get('duration'); }
  get paymentType() { return this.courseForm.get('paymentType'); }
}
