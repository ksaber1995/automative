import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';
import { MultiSelectModule } from 'primeng/multiselect';
import { DialogModule } from 'primeng/dialog';
import { CheckboxModule } from 'primeng/checkbox';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CourseService } from '../services/course.service';
import { LookupService, LookupOption } from '../../../core/services/lookup.service';
import { NotificationService } from '../../../core/services/notification.service';
import { AuthService } from '../../../core/services/auth.service';
import { BranchStateService } from '../../../core/services/branch-state.service';
import { Course, CoursePriceImpact } from '@shared/interfaces/course.interface';

@Component({
  selector: 'app-course-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    TextareaModule,
    InputNumberModule,
    SelectModule,
    MultiSelectModule,
    DialogModule,
    CheckboxModule,
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
  subjects = signal<LookupOption[]>([]);

  // Price-change confirmation. A recurring course keeps charging its price long
  // after it is set, so staff are shown what moves before the save goes through.
  private loadedPrice: number | null = null;
  priceImpact = signal<CoursePriceImpact | null>(null);
  priceDialogVisible = signal(false);
  applyToCurrentUnpaid = signal(false);
  checkingImpact = signal(false);

  constructor() {
    this.courseForm = this.fb.group({
      branchId: ['', [Validators.required]],
      name: ['', [Validators.required, Validators.minLength(3)]],
      description: [''],
      paymentType: ['ONE_TIME', Validators.required],
      price: [0, [Validators.required, Validators.min(0)]],
      instructorId: [''],
      defaultRoomId: [null],
      levelIds: [[] as string[]],
      subjectIds: [[] as string[]],
      // PER_SESSION settings:
      chargeAbsentSessions: [false],
      sessionPackageSize: [null],
      sessionPackagePrice: [null],
    });
  }

  ngOnInit() {
    // Subscribe BEFORE loading branches. LookupService.branches() is a
    // shareReplay cache that BranchStateService warms at app startup, so this
    // call usually emits synchronously — and loadBranches() auto-selects the only
    // branch for a single-branch company. Registering afterwards meant that
    // setValue fired with nobody listening, so rooms were never fetched and the
    // Default room dropdown stayed empty.
    this.courseForm.get('branchId')?.valueChanges.subscribe(branchId => {
      if (branchId) this.loadRooms(branchId);
    });

    this.loadBranches();
    this.loadEmployees();
    // Levels and subjects are academy-only concepts — teachers never see either
    // dropdown, so don't bother fetching the lookups for them.
    if (!this.authService.isTeacher()) {
      this.loadLevels();
      this.loadSubjects();
    }
    this.courseId = this.route.snapshot.paramMap.get('id');
    if (this.courseId) {
      this.isEditMode.set(true);
      this.loadCourse(this.courseId);
    }
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

  loadSubjects() {
    this.lookupService.subjects().subscribe({
      next: (s) => this.subjects.set(s),
      error: () => {},
    });
  }

  loadBranches() {
    this.lookupService.branches().subscribe({
      next: (branches) => {
        this.branches.set(branches);
        if (branches.length === 1 && !this.isEditMode()) {
          const ctrl = this.courseForm.get('branchId');
          if (ctrl && !ctrl.value) {
            ctrl.setValue(branches[0].id);
            // Explicit as well as via valueChanges: setValue is a no-op emit if
            // the control already holds this id, and the rooms list must not
            // depend on that subtlety.
            this.loadRooms(branches[0].id);
          }
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
          instructorId: course.instructorId || '',
          defaultRoomId: (course as any).defaultRoomId || null,
          levelIds: course.levels?.map(l => l.id) ?? (course.levelId ? [course.levelId] : []),
          subjectIds: course.subjects?.map(s => s.id) ?? course.subjectIds ?? [],
          chargeAbsentSessions: (course as any).chargeAbsentSessions ?? false,
          sessionPackageSize: (course as any).sessionPackageSize ?? null,
          sessionPackagePrice: (course as any).sessionPackagePrice ?? null,
        });
        // Payment type is fixed once a course is created — lock it in edit mode.
        this.courseForm.get('paymentType')?.disable();
        // Remember what the price was, to tell a real change from a re-save.
        this.loadedPrice = Number(course.price);
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

    // A price change on a recurring course reaches students who are already on it,
    // so confirm it before saving rather than after. Everything else saves straight
    // through, and so does the price on a one-time course — that only ever applies
    // to the next student to sign up.
    if (this.isEditMode() && this.courseId && this.priceChangeNeedsConfirming()) {
      this.confirmPriceChange();
      return;
    }

    this.save();
  }

  /** Has the price actually moved, on a course whose price keeps being charged? */
  private priceChangeNeedsConfirming(): boolean {
    const { price, paymentType } = this.courseForm.getRawValue();
    const recurring = paymentType === 'MONTHLY_SUBSCRIPTION' || paymentType === 'PER_SESSION';
    return recurring && this.loadedPrice !== null && Number(price) !== this.loadedPrice;
  }

  /** Fetch what the change would do, then show it for confirmation. */
  private confirmPriceChange() {
    this.checkingImpact.set(true);
    this.applyToCurrentUnpaid.set(false);
    this.courseService.getPriceImpact(this.courseId!, Number(this.courseForm.getRawValue().price)).subscribe({
      next: (impact) => {
        this.checkingImpact.set(false);
        this.priceImpact.set(impact);
        this.priceDialogVisible.set(true);
      },
      error: () => {
        // Interceptor toasted the translated error. Without the numbers there is
        // nothing meaningful to confirm against, so leave the form as it is.
        this.checkingImpact.set(false);
      }
    });
  }

  confirmPriceDialog() {
    this.priceDialogVisible.set(false);
    this.save(this.applyToCurrentUnpaid());
  }

  cancelPriceDialog() {
    this.priceDialogVisible.set(false);
  }

  private save(applyToCurrentUnpaid = false) {
    this.loading.set(true);
    // getRawValue() so the disabled paymentType control is still included on edit.
    const formValue = this.courseForm.getRawValue();

    // Clean the data
    const courseData = {
      ...formValue,
      description: formValue.description?.trim() || undefined,
      instructorId: formValue.instructorId || undefined,
      ...(applyToCurrentUnpaid ? { applyToCurrentUnpaid: true } : {}),
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
  get paymentType() { return this.courseForm.get('paymentType'); }
}
