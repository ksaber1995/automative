import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Subject, of, merge } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, catchError, takeUntil, filter, tap, map } from 'rxjs/operators';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TextareaModule } from 'primeng/textarea';
import { SelectModule } from 'primeng/select';
import { DatePickerModule } from 'primeng/datepicker';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StudentService, SimilarStudent } from '../services/student.service';
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
    TranslateModule,
    RouterModule
  ],
  templateUrl: './student-form.component.html',
  styleUrl: './student-form.component.scss'
})
export class StudentFormComponent implements OnInit, OnDestroy {
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

  // ── "Do we already have this person?" ─────────────────────────────────────
  /**
   * Existing students whose name reads like the one being typed. Advisory only:
   * the form saves regardless, because two children really can share a name and
   * only the person at the desk can tell which case this is.
   */
  similarStudents = signal<SimilarStudent[]>([]);
  checkingSimilar = signal(false);

  /**
   * Long enough that the lookup fires once the typing stops, not once per
   * letter — an Arabic full name is typed in bursts, and a request per keystroke
   * would both flood the API and flash a hint built from half a name.
   */
  private static readonly TYPING_PAUSE_MS = 450;
  /** Below this the name matches half the school; the server enforces it too. */
  private static readonly MIN_NAME_LENGTH = 3;

  private nameTyped$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor() {
    this.studentForm = this.fb.group({
      name: ['', [Validators.required]],
      dateOfBirth: [null],
      gender: [null, [Validators.required]],
      email: ['', [Validators.email]],
      phone: [''],
      // Guardian details are optional: a student needs a name, nothing more.
      parentName: [''],
      parentPhone: [''],
      address: [''],
      schoolName: [''],
      branchId: ['', [Validators.required]],
      notes: [''],
      acquisitionChannel: [null]
    });
  }

  ngOnInit() {
    // Retries if the app-start load never landed — otherwise this form inherits
    // an empty branch list for the life of the tab.
    this.branchState.ensureLoaded();
    this.loadBranches();
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      this.isEditMode.set(true);
      this.loadStudent(this.studentId);
    }
    this.watchNameForDuplicates();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Ask "do we already have this person?" once the typing settles.
   *
   * `switchMap` is the important operator: a slow answer for "دنيا" must never
   * land after the answer for "دنيا حجازي" and repaint the panel with matches
   * for a name that is no longer in the box. It cancels the in-flight request on
   * every new one, so the hint always belongs to what is on screen.
   */
  private watchNameForDuplicates() {
    const name$ = this.studentForm.get('name')!.valueChanges.pipe(
      debounceTime(StudentFormComponent.TYPING_PAUSE_MS),
      distinctUntilChanged(),
    );
    // Changing the branch re-ranks the answer (its own branch's matches come
    // first), so the question is asked again — with no debounce, because picking
    // from a dropdown is one deliberate act, not typing.
    const branch$ = this.studentForm.get('branchId')!.valueChanges.pipe(
      distinctUntilChanged(),
      map(() => this.studentForm.get('name')?.value ?? ''),
    );

    merge(name$, branch$)
      .pipe(
        takeUntil(this.destroy$),
        tap(() => this.similarStudents.set([])),
        filter((v) => {
          const ok = (v ?? '').trim().length >= StudentFormComponent.MIN_NAME_LENGTH;
          if (!ok) this.checkingSimilar.set(false);
          return ok;
        }),
        tap(() => this.checkingSimilar.set(true)),
        switchMap((v: string) =>
          this.studentService
            .findSimilar(v.trim(), this.studentId, this.studentForm.get('branchId')?.value || null)
            .pipe(
              // A hint that fails is not worth a toast — the form still works.
              catchError(() => of([] as SimilarStudent[])),
            ),
        ),
      )
      .subscribe((matches) => {
        this.checkingSimilar.set(false);
        this.similarStudents.set(matches);
      });
  }

  /** Hide the panel. Editing the name again asks afresh. */
  dismissSimilar() {
    this.similarStudents.set([]);
  }

  /** Any exact match makes the panel a warning rather than a note. */
  hasExactMatch(): boolean {
    return this.similarStudents().some((s) => s.matchType === 'EXACT');
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

  get name() { return this.studentForm.get('name'); }
  get dateOfBirth() { return this.studentForm.get('dateOfBirth'); }
  get gender() { return this.studentForm.get('gender'); }
  get email() { return this.studentForm.get('email'); }
  get parentName() { return this.studentForm.get('parentName'); }
  get parentPhone() { return this.studentForm.get('parentPhone'); }
  get branchId() { return this.studentForm.get('branchId'); }
}
